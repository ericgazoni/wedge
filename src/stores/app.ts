import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

export type MainView = "editor" | "batch" | "git";
export type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "wedge.theme";
const RECENT_PROJECTS_STORAGE_KEY = "wedge.recentProjects";

function normalizeTheme(raw: string | null): ThemeMode {
  return raw === "light" ? "light" : "dark";
}

function loadTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "dark";
  }
}

function persistTheme(theme: ThemeMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore persistence errors (e.g., storage unavailable in specific runtime modes).
  }
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("theme-light", theme === "light");
}

function loadRecentProjects(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => String(entry ?? "").trim())
      .filter((entry) => !!entry)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function persistRecentProjects(paths: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(paths));
  } catch {
    // Ignore persistence errors.
  }
}

export const useAppStore = defineStore("app", () => {
  const repoPath = ref<string>("");
  const currentView = ref<MainView>("editor");
  const selectedUid = ref<string>("");
  const treeFilter = ref<string>("");
  const commandPaletteOpen = ref(false);
  const linkFinderOpen = ref(false);
  const expandedDocs = ref<Record<string, boolean>>({});
  const theme = ref<ThemeMode>(loadTheme());
  const recentProjects = ref<string[]>(loadRecentProjects());

  const hasRepo = computed(() => !!repoPath.value);

  watch(
    theme,
    (nextTheme) => {
      persistTheme(nextTheme);
      applyTheme(nextTheme);
    },
    { immediate: true },
  );

  function toggleDoc(prefix: string) {
    const current = expandedDocs.value[prefix];
    expandedDocs.value[prefix] = current === undefined ? false : !current;
  }

  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
  }

  function addRecentProject(path: string) {
    const next = path.trim();
    if (!next) return;
    recentProjects.value = [next, ...recentProjects.value.filter((p) => p !== next)].slice(0, 8);
    persistRecentProjects(recentProjects.value);
  }

  function removeRecentProject(path: string) {
    recentProjects.value = recentProjects.value.filter((p) => p !== path);
    persistRecentProjects(recentProjects.value);
  }

  return {
    repoPath,
    currentView,
    selectedUid,
    treeFilter,
    commandPaletteOpen,
    linkFinderOpen,
    expandedDocs,
    theme,
    recentProjects,
    hasRepo,
    toggleDoc,
    toggleTheme,
    addRecentProject,
    removeRecentProject,
  };
});
