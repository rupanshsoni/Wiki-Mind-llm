use std::fs;
use std::path::Path;
use chrono::Local;
use serde::{Deserialize, Serialize};
use crate::agent::provider::{LlmClient, AgentLlmProvider};
use crate::agent::tools::WebSearchConfig;
use super::claims::{self, Claim};
use super::contradictions::{Contradiction, JudgeVote};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JudgeVerdict {
    pub verdict: String, // accept_a | accept_b | merge | needs_evidence | escalate
    pub reasoning: String,
    pub confidence: f64,
}

#[derive(Debug, Deserialize)]
struct EnsembleConfig {
    fallback_to_single_judge: Option<bool>,
    escalation_threshold: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct LocalScheduleConfig {
    ensemble: Option<EnsembleConfig>,
}

fn clean_json_response(s: &str) -> String {
    let s = s.trim();
    let s = s.strip_prefix("```json").unwrap_or(s);
    let s = s.strip_prefix("```").unwrap_or(s);
    let s = s.strip_suffix("```").unwrap_or(s);
    s.trim().to_string()
}

fn build_judge_prompt(
    claim_a: &Claim,
    claim_b: &Claim,
    new_evidence: &str,
) -> String {
    let mut claim_a_sources_str = String::new();
    for src in &claim_a.sources {
        let page_str = match src.page {
            Some(p) => format!(", p.{}", p),
            None => String::new(),
        };
        claim_a_sources_str.push_str(&format!(
            "  - {}{}: \"{}\"\n    Last verified: {}\n",
            src.path, page_str, src.excerpt, src.verified_at
        ));
    }

    let mut claim_b_sources_str = String::new();
    for src in &claim_b.sources {
        let page_str = match src.page {
            Some(p) => format!(", p.{}", p),
            None => String::new(),
        };
        claim_b_sources_str.push_str(&format!(
            "  - {}{}: \"{}\"\n    Last verified: {}\n",
            src.path, page_str, src.excerpt, src.verified_at
        ));
    }

    format!(
        r#"You are an expert fact-checker evaluating a factual disagreement between two claims
in a knowledge base. Your job is to determine which claim is more likely correct based
on the evidence provided.

## CLAIM A
Title: {}
Text: {}
Sources ({} total):
{}Confidence: {:.2}
Last verified: {}

## CLAIM B
Title: {}
Text: {}
Sources ({} total):
{}Confidence: {:.2}
Last verified: {}

## ADDITIONAL EVIDENCE (from re-research)
{}

## EVALUATION CRITERIA
Consider:
1. Source authority: academic papers > official documentation > news articles > blog posts
2. Recency: more recent sources are generally more authoritative for fast-moving domains
3. Independence: claims corroborated by independent sources are stronger
4. Precision: determine if the contradiction is genuine or apparent (rounding, different contexts, different time periods)
5. Scope: one claim may be a subset or approximation of the other

## REQUIRED OUTPUT
Respond with a single JSON object (no markdown fencing):
{{
  "verdict": "accept_a" | "accept_b" | "merge" | "needs_evidence" | "escalate",
  "reasoning": "2-3 sentence explanation of your decision",
  "confidence": <float 0.0 to 1.0 — how confident you are in this verdict>
}}

Definitions:
- accept_a: Claim A is correct; Claim B should be deprecated or corrected
- accept_b: Claim B is correct; Claim A should be deprecated or corrected
- merge: Both claims are compatible (e.g., rounding, different contexts); they should be merged
- needs_evidence: Cannot determine without additional research; request a deeper investigation
- escalate: Genuinely ambiguous; requires human judgment to resolve"#,
        claim_a.title,
        claim_a.description.as_deref().unwrap_or(&claim_a.content),
        claim_a.source_count,
        claim_a_sources_str,
        claim_a.confidence,
        claim_a.last_verified,
        claim_b.title,
        claim_b.description.as_deref().unwrap_or(&claim_b.content),
        claim_b.source_count,
        claim_b_sources_str,
        claim_b.confidence,
        claim_b.last_verified,
        new_evidence
    )
}

async fn run_single_judge_vote(
    judge_id: &str,
    client: &LlmClient,
    prompt: &str,
) -> Result<JudgeVote, String> {
    let system_prompt = "You are an expert fact-checker evaluating a factual disagreement between two claims. Respond ONLY with the requested JSON object.";
    let response_text = client.generate_text(system_prompt, prompt, &[]).await?;
    let clean = clean_json_response(&response_text);
    
    let res = serde_json::from_str::<JudgeVerdict>(&clean)
        .map_err(|e| format!("Failed to parse judge JSON: {}. Raw response: {}", e, response_text))?;
        
    Ok(JudgeVote {
        judge_id: judge_id.to_string(),
        model: client.model_name().to_string(),
        verdict: res.verdict,
        reasoning: res.reasoning,
        confidence: res.confidence,
        voted_at: Local::now().to_rfc3339(),
    })
}

pub async fn run_ensemble(
    project_path: &str,
    contradiction: &Contradiction,
    app_handle: &tauri::AppHandle,
) -> Result<(JudgeVerdict, Vec<JudgeVote>), String> {
    // 1. Get linked claims
    if contradiction.claims.len() < 2 {
        return Err("Contradiction does not link to at least 2 claims".to_string());
    }

    let file_a = contradiction.claims[0].path.strip_prefix("claims/").unwrap_or(&contradiction.claims[0].path);
    let file_b = contradiction.claims[1].path.strip_prefix("claims/").unwrap_or(&contradiction.claims[1].path);

    let claim_a = claims::get_claim(project_path, file_a)
        .map_err(|e| format!("Failed to read Claim A: {}", e))?;
    let claim_b = claims::get_claim(project_path, file_b)
        .map_err(|e| format!("Failed to read Claim B: {}", e))?;

    // 2. Load configurations
    let app_config = crate::load_agent_runtime_config(app_handle);
    let main_llm = app_config.llm.clone();

    let mut judge_configs = vec![
        ("judge-1", app_config.judge1.clone()),
        ("judge-2", app_config.judge2.clone()),
        ("judge-3", app_config.judge3.clone()),
    ];

    // Load schedule config for fallback / threshold
    let schedule_file = Path::new(project_path).join(".wikimind").join("schedule.json");
    let mut fallback_to_single_judge = true;
    let mut escalation_threshold = 0.6;

    if schedule_file.exists() {
        if let Ok(raw) = fs::read_to_string(schedule_file) {
            if let Ok(cfg) = serde_json::from_str::<LocalScheduleConfig>(&raw) {
                if let Some(ens) = cfg.ensemble {
                    if let Some(fb) = ens.fallback_to_single_judge {
                        fallback_to_single_judge = fb;
                    }
                    if let Some(eth) = ens.escalation_threshold {
                        escalation_threshold = eth;
                    }
                }
            }
        }
    }

    // 3. Build LLM clients
    let mut clients = Vec::new();
    for (id, cfg) in judge_configs {
        if let Some(c) = cfg {
            if c.is_usable_for_backend_http() {
                if let Ok(client) = LlmClient::new(c) {
                    clients.push((id.to_string(), client));
                }
            }
        }
    }

    // If less than 3 judges are configured, handle fallback
    if clients.len() < 3 {
        if fallback_to_single_judge {
            if let Some(ref main_cfg) = main_llm {
                if main_cfg.is_usable_for_backend_http() {
                    if let Ok(client) = LlmClient::new(main_cfg.clone()) {
                        // Re-initialize judges using main LLM configuration
                        clients.clear();
                        clients.push(("judge-1".to_string(), client));
                    }
                }
            }
        }
    }

    if clients.is_empty() {
        return Err("No usable LLM configuration found for ensemble judges".to_string());
    }

    // 4. Build prompt
    let new_evidence = contradiction.new_evidence.as_deref().unwrap_or("No new evidence.");
    let prompt = build_judge_prompt(&claim_a, &claim_b, new_evidence);

    // 5. Execute LLM votes in parallel (or single judge if fallback)
    let mut votes = Vec::new();
    let mut futures = Vec::new();

    for (id, client) in &clients {
        let id_clone = id.clone();
        let client_clone = client.clone();
        let prompt_clone = prompt.clone();
        futures.push(tokio::spawn(async move {
            run_single_judge_vote(&id_clone, &client_clone, &prompt_clone).await
        }));
    }

    for f in futures {
        match f.await {
            Ok(Ok(vote)) => votes.push(vote),
            Ok(Err(e)) => println!("[Ensemble] Judge failed: {}", e),
            Err(e) => println!("[Ensemble] Task join failed: {}", e),
        }
    }

    if votes.is_empty() {
        return Err("All judge votes failed".to_string());
    }

    // Tally cost: $0.015 per vote
    let cost = (votes.len() as f64) * 0.015;
    let _ = super::scheduler::check_and_update_budget(project_path, cost);

    // 6. Aggregate votes
    let mut weight_accept_a = 0.0;
    let mut weight_accept_b = 0.0;
    let mut weight_merge = 0.0;
    let mut weight_needs_evidence = 0.0;
    let mut weight_escalate = 0.0;

    for vote in &votes {
        match vote.verdict.as_str() {
            "accept_a" => weight_accept_a += vote.confidence,
            "accept_b" => weight_accept_b += vote.confidence,
            "merge" => weight_merge += vote.confidence,
            "needs_evidence" => weight_needs_evidence += vote.confidence,
            "escalate" => weight_escalate += vote.confidence,
            _ => weight_escalate += vote.confidence,
        }
    }

    let total_weight = weight_accept_a + weight_accept_b + weight_merge + weight_needs_evidence + weight_escalate;
    let (mut winning_verdict, winning_weight) = if total_weight == 0.0 {
        ("escalate".to_string(), 0.0)
    } else {
        let mut max_verdict = "escalate".to_string();
        let mut max_weight = 0.0;

        if weight_accept_a > max_weight {
            max_verdict = "accept_a".to_string();
            max_weight = weight_accept_a;
        }
        if weight_accept_b > max_weight {
            max_verdict = "accept_b".to_string();
            max_weight = weight_accept_b;
        }
        if weight_merge > max_weight {
            max_verdict = "merge".to_string();
            max_weight = weight_merge;
        }
        if weight_needs_evidence > max_weight {
            max_verdict = "needs_evidence".to_string();
            max_weight = weight_needs_evidence;
        }
        if weight_escalate > max_weight {
            max_verdict = "escalate".to_string();
            max_weight = weight_escalate;
        }

        (max_verdict, max_weight)
    };

    let ratio = if total_weight > 0.0 { winning_weight / total_weight } else { 0.0 };
    let final_confidence = if total_weight > 0.0 { winning_weight / (votes.len() as f64) } else { 0.0 };

    if ratio < escalation_threshold {
        winning_verdict = "escalate".to_string();
    }

    let mut reasoning = String::new();
    for vote in &votes {
        if vote.verdict == winning_verdict {
            reasoning = vote.reasoning.clone();
            break;
        }
    }
    if reasoning.is_empty() && !votes.is_empty() {
        reasoning = votes[0].reasoning.clone();
    }

    Ok((
        JudgeVerdict {
            verdict: winning_verdict,
            reasoning,
            confidence: final_confidence.min(1.0).max(0.0),
        },
        votes,
    ))
}

pub fn add_review_item(
    project_path: &str,
    item_type: &str,
    title: &str,
    description: &str,
    source_path: &str,
    affected_pages: Vec<String>,
    options: Vec<serde_json::Value>,
) -> Result<(), String> {
    let path = Path::new(project_path).join(".wikimind").join("review.json");
    let mut items = if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read review.json: {e}"))?;
        serde_json::from_str::<Vec<serde_json::Value>>(&raw)
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    // FNV-1a (32-bit) stable id
    let normalized_title = title.to_lowercase().trim().to_string();
    let key = format!("{}::{}", item_type, normalized_title);
    let mut h: u32 = 0x811c9dc5;
    for c in key.as_bytes() {
        h ^= *c as u32;
        h = h.wrapping_mul(0x01000193);
    }
    let review_id = format!("review-{:08x}", h);

    let exists = items.iter().any(|val| {
        val.get("id").and_then(|v| v.as_str()) == Some(&review_id)
    });

    if !exists {
        let new_item = serde_json::json!({
            "id": review_id,
            "type": item_type,
            "title": title,
            "description": description,
            "sourcePath": source_path,
            "affectedPages": affected_pages,
            "options": options,
            "resolved": false,
            "createdAt": chrono::Utc::now().timestamp_millis(),
        });
        items.push(new_item);

        let parent = path.parent().unwrap();
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create .wikimind directory: {e}"))?;
        }
        let raw = serde_json::to_string_pretty(&items)
            .map_err(|e| format!("Failed to serialize review.json: {e}"))?;
        fs::write(&path, raw)
            .map_err(|e| format!("Failed to write review.json: {e}"))?;
    }

    Ok(())
}
