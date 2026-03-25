import { readDir, readTextFile, exists } from "@tauri-apps/plugin-fs";
import { load } from "js-yaml";
import type {
  RepoModel,
  DoorstopDocument,
  DoorstopItem,
  DocumentConfig,
} from "../types/doorstop";

type DirEntry = {
  name: string;
  isDirectory?: boolean;
  isFile?: boolean;
};

async function listDir(path: string): Promise<DirEntry[]> {
  const entries = await readDir(path);
  return entries.map((e) => ({
    name: e.name ?? "",
    isDirectory: e.isDirectory,
    isFile: e.isFile,
  }));
}

function isYamlItemFile(name: string): boolean {
  return /\.ya?ml$/i.test(name) && name !== ".doorstop.yml";
}

function uidFromFileName(fileName: string): string {
  return fileName.replace(/\.ya?ml$/i, "");
}

function defaultDocConfig(prefix: string): DocumentConfig {
  return {
    settings: {
      digits: 3,
      prefix,
      parent: null,
      sep: "",
    },
    attributes: {},
  };
}

async function parseDocConfig(
  configPath: string,
  fallbackPrefix: string,
): Promise<DocumentConfig> {
  try {
    const raw = await readTextFile(configPath);
    const y = (load(raw) ?? {}) as Record<string, any>;
    const settings = y.settings ?? {};
    return {
      settings: {
        digits: Number(settings.digits ?? 3),
        prefix: String(settings.prefix ?? fallbackPrefix),
        parent: settings.parent == null ? null : String(settings.parent),
        sep: String(settings.sep ?? ""),
      },
      attributes: y.attributes ?? {},
    };
  } catch {
    return defaultDocConfig(fallbackPrefix);
  }
}

async function parseItemFile(
  filePath: string,
  docPrefix: string,
  fileName: string,
): Promise<DoorstopItem> {
  const raw = await readTextFile(filePath);
  const data = (load(raw) ?? {}) as Record<string, unknown>;
  return {
    uid: uidFromFileName(fileName),
    filePath,
    docPrefix,
    data,
  };
}

async function scanDocument(
  docDirPath: string,
  docDirName: string,
): Promise<DoorstopDocument | null> {
  const configPath = `${docDirPath}/.doorstop.yml`;
  const hasConfig = await exists(configPath);
  if (!hasConfig) return null;

  const config = await parseDocConfig(configPath, docDirName);

  const entries = await listDir(docDirPath);
  const itemFiles = entries
    .filter((e) => e.isFile && !!e.name && isYamlItemFile(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const items: DoorstopItem[] = [];
  for (const fileName of itemFiles) {
    const itemPath = `${docDirPath}/${fileName}`;
    const item = await parseItemFile(
      itemPath,
      config.settings.prefix,
      fileName,
    );
    items.push(item);
  }

  return {
    name: docDirName,
    dirPath: docDirPath,
    configPath,
    config,
    items,
  };
}

export async function scanDoorstopRepository(
  rootPath: string,
): Promise<RepoModel> {
  const rootEntries = await listDir(rootPath);
  const docDirs = rootEntries
    .filter((e) => e.isDirectory && !!e.name && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  const documents: DoorstopDocument[] = [];

  for (const dirName of docDirs) {
    const absDir = `${rootPath}/${dirName}`;
    const doc = await scanDocument(absDir, dirName);
    if (doc) documents.push(doc);
  }

  documents.sort((a, b) =>
    a.config.settings.prefix.localeCompare(b.config.settings.prefix),
  );

  return { rootPath, documents };
}

export function buildUidIndex(repo: RepoModel): Map<string, DoorstopItem> {
  const m = new Map<string, DoorstopItem>();
  for (const d of repo.documents) {
    for (const it of d.items) m.set(it.uid, it);
  }
  return m;
}
