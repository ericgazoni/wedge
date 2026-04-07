import { defineStore } from "pinia";
import { computed, ref, toRaw } from "vue";
import type { RepoModel, DoorstopItem, DoorstopDocument } from "../types/doorstop";
import {
  createDoorstopItem,
  deleteDoorstopItem,
  scanDoorstopRepository,
  writeDoorstopItem,
} from "../services/doorstop";

function safeCloneData<T>(value: T): T {
  const raw = toRaw(value);
  try {
    return structuredClone(raw);
  } catch {
    try {
      return JSON.parse(JSON.stringify(raw)) as T;
    } catch {
      return {} as T;
    }
  }
}

function computeNextDocumentLevel(document: DoorstopDocument): number {
  let maxLevel = 0;
  for (const item of document.items) {
    const level = Number(item.data.level);
    if (Number.isFinite(level)) maxLevel = Math.max(maxLevel, level);
  }
  return Math.round((maxLevel + 0.1) * 10) / 10;
}

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

  function findDocument(prefix: string): DoorstopDocument | null {
    return (
      repo.value?.documents.find((d) => d.config.settings.prefix === prefix) ??
      null
    );
  }

  function findItemWithDocument(uid: string): {
    document: DoorstopDocument;
    item: DoorstopItem;
    index: number;
  } | null {
    if (!repo.value) return null;

    for (const document of repo.value.documents) {
      const index = document.items.findIndex((x) => x.uid === uid);
      if (index >= 0) {
        return {
          document,
          item: document.items[index],
          index,
        };
      }
    }

    return null;
  }

  async function saveItem(uid: string, data: Record<string, unknown>) {
    const hit = findItemWithDocument(uid);
    if (!hit) return false;

    await writeDoorstopItem(hit.item.filePath, data);
    hit.item.data = safeCloneData(data);
    return true;
  }

  async function createItem(
    docPrefix: string,
    partial?: Record<string, unknown>,
  ): Promise<DoorstopItem | null> {
    const document = findDocument(docPrefix);
    if (!document) return null;

    const created = await createDoorstopItem(document, partial);
    document.items.push(created);
    document.items.sort((a, b) => a.uid.localeCompare(b.uid));
    return created;
  }

  async function duplicateItem(uid: string): Promise<DoorstopItem | null> {
    const hit = findItemWithDocument(uid);
    if (!hit) return null;

    const cloneData = safeCloneData(hit.item.data);
    cloneData.level = computeNextDocumentLevel(hit.document);
    return createItem(hit.document.config.settings.prefix, cloneData);
  }

  async function deleteItem(uid: string): Promise<boolean> {
    const hit = findItemWithDocument(uid);
    if (!hit) return false;

    await deleteDoorstopItem(hit.item.filePath);
    hit.document.items.splice(hit.index, 1);
    return true;
  }

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
    findDocument,
    saveItem,
    createItem,
    duplicateItem,
    deleteItem,
  };
});
