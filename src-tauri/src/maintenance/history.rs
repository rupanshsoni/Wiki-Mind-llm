use std::fs;
use std::path::Path;
use chrono::Local;

pub fn generate_unified_diff(old: &str, new: &str) -> String {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();
    
    let n = old_lines.len();
    let m = new_lines.len();
    let mut dp = vec![vec![0; m + 1]; n + 1];
    
    for i in 1..=n {
        for j in 1..=m {
            if old_lines[i - 1] == new_lines[j - 1] {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }
    
    let mut i = n;
    let mut j = m;
    let mut steps = Vec::new();
    
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && old_lines[i - 1] == new_lines[j - 1] {
            steps.push((format!("  {}", old_lines[i - 1]), i - 1, j - 1));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            steps.push((format!("+{}", new_lines[j - 1]), i, j - 1));
            j -= 1;
        } else if i > 0 && (j == 0 || dp[i][j - 1] < dp[i - 1][j]) {
            steps.push((format!("-{}", old_lines[i - 1]), i - 1, j));
            i -= 1;
        }
    }
    
    steps.reverse();
    let mut diff = String::new();
    for (line, _, _) in steps {
        diff.push_str(&line);
        diff.push('\n');
    }
    diff
}

pub fn save_history_diff(project_path: &str, slug: &str, old_content: &str, new_content: &str) -> Result<(), String> {
    let diff_content = generate_unified_diff(old_content, new_content);
    let history_dir = Path::new(project_path).join(".wikimind").join("history");
    if !history_dir.exists() {
        fs::create_dir_all(&history_dir)
            .map_err(|e| format!("Failed to create history directory: {e}"))?;
    }
    
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("{}_{}.diff", slug, timestamp);
    let file_path = history_dir.join(filename);
    
    fs::write(&file_path, diff_content)
        .map_err(|e| format!("Failed to write history diff: {e}"))?;
        
    Ok(())
}
