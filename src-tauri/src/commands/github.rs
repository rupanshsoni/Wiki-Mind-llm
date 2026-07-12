use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use walkdir::WalkDir;

fn extract_github_info(url: &str) -> Option<(String, String)> {
    let path = if let Some(pos) = url.find("github.com/") {
        &url[pos + 11..]
    } else if let Some(pos) = url.find("github.com:") {
        &url[pos + 11..]
    } else {
        url
    };

    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() >= 2 {
        let owner = parts[0].to_string();
        let mut repo = parts[1].to_string();
        if repo.ends_with(".git") {
            repo = repo[..repo.len() - 4].to_string();
        }
        if let Some(pos) = repo.find('?') {
            repo = repo[..pos].to_string();
        }
        return Some((owner, repo));
    }
    None
}

#[tauri::command]
pub async fn ingest_github_url(
    project_path: String,
    url: String,
) -> Result<String, String> {
    let (owner, repo) = extract_github_info(&url)
        .ok_or_else(|| "Failed to parse owner and repository name from the GitHub URL".to_string())?;

    let temp_dir = Path::new(&project_path)
        .join(".wikimind")
        .join("tmp")
        .join(format!("github_{}_{}", owner, repo));

    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
    }
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temporary directory for clone: {}", e))?;

    // Run git clone --depth 1
    let status = Command::new("git")
        .args(&[
            "clone",
            "--depth",
            "1",
            &url,
            temp_dir.to_str().unwrap(),
        ])
        .status()
        .map_err(|e| format!("Failed to run git command: {}", e))?;

    if !status.success() {
        let _ = fs::remove_dir_all(&temp_dir);
        return Err("git clone command failed. Make sure the repository exists and is public.".to_string());
    }

    let mut combined_content = format!(
        "---\ntitle: GitHub Repository - {}/{}\nsources: [\"{}\"]\ndate: {}\n---\n\n# GitHub Repository: {}/{}\n\nURL: {}\n\n",
        owner,
        repo,
        url,
        chrono::Local::now().format("%Y-%m-%d"),
        owner,
        repo,
        url
    );

    // List of files to read
    let mut files_to_read: Vec<PathBuf> = Vec::new();

    // 1. Check for root level readmes
    if let Ok(entries) = fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    let lower = name.to_lowercase();
                    if lower.starts_with("readme") && (lower.ends_with(".md") || lower.ends_with(".txt")) {
                        files_to_read.push(path);
                    }
                }
            }
        }
    }

    // 2. Check for docs/ or doc/ directory recursively
    for docs_name in &["docs", "doc"] {
        let docs_dir = temp_dir.join(docs_name);
        if docs_dir.exists() && docs_dir.is_dir() {
            for entry in WalkDir::new(docs_dir).into_iter().flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        let lower_ext = ext.to_lowercase();
                        if lower_ext == "md" || lower_ext == "txt" {
                            files_to_read.push(path.to_path_buf());
                        }
                    }
                }
            }
        }
    }

    // Sort to keep deterministic order
    files_to_read.sort();

    // Limit to prevent huge file sizes (max 50 files)
    let files_to_read = if files_to_read.len() > 50 {
        &files_to_read[..50]
    } else {
        &files_to_read[..]
    };

    for path in files_to_read {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(rel_path) = path.strip_prefix(&temp_dir) {
                let rel_path_str = rel_path.to_string_lossy().replace('\\', "/");
                combined_content.push_str(&format!(
                    "\n\n## File: {}\n\n{}\n",
                    rel_path_str,
                    content
                ));
            }
        }
    }

    // Save combined content to raw/sources/github_{owner}_{repo}.md
    let dest_dir = Path::new(&project_path).join("raw").join("sources");
    if !dest_dir.exists() {
        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create raw/sources directory: {}", e))?;
    }

    let filename = format!("github_{}_{}.md", owner, repo);
    let dest_file = dest_dir.join(&filename);

    fs::write(&dest_file, combined_content)
        .map_err(|e| format!("Failed to write combined repository documentation: {}", e))?;

    // Cleanup temp clone directory
    let _ = fs::remove_dir_all(&temp_dir);

    Ok(format!("raw/sources/{}", filename))
}
