<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { useAppStore } from "./stores/app";
import { useRepoStore } from "./stores/repo";
import { useGitStore } from "./stores/git";
import { gitGetOriginHost } from "./services/git";
import type { GitCredentials, GitIdentity } from "./types/git";
import AppHeader from "./components/layout/AppHeader.vue";
import AppFooter from "./components/layout/AppFooter.vue";
import TreePanel from "./components/tree/TreePanel.vue";
import EditorView from "./components/views/EditorView.vue";
import BatchView from "./components/views/BatchView.vue";
import GitView from "./components/views/GitView.vue";
import ProjectSetupView from "./components/views/ProjectSetupView.vue";

const app = useAppStore();
const repo = useRepoStore();
const git = useGitStore();
const keys = useMagicKeys();

const visibleDocCount = ref(0);
const visibleItemCount = ref(0);

let openingRepo = false;
const joiningProject = ref(false);
const joinDialogOpen = ref(false);
const joinUrl = ref("");
const joinDestination = ref("");
const joinAuthNeeded = ref(false);
const joinUsername = ref("");
const joinPassword = ref("");
const joinRememberMe = ref(true);
const joinError = ref("");

const gitSettingsDialogOpen = ref(false);
const gitSettingsHost = ref("");
const gitSettingsUsername = ref("");
const gitSettingsPassword = ref("");
const gitSettingsCommitName = ref("");
const gitSettingsCommitEmail = ref("");
const gitSettingsError = ref("");

let unlistenMenuAction: (() => void) | null = null;

const CREDENTIALS_STORAGE_KEY = "wedge.gitCredentialsByHost";
const GIT_IDENTITY_STORAGE_KEY = "wedge.gitIdentity";
const APP_MENU_EVENT_NAME = "wedge://menu-action";

const viewLabel = computed(() =>
  app.currentView === "editor" ? "Editor" : app.currentView === "batch" ? "Batch" : "Git",
);

const canDownloadShared = computed(() => {
  if (!joinDestination.value.trim()) return false;
  try {
    const url = new URL(joinUrl.value.trim());
    return url.protocol === "https:";
  } catch {
    return false;
  }
});

function repoNameFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    const tail = url.pathname.split("/").filter(Boolean).pop() ?? "project";
    return tail.endsWith(".git") ? tail.slice(0, -4) : tail;
  } catch {
    return "project";
  }
}

function credentialsHost(rawUrl: string): string {
  try {
    return new URL(rawUrl.trim()).host;
  } catch {
    return "";
  }
}

function normalizeHost(rawHost: string): string {
  const trimmed = rawHost.trim();
  if (!trimmed) return "";
  try {
    const withProtocol = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(withProtocol).host.toLowerCase();
  } catch {
    return trimmed.split("/")[0]?.toLowerCase() ?? "";
  }
}

function isValidEmail(value: string): boolean {
  if (!value || /\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at === value.length - 1) return false;
  return value.slice(at + 1).includes(".");
}

function readStoredCredentialsByHost(): Record<string, { username: string; password: string }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CREDENTIALS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, { username: string; password: string }>) : {};
  } catch {
    return {};
  }
}

function writeStoredCredentialsByHost(data: Record<string, { username: string; password: string }>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore local persistence failure.
  }
}

function readStoredGitIdentity(): GitIdentity | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(GIT_IDENTITY_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<GitIdentity>;
    const name = parsed.name?.trim() ?? "";
    const email = parsed.email?.trim() ?? "";
    if (!name || !email) return undefined;
    return { name, email };
  } catch {
    return undefined;
  }
}

function writeStoredGitIdentity(identity: GitIdentity) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GIT_IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Ignore local persistence failure.
  }
}

function loadRememberedCredentialsForHost(rawHost: string): GitCredentials | undefined {
  const host = normalizeHost(rawHost);
  if (!host) return undefined;
  const parsed = readStoredCredentialsByHost();
  const hit = parsed[host];
  if (!hit) return undefined;
  return { username: hit.username, password: hit.password, remember: true };
}

function persistRememberedCredentialsForHost(rawHost: string, credentials: GitCredentials) {
  if (!credentials.remember) return;
  const host = normalizeHost(rawHost);
  if (!host) return;
  const parsed = readStoredCredentialsByHost();
  parsed[host] = { username: credentials.username, password: credentials.password };
  writeStoredCredentialsByHost(parsed);
}

function clearRememberedCredentialsForHost(rawHost: string) {
  const host = normalizeHost(rawHost);
  if (!host) return;
  const parsed = readStoredCredentialsByHost();
  delete parsed[host];
  writeStoredCredentialsByHost(parsed);
}

function loadRememberedCredentials(rawUrl: string): GitCredentials | undefined {
  const host = credentialsHost(rawUrl);
  return loadRememberedCredentialsForHost(host);
}

function persistRememberedCredentials(rawUrl: string, credentials: GitCredentials) {
  const host = credentialsHost(rawUrl);
  persistRememberedCredentialsForHost(host, credentials);
}

async function rememberedCredentialsForRepo(repoPath: string): Promise<GitCredentials | undefined> {
  const host = await gitGetOriginHost({ repoPath }).catch(() => null);
  if (!host) return undefined;
  return loadRememberedCredentialsForHost(host);
}

async function reloadRepositoryModel() {
  if (!app.repoPath) return;

  const previousSelectedUid = app.selectedUid;
  await repo.load(app.repoPath);

  if (!repo.repo) {
    app.selectedUid = "";
    git.clearState();
    return;
  }

  if (previousSelectedUid && repo.findItem(previousSelectedUid)) {
    app.selectedUid = previousSelectedUid;
    return;
  }

  app.selectedUid = repo.allItems[0]?.uid ?? "";
}

async function loadRepositoryAtPath(path: string): Promise<boolean> {
  const nextPath = path.trim();
  if (!nextPath) return false;

  app.repoPath = nextPath;
  await repo.load(nextPath);

  if (!repo.repo) {
    app.selectedUid = "";
    git.clearState();
    return false;
  }

  app.selectedUid = repo.allItems[0]?.uid ?? "";
  app.addRecentProject(nextPath);
  const credentials = await rememberedCredentialsForRepo(nextPath);
  await git.startupRefresh(nextPath, credentials);
  if (!git.error) {
    await reloadRepositoryModel();
  }
  return true;
}

async function tryOpenLatestRepositoryOnStartup() {
  const validRecent: string[] = [];
  for (const path of app.recentProjects) {
    const present = await exists(path).catch(() => false);
    if (!present) {
      app.removeRecentProject(path);
      continue;
    }
    validRecent.push(path);
  }

  const startupPath = validRecent[0] ?? "";
  if (!startupPath) return;
  await loadRepositoryAtPath(startupPath);
}

async function openRepository() {
  if (openingRepo) return;
  openingRepo = true;
  try {
    const path = await open({ directory: true, multiple: false, title: "Open Doorstop project" });
    if (!path || Array.isArray(path)) return;
    await loadRepositoryAtPath(path);
  } finally {
    openingRepo = false;
  }
}

function setView(v: "editor" | "batch" | "git") {
  app.currentView = v;
}

function onCountsChange(payload: { docs: number; items: number }) {
  visibleDocCount.value = payload.docs;
  visibleItemCount.value = payload.items;
}

function openJoinDialog() {
  joinDialogOpen.value = true;
  joinAuthNeeded.value = false;
  joinError.value = "";
  joinUsername.value = "";
  joinPassword.value = "";
  joinDestination.value = app.repoPath || repoNameFromUrl(joinUrl.value || "");
}

function openRemoteRepositoryDialog() {
  joinUrl.value = "";
  openJoinDialog();
}

function closeJoinDialog() {
  joinDialogOpen.value = false;
  joiningProject.value = false;
  joinAuthNeeded.value = false;
  joinError.value = "";
}

async function pickJoinDestination() {
  const path = await open({ directory: true, multiple: false, title: "Choose where to save the project" });
  if (!path || Array.isArray(path)) return;
  joinDestination.value = path;
}

async function downloadSharedProject() {
  if (!canDownloadShared.value || joiningProject.value) return;
  joiningProject.value = true;
  joinError.value = "";

  try {
    const remembered = loadRememberedCredentials(joinUrl.value);
    const creds = joinAuthNeeded.value
      ? { username: joinUsername.value.trim(), password: joinPassword.value, remember: joinRememberMe.value }
      : remembered;

    const target = joinDestination.value.trim().endsWith(repoNameFromUrl(joinUrl.value.trim()))
      ? joinDestination.value.trim()
      : `${joinDestination.value.trim()}/${repoNameFromUrl(joinUrl.value.trim())}`;

    const result = await git.cloneProject(joinUrl.value.trim(), target, creds);
    if (!result || !result.openedPath) {
      if (result?.requiresAuth) {
        joinAuthNeeded.value = true;
        joinError.value = "This project requires a login.";
      } else {
        joinError.value = git.error?.message ?? "Could not download the project.";
      }
      return;
    }

    if (creds?.remember) persistRememberedCredentials(joinUrl.value, creds);

    await loadRepositoryAtPath(result.openedPath);
    closeJoinDialog();
  } finally {
    joiningProject.value = false;
  }
}

async function openGitSettingsDialog(prefilledHost?: string) {
  gitSettingsDialogOpen.value = true;
  gitSettingsError.value = "";
  gitSettingsHost.value = normalizeHost(prefilledHost ?? "");
  const remembered = loadRememberedCredentialsForHost(gitSettingsHost.value);
  gitSettingsUsername.value = remembered?.username ?? "";
  gitSettingsPassword.value = remembered?.password ?? "";

  const identity = readStoredGitIdentity();
  gitSettingsCommitName.value = identity?.name ?? "";
  gitSettingsCommitEmail.value = identity?.email ?? "";

  if (!gitSettingsHost.value && app.repoPath) {
    const repoHost = await gitGetOriginHost({ repoPath: app.repoPath }).catch(() => null);
    if (repoHost) {
      gitSettingsHost.value = normalizeHost(repoHost);
      const fromRepo = loadRememberedCredentialsForHost(gitSettingsHost.value);
      gitSettingsUsername.value = fromRepo?.username ?? "";
      gitSettingsPassword.value = fromRepo?.password ?? "";
    }
  }
}

function closeGitSettingsDialog() {
  gitSettingsDialogOpen.value = false;
  gitSettingsError.value = "";
}

function normalizeGitSettingsHostInPlace() {
  gitSettingsHost.value = normalizeHost(gitSettingsHost.value);
  const remembered = loadRememberedCredentialsForHost(gitSettingsHost.value);
  if (remembered) {
    gitSettingsUsername.value = remembered.username;
    gitSettingsPassword.value = remembered.password;
  }
}

async function saveGitSettings() {
  const commitName = gitSettingsCommitName.value.trim();
  const commitEmail = gitSettingsCommitEmail.value.trim();
  const host = normalizeHost(gitSettingsHost.value);
  const username = gitSettingsUsername.value.trim();
  const password = gitSettingsPassword.value;
  const hasAnyCredentialInput = !!host || !!username || !!password;

  if (!commitName) {
    gitSettingsError.value = "Enter the name to use for synced commits.";
    return;
  }
  if (!isValidEmail(commitEmail)) {
    gitSettingsError.value = "Enter a valid commit email address.";
    return;
  }

  if (hasAnyCredentialInput) {
    if (!host) {
      gitSettingsError.value = "Enter a valid host (for example: github.com).";
      return;
    }
    if (!username || !password) {
      gitSettingsError.value = "Username and password are required when saving credentials.";
      return;
    }
  }

  writeStoredGitIdentity({ name: commitName, email: commitEmail });

  if (hasAnyCredentialInput) {
    persistRememberedCredentialsForHost(host, { username, password, remember: true });
  }

  closeGitSettingsDialog();
}

function clearGitSettings() {
  const host = normalizeHost(gitSettingsHost.value);
  if (!host) {
    gitSettingsError.value = "Enter a host to remove saved credentials.";
    return;
  }
  clearRememberedCredentialsForHost(host);
  gitSettingsUsername.value = "";
  gitSettingsPassword.value = "";
  gitSettingsError.value = "";
}

async function runSyncNow() {
  if (!app.repoPath) return;
  window.dispatchEvent(new Event("wedge:save-now"));
  await new Promise((resolve) => window.setTimeout(resolve, 140));
  const credentials = await rememberedCredentialsForRepo(app.repoPath);
  await git.runSync(app.repoPath, credentials);
  if (!git.error) {
    await reloadRepositoryModel();
  }
}

watch(() => keys["Ctrl+O"]?.value, async (p, prev) => p && !prev && (await openRepository()));
watch(() => keys["Ctrl+G"]?.value, (p, prev) => p && !prev && (app.currentView = app.currentView === "git" ? "editor" : "git"));
watch(() => keys["Ctrl+Shift+N"]?.value, (p, prev) => p && !prev && (app.currentView = "batch"));
watch(() => keys["Ctrl+S"]?.value, async (p, prev) => p && !prev && (await runSyncNow()));
watch(() => keys["Escape"]?.value, (p, prev) => {
  if (!(p && !prev)) return;
  app.commandPaletteOpen = false;
  app.linkFinderOpen = false;
  if (app.currentView === "batch") app.currentView = "editor";
});

onMounted(async () => {
  unlistenMenuAction = await listen<{ action?: string }>(APP_MENU_EVENT_NAME, async (event) => {
    if (event.payload?.action === "open-remote-repository") {
      openRemoteRepositoryDialog();
      return;
    }
    if (event.payload?.action === "configure-git-settings") {
      await openGitSettingsDialog();
    }
  });
  await tryOpenLatestRepositoryOnStartup();
});

onBeforeUnmount(() => {
  if (unlistenMenuAction) {
    unlistenMenuAction();
    unlistenMenuAction = null;
  }
});
</script>

<template>
  <div class="h-full w-full bg-bg text-text">
    <div class="h-full w-full grid grid-rows-[56px_1fr_34px] gap-px bg-slate-800">
      <AppHeader
        :repo-path="app.repoPath"
        :current-view="app.currentView"
        :theme="app.theme"
        @open-repo="openRepository"
        @set-view="setView"
        @toggle-theme="app.toggleTheme"
      />

      <main v-if="app.hasRepo" class="min-h-0 flex gap-px bg-slate-800">
        <TreePanel @counts-change="onCountsChange" />

        <section class="bg-panel min-h-0 flex flex-col flex-1 min-w-0">
          <div class="px-4 py-2 border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">{{ viewLabel }} View</div>
          <div class="flex-1 min-h-0 overflow-auto p-4">
            <EditorView v-if="app.currentView === 'editor'" />
            <BatchView v-else-if="app.currentView === 'batch'" />
            <GitView v-else />
          </div>
        </section>
      </main>

      <main v-else class="bg-panel min-h-0 overflow-auto">
        <ProjectSetupView
          :recent-projects="app.recentProjects"
          :cloning="joiningProject"
          @open-local="openRepository"
          @join-shared="openRemoteRepositoryDialog"
          @open-recent="loadRepositoryAtPath"
          @remove-recent="app.removeRecentProject"
        />
      </main>

      <AppFooter
        :visible-doc-count="visibleDocCount"
        :visible-item-count="visibleItemCount"
        :sync-text="git.statusText"
        :sync-tone="git.statusTone"
        :branch-name="git.status?.branch ?? '-'"
        :last-sync-at="git.lastSyncAt"
        :can-sync="app.hasRepo"
        :syncing="git.syncing"
        @sync-now="runSyncNow"
      />
    </div>

    <div v-if="joinDialogOpen" class="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div class="panel w-full max-w-xl p-4 space-y-4" @pointerdown.stop>
        <div class="text-lg font-semibold">Join a shared project</div>

        <template v-if="!joinAuthNeeded">
          <div class="space-y-1">
            <label class="text-sm text-slate-400">Project link</label>
            <input v-model="joinUrl" class="input w-full h-9" placeholder="https://github.com/team/specs.git" />
          </div>
          <div class="space-y-1">
            <label class="text-sm text-slate-400">Save location</label>
            <div class="flex gap-2">
              <input v-model="joinDestination" class="input w-full h-9" placeholder="Choose a folder" />
              <button class="btn h-9" @click="pickJoinDestination">[..]</button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="text-sm text-slate-300">This project requires a login.</div>
          <div class="space-y-1">
            <label class="text-sm text-slate-400">Username or email</label>
            <input v-model="joinUsername" class="input w-full h-9" />
          </div>
          <div class="space-y-1">
            <label class="text-sm text-slate-400">Password or access token</label>
            <input v-model="joinPassword" type="password" class="input w-full h-9" />
          </div>
          <label class="inline-flex items-center gap-2 text-sm text-slate-300">
            <input v-model="joinRememberMe" type="checkbox" class="h-4 w-4" />
            Remember me on this computer
          </label>
          <div class="text-xs text-slate-400 border border-slate-700 rounded p-2">
            If your team uses GitHub or GitLab, use a personal access token as the password.
          </div>
        </template>

        <div v-if="joinError" class="text-sm text-red-300">{{ joinError }}</div>

        <div class="flex justify-end gap-2">
          <button class="btn" :disabled="joiningProject" @click="closeJoinDialog">Cancel</button>
          <button class="btn" :disabled="!canDownloadShared || joiningProject" @click="downloadSharedProject">
            {{ joiningProject ? "Downloading..." : joinAuthNeeded ? "Connect" : "Download" }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="gitSettingsDialogOpen" class="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div class="panel w-full max-w-lg p-4 space-y-4" @pointerdown.stop>
        <div class="text-lg font-semibold">Configure Git settings</div>

        <div class="space-y-1">
          <label class="text-sm text-slate-400">Commit name</label>
          <input v-model="gitSettingsCommitName" class="input w-full h-9" placeholder="Jane Doe" />
        </div>

        <div class="space-y-1">
          <label class="text-sm text-slate-400">Commit email</label>
          <input v-model="gitSettingsCommitEmail" class="input w-full h-9" placeholder="jane@example.com" />
        </div>

        <div class="text-xs text-slate-400 border border-slate-700 rounded p-2">
          Used as author identity for Wedge sync commits.
        </div>

        <div class="text-sm text-slate-300 font-medium">Repository login (optional)</div>

        <div class="space-y-1">
          <label class="text-sm text-slate-400">Host</label>
          <input
            v-model="gitSettingsHost"
            class="input w-full h-9"
            placeholder="github.com"
            @blur="normalizeGitSettingsHostInPlace"
          />
        </div>

        <div class="space-y-1">
          <label class="text-sm text-slate-400">Username or email</label>
          <input v-model="gitSettingsUsername" class="input w-full h-9" />
        </div>

        <div class="space-y-1">
          <label class="text-sm text-slate-400">Password or access token</label>
          <input v-model="gitSettingsPassword" type="password" class="input w-full h-9" />
        </div>

        <div v-if="gitSettingsError" class="text-sm text-red-300">{{ gitSettingsError }}</div>

        <div class="flex justify-between gap-2">
          <button class="btn" @click="clearGitSettings">Remove saved credentials</button>
          <div class="flex gap-2">
            <button class="btn" @click="closeGitSettingsDialog">Cancel</button>
            <button class="btn" @click="saveGitSettings">Save</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
