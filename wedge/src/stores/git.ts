import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  gitCloneProject,
  gitGetStatus,
  gitResolveConflict,
  gitStartupRefresh,
  gitSync,
} from "../services/git";
import type { GitCommandError, GitCredentials, GitStatus } from "../types/git";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export const useGitStore = defineStore("git", () => {
  const status = ref<GitStatus | null>(null);
  const syncing = ref(false);
  const lastSyncAt = ref<string>("");
  const error = ref<GitCommandError | null>(null);
  const conflictingFiles = ref<string[]>([]);
  const pollTimer = ref<number | null>(null);

  const hasConflict = computed(() => conflictingFiles.value.length > 0);

  const statusTone = computed<"amber" | "green" | "blue" | "red" | "neutral">(() => {
    if (syncing.value) return "blue";
    if (error.value) return "red";
    if (status.value?.updatesAvailable) return "blue";
    if ((status.value?.localChangeCount ?? 0) > 0) return "amber";
    if (status.value) return "green";
    return "neutral";
  });

  const statusText = computed(() => {
    if (syncing.value) return "Syncing...";
    if (error.value) return "Sync failed";
    if (status.value?.updatesAvailable) return "Updates available";
    if ((status.value?.localChangeCount ?? 0) > 0) {
      const count = status.value?.localChangeCount ?? 0;
      return `${count} unsaved changes`;
    }
    if (status.value) return "All synced";
    return "Sync status unavailable";
  });

  function applyStatus(next: GitStatus | null) {
    if (!next) return;
    status.value = next;
    if (next.localChangeCount === 0 && !next.updatesAvailable) {
      error.value = null;
    }
  }

  function stopPolling() {
    if (pollTimer.value == null) return;
    window.clearInterval(pollTimer.value);
    pollTimer.value = null;
  }

  function startPolling(repoPath: string, credentials?: GitCredentials) {
    stopPolling();
    pollTimer.value = window.setInterval(async () => {
      const result = await gitGetStatus({ repoPath, credentials });
      if (result.error) {
        error.value = result.error;
        return;
      }
      applyStatus(result.status);
    }, POLL_INTERVAL_MS);
  }

  async function refresh(repoPath: string, credentials?: GitCredentials) {
    const result = await gitGetStatus({ repoPath, credentials });
    error.value = result.error;
    applyStatus(result.status);
  }

  async function startupRefresh(repoPath: string, credentials?: GitCredentials) {
    const result = await gitStartupRefresh({ repoPath, credentials });
    error.value = result.error;
    applyStatus(result.status);
    startPolling(repoPath, credentials);
  }

  async function runSync(repoPath: string, credentials?: GitCredentials) {
    if (syncing.value) return;
    syncing.value = true;
    error.value = null;

    try {
      const result = await gitSync({ repoPath, credentials });
      applyStatus(result.status);
      conflictingFiles.value = result.conflictingFiles;
      error.value = result.error;
      if (result.outcome === "synced") {
        lastSyncAt.value = new Date().toLocaleString();
      }
    } finally {
      syncing.value = false;
    }
  }

  async function resolveConflict(
    repoPath: string,
    strategy: "mine" | "theirs" | "abort",
    credentials?: GitCredentials,
  ) {
    syncing.value = true;
    try {
      const result = await gitResolveConflict({ repoPath, strategy, credentials });
      applyStatus(result.status);
      conflictingFiles.value = result.conflictingFiles;
      error.value = result.error;
      if (result.outcome === "synced") {
        lastSyncAt.value = new Date().toLocaleString();
      }
    } finally {
      syncing.value = false;
    }
  }

  async function cloneProject(
    url: string,
    destination: string,
    credentials?: GitCredentials,
  ): Promise<{ openedPath: string; requiresAuth: boolean } | null> {
    const result = await gitCloneProject({ url, destination, credentials });
    error.value = result.error;
    applyStatus(result.status);
    if (!result.ok || !result.openedPath) {
      return { openedPath: "", requiresAuth: !!result.error?.requiresAuth };
    }
    return { openedPath: result.openedPath, requiresAuth: false };
  }

  function clearState() {
    status.value = null;
    syncing.value = false;
    error.value = null;
    conflictingFiles.value = [];
    stopPolling();
  }

  return {
    status,
    syncing,
    lastSyncAt,
    error,
    conflictingFiles,
    hasConflict,
    statusTone,
    statusText,
    refresh,
    startupRefresh,
    runSync,
    resolveConflict,
    cloneProject,
    clearState,
    stopPolling,
  };
});

