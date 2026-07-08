use std::fs;
use std::path::Path;
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use super::claims::{self, Claim, ClaimSource, ClaimHistoryEntry};
use super::decay::FreshnessState;
use super::contradictions::{self, Contradiction, ContradictionClaimRef, ContradictionStatus};
use super::history::save_history_diff;
use crate::agent::provider::LlmClient;
use crate::agent::tools::WebSearchConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecayScanResult {
    pub total: usize,
    pub fresh: usize,
    pub aging: usize,
    pub stale: usize,
    pub decayed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReVerificationResult {
    pub scanned: usize,
    pub corroborated: usize,
    pub contradicted: usize,
    pub neutral: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QueryGenerationResponse {
    pub queries: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EvidenceSource {
    pub url: String,
    pub title: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EvidenceEvaluationResponse {
    pub verdict: String, // "corroborates", "contradicts", "neutral"
    pub explanation: String,
    pub new_sources: Vec<EvidenceSource>,
}

fn slugify(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

async fn check_url_head(url: &str) -> bool {
    let client = reqwest::Client::new();
    match client.head(url).send().await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

fn clean_json_response(s: &str) -> String {
    let s = s.trim();
    let s = s.strip_prefix("```json").unwrap_or(s);
    let s = s.strip_prefix("```").unwrap_or(s);
    let s = s.strip_suffix("```").unwrap_or(s);
    s.trim().to_string()
}

pub fn run_decay_scan(project_path: &str) -> Result<DecayScanResult, String> {
    let claims_dir = Path::new(project_path).join("wiki").join("claims");
    if !claims_dir.exists() {
        return Ok(DecayScanResult { total: 0, fresh: 0, aging: 0, stale: 0, decayed: 0 });
    }

    let entries = fs::read_dir(claims_dir)
        .map_err(|e| format!("Failed to read claims directory: {e}"))?;

    let mut result = DecayScanResult { total: 0, fresh: 0, aging: 0, stale: 0, decayed: 0 };
    let now = Local::now().naive_local().date();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read claim directory entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("md") {
            let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if let Ok(mut claim) = claims::get_claim(project_path, filename) {
                let old_serialized = claims::serialize_claim(&claim);
                claim.apply_decay(now);
                
                result.total += 1;
                match claim.freshness_state {
                    FreshnessState::Fresh => result.fresh += 1,
                    FreshnessState::Aging => result.aging += 1,
                    FreshnessState::Stale => result.stale += 1,
                    FreshnessState::Decayed => result.decayed += 1,
                }

                let new_serialized = claims::serialize_claim(&claim);
                if old_serialized != new_serialized {
                    let slug = filename.strip_suffix(".md").unwrap_or(filename);
                    let _ = save_history_diff(project_path, slug, &old_serialized, &new_serialized);
                    let _ = claims::update_claim(project_path, filename, &claim);
                }
            }
        }
    }

    Ok(result)
}

pub async fn run_re_verification(
    project_path: &str,
    provider: &LlmClient,
    search_config: Option<WebSearchConfig>,
    app: &tauri::AppHandle,
) -> Result<ReVerificationResult, String> {
    let claims_dir = Path::new(project_path).join("wiki").join("claims");
    if !claims_dir.exists() {
        return Ok(ReVerificationResult { scanned: 0, corroborated: 0, contradicted: 0, neutral: 0, errors: Vec::new() });
    }

    let entries = fs::read_dir(claims_dir)
        .map_err(|e| format!("Failed to read claims directory: {e}"))?;

    let mut result = ReVerificationResult {
        scanned: 0,
        corroborated: 0,
        contradicted: 0,
        neutral: 0,
        errors: Vec::new(),
    };

    let now_date_str = Local::now().format("%Y-%m-%d").to_string();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read claim directory entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }

        let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let mut claim = match claims::get_claim(project_path, filename) {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Scan only Stale or Decayed claims
        if claim.freshness_state != FreshnessState::Stale && claim.freshness_state != FreshnessState::Decayed {
            continue;
        }

        result.scanned += 1;

        // 1. Generate search queries
        let query_system_prompt = "You are a research assistant. Generate 2 targeted search engine queries to find verification or disproving evidence for the provided factual claim. Output ONLY a JSON object in this format:\n{\n  \"queries\": [\"query 1\", \"query 2\"]\n}";
        let query_user_prompt = format!("Generate search queries for this claim: \"{}\"", claim.title);
        
        let queries = match provider.generate_text(query_system_prompt, &query_user_prompt, &[]).await {
            Ok(resp) => {
                let clean = clean_json_response(&resp);
                serde_json::from_str::<QueryGenerationResponse>(&clean)
                    .map(|r| r.queries)
                    .unwrap_or_else(|_| vec![claim.title.clone()])
            }
            Err(_) => vec![claim.title.clone()],
        };

        // 2. Execute searches and collect evidence
        let mut search_snippets = Vec::new();
        for query in &queries {
            if let Some(ref config) = search_config {
                if let Ok(refs) = crate::agent::tools::run_web_search(query, Some(config.clone()), 3).await {
                    for r in refs {
                        let url = r.path.clone();
                        let is_alive = check_url_head(&url).await;
                        let excerpt = r.snippet.unwrap_or_default();
                        search_snippets.push(format!(
                            "URL: {}\nTitle: {}\nStatus: {}\nSnippet: {}\n---",
                            url,
                            r.title,
                            if is_alive { "Online" } else { "Offline" },
                            excerpt
                        ));
                    }
                }
            }
        }

        if search_snippets.is_empty() {
            // Neutral re-verification: resets last_verified without changing C_base
            let old_serialized = claims::serialize_claim(&claim);
            claim.last_verified = now_date_str.clone();
            claim.history.push(ClaimHistoryEntry {
                date: now_date_str.clone(),
                confidence: claim.confidence,
                event: "re_verification_neutral".to_string(),
                source: "automated_search".to_string(),
                note: Some("No search evidence found. Refreshing timestamp.".to_string()),
            });
            let new_serialized = claims::serialize_claim(&claim);
            let _ = save_history_diff(project_path, filename.strip_suffix(".md").unwrap_or(filename), &old_serialized, &new_serialized);
            let _ = claims::update_claim(project_path, filename, &claim);
            result.neutral += 1;
            continue;
        }

        // 3. Call LLM to evaluate evidence
        let eval_system_prompt = r#"You are an expert fact-checker. Compare the Claim to the gathered search results (evidence).
Determine if the evidence corroborates, contradicts, or is neutral to the claim.
Output ONLY a JSON object in this format:
{
  "verdict": "corroborates" | "contradicts" | "neutral",
  "explanation": "Brief explanation of verdict",
  "new_sources": [
    {
      "url": "URL of supporting evidence",
      "title": "Title of supporting page",
      "excerpt": "Exact snippet supporting the verdict"
    }
  ]
}"#;
        let eval_user_prompt = format!(
            "Claim: \"{}\"\n\nGathered Evidence:\n{}",
            claim.title,
            search_snippets.join("\n")
        );

        match provider.generate_text(eval_system_prompt, &eval_user_prompt, &[]).await {
            Ok(resp) => {
                let _ = super::scheduler::check_and_update_budget(project_path, 0.015);
                let clean = clean_json_response(&resp);
                if let Ok(eval) = serde_json::from_str::<EvidenceEvaluationResponse>(&clean) {
                    let old_serialized = claims::serialize_claim(&claim);
                    claim.last_verified = now_date_str.clone();
                    claim.verification_count += 1;

                    match eval.verdict.as_str() {
                        "corroborates" => {
                            // corroboration: C_base += 0.05 * new_sources, clamp 1.0
                            let boost = 0.05 * eval.new_sources.len() as f64;
                            claim.confidence = (claim.confidence + boost).min(1.0);
                            
                            // add new sources
                            for src in eval.new_sources {
                                claim.sources.push(ClaimSource {
                                    path: src.url.clone(),
                                    page: None,
                                    excerpt: src.excerpt,
                                    verified_at: now_date_str.clone(),
                                    url: Some(src.url),
                                });
                            }
                            claim.source_count = claim.sources.len();
                            claim.history.push(ClaimHistoryEntry {
                                date: now_date_str.clone(),
                                confidence: claim.confidence,
                                event: "corroboration".to_string(),
                                source: "automated_search".to_string(),
                                note: Some(eval.explanation),
                            });
                            result.corroborated += 1;
                        }
                        "contradicts" => {
                            // contradiction: C_base -= 0.15, clamp 0.0
                            claim.confidence = (claim.confidence - 0.15).max(0.0);
                            claim.contradiction_count += 1;
                            claim.history.push(ClaimHistoryEntry {
                                date: now_date_str.clone(),
                                confidence: claim.confidence,
                                event: "contradiction".to_string(),
                                source: "automated_search".to_string(),
                                note: Some(eval.explanation.clone()),
                            });
                            
                            // Create contradiction record
                            let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
                            let contra_filename = format!("{}_{}.md", slugify(&claim.title), timestamp);

                            let claim_b_filename = format!("contra_claim_{}_{}.md", slugify(&claim.title), timestamp);
                            let mut claim_b = Claim {
                                title: format!("Contradicting evidence: {}", eval.explanation),
                                r#type: "claim".to_string(),
                                confidence: 0.8,
                                source_count: eval.new_sources.len(),
                                last_verified: now_date_str.clone(),
                                verification_count: 1,
                                contradiction_count: 1,
                                freshness_state: FreshnessState::Fresh,
                                date: now_date_str.clone(),
                                tags: claim.tags.clone(),
                                domain_volatility: claim.domain_volatility.clone(),
                                description: Some(format!("Counter-claim to: {}", claim.title)),
                                sources: eval.new_sources.iter().map(|src| ClaimSource {
                                    path: src.url.clone(),
                                    page: None,
                                    excerpt: src.excerpt.clone(),
                                    verified_at: now_date_str.clone(),
                                    url: Some(src.url.clone()),
                                }).collect(),
                                parent_concepts: claim.parent_concepts.clone(),
                                contradictions: vec![format!("contradictions/{}", contra_filename)],
                                history: vec![ClaimHistoryEntry {
                                    date: now_date_str.clone(),
                                    confidence: 0.8,
                                    event: "initial_extraction".to_string(),
                                    source: "automated_search".to_string(),
                                    note: Some("Created automatically as contradicting evidence".to_string()),
                                }],
                                content: format!("This claim was automatically created to represent contradicting evidence found for claim: \"{}\".\n\nExplanation: {}\n", claim.title, eval.explanation),
                            };
                            let _ = claims::create_claim(project_path, &claim_b_filename, &claim_b);
                            
                            let mut contra = Contradiction {
                                title: format!("Dispute: {}", claim.title),
                                r#type: "contradiction".to_string(),
                                status: ContradictionStatus::Open,
                                date: now_date_str.clone(),
                                tags: claim.tags.clone(),
                                claims: vec![
                                    ContradictionClaimRef {
                                        path: format!("claims/{}", filename),
                                        position: claim.title.clone(),
                                    },
                                    ContradictionClaimRef {
                                        path: format!("claims/{}", claim_b_filename),
                                        position: claim_b.title.clone(),
                                    },
                                ],
                                judge_votes: Vec::new(),
                                resolution_method: None,
                                resolution: None,
                                resolved_at: None,
                                resolved_by: None,
                                description: Some(eval.explanation.clone()),
                                new_evidence: Some(search_snippets.join("\n")),
                                content: "Contradiction detected automatically during scheduled maintenance scan.\n".to_string(),
                            };

                            let _ = contradictions::create_contradiction(project_path, &contra_filename, &contra);
                            result.contradicted += 1;

                            // Run ensemble
                            if let Ok((verdict, votes)) = super::ensemble::run_ensemble(project_path, &contra, app).await {
                                contra.judge_votes = votes;
                                match verdict.verdict.as_str() {
                                    "accept_a" => {
                                        contra.status = ContradictionStatus::Resolved;
                                        contra.resolution_method = Some("ensemble_majority".to_string());
                                        contra.resolved_by = Some("ensemble".to_string());
                                        contra.resolved_at = Some(now_date_str.clone());
                                        contra.resolution = Some(format!("Claim A accepted. Reasoning: {}", verdict.reasoning));
                                        
                                        // Update Claim A
                                        claim.confidence = (claim.confidence + 0.1).min(1.0); // restore confidence
                                        claim.contradiction_count = 0;
                                        claim.history.push(ClaimHistoryEntry {
                                            date: now_date_str.clone(),
                                            confidence: claim.confidence,
                                            event: "contradiction_resolved".to_string(),
                                            source: "judge_ensemble".to_string(),
                                            note: Some(format!("Resolved: Claim A accepted by ensemble. Reasoning: {}", verdict.reasoning)),
                                        });

                                        // Update Claim B
                                        claim_b.confidence = 0.0;
                                        claim_b.contradiction_count = 0;
                                        claim_b.history.push(ClaimHistoryEntry {
                                            date: now_date_str.clone(),
                                            confidence: 0.0,
                                            event: "contradiction_resolved".to_string(),
                                            source: "judge_ensemble".to_string(),
                                            note: Some(format!("Resolved: Claim A accepted by ensemble. Claim B deprecated. Reasoning: {}", verdict.reasoning)),
                                        });
                                        let _ = claims::update_claim(project_path, &claim_b_filename, &claim_b);
                                    }
                                    "accept_b" => {
                                        contra.status = ContradictionStatus::Resolved;
                                        contra.resolution_method = Some("ensemble_majority".to_string());
                                        contra.resolved_by = Some("ensemble".to_string());
                                        contra.resolved_at = Some(now_date_str.clone());
                                        contra.resolution = Some(format!("Claim B accepted. Reasoning: {}", verdict.reasoning));
                                        
                                        // Update Claim A (deprecated)
                                        claim.confidence = 0.0;
                                        claim.contradiction_count = 0;
                                        claim.history.push(ClaimHistoryEntry {
                                            date: now_date_str.clone(),
                                            confidence: 0.0,
                                            event: "contradiction_resolved".to_string(),
                                            source: "judge_ensemble".to_string(),
                                            note: Some(format!("Resolved: Claim B accepted by ensemble. Claim A deprecated. Reasoning: {}", verdict.reasoning)),
                                        });

                                        // Update Claim B
                                        claim_b.confidence = 1.0;
                                        claim_b.contradiction_count = 0;
                                        claim_b.history.push(ClaimHistoryEntry {
                                            date: now_date_str.clone(),
                                            confidence: 1.0,
                                            event: "contradiction_resolved".to_string(),
                                            source: "judge_ensemble".to_string(),
                                            note: Some(format!("Resolved: Claim B accepted by ensemble. Reasoning: {}", verdict.reasoning)),
                                        });
                                        let _ = claims::update_claim(project_path, &claim_b_filename, &claim_b);
                                    }
                                    "merge" => {
                                        contra.status = ContradictionStatus::Resolved;
                                        contra.resolution_method = Some("ensemble_majority".to_string());
                                        contra.resolved_by = Some("ensemble".to_string());
                                        contra.resolved_at = Some(now_date_str.clone());
                                        contra.resolution = Some(format!("Merged Claims. Reasoning: {}", verdict.reasoning));
                                        
                                        claim.contradiction_count = 0;
                                        claim_b.contradiction_count = 0;
                                        let avg_confidence = ((claim.confidence + claim_b.confidence) / 2.0).min(1.0).max(0.0);
                                        claim.confidence = avg_confidence;
                                        claim_b.confidence = avg_confidence;
                                        
                                        claim.history.push(ClaimHistoryEntry {
                                            date: now_date_str.clone(),
                                            confidence: avg_confidence,
                                            event: "contradiction_resolved".to_string(),
                                            source: "judge_ensemble".to_string(),
                                            note: Some(format!("Resolved: Merged claims by ensemble. Reasoning: {}", verdict.reasoning)),
                                        });
                                        claim_b.history.push(ClaimHistoryEntry {
                                            date: now_date_str.clone(),
                                            confidence: avg_confidence,
                                            event: "contradiction_resolved".to_string(),
                                            source: "judge_ensemble".to_string(),
                                            note: Some(format!("Resolved: Merged claims by ensemble. Reasoning: {}", verdict.reasoning)),
                                        });
                                        let _ = claims::update_claim(project_path, &claim_b_filename, &claim_b);
                                    }
                                    _ => {
                                        // Escalate to Review
                                        contra.status = ContradictionStatus::Escalated;
                                        
                                        let reasonings = contra.judge_votes.iter().map(|v| {
                                            format!("{}: {} (confidence: {})", v.judge_id, v.reasoning, v.confidence)
                                        }).collect::<Vec<_>>().join("\n");

                                        let description = format!(
                                            "The 3-judge ensemble could not agree on a resolution (escalation threshold not met or split vote).\n\nJudge Reasonings:\n{}",
                                            reasonings
                                        );

                                        let options = serde_json::json!([
                                            { "label": "Accept A (Keep Original)", "action": "accept_a" },
                                            { "label": "Accept B (Use Counter-claim)", "action": "accept_b" },
                                            { "label": "Merge Claims", "action": "merge" },
                                            { "label": "Dismiss Dispute", "action": "dismiss" }
                                        ]);

                                        let affected = vec![
                                            format!("claims/{}", filename),
                                            format!("claims/{}", claim_b_filename)
                                        ];

                                        let _ = super::ensemble::add_review_item(
                                            project_path,
                                            "contradiction",
                                            &format!("Dispute: {}", claim.title),
                                            &description,
                                            &format!("wiki/contradictions/{}", contra_filename),
                                            affected,
                                            options.as_array().unwrap().clone()
                                        );
                                    }
                                }
                                let _ = contradictions::update_contradiction(project_path, &contra_filename, &contra);
                            }
                        }
                        _ => {
                            // Neutral
                            claim.history.push(ClaimHistoryEntry {
                                date: now_date_str.clone(),
                                confidence: claim.confidence,
                                event: "re_verification_neutral".to_string(),
                                source: "automated_search".to_string(),
                                note: Some(eval.explanation),
                            });
                            result.neutral += 1;
                        }
                    }
                    
                    let new_serialized = claims::serialize_claim(&claim);
                    let _ = save_history_diff(project_path, filename.strip_suffix(".md").unwrap_or(filename), &old_serialized, &new_serialized);
                    let _ = claims::update_claim(project_path, filename, &claim);
                } else {
                    result.errors.push(format!("Failed to parse evaluation response for claim {}: {}", claim.title, resp));
                }
            }
            Err(e) => {
                result.errors.push(format!("LLM generation failed for claim {}: {}", claim.title, e));
            }
        }
    }

    Ok(result)
}
