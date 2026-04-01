import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

export type MainView = "editor" | "batch" | "git";
export type ThemeMode = "dark" | "light";

const THEME_STORAGE_KEY = "wedge.theme";

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

export const useAppStore = defineStore("app", () => {
  const repoPath = ref<string>("");
  const currentView = ref<MainView>("editor");
  const selectedUid = ref<string>("");
  const treeFilter = ref<string>("");
  const commandPaletteOpen = ref(false);
  const linkFinderOpen = ref(false);
  const expandedDocs = ref<Record<string, boolean>>({});
  const theme = ref<ThemeMode>(loadTheme());

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

  return {
    repoPath,
    currentView,
    selectedUid,
    treeFilter,
    commandPaletteOpen,
    linkFinderOpen,
    expandedDocs,
    theme,
    hasRepo,
    toggleDoc,
    toggleTheme,
  };
});
