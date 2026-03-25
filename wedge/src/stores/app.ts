import { defineStore } from "pinia";
import { ref, computed } from "vue";

export type MainView = "editor" | "batch" | "git";

export const useAppStore = defineStore("app", () => {
  const repoPath = ref<string>("");
  const currentView = ref<MainView>("editor");
  const selectedUid = ref<string>("");
  const treeFilter = ref<string>("");
  const commandPaletteOpen = ref(false);
  const linkFinderOpen = ref(false);
  const expandedDocs = ref<Record<string, boolean>>({});

  const hasRepo = computed(() => !!repoPath.value);

  function toggleDoc(prefix: string) {
    const current = expandedDocs.value[prefix];
    expandedDocs.value[prefix] = current === undefined ? false : !current;
  }

  return {
    repoPath,
    currentView,
    selectedUid,
    treeFilter,
    commandPaletteOpen,
    linkFinderOpen,
    expandedDocs,
    hasRepo,
    toggleDoc,
  };
});
