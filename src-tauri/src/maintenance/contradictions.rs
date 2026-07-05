use serde::{Deserialize, Serialize};
use chrono::{Local, NaiveDate};
use std::fs;
use std::path::{Path, PathBuf};
use super::claims::split_frontmatter;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ContradictionStatus {
    Open,
    #[serde(rename = "under_review")]
    UnderReview,
    Resolved,
    Escalated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContradictionClaimRef {
    pub path: String,
    pub position: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JudgeVote {
    pub judge_id: String,
    pub model: String,
    pub verdict: String, // accept_a | accept_b | merge | needs_evidence | escalate
    pub reasoning: String,
    pub confidence: f64,
    pub voted_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contradiction {
    pub title: String,
    pub r#type: String, // "contradiction"
    pub status: ContradictionStatus,
    pub date: String,
    pub tags: Vec<String>,
    pub claims: Vec<ContradictionClaimRef>,
    pub judge_votes: Vec<JudgeVote>,
    pub resolution_method: Option<String>,
    pub resolution: Option<String>,
    pub resolved_at: Option<String>,
    pub resolved_by: Option<String>,
    pub description: Option<String>,
    pub new_evidence: Option<String>,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub content: String,
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

pub fn parse_contradiction(raw: &str) -> Result<Contradiction, String> {
    let (frontmatter_str, content) = split_frontmatter(raw)?;

    let mut title = String::new();
    let mut status = ContradictionStatus::Open;
    let mut date = String::new();
    let mut tags = Vec::new();
    let mut claims = Vec::new();
    let mut judge_votes = Vec::new();
    let mut resolution_method = None;
    let mut resolution = None;
    let mut resolved_at = None;
    let mut resolved_by = None;
    let mut description = None;
    let mut new_evidence = None;

    let mut current_block = "";
    
    let mut current_claim: Option<ContradictionClaimRef> = None;
    let mut current_vote: Option<JudgeVote> = None;

    for line in frontmatter_str.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        let indent = line.len() - line.trim_start().len();
        let trimmed_line = line.trim();

        if indent == 0 {
            if let Some(c) = current_claim.take() {
                claims.push(c);
            }
            if let Some(v) = current_vote.take() {
                judge_votes.push(v);
            }

            if let Some((key, val)) = trimmed_line.split_once(':') {
                let key = key.trim();
                let val = val.trim();
                match key {
                    "title" => title = trim_quotes(val),
                    "status" => {
                        status = match val.to_lowercase().as_str() {
                            "open" => ContradictionStatus::Open,
                            "under_review" => ContradictionStatus::UnderReview,
                            "resolved" => ContradictionStatus::Resolved,
                            "escalated" => ContradictionStatus::Escalated,
                            _ => ContradictionStatus::Open,
                        };
                    }
                    "date" => date = trim_quotes(val),
                    "resolution_method" => resolution_method = Some(trim_quotes(val)),
                    "resolution" => resolution = Some(trim_quotes(val)),
                    "resolved_at" => resolved_at = Some(trim_quotes(val)),
                    "resolved_by" => resolved_by = Some(trim_quotes(val)),
                    "description" => description = Some(trim_quotes(val)),
                    "new_evidence" => new_evidence = Some(trim_quotes(val)),
                    "tags" => {
                        current_block = "tags";
                        if val == "[]" {
                            current_block = "";
                        }
                    }
                    "claims" => {
                        current_block = "claims";
                        if val == "[]" {
                            current_block = "";
                        }
                    }
                    "judge_votes" => {
                        current_block = "judge_votes";
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
            } else if current_block == "claims" {
                if trimmed_line.starts_with("- ") {
                    if let Some(c) = current_claim.take() {
                        claims.push(c);
                    }
                    let rest = &trimmed_line[2..];
                    if let Some((k, v)) = rest.split_once(':') {
                        let k = k.trim();
                        let v = v.trim();
                        let mut c = ContradictionClaimRef {
                            path: String::new(),
                            position: String::new(),
                        };
                        if k == "path" {
                            c.path = trim_quotes(v);
                        }
                        current_claim = Some(c);
                    }
                } else if let Some((k, v)) = trimmed_line.split_once(':') {
                    let k = k.trim();
                    let v = v.trim();
                    if let Some(ref mut c) = current_claim {
                        match k {
                            "path" => c.path = trim_quotes(v),
                            "position" => c.position = trim_quotes(v),
                            _ => {}
                        }
                    }
                }
            } else if current_block == "judge_votes" {
                if trimmed_line.starts_with("- ") {
                    if let Some(v) = current_vote.take() {
                        judge_votes.push(v);
                    }
                    let rest = &trimmed_line[2..];
                    if let Some((k, val)) = rest.split_once(':') {
                        let k = k.trim();
                        let val = val.trim();
                        let mut vote = JudgeVote {
                            judge_id: String::new(),
                            model: String::new(),
                            verdict: String::new(),
                            reasoning: String::new(),
                            confidence: 1.0,
                            voted_at: String::new(),
                        };
                        if k == "judge_id" {
                            vote.judge_id = trim_quotes(val);
                        }
                        current_vote = Some(vote);
                    }
                } else if let Some((k, val)) = trimmed_line.split_once(':') {
                    let k = k.trim();
                    let val = val.trim();
                    if let Some(ref mut vote) = current_vote {
                        match k {
                            "judge_id" => vote.judge_id = trim_quotes(val),
                            "model" => vote.model = trim_quotes(val),
                            "verdict" => vote.verdict = trim_quotes(val),
                            "reasoning" => vote.reasoning = trim_quotes(val),
                            "confidence" => vote.confidence = val.parse::<f64>().unwrap_or(1.0),
                            "voted_at" => vote.voted_at = trim_quotes(val),
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    if let Some(c) = current_claim {
        claims.push(c);
    }
    if let Some(v) = current_vote {
        judge_votes.push(v);
    }

    Ok(Contradiction {
        title,
        r#type: "contradiction".to_string(),
        status,
        date,
        tags,
        claims,
        judge_votes,
        resolution_method,
        resolution,
        resolved_at,
        resolved_by,
        description,
        new_evidence,
        content: content.to_string(),
    })
}

pub fn serialize_contradiction(c: &Contradiction) -> String {
    let mut yaml = String::new();
    yaml.push_str("---\n");
    yaml.push_str(&format!("title: \"{}\"\n", c.title.replace('"', "\\\"")));
    yaml.push_str("type: contradiction\n");
    yaml.push_str(&format!("status: {:?}\n", c.status).to_lowercase());
    yaml.push_str(&format!("date: \"{}\"\n", c.date));

    if c.tags.is_empty() {
        yaml.push_str("tags: []\n");
    } else {
        yaml.push_str("tags:\n");
        for tag in &c.tags {
            yaml.push_str(&format!("  - \"{}\"\n", tag.replace('"', "\\\"")));
        }
    }

    if c.claims.is_empty() {
        yaml.push_str("claims: []\n");
    } else {
        yaml.push_str("claims:\n");
        for claim in &c.claims {
            yaml.push_str("  - path: \"");
            yaml.push_str(&claim.path.replace('"', "\\\""));
            yaml.push_str("\"\n");
            yaml.push_str(&format!("    position: \"{}\"\n", claim.position.replace('"', "\\\"")));
        }
    }

    if c.judge_votes.is_empty() {
        yaml.push_str("judge_votes: []\n");
    } else {
        yaml.push_str("judge_votes:\n");
        for vote in &c.judge_votes {
            yaml.push_str("  - judge_id: \"");
            yaml.push_str(&vote.judge_id.replace('"', "\\\""));
            yaml.push_str("\"\n");
            yaml.push_str(&format!("    model: \"{}\"\n", vote.model.replace('"', "\\\"")));
            yaml.push_str(&format!("    verdict: {}\n", vote.verdict));
            yaml.push_str(&format!("    reasoning: \"{}\"\n", vote.reasoning.replace('"', "\\\"")));
            yaml.push_str(&format!("    confidence: {:.2}\n", vote.confidence));
            yaml.push_str(&format!("    voted_at: \"{}\"\n", vote.voted_at));
        }
    }

    if let Some(ref val) = c.resolution_method {
        yaml.push_str(&format!("resolution_method: {}\n", val));
    }
    if let Some(ref val) = c.resolution {
        yaml.push_str(&format!("resolution: \"{}\"\n", val.replace('"', "\\\"")));
    }
    if let Some(ref val) = c.resolved_at {
        yaml.push_str(&format!("resolved_at: \"{}\"\n", val));
    }
    if let Some(ref val) = c.resolved_by {
        yaml.push_str(&format!("resolved_by: {}\n", val));
    }
    if let Some(ref val) = c.description {
        yaml.push_str(&format!("description: \"{}\"\n", val.replace('"', "\\\"")));
    }
    if let Some(ref val) = c.new_evidence {
        yaml.push_str(&format!("new_evidence: \"{}\"\n", val.replace('"', "\\\"")));
    }

    yaml.push_str("---\n");
    yaml.push_str(&c.content);
    yaml
}

pub fn list_contradictions(project_path: &str, status_filter: Option<ContradictionStatus>) -> Result<Vec<Contradiction>, String> {
    let dir = Path::new(project_path).join("wiki").join("contradictions");
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(dir)
        .map_err(|e| format!("Failed to read contradictions directory: {e}"))?;

    let mut list = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("md") {
            let raw = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read contradiction file {}: {}", path.display(), e))?;
            
            let c = parse_contradiction(&raw)?;

            if let Some(ref filter) = status_filter {
                if &c.status == filter {
                    list.push(c);
                }
            } else {
                list.push(c);
            }
        }
    }

    Ok(list)
}

pub fn get_contradiction(project_path: &str, filename: &str) -> Result<Contradiction, String> {
    let file_path = Path::new(project_path)
        .join("wiki")
        .join("contradictions")
        .join(filename);

    if !file_path.exists() {
        return Err(format!("Contradiction file does not exist: {}", file_path.display()));
    }

    let raw = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read contradiction file: {e}"))?;

    parse_contradiction(&raw)
}

pub fn create_contradiction(project_path: &str, filename: &str, c: &Contradiction) -> Result<(), String> {
    let dir = Path::new(project_path).join("wiki").join("contradictions");
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create contradictions directory: {e}"))?;
    }

    let file_path = dir.join(filename);
    let serialized = serialize_contradiction(c);
    fs::write(&file_path, serialized)
        .map_err(|e| format!("Failed to write contradiction file: {e}"))?;

    Ok(())
}

pub fn update_contradiction(project_path: &str, filename: &str, c: &Contradiction) -> Result<(), String> {
    let file_path = Path::new(project_path)
        .join("wiki")
        .join("contradictions")
        .join(filename);

    if !file_path.exists() {
        return Err(format!("Contradiction file does not exist to update: {}", file_path.display()));
    }

    let serialized = serialize_contradiction(c);
    fs::write(&file_path, serialized)
        .map_err(|e| format!("Failed to write contradiction file: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_contradiction_parsing_serialization() {
        let raw = r#"---
title: "Dispute about GPT-4 parameters"
type: contradiction
status: open
date: "2026-06-10"
tags:
  - "gpt-4"
claims:
  - path: "claims/gpt4-1.8t.md"
    position: "1.8 trillion"
  - path: "claims/gpt4-1.76t.md"
    position: "1.76 trillion"
judge_votes:
  - judge_id: "judge-1"
    model: "gpt-4o"
    verdict: accept_a
    reasoning: "Corroborated by key leaked specs"
    confidence: 0.90
    voted_at: "2026-06-16T03:15:00Z"
resolution_method: ensemble_majority
resolution: "Merge positions"
resolved_at: "2026-06-16"
resolved_by: ensemble
description: "Dispute explanation"
new_evidence: "No new evidence"
---
Content goes here.
"#;
        let parsed = parse_contradiction(raw).unwrap();
        assert_eq!(parsed.title, "Dispute about GPT-4 parameters");
        assert_eq!(parsed.claims[0].path, "claims/gpt4-1.8t.md");
        assert_eq!(parsed.claims[0].position, "1.8 trillion");
        assert_eq!(parsed.judge_votes[0].judge_id, "judge-1");
        assert_eq!(parsed.judge_votes[0].verdict, "accept_a");

        let serialized = serialize_contradiction(&parsed);
        assert!(serialized.contains("title: \"Dispute about GPT-4 parameters\""));
        assert!(serialized.contains("Content goes here."));
    }
}
