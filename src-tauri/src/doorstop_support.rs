use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoorstopIssue {
    pub level: String,
    pub uid: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoorstopCheckResult {
    pub available: bool,
    pub issues: Vec<DoorstopIssue>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoorstopReviewResult {
    pub available: bool,
    pub success: bool,
}

// Resolve the doorstop executable using a three-step priority:
//   1. Sidecar bundled next to the app binary (production)
//   2. .venv created by `uv sync` in the project tree (dev)
//   3. System PATH fallback
fn doorstop_binary() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        // 1. Bundled sidecar sits in the same directory as the app binary.
        if let Some(dir) = exe.parent() {
            #[cfg(not(windows))]
            let candidate = dir.join("doorstop");
            #[cfg(windows)]
            let candidate = dir.join("doorstop.exe");
            if candidate.exists() && std::fs::metadata(&candidate).map(|m| m.len() > 0).unwrap_or(false) {
                return candidate;
            }
        }

        // 2. Walk up the directory tree looking for a .venv (dev environment).
        let venv_rel = {
            #[cfg(windows)]
            { std::path::Path::new(".venv/Scripts/doorstop.exe") }
            #[cfg(not(windows))]
            { std::path::Path::new(".venv/bin/doorstop") }
        };
        let mut dir = exe.as_path();
        while let Some(parent) = dir.parent() {
            let candidate = parent.join(venv_rel);
            if candidate.exists() {
                return candidate;
            }
            dir = parent;
        }
    }

    // 3. Fall back to whatever is on the system PATH.
    PathBuf::from("doorstop")
}

fn parse_issue_line(line: &str) -> Option<DoorstopIssue> {
    let trimmed = line.trim();
    let (level, rest) = if let Some(r) = trimmed.strip_prefix("ERROR: ") {
        ("error", r)
    } else if let Some(r) = trimmed.strip_prefix("WARNING: ") {
        ("warning", r)
    } else {
        return None;
    };

    let sep_pos = rest.find(": ")?;
    let uid = rest[..sep_pos].trim().to_string();
    if uid.is_empty() {
        return None;
    }
    let message = rest[sep_pos + 2..].trim().to_string();

    Some(DoorstopIssue {
        level: level.to_string(),
        uid,
        message,
    })
}

fn parse_doorstop_output(output: &str) -> Vec<DoorstopIssue> {
    output.lines().filter_map(parse_issue_line).collect()
}

#[tauri::command]
pub fn doorstop_check(root_path: String) -> DoorstopCheckResult {
    let result = Command::new(doorstop_binary())
        .current_dir(&root_path)
        .output();

    match result {
        Err(_) => DoorstopCheckResult {
            available: false,
            issues: vec![],
        },
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{}{}", stdout, stderr);
            DoorstopCheckResult {
                available: true,
                issues: parse_doorstop_output(&combined),
            }
        }
    }
}

#[tauri::command]
pub fn doorstop_review(root_path: String, uid: String) -> DoorstopReviewResult {
    let result = Command::new(doorstop_binary())
        .args(["review", &uid])
        .current_dir(&root_path)
        .output();

    match result {
        Err(_) => DoorstopReviewResult {
            available: false,
            success: false,
        },
        Ok(output) => DoorstopReviewResult {
            available: true,
            success: output.status.success(),
        },
    }
}
