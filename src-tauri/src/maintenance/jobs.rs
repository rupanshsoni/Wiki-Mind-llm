use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceJobLog {
    pub job_id: String,
    pub r#type: String, // "decay_scan", "re_verification", "contradiction_resolution", "health_report"
    pub start_time: String,
    pub end_time: String,
    pub claims_scanned: usize,
    pub actions_taken: Vec<String>,
    pub errors: Vec<String>,
}

pub fn log_job(project_path: &str, log: &MaintenanceJobLog) -> Result<(), String> {
    let dir = Path::new(project_path).join(".wikimind").join("maintenance");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create maintenance directory: {e}"))?;
    }
    
    let log_path = dir.join("jobs.jsonl");
    let serialized = serde_json::to_string(log)
        .map_err(|e| format!("Failed to serialize job log: {e}"))?;
        
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("Failed to open jobs.jsonl: {e}"))?;
        
    writeln!(file, "{}", serialized)
        .map_err(|e| format!("Failed to write job log line: {e}"))?;
        
    Ok(())
}
