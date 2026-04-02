<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { open } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import { useAppStore } from "./stores/app";
import { useRepoStore } from "./stores/repo";
import { useGitStore } from "./stores/git";
import type { GitCredentials } from "./types/git";
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

const CREDENTIALS_STORAGE_KEY = "wedge.gitCredentialsByHost";

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

function loadRememberedCredentials(rawUrl: string): GitCredentials | undefined {
  if (typeof window === "undefined") return undefined;
  const host = credentialsHost(rawUrl);
  if (!host) return undefined;
  try {
    const raw = window.localStorage.getItem(CREDENTIALS_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, { username: string; password: string }>;
    const hit = parsed[host];
    if (!hit) return undefined;
    return { username: hit.username, password: hit.password, remember: true };
  } catch {
    return undefined;
  }
}

function persistRememberedCredentials(rawUrl: string, credentials: GitCredentials) {
  if (typeof window === "undefined") return;
  if (!credentials.remember) return;
  const host = credentialsHost(rawUrl);
  if (!host) return;
  try {
    const raw = window.localStorage.getItem(CREDENTIALS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, { username: string; password: string }>) : {};
    parsed[host] = { username: credentials.username, password: credentials.password };
    window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore local persistence failure.
  }
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
  await git.startupRefresh(nextPath);
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

async function runSyncNow() {
  if (!app.repoPath) return;
  window.dispatchEvent(new Event("wedge:save-now"));
  await new Promise((resolve) => window.setTimeout(resolve, 140));
  await git.runSync(app.repoPath);
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
  await tryOpenLatestRepositoryOnStartup();
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
          @join-shared="openJoinDialog"
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
  </div>
</template>
