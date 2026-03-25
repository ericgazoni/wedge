import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { RepoModel, DoorstopItem } from "../types/doorstop";
import { scanDoorstopRepository } from "../services/doorstop";

export const useRepoStore = defineStore("repo", () => {
  const repo = ref<RepoModel | null>(null);
  const loading = ref(false);
  const error = ref<string>("");

  const allItems = computed<DoorstopItem[]>(() => {
    if (!repo.value) return [];
    return repo.value.documents.flatMap((d) => d.items);
  });

  const itemCount = computed(() => allItems.value.length);
  const docCount = computed(() => repo.value?.documents.length ?? 0);

  function findItem(uid: string): DoorstopItem | null {
    if (!repo.value) return null;
    for (const d of repo.value.documents) {
      const item = d.items.find((x) => x.uid === uid);
      if (item) return item;
    }
    return null;
  }

  async function load(path: string) {
    loading.value = true;
    error.value = "";
    try {
      const data = await scanDoorstopRepository(path);
      repo.value = data;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      repo.value = null;
    } finally {
      loading.value = false;
    }
  }

  const documentTree = computed(() => {
    if (!repo.value) return [];
    return repo.value.documents.map((d) => ({
      key: d.config.settings.prefix,
      name: d.name,
      prefix: d.config.settings.prefix,
      parent: d.config.settings.parent,
      count: d.items.length,
      items: d.items,
    }));
  });

  const allDocsByPrefix = computed(() => {
    const map = new Map<string, string>();
    for (const d of repo.value?.documents ?? []) {
      map.set(d.config.settings.prefix, d.dirPath);
    }
    return map;
  });

  return {
    repo,
    loading,
    error,
    allItems,
    itemCount,
    docCount,
    findItem,
    load,
    documentTree,
    allDocsByPrefix,
  };
});
