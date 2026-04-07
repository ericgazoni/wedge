import { invoke } from "@tauri-apps/api/core";
import type {
  GitCloneResult,
  GitCredentials,
  GitIdentity,
  GitStatusResult,
  GitSyncResult,
} from "../types/git";

type RepoPathInput = {
  repoPath: string;
  credentials?: GitCredentials;
  identity?: GitIdentity;
};

type ResolveConflictInput = {
  repoPath: string;
  strategy: "mine" | "theirs" | "abort";
  credentials?: GitCredentials;
  identity?: GitIdentity;
};

type CloneProjectInput = {
  url: string;
  destination: string;
  credentials?: GitCredentials;
};

export async function gitCloneProject(input: CloneProjectInput): Promise<GitCloneResult> {
  return invoke<GitCloneResult>("git_clone_project", { input });
}

export async function gitGetStatus(input: RepoPathInput): Promise<GitStatusResult> {
  return invoke<GitStatusResult>("git_get_status", { input });
}

export async function gitStartupRefresh(input: RepoPathInput): Promise<GitStatusResult> {
  return invoke<GitStatusResult>("git_startup_refresh", { input });
}

export async function gitGetOriginHost(input: RepoPathInput): Promise<string | null> {
  return invoke<string | null>("git_get_origin_host", { input });
}


export async function gitSync(input: RepoPathInput): Promise<GitSyncResult> {
  return invoke<GitSyncResult>("git_sync", { input });
}

export async function gitResolveConflict(input: ResolveConflictInput): Promise<GitSyncResult> {
  return invoke<GitSyncResult>("git_resolve_conflict", { input });
}

