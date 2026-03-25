import { readDir, readTextFile, exists } from "@tauri-apps/plugin-fs";
import { load } from "js-yaml";
import type {
  RepoModel,
  DoorstopDocument,
  DoorstopItem,
  DocumentConfig,
} from "../types/doorstop";

type FsEntry = {
  name?: string;
  isDirectory?: boolean;
  isFile?: boolean;
  children?: FsEntry[];
};

function hasYamlExt(name: string): boolean {
  return name.endsWith(".yml") || name.endsWith(".yaml");
}

function isItemFileName(name: string): boolean {
  if (name === ".doorstop.yml" || name === ".doorstop.yaml") return false;
  return hasYamlExt(name);
}

function uidFromFileName(name: string): string {
  return name.replace(/\.ya?ml$/i, "");
}

function defaultDocConfig(prefix: string): DocumentConfig {
  return {
    settings: { digits: 3, prefix, parent: null, sep: "" },
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

async function parseItem(
  filePath: string,
  fileName: string,
  docPrefix: string,
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

function looksLikeDir(entry: FsEntry): boolean {
  if (entry.isDirectory === true) return true;
  if (entry.isFile === true) return false;
  return !entry.name?.includes(".");
}

function looksLikeFile(entry: FsEntry): boolean {
  if (entry.isFile === true) return true;
  if (entry.isDirectory === true) return false;
  return !!entry.name?.includes(".");
}

export async function scanDoorstopRepository(
  rootPath: string,
): Promise<RepoModel> {
  const root = (await readDir(rootPath)) as FsEntry[];

  const candidateDirs = root
    .filter((e) => !!e.name && looksLikeDir(e))
    .map((e) => e.name as string)
    .sort((a, b) => a.localeCompare(b));

  const documents: DoorstopDocument[] = [];

  for (const dirName of candidateDirs) {
    const dirPath = `${rootPath}/${dirName}`;
    const configYml = `${dirPath}/.doorstop.yml`;
    const configYaml = `${dirPath}/.doorstop.yaml`;

    const hasYml = await exists(configYml);
    const hasYaml = await exists(configYaml);
    if (!hasYml && !hasYaml) continue;

    const configPath = hasYml ? configYml : configYaml;
    const config = await parseDocConfig(configPath, dirName);

    const entries = (await readDir(dirPath)) as FsEntry[];
    const itemNames = entries
      .filter((e) => !!e.name && looksLikeFile(e))
      .map((e) => e.name as string)
      .filter((n) => isItemFileName(n))
      .sort((a, b) => a.localeCompare(b));

    const items: DoorstopItem[] = [];
    for (const fileName of itemNames) {
      const itemPath = `${dirPath}/${fileName}`;
      const item = await parseItem(itemPath, fileName, config.settings.prefix);
      items.push(item);
    }

    documents.push({
      name: dirName,
      dirPath,
      configPath,
      config,
      items,
    });
  }

  documents.sort((a, b) =>
    a.config.settings.prefix.localeCompare(b.config.settings.prefix),
  );

  return { rootPath, documents };
}
