use serde::{Deserialize, Serialize};
use chrono::Local;
use std::fs;
use std::path::Path;
use crate::agent::provider::AgentLlmProvider;
use crate::commands::search::{SearchEmbeddingConfig, resolve_query_embedding};
use crate::commands::vectorstore::{vector_search_chunks, ChunkSearchResult};
use super::claims::{
    Claim, ClaimSource, ClaimHistoryEntry, create_claim, update_claim, get_claim, list_claims,
    split_frontmatter
};
use super::decay::{DomainVolatility, FreshnessState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateClaim {
    pub title: String,
    pub confidence: f64,
    pub domain_volatility: String, // "low", "medium", "high"
    pub description: String,
    pub excerpt: String,
}

pub fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for c in title.chars() {
        if c.is_alphanumeric() && c.is_ascii() {
            slug.push(c.to_ascii_lowercase());
            last_was_dash = false;
        } else {
            if !last_was_dash {
                slug.push('-');
                last_was_dash = true;
            }
        }
    }
    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "claim".to_string()
    } else {
        trimmed
    }
}

fn get_unique_filename(project_path: &str, title: &str) -> String {
    let slug = slugify(title);
    let mut filename = format!("{}.md", slug);
    let mut counter = 1;
    while Path::new(project_path).join("wiki").join("claims").join(&filename).exists() {
        counter += 1;
        filename = format!("{}-{}.md", slug, counter);
    }
    filename
}

fn clean_json_response(s: &str) -> String {
    let s = s.trim();
    let s = s.strip_prefix("```json").unwrap_or(s);
    let s = s.strip_prefix("```").unwrap_or(s);
    let s = s.strip_suffix("```").unwrap_or(s);
    s.trim().to_string()
}

pub async fn extract_claims(
    project_path: &str,
    page_path: &str,
    provider: &dyn AgentLlmProvider,
    embed_cfg: Option<&SearchEmbeddingConfig>,
) -> Result<Vec<String>, String> {
    // 1. Read page content
    let full_path = Path::new(project_path).join(page_path);
    if !full_path.exists() {
        return Err(format!("Page file not found: {}", full_path.display()));
    }
    let raw_content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read page file: {e}"))?;

    // 2. Call LLM to extract claims
    let system_prompt = "You are an expert knowledge engineer. Your task is to analyze the content of a Wiki page and extract all atomic, verifiable claims (factual assertions) made in the text. You MUST respond ONLY with a JSON array of claim objects, and no other text or explanation. JSON format:\n[\n  {\n    \"title\": \"Claim assertion\",\n    \"confidence\": 0.95,\n    \"domain_volatility\": \"medium\",\n    \"description\": \"Brief explanation/context\",\n    \"excerpt\": \"Exact quote from source text\"\n  }\n]";
    let user_prompt = format!("Extract claims from the following text:\n\n{}", raw_content);

    let response = provider.generate_text(system_prompt, &user_prompt, &[]).await?;
    
    // Clean response of any markdown backticks
    let clean_json = clean_json_response(&response);
    let candidates: Vec<CandidateClaim> = serde_json::from_str(&clean_json)
        .map_err(|e| format!("Failed to parse claims JSON: {}. Response was: {}", e, response))?;

    let mut processed_claims = Vec::new();

    // 3. For each candidate claim, perform vector search to check if similar claim already exists
    for candidate in candidates {
        let mut matched_claim_id: Option<String> = None;
        if let Some(cfg) = embed_cfg {
            // Generate query embedding
            if let Ok(Some(embedding)) = resolve_query_embedding(&candidate.title, None, Some(cfg.clone())).await {
                // Search chunks table for similarity
                if let Ok(search_results) = vector_search_chunks(project_path.to_string(), embedding, 3).await {
                    for res in search_results {
                        // Check if a claim file with this page_id exists in wiki/claims/
                        let claim_file = format!("{}.md", res.page_id);
                        let claim_file_path = Path::new(project_path).join("wiki").join("claims").join(&claim_file);
                        if claim_file_path.exists() && res.score > 0.85 {
                            matched_claim_id = Some(res.page_id.clone());
                            break;
                        }
                    }
                }
            }
        }

        if let Some(ref claim_id) = matched_claim_id {
            // Load and update existing claim
            let filename = format!("{}.md", claim_id);
            if let Ok(mut existing_claim) = get_claim(project_path, &filename) {
                // Check if this source is already present to avoid duplication
                let already_sourced = existing_claim.sources.iter().any(|s| s.path == page_path);
                if !already_sourced {
                    existing_claim.sources.push(ClaimSource {
                        path: page_path.to_string(),
                        page: None,
                        excerpt: candidate.excerpt.clone(),
                        verified_at: Local::now().format("%Y-%m-%d").to_string(),
                        url: None,
                    });
                    existing_claim.source_count = existing_claim.sources.len();
                }

                // Bump verification count
                existing_claim.verification_count += 1;
                existing_claim.last_verified = Local::now().format("%Y-%m-%d").to_string();

                // Recalculate confidence (corroboration bump: +0.05 per source up to 1.0)
                existing_claim.history.push(ClaimHistoryEntry {
                    date: Local::now().format("%Y-%m-%d").to_string(),
                    confidence: existing_claim.confidence,
                    event: "corroboration".to_string(),
                    source: page_path.to_string(),
                    note: Some(format!("Corroborated by extraction from {}", page_path)),
                });

                if !already_sourced {
                    existing_claim.confidence = (existing_claim.confidence + 0.05).min(1.0);
                }

                update_claim(project_path, &filename, &existing_claim)?;
                processed_claims.push(filename);
            }
        } else {
            // Create new claim
            let filename = get_unique_filename(project_path, &candidate.title);
            let new_claim = Claim {
                title: candidate.title.clone(),
                r#type: "claim".to_string(),
                confidence: candidate.confidence,
                source_count: 1,
                last_verified: Local::now().format("%Y-%m-%d").to_string(),
                verification_count: 1,
                contradiction_count: 0,
                freshness_state: FreshnessState::Fresh,
                date: Local::now().format("%Y-%m-%d").to_string(),
                tags: vec![],
                domain_volatility: Some(match candidate.domain_volatility.to_lowercase().as_str() {
                    "low" => DomainVolatility::Low,
                    "high" => DomainVolatility::High,
                    _ => DomainVolatility::Medium,
                }),
                description: Some(candidate.description.clone()),
                sources: vec![ClaimSource {
                    path: page_path.to_string(),
                    page: None,
                    excerpt: candidate.excerpt.clone(),
                    verified_at: Local::now().format("%Y-%m-%d").to_string(),
                    url: None,
                }],
                parent_concepts: vec![page_path.to_string()],
                contradictions: vec![],
                history: vec![ClaimHistoryEntry {
                    date: Local::now().format("%Y-%m-%d").to_string(),
                    confidence: candidate.confidence,
                    event: "initial_extraction".to_string(),
                    source: page_path.to_string(),
                    note: Some("Initial extraction by AI Agent".to_string()),
                }],
                content: String::new(),
            };
            create_claim(project_path, &filename, &new_claim)?;
            processed_claims.push(filename);
        }
    }

    // 4. Update the parent page's frontmatter stats
    if let Err(e) = run_page_audit_update(project_path, page_path) {
        eprintln!("[Extract] Failed to update parent page audit stats for {}: {}", page_path, e);
    }

    Ok(processed_claims)
}

pub fn update_frontmatter_fields(
    frontmatter_str: &str,
    claim_count: usize,
    stale_claim_count: usize,
    avg_confidence: f64,
    last_audited: Option<String>,
) -> String {
    let mut lines: Vec<String> = frontmatter_str.lines().map(|s| s.to_string()).collect();
    
    let mut has_claim_count = false;
    let mut has_stale_claim_count = false;
    let mut has_avg_confidence = false;
    let mut has_last_audited = false;

    for line in lines.iter_mut() {
        let trimmed = line.trim();
        if let Some((key, _)) = trimmed.split_once(':') {
            let key = key.trim();
            match key {
                "claim_count" => {
                    *line = format!("claim_count: {}", claim_count);
                    has_claim_count = true;
                }
                "stale_claim_count" => {
                    *line = format!("stale_claim_count: {}", stale_claim_count);
                    has_stale_claim_count = true;
                }
                "avg_confidence" => {
                    *line = format!("avg_confidence: {:.2}", avg_confidence);
                    has_avg_confidence = true;
                }
                "last_audited" => {
                    if let Some(ref date) = last_audited {
                        *line = format!("last_audited: \"{}\"", date);
                    } else {
                        *line = "last_audited: \"\"".to_string();
                    }
                    has_last_audited = true;
                }
                _ => {}
            }
        }
    }

    if !has_claim_count {
        lines.push(format!("claim_count: {}", claim_count));
    }
    if !has_stale_claim_count {
        lines.push(format!("stale_claim_count: {}", stale_claim_count));
    }
    if !has_avg_confidence {
        lines.push(format!("avg_confidence: {:.2}", avg_confidence));
    }
    if !has_last_audited {
        if let Some(ref date) = last_audited {
            lines.push(format!("last_audited: \"{}\"", date));
        }
    }

    lines.join("\n")
}

pub fn update_parent_page_audit_stats(
    project_path: &str,
    page_path: &str,
    claim_count: usize,
    stale_claim_count: usize,
    avg_confidence: f64,
    last_audited: Option<String>,
) -> Result<(), String> {
    let full_path = Path::new(project_path).join(page_path);
    if !full_path.exists() {
        return Err(format!("Parent page not found: {}", full_path.display()));
    }
    let raw = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read parent page: {e}"))?;

    let (frontmatter_str, content) = split_frontmatter(&raw)?;
    let updated_fm = update_frontmatter_fields(
        &frontmatter_str,
        claim_count,
        stale_claim_count,
        avg_confidence,
        last_audited,
    );

    let updated_file = format!("---\n{}\n---\n{}", updated_fm.trim(), content);
    fs::write(&full_path, updated_file)
        .map_err(|e| format!("Failed to write parent page: {e}"))?;

    Ok(())
}

pub fn run_page_audit_update(project_path: &str, page_path: &str) -> Result<(), String> {
    let all_claims = list_claims(project_path, None)?;
    let mut page_claims = Vec::new();
    for claim in all_claims {
        if claim.parent_concepts.iter().any(|p| p == page_path) {
            page_claims.push(claim);
        }
    }

    if page_claims.is_empty() {
        update_parent_page_audit_stats(project_path, page_path, 0, 0, 0.0, None)?;
    } else {
        let claim_count = page_claims.len();
        let stale_claim_count = page_claims
            .iter()
            .filter(|c| c.freshness_state == FreshnessState::Stale || c.freshness_state == FreshnessState::Decayed)
            .count();
        let avg_confidence = page_claims.iter().map(|c| c.confidence).sum::<f64>() / claim_count as f64;
        let last_audited = page_claims.iter().map(|c| c.last_verified.clone()).max();
        update_parent_page_audit_stats(
            project_path,
            page_path,
            claim_count,
            stale_claim_count,
            avg_confidence,
            last_audited,
        )?;
    }
    Ok(())
}
