use serde::{Deserialize, Serialize};
use chrono::{Local, NaiveDate};
use std::fs;
use std::path::{Path, PathBuf};
use super::decay::{DomainVolatility, FreshnessState, ClaimDecayInput, compute_confidence, classify_freshness};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimSource {
    pub path: String,
    pub page: Option<usize>,
    pub excerpt: String,
    pub verified_at: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimHistoryEntry {
    pub date: String,
    pub confidence: f64,
    pub event: String, // e.g. "initial_extraction", "corroboration", etc.
    pub source: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claim {
    pub title: String,
    pub r#type: String, // "claim"
    pub confidence: f64,
    pub source_count: usize,
    pub last_verified: String,
    pub verification_count: usize,
    pub contradiction_count: usize,
    pub freshness_state: FreshnessState,
    pub date: String,
    pub tags: Vec<String>,
    pub domain_volatility: Option<DomainVolatility>,
    pub description: Option<String>,
    pub sources: Vec<ClaimSource>,
    pub parent_concepts: Vec<String>,
    pub contradictions: Vec<String>,
    pub history: Vec<ClaimHistoryEntry>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub content: String,
}

impl Claim {
    pub fn apply_decay(&mut self, now: NaiveDate) {
        let decay_input = ClaimDecayInput {
            confidence: self.confidence,
            source_count: self.source_count,
            contradiction_count: self.contradiction_count,
            last_verified: self.last_verified.clone(),
            domain_volatility: self.domain_volatility,
        };
        let decayed = compute_confidence(&decay_input, now);
        self.freshness_state = classify_freshness(decayed, self.confidence);
    }
}

fn trim_quotes(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        if s.len() >= 2 {
            s[1..s.len()-1].to_string()
        } else {
            String::new()
        }
    } else {
        s.to_string()
    }
}

pub fn split_frontmatter(raw: &str) -> Result<(String, &str), String> {
    if !raw.starts_with("---\n") && !raw.starts_with("---\r\n") {
        return Err("Missing frontmatter separator at start".to_string());
    }
    let start_offset = if raw.starts_with("---\r\n") { 5 } else { 4 };
    let fm_end = raw[start_offset..].find("---\n").or_else(|| raw[start_offset..].find("---\r\n"));
    let fm_end = match fm_end {
        Some(idx) => idx + start_offset,
        None => return Err("Missing closing frontmatter separator".to_string()),
    };
    
    let frontmatter = raw[start_offset..fm_end].to_string();
    let content_start = fm_end + if raw[fm_end..].starts_with("---\r\n") { 5 } else { 4 };
    let content = &raw[content_start..];
    Ok((frontmatter, content))
}

pub fn parse_claim(raw: &str) -> Result<Claim, String> {
    let (frontmatter_str, content) = split_frontmatter(raw)?;

    let mut title = String::new();
    let mut confidence = 1.0;
    let mut source_count = 0;
    let mut last_verified = String::new();
    let mut verification_count = 0;
    let mut contradiction_count = 0;
    let mut freshness_state = FreshnessState::Fresh;
    let mut date = String::new();
    let mut tags = Vec::new();
    let mut domain_volatility = None;
    let mut description = None;
    let mut sources = Vec::new();
    let mut parent_concepts = Vec::new();
    let mut contradictions = Vec::new();
    let mut history = Vec::new();

    let mut current_block = "";
    
    let mut current_source: Option<ClaimSource> = None;
    let mut current_history: Option<ClaimHistoryEntry> = None;

    for line in frontmatter_str.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        let indent = line.len() - line.trim_start().len();
        let trimmed_line = line.trim();

        if indent == 0 {
            if let Some(src) = current_source.take() {
                sources.push(src);
            }
            if let Some(hist) = current_history.take() {
                history.push(hist);
            }

            if let Some((key, val)) = trimmed_line.split_once(':') {
                let key = key.trim();
                let val = val.trim();
                match key {
                    "title" => title = trim_quotes(val),
                    "confidence" => confidence = val.parse::<f64>().unwrap_or(1.0),
                    "source_count" => source_count = val.parse::<usize>().unwrap_or(0),
                    "last_verified" => last_verified = trim_quotes(val),
                    "verification_count" => verification_count = val.parse::<usize>().unwrap_or(0),
                    "contradiction_count" => contradiction_count = val.parse::<usize>().unwrap_or(0),
                    "freshness_state" => {
                        freshness_state = match val.to_lowercase().as_str() {
                            "fresh" => FreshnessState::Fresh,
                            "aging" => FreshnessState::Aging,
                            "stale" => FreshnessState::Stale,
                            "decayed" => FreshnessState::Decayed,
                            _ => FreshnessState::Fresh,
                        };
                    }
                    "date" => date = trim_quotes(val),
                    "domain_volatility" => {
                        domain_volatility = match val.to_lowercase().as_str() {
                            "low" => Some(DomainVolatility::Low),
                            "medium" => Some(DomainVolatility::Medium),
                            "high" => Some(DomainVolatility::High),
                            _ => None,
                        };
                    }
                    "description" => description = Some(trim_quotes(val)),
                    "tags" => {
                        current_block = "tags";
                        if val == "[]" {
                            current_block = "";
                        }
                    }
                    "sources" => {
                        current_block = "sources";
                        if val == "[]" {
                            current_block = "";
                        }
                    }
                    "parent_concepts" => {
                        current_block = "parent_concepts";
                        if val == "[]" {
                            current_block = "";
                        }
                    }
                    "contradictions" => {
                        current_block = "contradictions";
                        if val == "[]" {
                            current_block = "";
                        }
                    }
                    "history" => {
                        current_block = "history";
                        if val == "[]" {
                            current_block = "";
                        }
                    }
                    _ => {
                        current_block = "";
                    }
                }
            }
        } else {
            if current_block == "tags" {
                if trimmed_line.starts_with("- ") {
                    tags.push(trim_quotes(&trimmed_line[2..]));
                }
            } else if current_block == "parent_concepts" {
                if trimmed_line.starts_with("- ") {
                    parent_concepts.push(trim_quotes(&trimmed_line[2..]));
                }
            } else if current_block == "contradictions" {
                if trimmed_line.starts_with("- ") {
                    contradictions.push(trim_quotes(&trimmed_line[2..]));
                }
            } else if current_block == "sources" {
                if trimmed_line.starts_with("- ") {
                    if let Some(src) = current_source.take() {
                        sources.push(src);
                    }
                    let rest = &trimmed_line[2..];
                    if let Some((k, v)) = rest.split_once(':') {
                        let k = k.trim();
                        let v = v.trim();
                        let mut src = ClaimSource {
                            path: String::new(),
                            page: None,
                            excerpt: String::new(),
                            verified_at: String::new(),
                            url: None,
                        };
                        if k == "path" {
                            src.path = trim_quotes(v);
                        }
                        current_source = Some(src);
                    }
                } else if let Some((k, v)) = trimmed_line.split_once(':') {
                    let k = k.trim();
                    let v = v.trim();
                    if let Some(ref mut src) = current_source {
                        match k {
                            "path" => src.path = trim_quotes(v),
                            "page" => src.page = v.parse::<usize>().ok(),
                            "excerpt" => src.excerpt = trim_quotes(v),
                            "verified_at" => src.verified_at = trim_quotes(v),
                            "url" => src.url = Some(trim_quotes(v)),
                            _ => {}
                        }
                    }
                }
            } else if current_block == "history" {
                if trimmed_line.starts_with("- ") {
                    if let Some(hist) = current_history.take() {
                        history.push(hist);
                    }
                    let rest = &trimmed_line[2..];
                    if let Some((k, v)) = rest.split_once(':') {
                        let k = k.trim();
                        let v = v.trim();
                        let mut hist = ClaimHistoryEntry {
                            date: String::new(),
                            confidence: 1.0,
                            event: String::new(),
                            source: String::new(),
                            note: None,
                        };
                        if k == "date" {
                            hist.date = trim_quotes(v);
                        }
                        current_history = Some(hist);
                    }
                } else if let Some((k, v)) = trimmed_line.split_once(':') {
                    let k = k.trim();
                    let v = v.trim();
                    if let Some(ref mut hist) = current_history {
                        match k {
                            "date" => hist.date = trim_quotes(v),
                            "confidence" => hist.confidence = v.parse::<f64>().unwrap_or(1.0),
                            "event" => hist.event = trim_quotes(v),
                            "source" => hist.source = trim_quotes(v),
                            "note" => hist.note = Some(trim_quotes(v)),
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    if let Some(src) = current_source {
        sources.push(src);
    }
    if let Some(hist) = current_history {
        history.push(hist);
    }

    Ok(Claim {
        title,
        r#type: "claim".to_string(),
        confidence,
        source_count,
        last_verified,
        verification_count,
        contradiction_count,
        freshness_state,
        date,
        tags,
        domain_volatility,
        description,
        sources,
        parent_concepts,
        contradictions,
        history,
        content: content.to_string(),
    })
}

pub fn serialize_claim(claim: &Claim) -> String {
    let mut yaml = String::new();
    yaml.push_str("---\n");
    yaml.push_str(&format!("title: \"{}\"\n", claim.title.replace('"', "\\\"")));
    yaml.push_str("type: claim\n");
    yaml.push_str(&format!("confidence: {:.2}\n", claim.confidence));
    yaml.push_str(&format!("source_count: {}\n", claim.source_count));
    yaml.push_str(&format!("last_verified: \"{}\"\n", claim.last_verified));
    yaml.push_str(&format!("verification_count: {}\n", claim.verification_count));
    yaml.push_str(&format!("contradiction_count: {}\n", claim.contradiction_count));
    yaml.push_str(&format!("freshness_state: {:?}\n", claim.freshness_state).to_lowercase());
    yaml.push_str(&format!("date: \"{}\"\n", claim.date));

    if claim.tags.is_empty() {
        yaml.push_str("tags: []\n");
    } else {
        yaml.push_str("tags:\n");
        for tag in &claim.tags {
            yaml.push_str(&format!("  - \"{}\"\n", tag.replace('"', "\\\"")));
        }
    }

    if let Some(ref vol) = claim.domain_volatility {
        yaml.push_str(&format!("domain_volatility: {:?}\n", vol).to_lowercase());
    }
    if let Some(ref desc) = claim.description {
        yaml.push_str(&format!("description: \"{}\"\n", desc.replace('"', "\\\"")));
    }

    if claim.sources.is_empty() {
        yaml.push_str("sources: []\n");
    } else {
        yaml.push_str("sources:\n");
        for src in &claim.sources {
            yaml.push_str("  - path: \"");
            yaml.push_str(&src.path.replace('"', "\\\""));
            yaml.push_str("\"\n");
            if let Some(page) = src.page {
                yaml.push_str(&format!("    page: {}\n", page));
            }
            yaml.push_str(&format!("    excerpt: \"{}\"\n", src.excerpt.replace('"', "\\\"").replace('\n', " ")));
            yaml.push_str(&format!("    verified_at: \"{}\"\n", src.verified_at));
            if let Some(ref url) = src.url {
                yaml.push_str(&format!("    url: \"{}\"\n", url.replace('"', "\\\"")));
            }
        }
    }

    if claim.parent_concepts.is_empty() {
        yaml.push_str("parent_concepts: []\n");
    } else {
        yaml.push_str("parent_concepts:\n");
        for pc in &claim.parent_concepts {
            yaml.push_str(&format!("  - \"{}\"\n", pc.replace('"', "\\\"")));
        }
    }

    if claim.contradictions.is_empty() {
        yaml.push_str("contradictions: []\n");
    } else {
        yaml.push_str("contradictions:\n");
        for c in &claim.contradictions {
            yaml.push_str(&format!("  - \"{}\"\n", c.replace('"', "\\\"")));
        }
    }

    if claim.history.is_empty() {
        yaml.push_str("history: []\n");
    } else {
        yaml.push_str("history:\n");
        for h in &claim.history {
            yaml.push_str(&format!("  - date: \"{}\"\n", h.date));
            yaml.push_str(&format!("    confidence: {:.2}\n", h.confidence));
            yaml.push_str(&format!("    event: {}\n", h.event));
            yaml.push_str(&format!("    source: \"{}\"\n", h.source.replace('"', "\\\"")));
            if let Some(ref note) = h.note {
                yaml.push_str(&format!("    note: \"{}\"\n", note.replace('"', "\\\"")));
            }
        }
    }

    yaml.push_str("---\n");
    yaml.push_str(&claim.content);
    yaml
}

pub fn list_claims(project_path: &str, state_filter: Option<FreshnessState>) -> Result<Vec<Claim>, String> {
    let claims_dir = Path::new(project_path).join("wiki").join("claims");
    if !claims_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(claims_dir)
        .map_err(|e| format!("Failed to read claims directory: {e}"))?;

    let now = Local::now().date_naive();
    let mut claims = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("md") {
            let raw = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read claim file {}: {}", path.display(), e))?;
            
            let mut claim = parse_claim(&raw)?;
            claim.apply_decay(now);

            if let Some(ref filter) = state_filter {
                if &claim.freshness_state == filter {
                    claims.push(claim);
                }
            } else {
                claims.push(claim);
            }
        }
    }

    // Sort by confidence descending
    claims.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

    Ok(claims)
}

pub fn get_claim(project_path: &str, filename: &str) -> Result<Claim, String> {
    let file_path = Path::new(project_path)
        .join("wiki")
        .join("claims")
        .join(filename);

    if !file_path.exists() {
        return Err(format!("Claim file does not exist: {}", file_path.display()));
    }

    let raw = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read claim file: {e}"))?;

    let mut claim = parse_claim(&raw)?;
    let now = Local::now().date_naive();
    claim.apply_decay(now);

    Ok(claim)
}

pub fn create_claim(project_path: &str, filename: &str, claim: &Claim) -> Result<(), String> {
    let claims_dir = Path::new(project_path).join("wiki").join("claims");
    if !claims_dir.exists() {
        fs::create_dir_all(&claims_dir)
            .map_err(|e| format!("Failed to create claims directory: {e}"))?;
    }

    let file_path = claims_dir.join(filename);
    let serialized = serialize_claim(claim);
    fs::write(&file_path, serialized)
        .map_err(|e| format!("Failed to write claim file: {e}"))?;

    Ok(())
}

pub fn update_claim(project_path: &str, filename: &str, claim: &Claim) -> Result<(), String> {
    let file_path = Path::new(project_path)
        .join("wiki")
        .join("claims")
        .join(filename);

    if !file_path.exists() {
        return Err(format!("Claim file does not exist to update: {}", file_path.display()));
    }

    let serialized = serialize_claim(claim);
    fs::write(&file_path, serialized)
        .map_err(|e| format!("Failed to write claim file: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_claim_parsing_serialization() {
        let raw = r#"---
title: "GPT-4 has 1.8 trillion parameters"
type: claim
confidence: 0.90
source_count: 1
last_verified: "2026-07-01"
verification_count: 2
contradiction_count: 0
freshness_state: fresh
date: "2026-06-01"
tags:
  - "gpt-4"
  - "parameters"
domain_volatility: medium
description: "Disputed claim on parameter count"
sources:
  - path: "raw/sources/leak.pdf"
    page: 5
    excerpt: "gpt4 is a mixture of experts with 1.8t total parameters"
    verified_at: "2026-07-01"
parent_concepts:
  - "concepts/gpt-4.md"
contradictions: []
history:
  - date: "2026-06-01"
    confidence: 0.90
    event: initial_extraction
    source: "leak.pdf"
---
Some content prose here.
"#;
        let parsed = parse_claim(raw).unwrap();
        assert_eq!(parsed.title, "GPT-4 has 1.8 trillion parameters");
        assert_eq!(parsed.confidence, 0.9);
        assert_eq!(parsed.sources[0].path, "raw/sources/leak.pdf");
        assert_eq!(parsed.sources[0].page, Some(5));
        assert_eq!(parsed.sources[0].excerpt, "gpt4 is a mixture of experts with 1.8t total parameters");
        assert_eq!(parsed.parent_concepts[0], "concepts/gpt-4.md");
        assert_eq!(parsed.history[0].event, "initial_extraction");

        let serialized = serialize_claim(&parsed);
        assert!(serialized.contains("title: \"GPT-4 has 1.8 trillion parameters\""));
        assert!(serialized.contains("Some content prose here."));
    }
}
