pub mod decay;
pub mod claims;
pub mod contradictions;
pub mod extract;
pub mod scheduler;
pub mod jobs;
pub mod pipeline;
pub mod history;
pub mod ensemble;
pub mod eval;

use claims::Claim;
use contradictions::{Contradiction, ContradictionStatus};
use tauri::{command, State};
use serde_json::json;
use std::fs;
use std::path::Path;
use scheduler::{MaintenanceScheduler, SchedulerConfig};

#[command]
pub fn maintenance_list_claims(project_path: String, state_filter: Option<String>) -> Result<Vec<Claim>, String> {
    let filter = match state_filter {
        Some(s) => match s.to_lowercase().as_str() {
            "fresh" => Some(decay::FreshnessState::Fresh),
            "aging" => Some(decay::FreshnessState::Aging),
            "stale" => Some(decay::FreshnessState::Stale),
            "decayed" => Some(decay::FreshnessState::Decayed),
            _ => None,
        },
        None => None,
    };
    claims::list_claims(&project_path, filter)
}

#[command]
pub fn maintenance_get_claim(project_path: String, filename: String) -> Result<Claim, String> {
    claims::get_claim(&project_path, &filename)
}

#[command]
pub fn maintenance_create_claim(project_path: String, filename: String, claim: Claim) -> Result<(), String> {
    claims::create_claim(&project_path, &filename, &claim)
}

#[command]
pub fn maintenance_update_claim(project_path: String, filename: String, claim: Claim) -> Result<(), String> {
    claims::update_claim(&project_path, &filename, &claim)
}

#[command]
pub fn maintenance_decay_status(project_path: String) -> Result<serde_json::Value, String> {
    let claims = claims::list_claims(&project_path, None)?;
    let mut total = 0;
    let mut fresh = 0;
    let mut aging = 0;
    let mut stale = 0;
    let mut decayed = 0;

    for claim in &claims {
        total += 1;
        match claim.freshness_state {
            decay::FreshnessState::Fresh => fresh += 1,
            decay::FreshnessState::Aging => aging += 1,
            decay::FreshnessState::Stale => stale += 1,
            decay::FreshnessState::Decayed => decayed += 1,
        }
    }

    Ok(json!({
        "total": total,
        "fresh": fresh,
        "aging": aging,
        "stale": stale,
        "decayed": decayed,
    }))
}

#[command]
pub fn maintenance_list_contradictions(project_path: String, status_filter: Option<String>) -> Result<Vec<Contradiction>, String> {
    let filter = match status_filter {
        Some(s) => match s.to_lowercase().as_str() {
            "open" => Some(ContradictionStatus::Open),
            "under_review" => Some(ContradictionStatus::UnderReview),
            "resolved" => Some(ContradictionStatus::Resolved),
            "escalated" => Some(ContradictionStatus::Escalated),
            _ => None,
        },
        None => None,
    };
    contradictions::list_contradictions(&project_path, filter)
}

#[command]
pub fn maintenance_get_contradiction(project_path: String, filename: String) -> Result<Contradiction, String> {
    contradictions::get_contradiction(&project_path, &filename)
}

#[command]
pub fn maintenance_resolve_contradiction(
    project_path: String,
    filename: String,
    resolution: String,
    method: String,
) -> Result<(), String> {
    let mut c = contradictions::get_contradiction(&project_path, &filename)?;
    c.status = ContradictionStatus::Resolved;
    c.resolution = Some(resolution.clone());
    c.resolution_method = Some(method.clone());
    let now_date_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    c.resolved_at = Some(now_date_str.clone());
    c.resolved_by = Some("human".to_string());

    if c.claims.len() >= 2 {
        let file_a = c.claims[0].path.strip_prefix("claims/").unwrap_or(&c.claims[0].path);
        let file_b = c.claims[1].path.strip_prefix("claims/").unwrap_or(&c.claims[1].path);

        if let Ok(mut claim_a) = claims::get_claim(&project_path, file_a) {
            if let Ok(mut claim_b) = claims::get_claim(&project_path, file_b) {
                let old_a_serialized = claims::serialize_claim(&claim_a);
                let old_b_serialized = claims::serialize_claim(&claim_b);

                claim_a.contradiction_count = 0;
                claim_b.contradiction_count = 0;
                claim_a.last_verified = now_date_str.clone();
                claim_b.last_verified = now_date_str.clone();

                match resolution.to_lowercase().as_str() {
                    "accept_a" | "accept a" => {
                        claim_a.confidence = 1.0;
                        claim_b.confidence = 0.0;
                        claim_a.history.push(claims::ClaimHistoryEntry {
                            date: now_date_str.clone(),
                            confidence: 1.0,
                            event: "contradiction_resolved".to_string(),
                            source: "human_review".to_string(),
                            note: Some("Resolved by human: Claim A accepted".to_string()),
                        });
                        claim_b.history.push(claims::ClaimHistoryEntry {
                            date: now_date_str.clone(),
                            confidence: 0.0,
                            event: "contradiction_resolved".to_string(),
                            source: "human_review".to_string(),
                            note: Some("Resolved by human: Claim A accepted, Claim B deprecated".to_string()),
                        });
                    }
                    "accept_b" | "accept b" => {
                        claim_a.confidence = 0.0;
                        claim_b.confidence = 1.0;
                        claim_a.history.push(claims::ClaimHistoryEntry {
                            date: now_date_str.clone(),
                            confidence: 0.0,
                            event: "contradiction_resolved".to_string(),
                            source: "human_review".to_string(),
                            note: Some("Resolved by human: Claim B accepted, Claim A deprecated".to_string()),
                        });
                        claim_b.history.push(claims::ClaimHistoryEntry {
                            date: now_date_str.clone(),
                            confidence: 1.0,
                            event: "contradiction_resolved".to_string(),
                            source: "human_review".to_string(),
                            note: Some("Resolved by human: Claim B accepted".to_string()),
                        });
                    }
                    "merge" => {
                        let avg = ((claim_a.confidence + claim_b.confidence) / 2.0).min(1.0).max(0.0);
                        claim_a.confidence = avg;
                        claim_b.confidence = avg;
                        claim_a.history.push(claims::ClaimHistoryEntry {
                            date: now_date_str.clone(),
                            confidence: avg,
                            event: "contradiction_resolved".to_string(),
                            source: "human_review".to_string(),
                            note: Some("Resolved by human: Merged claims".to_string()),
                        });
                        claim_b.history.push(claims::ClaimHistoryEntry {
                            date: now_date_str.clone(),
                            confidence: avg,
                            event: "contradiction_resolved".to_string(),
                            source: "human_review".to_string(),
                            note: Some("Resolved by human: Merged claims".to_string()),
                        });
                    }
                    _ => {
                        // Dismiss/other: reset contradiction status but leave confidence unchanged
                        claim_a.history.push(claims::ClaimHistoryEntry {
                            date: now_date_str.clone(),
                            confidence: claim_a.confidence,
                            event: "contradiction_resolved".to_string(),
                            source: "human_review".to_string(),
                            note: Some("Dispute dismissed by human".to_string()),
                        });
                        claim_b.history.push(claims::ClaimHistoryEntry {
                            date: now_date_str.clone(),
                            confidence: claim_b.confidence,
                            event: "contradiction_resolved".to_string(),
                            source: "human_review".to_string(),
                            note: Some("Dispute dismissed by human".to_string()),
                        });
                    }
                }

                let new_a_serialized = claims::serialize_claim(&claim_a);
                let new_b_serialized = claims::serialize_claim(&claim_b);

                let _ = claims::update_claim(&project_path, file_a, &claim_a);
                let _ = claims::update_claim(&project_path, file_b, &claim_b);

                let slug_a = file_a.strip_suffix(".md").unwrap_or(file_a);
                let slug_b = file_b.strip_suffix(".md").unwrap_or(file_b);
                let _ = history::save_history_diff(&project_path, slug_a, &old_a_serialized, &new_a_serialized);
                let _ = history::save_history_diff(&project_path, slug_b, &old_b_serialized, &new_b_serialized);
            }
        }
    }

    contradictions::update_contradiction(&project_path, &filename, &c)
}

#[command]
pub fn maintenance_job_history(project_path: String) -> Result<Vec<serde_json::Value>, String> {
    let log_path = Path::new(&project_path)
        .join(".wikimind")
        .join("maintenance")
        .join("jobs.jsonl");

    if !log_path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read jobs log: {e}"))?;

    let mut list = Vec::new();
    for line in raw.lines() {
        if !line.trim().is_empty() {
            if let Ok(val) = serde_json::from_str(line) {
                list.push(val);
            }
        }
    }
    list.reverse();
    Ok(list)
}

#[command]
pub fn maintenance_scheduler_status(
    scheduler: State<'_, MaintenanceScheduler>,
) -> Result<serde_json::Value, String> {
    let paused = scheduler.is_paused();
    let project_path = scheduler.get_project_path();
    let config = scheduler.get_config();
    Ok(json!({
        "paused": paused,
        "project_path": project_path,
        "time_warp_factor": config.time_warp_factor,
        "jobs": config.jobs,
    }))
}

#[command]
pub async fn maintenance_run_job(
    job_name: String,
    scheduler: State<'_, MaintenanceScheduler>,
) -> Result<(), String> {
    scheduler.run_job_manually(&job_name).await
}

#[command]
pub fn maintenance_pause_scheduler(
    scheduler: State<'_, MaintenanceScheduler>,
) -> Result<(), String> {
    scheduler.pause();
    Ok(())
}

#[command]
pub fn maintenance_resume_scheduler(
    scheduler: State<'_, MaintenanceScheduler>,
) -> Result<(), String> {
    scheduler.resume();
    Ok(())
}

#[command]
pub fn maintenance_update_schedule_config(
    new_config: SchedulerConfig,
    scheduler: State<'_, MaintenanceScheduler>,
) -> Result<(), String> {
    scheduler.update_config(new_config)
}

#[command]
pub async fn maintenance_run_eval(
    project_path: String,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let res = eval::run_evaluation(&project_path, &app).await?;
    Ok(serde_json::to_value(&res).unwrap())
}

#[command]
pub fn maintenance_get_eval_results(project_path: String) -> Result<serde_json::Value, String> {
    let file = Path::new(&project_path).join(".wikimind").join("maintenance").join("eval").join("results.jsonl");
    if !file.exists() {
        return Ok(json!({ "total": 0, "runs": [] }));
    }
    let raw = fs::read_to_string(&file)
        .map_err(|e| format!("Failed to read evaluation results: {e}"))?;

    let mut list = Vec::new();
    for line in raw.lines() {
        if !line.trim().is_empty() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                list.push(val);
            }
        }
    }
    list.reverse();
    Ok(json!({
        "total": list.len(),
        "runs": list,
    }))
}
