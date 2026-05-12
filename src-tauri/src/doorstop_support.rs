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

// doorstop output is one issue per line:
//   WARNING: <doc_prefix>: <item_uid>: <message>   ← item-level warning
//   WARNING: <doc_prefix>: <message>               ← document-level warning
//   ERROR: <message>: <uid>                        ← error (uid at end)
//
// Examples:
//   WARNING: SRD: SRD_070: unreviewed changes
//   WARNING: SRD: duplicate level: 1 (SRD_146, SRD_147)
//   WARNING: HLT: HLT-001: suspect link: SRD_018
//   ERROR: no item with UID: SRD_001

fn looks_like_uid(s: &str) -> bool {
    !s.is_empty()
        && !s.contains(' ')
        && s.chars().any(|c| c.is_ascii_alphabetic())
        && s.chars().any(|c| c.is_ascii_digit())
        && s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-')
}

fn parse_issue_line(line: &str) -> Option<DoorstopIssue> {
    let trimmed = line.trim();

    let (level, rest) = if let Some(r) = trimmed.strip_prefix("WARNING: ") {
        ("warning", r)
    } else if let Some(r) = trimmed.strip_prefix("ERROR: ") {
        ("error", r)
    } else {
        return None;
    };

    if level == "warning" {
        // rest = "<doc_prefix>: <detail>"
        let sep = rest.find(": ")?;
        let doc_prefix = &rest[..sep];
        let detail = &rest[sep + 2..];

        // detail may be "<item_uid>: <message>" or just "<message>"
        if let Some(d_sep) = detail.find(": ") {
            let uid_candidate = &detail[..d_sep];
            if looks_like_uid(uid_candidate) {
                return Some(DoorstopIssue {
                    level: level.to_string(),
                    uid: uid_candidate.to_string(),
                    message: detail[d_sep + 2..].to_string(),
                });
            }
        }
        // Document-level: uid = doc_prefix
        Some(DoorstopIssue {
            level: level.to_string(),
            uid: doc_prefix.to_string(),
            message: detail.to_string(),
        })
    } else {
        // ERROR: uid is at the end after the last ": "
        // e.g. "no item with UID: SRD_001"
        let last_sep = rest.rfind(": ")?;
        let uid_candidate = &rest[last_sep + 2..];
        if !looks_like_uid(uid_candidate) {
            return None;
        }
        Some(DoorstopIssue {
            level: level.to_string(),
            uid: uid_candidate.to_string(),
            message: rest[..last_sep].trim().to_string(),
        })
    }
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
