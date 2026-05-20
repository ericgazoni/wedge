import { defineStore } from "pinia";
import { computed, ref, toRaw } from "vue";
import type { DoorstopIssue, RepoModel, DoorstopItem, DoorstopDocument } from "../types/doorstop";
import {
  createDoorstopItem,
  deleteDoorstopItem,
  readItemFromFile,
  runDoorstopCheck,
  runDoorstopReview,
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
  const doorstopIssues = ref<DoorstopIssue[]>([]);
  const doorstopChecking = ref(false);
  const doorstopHasRun = ref(false);

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

  // Doorstop may report UIDs with a different separator than the filename uses
  // (e.g. issue uid "SRD-001" vs filename "SRD_001.md"). Try swapping the
  // separator character immediately before the trailing digit group.
  function findItemByIssueUid(issueUid: string): DoorstopItem | null {
    const exact = findItem(issueUid);
    if (exact) return exact;
    const alt = issueUid.replace(/([_-])(\d+)$/, (_, sep, num) =>
      `${sep === "-" ? "_" : "-"}${num}`,
    );
    return alt !== issueUid ? findItem(alt) : null;
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

    hit.item.filePath = await writeDoorstopItem(
      hit.item.filePath,
      data,
      hit.document.config.settings.itemformat,
    );
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

  const docsWithIssues = computed<Set<string>>(() => {
    const result = new Set<string>();
    for (const issue of doorstopIssues.value) {
      const item = findItemByIssueUid(issue.uid);
      if (item) {
        result.add(item.docPrefix);
        continue;
      }
      for (const doc of repo.value?.documents ?? []) {
        if (doc.config.settings.prefix === issue.uid) {
          result.add(issue.uid);
          break;
        }
      }
    }
    return result;
  });

  const issuesByItemUid = computed<Map<string, DoorstopIssue[]>>(() => {
    const map = new Map<string, DoorstopIssue[]>();
    for (const issue of doorstopIssues.value) {
      const item = findItemByIssueUid(issue.uid);
      if (!item) continue;
      const existing = map.get(item.uid) ?? [];
      existing.push(issue);
      map.set(item.uid, existing);
    }
    return map;
  });

  async function runCheck() {
    if (!repo.value) return;
    doorstopChecking.value = true;
    try {
      const result = await runDoorstopCheck(repo.value);
      doorstopIssues.value = result.issues;
      doorstopHasRun.value = true;
    } finally {
      doorstopChecking.value = false;
    }
  }

  async function reloadItem(uid: string): Promise<boolean> {
    const hit = findItemWithDocument(uid);
    if (!hit) return false;
    const fresh = await readItemFromFile(
      hit.item.filePath,
      hit.document.config.settings.prefix,
    );
    if (!fresh) return false;
    // Replace the array slot so Vue detects the new reference and the editor
    // watch re-syncs the draft with the freshly-reviewed data.
    hit.document.items.splice(hit.index, 1, fresh);
    return true;
  }

  async function reviewAndCheck(uid: string) {
    if (!repo.value) return;
    doorstopChecking.value = true;
    try {
      const hit = findItemWithDocument(uid);
      if (hit) {
        const allItemsMap = new Map(allItems.value.map((i) => [i.uid, i]));
        await runDoorstopReview(hit.item, hit.document, allItemsMap);
        await reloadItem(uid);
      }
      const result = await runDoorstopCheck(repo.value);
      doorstopIssues.value = result.issues;
      doorstopHasRun.value = true;
    } finally {
      doorstopChecking.value = false;
    }
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
    doorstopIssues,
    doorstopChecking,
    doorstopHasRun,
    docsWithIssues,
    issuesByItemUid,
    runCheck,
    reviewAndCheck,
  };
});
