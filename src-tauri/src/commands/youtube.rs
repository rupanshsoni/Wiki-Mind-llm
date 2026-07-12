use std::fs;
use std::path::Path;
use std::process::Command;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
struct TranscriptSegment {
    text: String,
    start: f64,
    duration: f64,
}

fn extract_youtube_video_id(url: &str) -> Option<String> {
    if let Some(pos) = url.find("watch?v=") {
        let after = &url[pos + 8..];
        let end = after.find('&').unwrap_or(after.len());
        return Some(after[..end].to_string());
    }
    if let Some(pos) = url.find("youtu.be/") {
        let after = &url[pos + 9..];
        let end = after.find('?').unwrap_or(after.len());
        return Some(after[..end].to_string());
    }
    if let Some(pos) = url.find("/embed/") {
        let after = &url[pos + 7..];
        let end = after.find('?').unwrap_or(after.len());
        return Some(after[..end].to_string());
    }
    if let Some(pos) = url.find("/shorts/") {
        let after = &url[pos + 8..];
        let end = after.find('?').unwrap_or(after.len());
        return Some(after[..end].to_string());
    }
    None
}

#[tauri::command]
pub async fn ingest_youtube_url(
    project_path: String,
    url: String,
) -> Result<String, String> {
    let video_id = extract_youtube_video_id(&url)
        .ok_or_else(|| "Failed to extract YouTube video ID from the provided URL".to_string())?;

    // Execute python command
    let output = Command::new("python")
        .args(&["-m", "youtube_transcript_api", &video_id, "--format", "json"])
        .output()
        .map_err(|e| format!("Failed to run python youtube-transcript-api command: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("youtube-transcript-api failed: {}", stderr.trim()));
    }

    let segments: Vec<TranscriptSegment> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse transcript JSON: {}", e))?;

    let mut body = String::new();
    for seg in segments {
        body.push_str(&seg.text);
        body.push(' ');
    }

    let dest_dir = Path::new(&project_path).join("raw").join("sources");
    if !dest_dir.exists() {
        fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create raw/sources directory: {}", e))?;
    }

    let filename = format!("youtube_{}.md", video_id);
    let dest_file = dest_dir.join(&filename);

    let now_date_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let file_content = format!(
        "---\ntitle: YouTube Video Transcript - {}\nsources: [\"{}\"]\ndate: {}\n---\n\n# YouTube Video Transcript - {}\n\nURL: {}\n\n---\n\n{}\n",
        video_id,
        url,
        now_date_str,
        video_id,
        url,
        body.trim()
    );

    fs::write(&dest_file, file_content)
        .map_err(|e| format!("Failed to write YouTube transcript file: {}", e))?;

    Ok(format!("raw/sources/{}", filename))
}
