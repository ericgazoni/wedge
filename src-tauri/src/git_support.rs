use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{
    Cred, CredentialType, FetchOptions, IndexAddOption, Oid, PushOptions, RemoteCallbacks,
    Repository, Signature, Status, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCredentials {
    pub username: String,
    pub password: String,
    pub remember: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProjectInput {
    pub url: String,
    pub destination: String,
    pub credentials: Option<GitCredentials>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoPathInput {
    pub repo_path: String,
    pub credentials: Option<GitCredentials>,
    pub identity: Option<GitIdentityDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveConflictInput {
    pub repo_path: String,
    pub strategy: String,
    pub credentials: Option<GitCredentials>,
    pub identity: Option<GitIdentityDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusDto {
    pub branch: String,
    pub local_change_count: usize,
    pub updates_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentityDto {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandErrorDto {
    pub code: String,
    pub message: String,
    pub action_label: String,
    pub details: String,
    pub requires_auth: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProjectResult {
    pub ok: bool,
    pub opened_path: Option<String>,
    pub status: Option<GitStatusDto>,
    pub error: Option<CommandErrorDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub outcome: String,
    pub status: GitStatusDto,
    pub conflicting_files: Vec<String>,
    pub error: Option<CommandErrorDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusResult {
    pub status: Option<GitStatusDto>,
    pub error: Option<CommandErrorDto>,
}

fn map_error(error: &git2::Error) -> CommandErrorDto {
    let details = format!("{}", error.message());
    let message_text = details.to_lowercase();

    if message_text.contains("authentication") || message_text.contains("credentials") {
        return CommandErrorDto {
            code: "AUTH_FAILED".to_string(),
            message: "Your login did not work. Please check your credentials.".to_string(),
            action_label: "Re-enter credentials".to_string(),
            details,
            requires_auth: true,
        };
    }

    if message_text.contains("401") || message_text.contains("403") {
        return CommandErrorDto {
            code: "AUTH_FAILED".to_string(),
            message: "Your login did not work. Please check your credentials.".to_string(),
            action_label: "Re-enter credentials".to_string(),
            details,
            requires_auth: true,
        };
    }

    if message_text.contains("network")
        || message_text.contains("timed out")
        || message_text.contains("failed to connect")
        || message_text.contains("could not resolve")
    {
        return CommandErrorDto {
            code: "NETWORK".to_string(),
            message: "Can't reach the server. Check your internet connection.".to_string(),
            action_label: "Retry".to_string(),
            details,
            requires_auth: false,
        };
    }

    if message_text.contains("non-fast-forward") || message_text.contains("rejected") {
        return CommandErrorDto {
            code: "REMOTE_REJECTED".to_string(),
            message: "Someone else synced before you. Try syncing again.".to_string(),
            action_label: "Sync again".to_string(),
            details,
            requires_auth: false,
        };
    }

    if message_text.contains("no space") || message_text.contains("disk full") {
        return CommandErrorDto {
            code: "DISK_FULL".to_string(),
            message: "Not enough space on your computer to save changes.".to_string(),
            action_label: "OK".to_string(),
            details,
            requires_auth: false,
        };
    }

    CommandErrorDto {
        code: "UNKNOWN".to_string(),
        message: "Something unexpected happened.".to_string(),
        action_label: "Retry".to_string(),
        details,
        requires_auth: false,
    }
}

fn callbacks_with_credentials(credentials: Option<&GitCredentials>) -> RemoteCallbacks<'static> {
    let mut callbacks = RemoteCallbacks::new();
    let creds = credentials.cloned();

    callbacks.credentials(move |_url, username_from_url, allowed_types| {
        if let Some(creds) = creds.as_ref() {
            return Cred::userpass_plaintext(&creds.username, &creds.password);
        }

        if allowed_types.contains(CredentialType::USERNAME) {
            let username = username_from_url.unwrap_or("git");
            return Cred::username(username);
        }

        Cred::default()
    });

    callbacks
}

fn fetch_options(credentials: Option<&GitCredentials>) -> FetchOptions<'static> {
    let callbacks = callbacks_with_credentials(credentials);
    let mut options = FetchOptions::new();
    options.remote_callbacks(callbacks);
    options
}

fn push_options(credentials: Option<&GitCredentials>) -> PushOptions<'static> {
    let callbacks = callbacks_with_credentials(credentials);
    let mut options = PushOptions::new();
    options.remote_callbacks(callbacks);
    options
}

fn open_repo(path: &str) -> Result<Repository, git2::Error> {
    // Match git CLI behavior: allow opening from any nested path inside a repo.
    let repo = Repository::discover(Path::new(path)).or_else(|_| Repository::open(Path::new(path)))?;
    enforce_lf_eol_config(&repo)?;
    Ok(repo)
}

fn enforce_lf_eol_config(repo: &Repository) -> Result<(), git2::Error> {
    let mut config = repo.config()?;
    config.set_str("core.autocrlf", "false")?;
    config.set_str("core.eol", "lf")?;
    Ok(())
}

fn normalize_host(raw_host: &str) -> Option<String> {
    let host = raw_host.trim().trim_matches('[').trim_matches(']').to_lowercase();
    if host.is_empty() {
        return None;
    }
    Some(host)
}

fn host_from_authority_or_path(raw: &str) -> Option<String> {
    let authority = raw.split('/').next().unwrap_or(raw);
    let no_user = authority.rsplit_once('@').map(|(_, value)| value).unwrap_or(authority);

    // Preserve bracketed IPv6 hosts, otherwise trim optional :port suffix.
    if no_user.starts_with('[') {
        let host = no_user.split(']').next().unwrap_or(no_user);
        return normalize_host(host);
    }

    let host = no_user.split(':').next().unwrap_or(no_user);
    normalize_host(host)
}

fn extract_host_from_remote_url(raw_url: &str) -> Option<String> {
    let url = raw_url.trim();
    if url.is_empty() {
        return None;
    }

    if let Some((_, after_scheme)) = url.split_once("://") {
        return host_from_authority_or_path(after_scheme);
    }

    // SCP-like syntax: git@github.com:org/repo.git
    if let Some((_, after_user)) = url.rsplit_once('@') {
        if let Some((host, _)) = after_user.split_once(':') {
            return normalize_host(host);
        }
    }

    host_from_authority_or_path(url)
}

fn repo_origin_host(repo: &Repository) -> Option<String> {
    let remote = repo.find_remote("origin").ok()?;
    let url = remote.url()?;
    extract_host_from_remote_url(url)
}

fn validate_git_identity(name: &str, email: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Name is required.".to_string());
    }

    let email = email.trim();
    if email.is_empty() {
        return Err("Email is required.".to_string());
    }
    if email.contains(char::is_whitespace) {
        return Err("Email cannot contain spaces.".to_string());
    }

    let Some((local, domain)) = email.split_once('@') else {
        return Err("Enter a valid email address.".to_string());
    };

    if local.is_empty() || domain.is_empty() || !domain.contains('.') {
        return Err("Enter a valid email address.".to_string());
    }

    Ok(())
}

fn normalized_identity(identity: Option<&GitIdentityDto>) -> Option<GitIdentityDto> {
    let identity = identity?;
    if validate_git_identity(&identity.name, &identity.email).is_err() {
        return None;
    }

    Some(GitIdentityDto {
        name: identity.name.trim().to_string(),
        email: identity.email.trim().to_string(),
    })
}

fn repo_signature<'a>(
    repo: &'a Repository,
    preferred_identity: Option<&'a GitIdentityDto>,
) -> Result<Signature<'a>, git2::Error> {
    if let Some(identity) = preferred_identity {
        return Signature::now(identity.name.trim(), identity.email.trim());
    }

    match repo.signature() {
        Ok(sig) => Ok(sig),
        Err(_) => Signature::now("Wedge", "wedge@local"),
    }
}

fn current_branch_name(repo: &Repository) -> Result<String, git2::Error> {
    let head = repo.head()?;
    let branch = head.shorthand().unwrap_or("main");
    Ok(branch.to_string())
}

fn repo_status(repo: &Repository, include_remote_check: bool) -> Result<GitStatusDto, git2::Error> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_unmodified(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo.statuses(Some(&mut opts))?;
    let local_change_count = statuses
        .iter()
        .filter(|entry| {
            let s = entry.status();
            s.intersects(
                Status::WT_NEW
                    | Status::WT_MODIFIED
                    | Status::WT_DELETED
                    | Status::WT_RENAMED
                    | Status::WT_TYPECHANGE
                    | Status::INDEX_NEW
                    | Status::INDEX_MODIFIED
                    | Status::INDEX_DELETED
                    | Status::INDEX_RENAMED
                    | Status::INDEX_TYPECHANGE,
            )
        })
        .count();

    let branch = current_branch_name(repo)?;
    let mut updates_available = false;

    if include_remote_check {
        let local_ref = format!("refs/heads/{}", branch);
        let remote_ref = format!("refs/remotes/origin/{}", branch);

        if let (Ok(local_oid), Ok(remote_oid)) = (
            repo.refname_to_id(&local_ref),
            repo.refname_to_id(&remote_ref),
        ) {
            let (_ahead, behind) = repo.graph_ahead_behind(local_oid, remote_oid)?;
            updates_available = behind > 0;
        }
    }

    Ok(GitStatusDto {
        branch,
        local_change_count,
        updates_available,
    })
}

fn collect_changed_uids(repo: &Repository) -> Result<Vec<String>, git2::Error> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_unmodified(false);

    let statuses = repo.statuses(Some(&mut opts))?;
    let mut uids = BTreeSet::new();

    for entry in statuses.iter() {
        let Some(path) = entry.path() else {
            continue;
        };

        let file_name = path.rsplit('/').next().unwrap_or(path);
        if file_name.starts_with('.') {
            continue;
        }

        let uid = file_name
            .trim_end_matches(".yml")
            .trim_end_matches(".yaml")
            .trim_end_matches(".md")
            .trim_end_matches(".markdown")
            .trim();

        if uid.is_empty() {
            continue;
        }

        let all_alnum_or_dash = uid
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
        if all_alnum_or_dash {
            uids.insert(uid.to_string());
        }
    }

    Ok(uids.into_iter().collect())
}

fn auto_commit_message(changed_uids: &[String]) -> String {
    if changed_uids.is_empty() {
        return "Wedge: update project files".to_string();
    }

    if changed_uids.len() <= 3 {
        return format!("Wedge: update {}", changed_uids.join(", "));
    }

    let head = changed_uids
        .iter()
        .take(2)
        .cloned()
        .collect::<Vec<String>>()
        .join(", ");
    let rest = changed_uids.len() - 2;
    format!("Wedge: update {} and {} others", head, rest)
}

fn stage_all(repo: &Repository) -> Result<Oid, git2::Error> {
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;
    index.write_tree()
}

fn commit_if_needed(
    repo: &Repository,
    tree_id: Oid,
    message: &str,
    identity: Option<&GitIdentityDto>,
) -> Result<bool, git2::Error> {
    let tree = repo.find_tree(tree_id)?;

    if let Ok(head) = repo.head() {
        let parent = head.peel_to_commit()?;
        if parent.tree_id() == tree.id() {
            return Ok(false);
        }

        let sig = repo_signature(repo, identity)?;
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])?;
        return Ok(true);
    }

    let sig = repo_signature(repo, identity)?;
    repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[])?;
    Ok(true)
}

fn fetch_origin(repo: &Repository, branch: &str, credentials: Option<&GitCredentials>) -> Result<(), git2::Error> {
    let mut remote = repo.find_remote("origin")?;
    let mut options = fetch_options(credentials);
    remote.fetch(&[branch], Some(&mut options), None)?;
    Ok(())
}

fn fast_forward_to(repo: &Repository, branch: &str, target_oid: Oid) -> Result<(), git2::Error> {
    let local_ref = format!("refs/heads/{}", branch);
    let mut reference = repo.find_reference(&local_ref)?;
    reference.set_target(target_oid, "wedge fast-forward")?;
    repo.set_head(&local_ref)?;
    let mut checkout = CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout))?;
    Ok(())
}

fn merge_remote(
    repo: &Repository,
    branch: &str,
    identity: Option<&GitIdentityDto>,
) -> Result<Vec<String>, git2::Error> {
    let remote_ref_name = format!("refs/remotes/origin/{}", branch);
    let remote_ref = repo.find_reference(&remote_ref_name)?;
    let remote_annotated = repo.reference_to_annotated_commit(&remote_ref)?;

    let (analysis, _preference) = repo.merge_analysis(&[&remote_annotated])?;
    if analysis.is_up_to_date() {
        return Ok(vec![]);
    }

    if analysis.is_fast_forward() {
        fast_forward_to(repo, branch, remote_annotated.id())?;
        return Ok(vec![]);
    }

    if analysis.is_normal() {
        repo.merge(&[&remote_annotated], None, None)?;
        let mut index = repo.index()?;
        if index.has_conflicts() {
            let mut files = Vec::new();
            for conflict in index.conflicts()? {
                let conflict = conflict?;
                if let Some(our) = conflict.our {
                    if let Ok(path) = std::str::from_utf8(&our.path) {
                        files.push(path.to_string());
                    }
                } else if let Some(their) = conflict.their {
                    if let Ok(path) = std::str::from_utf8(&their.path) {
                        files.push(path.to_string());
                    }
                }
            }
            files.sort();
            files.dedup();
            return Ok(files);
        }

        let tree_id = index.write_tree_to(repo)?;
        let tree = repo.find_tree(tree_id)?;
        let sig = repo_signature(repo, identity)?;

        let head_commit = repo.head()?.peel_to_commit()?;
        let remote_commit = repo.find_commit(remote_annotated.id())?;
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "Wedge: merge updates",
            &tree,
            &[&head_commit, &remote_commit],
        )?;

        let mut checkout = CheckoutBuilder::new();
        checkout.force();
        repo.checkout_head(Some(&mut checkout))?;
        repo.cleanup_state()?;
    }

    Ok(vec![])
}

fn push_branch(repo: &Repository, branch: &str, credentials: Option<&GitCredentials>) -> Result<(), git2::Error> {
    let mut remote = repo.find_remote("origin")?;
    let mut options = push_options(credentials);
    let spec = format!("refs/heads/{0}:refs/heads/{0}", branch);
    remote.push(&[&spec], Some(&mut options))?;
    Ok(())
}

fn resolve_merge_conflicts(
    repo: &Repository,
    strategy: &str,
    identity: Option<&GitIdentityDto>,
) -> Result<Vec<String>, git2::Error> {
    let mut index = repo.index()?;
    if !index.has_conflicts() {
        return Ok(vec![]);
    }

    let mut paths = Vec::new();
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        let path = if let Some(our) = conflict.our {
            String::from_utf8_lossy(&our.path).to_string()
        } else if let Some(their) = conflict.their {
            String::from_utf8_lossy(&their.path).to_string()
        } else {
            continue;
        };
        paths.push(path);
    }

    for path in &paths {
        let mut checkout = CheckoutBuilder::new();
        checkout.path(path);
        checkout.force();
        if strategy == "mine" {
            checkout.use_ours(true);
        } else {
            checkout.use_theirs(true);
        }
        repo.checkout_index(None, Some(&mut checkout))?;
        index.add_path(Path::new(path))?;
    }

    index.write()?;

    if index.has_conflicts() {
        return Ok(paths);
    }

    let tree_id = index.write_tree_to(repo)?;
    let tree = repo.find_tree(tree_id)?;
    let sig = repo_signature(repo, identity)?;

    let head_commit = repo.head()?.peel_to_commit()?;
    let merge_head_oid = repo.refname_to_id("MERGE_HEAD")?;
    let merge_head_commit = repo.find_commit(merge_head_oid)?;

    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        "Wedge: resolve sync conflict",
        &tree,
        &[&head_commit, &merge_head_commit],
    )?;

    repo.cleanup_state()?;
    Ok(vec![])
}

#[tauri::command]
pub fn git_clone_project(input: CloneProjectInput) -> CloneProjectResult {
    let fetch = fetch_options(input.credentials.as_ref());

    let mut builder = RepoBuilder::new();
    builder.fetch_options(fetch);

    let _remember = input.credentials.as_ref().map(|c| c.remember).unwrap_or(false);

    match builder.clone(&input.url, Path::new(&input.destination)) {
        Ok(repo) => {
            if let Err(error) = enforce_lf_eol_config(&repo) {
                return CloneProjectResult {
                    ok: false,
                    opened_path: None,
                    status: None,
                    error: Some(map_error(&error)),
                };
            }
            let status = repo_status(&repo, false).ok();
            CloneProjectResult {
                ok: true,
                opened_path: Some(input.destination),
                status,
                error: None,
            }
        }
        Err(error) => CloneProjectResult {
            ok: false,
            opened_path: None,
            status: None,
            error: Some(map_error(&error)),
        },
    }
}

#[tauri::command]
pub fn git_get_status(input: RepoPathInput) -> StatusResult {
    let repo = match open_repo(&input.repo_path) {
        Ok(repo) => repo,
        Err(error) => {
            return StatusResult {
                status: None,
                error: Some(map_error(&error)),
            }
        }
    };

    match repo_status(&repo, true) {
        Ok(status) => StatusResult {
            status: Some(status),
            error: None,
        },
        Err(error) => StatusResult {
            status: None,
            error: Some(map_error(&error)),
        },
    }
}

#[tauri::command]
pub fn git_startup_refresh(input: RepoPathInput) -> StatusResult {
    let repo = match open_repo(&input.repo_path) {
        Ok(repo) => repo,
        Err(error) => {
            return StatusResult {
                status: None,
                error: Some(map_error(&error)),
            }
        }
    };

    let branch = match current_branch_name(&repo) {
        Ok(branch) => branch,
        Err(error) => {
            return StatusResult {
                status: None,
                error: Some(map_error(&error)),
            }
        }
    };

    let current_status = match repo_status(&repo, false) {
        Ok(status) => status,
        Err(error) => {
            return StatusResult {
                status: None,
                error: Some(map_error(&error)),
            }
        }
    };

    if current_status.local_change_count == 0 {
        if let Err(error) = fetch_origin(&repo, &branch, input.credentials.as_ref()) {
            return StatusResult {
                status: None,
                error: Some(map_error(&error)),
            };
        }

        let local_ref = format!("refs/heads/{}", branch);
        let remote_ref = format!("refs/remotes/origin/{}", branch);

        if let (Ok(local_oid), Ok(remote_oid)) = (
            repo.refname_to_id(&local_ref),
            repo.refname_to_id(&remote_ref),
        ) {
            if let Ok((ahead, behind)) = repo.graph_ahead_behind(local_oid, remote_oid) {
                if behind > 0 && ahead == 0 {
                    let _ = fast_forward_to(&repo, &branch, remote_oid);
                }
            }
        }
    }

    match repo_status(&repo, true) {
        Ok(status) => StatusResult {
            status: Some(status),
            error: None,
        },
        Err(error) => StatusResult {
            status: None,
            error: Some(map_error(&error)),
        },
    }
}

#[tauri::command]
pub fn git_get_origin_host(input: RepoPathInput) -> Option<String> {
    let repo = open_repo(&input.repo_path).ok()?;
    repo_origin_host(&repo)
}

#[tauri::command]
pub fn git_sync(input: RepoPathInput) -> SyncResult {
    let repo = match open_repo(&input.repo_path) {
        Ok(repo) => repo,
        Err(error) => {
            return SyncResult {
                outcome: "failed".to_string(),
                status: GitStatusDto {
                    branch: "-".to_string(),
                    local_change_count: 0,
                    updates_available: false,
                },
                conflicting_files: vec![],
                error: Some(map_error(&error)),
            }
        }
    };

    let branch = match current_branch_name(&repo) {
        Ok(branch) => branch,
        Err(error) => {
            return SyncResult {
                outcome: "failed".to_string(),
                status: GitStatusDto {
                    branch: "-".to_string(),
                    local_change_count: 0,
                    updates_available: false,
                },
                conflicting_files: vec![],
                error: Some(map_error(&error)),
            }
        }
    };

    let configured_identity = normalized_identity(input.identity.as_ref());

    let changed_uids = collect_changed_uids(&repo).unwrap_or_default();
    let tree_id = match stage_all(&repo) {
        Ok(tree_id) => tree_id,
        Err(error) => {
            return SyncResult {
                outcome: "failed".to_string(),
                status: GitStatusDto {
                    branch,
                    local_change_count: 0,
                    updates_available: false,
                },
                conflicting_files: vec![],
                error: Some(map_error(&error)),
            }
        }
    };

    let message = auto_commit_message(&changed_uids);
    if let Err(error) = commit_if_needed(&repo, tree_id, &message, configured_identity.as_ref()) {
        return SyncResult {
            outcome: "failed".to_string(),
            status: GitStatusDto {
                branch,
                local_change_count: 0,
                updates_available: false,
            },
            conflicting_files: vec![],
            error: Some(map_error(&error)),
        };
    }

    if let Err(error) = fetch_origin(&repo, &branch, input.credentials.as_ref()) {
        return SyncResult {
            outcome: "failed".to_string(),
            status: repo_status(&repo, false).unwrap_or(GitStatusDto {
                branch,
                local_change_count: 0,
                updates_available: false,
            }),
            conflicting_files: vec![],
            error: Some(map_error(&error)),
        };
    }

    let conflicts = match merge_remote(&repo, &branch, configured_identity.as_ref()) {
        Ok(conflicts) => conflicts,
        Err(error) => {
            return SyncResult {
                outcome: "failed".to_string(),
                status: repo_status(&repo, false).unwrap_or(GitStatusDto {
                    branch,
                    local_change_count: 0,
                    updates_available: false,
                }),
                conflicting_files: vec![],
                error: Some(map_error(&error)),
            }
        }
    };

    if !conflicts.is_empty() {
        return SyncResult {
            outcome: "conflict".to_string(),
            status: repo_status(&repo, false).unwrap_or(GitStatusDto {
                branch,
                local_change_count: 0,
                updates_available: true,
            }),
            conflicting_files: conflicts,
            error: None,
        };
    }

    if let Err(error) = push_branch(&repo, &branch, input.credentials.as_ref()) {
        return SyncResult {
            outcome: "failed".to_string(),
            status: repo_status(&repo, false).unwrap_or(GitStatusDto {
                branch,
                local_change_count: 0,
                updates_available: false,
            }),
            conflicting_files: vec![],
            error: Some(map_error(&error)),
        };
    }

    SyncResult {
        outcome: "synced".to_string(),
        status: repo_status(&repo, true).unwrap_or(GitStatusDto {
            branch,
            local_change_count: 0,
            updates_available: false,
        }),
        conflicting_files: vec![],
        error: None,
    }
}

#[tauri::command]
pub fn git_resolve_conflict(input: ResolveConflictInput) -> SyncResult {
    let repo = match open_repo(&input.repo_path) {
        Ok(repo) => repo,
        Err(error) => {
            return SyncResult {
                outcome: "failed".to_string(),
                status: GitStatusDto {
                    branch: "-".to_string(),
                    local_change_count: 0,
                    updates_available: false,
                },
                conflicting_files: vec![],
                error: Some(map_error(&error)),
            }
        }
    };

    let branch = current_branch_name(&repo).unwrap_or_else(|_| "main".to_string());

    if input.strategy == "abort" {
        if let Ok(head) = repo.head() {
            if let Ok(commit) = head.peel_to_commit() {
                let object = commit.as_object();
                let _ = repo.reset(object, git2::ResetType::Hard, None);
            }
        }
        let _ = repo.cleanup_state();
        return SyncResult {
            outcome: "aborted".to_string(),
            status: repo_status(&repo, true).unwrap_or(GitStatusDto {
                branch,
                local_change_count: 0,
                updates_available: false,
            }),
            conflicting_files: vec![],
            error: None,
        };
    }

    let strategy = if input.strategy == "mine" {
        "mine"
    } else {
        "theirs"
    };

    let configured_identity = normalized_identity(input.identity.as_ref());

    let remaining = match resolve_merge_conflicts(&repo, strategy, configured_identity.as_ref()) {
        Ok(remaining) => remaining,
        Err(error) => {
            return SyncResult {
                outcome: "failed".to_string(),
                status: repo_status(&repo, false).unwrap_or(GitStatusDto {
                    branch,
                    local_change_count: 0,
                    updates_available: false,
                }),
                conflicting_files: vec![],
                error: Some(map_error(&error)),
            }
        }
    };

    if !remaining.is_empty() {
        return SyncResult {
            outcome: "conflict".to_string(),
            status: repo_status(&repo, false).unwrap_or(GitStatusDto {
                branch,
                local_change_count: 0,
                updates_available: true,
            }),
            conflicting_files: remaining,
            error: None,
        };
    }

    if let Err(error) = push_branch(&repo, &branch, input.credentials.as_ref()) {
        return SyncResult {
            outcome: "failed".to_string(),
            status: repo_status(&repo, false).unwrap_or(GitStatusDto {
                branch,
                local_change_count: 0,
                updates_available: false,
            }),
            conflicting_files: vec![],
            error: Some(map_error(&error)),
        };
    }

    SyncResult {
        outcome: "synced".to_string(),
        status: repo_status(&repo, true).unwrap_or(GitStatusDto {
            branch,
            local_change_count: 0,
            updates_available: false,
        }),
        conflicting_files: vec![],
        error: None,
    }
}

