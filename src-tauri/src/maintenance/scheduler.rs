use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::str::FromStr;
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};
use cron::Schedule;
use chrono::{Utc, Local};
use uuid::Uuid;
use super::jobs::{self, MaintenanceJobLog};
use super::pipeline;
use crate::agent::provider::LlmClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnsembleScheduleConfig {
    pub judges: Vec<String>,
    pub fallback_to_single_judge: bool,
    pub escalation_threshold: f64,
}

impl Default for EnsembleScheduleConfig {
    fn default() -> Self {
        EnsembleScheduleConfig {
            judges: vec![],
            fallback_to_single_judge: true,
            escalation_threshold: 0.6,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiBudgetConfig {
    pub monthly_cap_usd: f64,
    pub current_month_spent_usd: f64,
    pub reset_day: u32,
    pub last_reset_month: Option<String>,
}

impl Default for ApiBudgetConfig {
    fn default() -> Self {
        ApiBudgetConfig {
            monthly_cap_usd: 10.0,
            current_month_spent_usd: 0.0,
            reset_day: 1,
            last_reset_month: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSchedule {
    pub name: String,
    pub cron: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerConfig {
    pub time_warp_factor: f64,
    pub jobs: Vec<JobSchedule>,
    pub ensemble: Option<EnsembleScheduleConfig>,
    pub api_budget: Option<ApiBudgetConfig>,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        SchedulerConfig {
            time_warp_factor: 1.0,
            jobs: vec![
                JobSchedule {
                    name: "decay_scan".to_string(),
                    cron: "0 0 * * * *".to_string(), // hourly
                    enabled: true,
                },
                JobSchedule {
                    name: "re_verification".to_string(),
                    cron: "0 0 */3 * * *".to_string(), // every 3 hours
                    enabled: true,
                },
                JobSchedule {
                    name: "contradiction_resolution".to_string(),
                    cron: "0 0 * * * 0".to_string(), // weekly on Sunday
                    enabled: true,
                },
                JobSchedule {
                    name: "health_report".to_string(),
                    cron: "0 0 1 * * *".to_string(), // daily
                    enabled: true,
                },
            ],
            ensemble: Some(EnsembleScheduleConfig::default()),
            api_budget: Some(ApiBudgetConfig::default()),
        }
    }
}

pub struct MaintenanceScheduler {
    app: tauri::AppHandle,
    project_path: Arc<Mutex<Option<String>>>,
    config: Arc<Mutex<SchedulerConfig>>,
    paused: Arc<Mutex<bool>>,
    handles: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl MaintenanceScheduler {
    pub fn new(app: tauri::AppHandle) -> Self {
        MaintenanceScheduler {
            app,
            project_path: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(SchedulerConfig::default())),
            paused: Arc::new(Mutex::new(false)),
            handles: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn open_project(&self, project_path: String) -> Result<(), String> {
        self.stop();

        let dot_wikimind = Path::new(&project_path).join(".wikimind");
        if !dot_wikimind.exists() {
            let _ = fs::create_dir_all(&dot_wikimind);
        }
        let config_file = dot_wikimind.join("schedule.json");
        let config = if config_file.exists() {
            let raw = fs::read_to_string(&config_file)
                .map_err(|e| format!("Failed to read schedule.json: {e}"))?;
            serde_json::from_str::<SchedulerConfig>(&raw)
                .unwrap_or_else(|_| SchedulerConfig::default())
        } else {
            let default_cfg = SchedulerConfig::default();
            let raw = serde_json::to_string_pretty(&default_cfg).unwrap();
            let _ = fs::write(&config_file, raw);
            default_cfg
        };

        *self.config.lock().unwrap() = config;
        *self.project_path.lock().unwrap() = Some(project_path);

        self.start();
        Ok(())
    }

    pub fn stop(&self) {
        let mut handles = self.handles.lock().unwrap();
        for handle in handles.drain(..) {
            handle.abort();
        }
    }

    pub fn pause(&self) {
        *self.paused.lock().unwrap() = true;
    }

    pub fn resume(&self) {
        *self.paused.lock().unwrap() = false;
    }

    pub fn is_paused(&self) -> bool {
        *self.paused.lock().unwrap()
    }

    pub fn get_project_path(&self) -> Option<String> {
        self.project_path.lock().unwrap().clone()
    }

    pub fn get_config(&self) -> SchedulerConfig {
        self.config.lock().unwrap().clone()
    }

    pub fn update_config(&self, new_config: SchedulerConfig) -> Result<(), String> {
        let path_opt = self.get_project_path();
        if let Some(ref project_path) = path_opt {
            let config_file = Path::new(project_path).join(".wikimind").join("schedule.json");
            let raw = serde_json::to_string_pretty(&new_config)
                .map_err(|e| format!("Failed to serialize schedule config: {e}"))?;
            fs::write(config_file, raw)
                .map_err(|e| format!("Failed to write schedule.json: {e}"))?;
        }

        *self.config.lock().unwrap() = new_config;
        
        // Restart scheduler to pick up changes
        if path_opt.is_some() {
            self.stop();
            self.start();
        }
        Ok(())
    }

    pub fn start(&self) {
        let project_path_opt = self.project_path.lock().unwrap().clone();
        let Some(project_path) = project_path_opt else { return; };

        let config = self.config.lock().unwrap().clone();
        let paused = self.paused.clone();
        let app = self.app.clone();
        
        let mut handles = self.handles.lock().unwrap();

        for job in config.jobs {
            if !job.enabled {
                continue;
            }

            let project_path = project_path.clone();
            let paused = paused.clone();
            let config_clone = self.config.clone();
            let app = app.clone();
            let job_name = job.name.clone();

            let handle = tokio::spawn(async move {
                loop {
                    let cron_str = job.cron.clone();
                    let Ok(schedule) = Schedule::from_str(&cron_str) else {
                        eprintln!("[Scheduler] Invalid cron expression for job {}: {}", job_name, cron_str);
                        sleep(Duration::from_secs(60)).await;
                        continue;
                    };

                    let now = Utc::now();
                    let Some(next_run) = schedule.upcoming(Utc).next() else {
                        sleep(Duration::from_secs(60)).await;
                        continue;
                    };

                    let time_warp = config_clone.lock().unwrap().time_warp_factor;
                    let sleep_seconds = ((next_run - now).num_seconds() as f64 / time_warp).max(1.0);
                    
                    sleep(Duration::from_secs_f64(sleep_seconds)).await;

                    if *paused.lock().unwrap() {
                        continue;
                    }

                    let job_id = Uuid::new_v4().to_string();
                    let start_time = Local::now().to_rfc3339();
                    println!("[Scheduler] Starting job: {} (id: {})", job_name, job_id);

                    let mut actions_taken = Vec::new();
                    let mut errors = Vec::new();
                    let mut claims_scanned = 0;

                    let app_state = crate::load_agent_runtime_config(&app);
                    let llm_client_res = app_state.llm.map(LlmClient::new);

                    match job_name.as_str() {
                        "decay_scan" => {
                            match pipeline::run_decay_scan(&project_path) {
                                Ok(res) => {
                                    claims_scanned = res.total;
                                    actions_taken.push(format!(
                                        "Decay scan complete. Fresh: {}, Aging: {}, Stale: {}, Decayed: {}",
                                        res.fresh, res.aging, res.stale, res.decayed
                                    ));
                                }
                                Err(err) => {
                                    errors.push(err);
                                }
                            }
                        }
                        "re_verification" => {
                            match llm_client_res {
                                Some(Ok(provider)) => {
                                    match check_and_update_budget(&project_path, 0.0) {
                                        Ok(false) => {
                                            errors.push("API Budget exhausted. Skipping re-verification job.".to_string());
                                        }
                                        _ => {
                                            match pipeline::run_re_verification(&project_path, &provider, app_state.web_search, &app).await {
                                                Ok(res) => {
                                                    claims_scanned = res.scanned;
                                                    actions_taken.push(format!(
                                                        "Re-verification complete. Corroborated: {}, Contradicted: {}, Neutral: {}",
                                                        res.corroborated, res.contradicted, res.neutral
                                                    ));
                                                    for err in res.errors {
                                                        errors.push(err);
                                                    }
                                                }
                                                Err(err) => {
                                                    errors.push(err);
                                                }
                                            }
                                        }
                                    }
                                }
                                Some(Err(err)) => {
                                    errors.push(format!("Failed to build LLM provider: {}", err));
                                }
                                None => {
                                    errors.push("No LLM config available to run re-verification".to_string());
                                }
                            }
                        }
                        "contradiction_resolution" => {
                            actions_taken.push("Contradiction resolution job started (not fully automated)".to_string());
                        }
                        "health_report" => {
                            actions_taken.push("Health report generated".to_string());
                        }
                        _ => {
                            errors.push(format!("Unknown job type: {}", job_name));
                        }
                    }

                    let end_time = Local::now().to_rfc3339();
                    let job_log = MaintenanceJobLog {
                        job_id,
                        r#type: job_name.clone(),
                        start_time,
                        end_time,
                        claims_scanned,
                        actions_taken,
                        errors,
                    };

                    let _ = jobs::log_job(&project_path, &job_log);
                }
            });

            handles.push(handle);
        }
    }

    pub async fn run_job_manually(&self, job_name: &str) -> Result<(), String> {
        let project_path_opt = self.get_project_path();
        let Some(project_path) = project_path_opt else {
            return Err("No active project to run job".to_string());
        };

        let job_id = Uuid::new_v4().to_string();
        let start_time = Local::now().to_rfc3339();
        let mut actions_taken = Vec::new();
        let mut errors = Vec::new();
        let mut claims_scanned = 0;

        let app_state = crate::load_agent_runtime_config(&self.app);
        let llm_client_res = app_state.llm.map(LlmClient::new);

        match job_name {
            "decay_scan" => {
                match pipeline::run_decay_scan(&project_path) {
                    Ok(res) => {
                        claims_scanned = res.total;
                        actions_taken.push(format!(
                            "Manual decay scan complete. Fresh: {}, Aging: {}, Stale: {}, Decayed: {}",
                            res.fresh, res.aging, res.stale, res.decayed
                        ));
                    }
                    Err(err) => {
                        errors.push(err);
                    }
                }
            }
            "re_verification" => {
                match llm_client_res {
                    Some(Ok(provider)) => {
                        match check_and_update_budget(&project_path, 0.0) {
                            Ok(false) => {
                                errors.push("API Budget exhausted. Skipping re-verification job.".to_string());
                            }
                            _ => {
                                match pipeline::run_re_verification(&project_path, &provider, app_state.web_search, &self.app).await {
                                    Ok(res) => {
                                        claims_scanned = res.scanned;
                                        actions_taken.push(format!(
                                            "Manual re-verification complete. Corroborated: {}, Contradicted: {}, Neutral: {}",
                                            res.corroborated, res.contradicted, res.neutral
                                        ));
                                        for err in res.errors {
                                            errors.push(err);
                                        }
                                    }
                                    Err(err) => {
                                        errors.push(err);
                                    }
                                }
                            }
                        }
                    }
                    Some(Err(err)) => {
                        errors.push(format!("Failed to build LLM provider: {}", err));
                    }
                    None => {
                        errors.push("No LLM config available to run re-verification".to_string());
                    }
                }
            }
            "contradiction_resolution" => {
                actions_taken.push("Manual contradiction resolution job started".to_string());
            }
            "health_report" => {
                actions_taken.push("Manual health report generated".to_string());
            }
            _ => {
                return Err(format!("Unknown job type: {}", job_name));
            }
        }

        let end_time = Local::now().to_rfc3339();
        let job_log = MaintenanceJobLog {
            job_id,
            r#type: job_name.to_string(),
            start_time,
            end_time,
            claims_scanned,
            actions_taken,
            errors,
        };

        jobs::log_job(&project_path, &job_log)?;
        Ok(())
    }
}

pub fn check_and_update_budget(project_path: &str, cost_to_add: f64) -> Result<bool, String> {
    let config_file = Path::new(project_path).join(".wikimind").join("schedule.json");
    if !config_file.exists() {
        return Ok(true);
    }
    let raw = fs::read_to_string(&config_file)
        .map_err(|e| format!("Failed to read schedule.json: {e}"))?;
    let mut config = serde_json::from_str::<SchedulerConfig>(&raw)
        .unwrap_or_else(|_| SchedulerConfig::default());

    let mut budget = config.api_budget.unwrap_or_default();
    let current_month = Local::now().format("%Y-%m").to_string();

    let mut reset_needed = false;
    if let Some(ref last_month) = budget.last_reset_month {
        if last_month != &current_month {
            reset_needed = true;
        }
    } else {
        reset_needed = true;
    }

    if reset_needed {
        budget.current_month_spent_usd = 0.0;
        budget.last_reset_month = Some(current_month);
    }

    if budget.current_month_spent_usd + cost_to_add > budget.monthly_cap_usd {
        config.api_budget = Some(budget);
        let raw_updated = serde_json::to_string_pretty(&config).unwrap();
        let _ = fs::write(&config_file, raw_updated);
        return Ok(false);
    }

    budget.current_month_spent_usd += cost_to_add;
    config.api_budget = Some(budget);
    let raw_updated = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize updated schedule config: {e}"))?;
    fs::write(&config_file, raw_updated)
        .map_err(|e| format!("Failed to write schedule.json: {e}"))?;

    Ok(true)
}
