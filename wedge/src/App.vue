<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "./stores/app";
import { useRepoStore } from "./stores/repo";
import { getLastDoorstopScanDebug } from "./services/doorstop";
import AppHeader from "./components/layout/AppHeader.vue";
import AppFooter from "./components/layout/AppFooter.vue";
import TreePanel from "./components/tree/TreePanel.vue";
import EditorView from "./components/views/EditorView.vue";
import BatchView from "./components/views/BatchView.vue";
import GitView from "./components/views/GitView.vue";

const app = useAppStore();
const repo = useRepoStore();
const keys = useMagicKeys();

const scanDebug = ref(getLastDoorstopScanDebug());
const visibleDocCount = ref(0);
const visibleItemCount = ref(0);

const LAST_REPO_PATH_STORAGE_KEY = "wedge.lastRepoPath";
let openingRepo = false;

const viewLabel = computed(() =>
  app.currentView === "editor" ? "Editor" : app.currentView === "batch" ? "Batch" : "Git",
);

function loadPersistedRepoPath(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_REPO_PATH_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function persistRepoPath(path: string) {
  if (typeof window === "undefined") return;
  try {
    if (path.trim()) {
      window.localStorage.setItem(LAST_REPO_PATH_STORAGE_KEY, path.trim());
    } else {
      window.localStorage.removeItem(LAST_REPO_PATH_STORAGE_KEY);
    }
  } catch {
    // Ignore persistence errors.
  }
}

async function loadRepositoryAtPath(path: string): Promise<boolean> {
  const nextPath = path.trim();
  if (!nextPath) return false;

  app.repoPath = nextPath;
  await repo.load(nextPath);
  scanDebug.value = getLastDoorstopScanDebug();

  if (!repo.repo) {
    app.selectedUid = "";
    return false;
  }

  app.selectedUid = repo.allItems[0]?.uid ?? "";
  persistRepoPath(nextPath);
  return true;
}

async function tryOpenLatestRepositoryOnStartup() {
  const persistedPath = loadPersistedRepoPath();
  if (!persistedPath) return;
  const ok = await loadRepositoryAtPath(persistedPath);
  if (!ok) persistRepoPath("");
}

async function openRepository() {
  if (openingRepo) return;
  openingRepo = true;
  try {
    const path = await open({ directory: true, multiple: false, title: "Open Doorstop repository" });
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

watch(() => keys["Ctrl+O"]?.value, async (p, prev) => p && !prev && (await openRepository()));
watch(() => keys["Ctrl+G"]?.value, (p, prev) => p && !prev && (app.currentView = app.currentView === "git" ? "editor" : "git"));
watch(() => keys["Ctrl+Shift+N"]?.value, (p, prev) => p && !prev && (app.currentView = "batch"));
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

      <main class="min-h-0 flex gap-px bg-slate-800">
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

      <AppFooter :visible-doc-count="visibleDocCount" :visible-item-count="visibleItemCount" />
    </div>
  </div>
</template>
