import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { load } from "js-yaml";
import type {
  DocumentConfig,
  DoorstopDocument,
  DoorstopItem,
  RepoModel,
} from "../types/doorstop";

type FsEntry = {
  name?: string;
  isDirectory?: boolean;
  isFile?: boolean;
};

type ScanDebug = {
  visitedDirs: number;
  candidateDirs: string[];
  documentDirs: string[];
  skippedBecauseNoConfig: string[];
  parseErrors: Array<{ path: string; error: string }>;
};

let lastScanDebug: ScanDebug = {
  visitedDirs: 0,
  candidateDirs: [],
  documentDirs: [],
  skippedBecauseNoConfig: [],
  parseErrors: [],
};

export function getLastDoorstopScanDebug(): ScanDebug {
  return structuredClone(lastScanDebug);
}

function resetDebug() {
  lastScanDebug = {
    visitedDirs: 0,
    candidateDirs: [],
    documentDirs: [],
    skippedBecauseNoConfig: [],
    parseErrors: [],
  };
}

function isDoorstopConfigName(name: string): boolean {
  return name === ".doorstop.yml" || name === ".doorstop.yaml";
}

function isYamlExt(name: string): boolean {
  return /\.ya?ml$/i.test(name);
}

function isMarkdownExt(name: string): boolean {
  return /\.md$/i.test(name) || /\.markdown$/i.test(name);
}

function isDoorstopItemFileName(name: string): boolean {
  if (isDoorstopConfigName(name)) return false;
  return isYamlExt(name) || isMarkdownExt(name);
}

function uidFromFileName(fileName: string): string {
  return fileName.replace(/\.(ya?ml|md|markdown)$/i, "");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function joinPath(base: string, name: string): string {
  if (!base) return normalizePath(name);
  return normalizePath(
    `${base.replace(/\/+$/, "")}/${name.replace(/^\/+/, "")}`,
  );
}

function shouldSkipDir(name: string): boolean {
  const skip = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".idea",
    ".vscode",
  ]);
  return skip.has(name);
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

async function parseDocumentConfig(
  configPath: string,
  fallbackPrefix: string,
): Promise<DocumentConfig> {
  try {
    const raw = await readTextFile(configPath);
    const parsed = (load(raw) ?? {}) as Record<string, any>;
    const settings = parsed.settings ?? {};
    return {
      settings: {
        digits: Number(settings.digits ?? 3),
        prefix: String(settings.prefix ?? fallbackPrefix),
        parent: settings.parent == null ? null : String(settings.parent),
        sep: String(settings.sep ?? ""),
      },
      attributes: parsed.attributes ?? {},
    };
  } catch (error) {
    lastScanDebug.parseErrors.push({
      path: configPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return defaultDocConfig(fallbackPrefix);
  }
}

function parseMarkdownFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  // Must start with frontmatter delimiter
  if (!raw.startsWith("---")) {
    return { frontmatter: {}, body: raw };
  }

  const lines = raw.split(/\r?\n/);
  if (lines.length < 2 || lines[0].trim() !== "---") {
    return { frontmatter: {}, body: raw };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { frontmatter: {}, body: raw };
  }

  const fmText = lines.slice(1, endIdx).join("\n");
  const body = lines.slice(endIdx + 1).join("\n");

  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed = load(fmText);
    if (parsed && typeof parsed === "object") {
      frontmatter = parsed as Record<string, unknown>;
    }
  } catch {
    // keep empty frontmatter and fallback body
  }

  return { frontmatter, body };
}

async function parseItemFile(
  itemPath: string,
  fileName: string,
  docPrefix: string,
): Promise<DoorstopItem | null> {
  try {
    const raw = await readTextFile(itemPath);
    let data: Record<string, unknown> = {};

    if (isYamlExt(fileName)) {
      data = ((load(raw) ?? {}) as Record<string, unknown>) ?? {};
    } else if (isMarkdownExt(fileName)) {
      const { frontmatter, body } = parseMarkdownFrontmatter(raw);
      data = { ...frontmatter };

      const hasText = Object.prototype.hasOwnProperty.call(data, "text");
      if (!hasText && body.trim().length > 0) {
        data.text = body;
      }
    }

    return {
      uid: uidFromFileName(fileName),
      filePath: itemPath,
      docPrefix,
      data,
    };
  } catch (error) {
    lastScanDebug.parseErrors.push({
      path: itemPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function entryName(entry: FsEntry): string | null {
  if (!entry.name) return null;
  const t = entry.name.trim();
  return t.length ? t : null;
}

async function listDirectory(path: string): Promise<FsEntry[]> {
  const result = (await readDir(path)) as FsEntry[];
  return Array.isArray(result) ? result : [];
}

async function discoverAllDirectories(rootPath: string): Promise<string[]> {
  const root = normalizePath(rootPath);
  const queue: string[] = [root];
  const seen = new Set<string>();
  const discovered: string[] = [];

  while (queue.length) {
    const current = queue.shift() as string;
    if (seen.has(current)) continue;
    seen.add(current);

    let entries: FsEntry[] = [];
    try {
      entries = await listDirectory(current);
    } catch (error) {
      lastScanDebug.parseErrors.push({
        path: current,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    lastScanDebug.visitedDirs += 1;
    discovered.push(current);

    for (const entry of entries) {
      const name = entryName(entry);
      if (!name) continue;

      const maybeDir =
        entry.isDirectory === true ||
        (entry.isDirectory !== false &&
          entry.isFile !== true &&
          !name.includes("."));

      if (!maybeDir) continue;
      if (shouldSkipDir(name)) continue;

      queue.push(joinPath(current, name));
    }
  }

  return discovered.sort((a, b) => a.localeCompare(b));
}

async function isDocumentDirectory(
  dirPath: string,
): Promise<{ isDocument: boolean; configPath: string | null }> {
  const yml = joinPath(dirPath, ".doorstop.yml");
  const yaml = joinPath(dirPath, ".doorstop.yaml");

  const hasYml = await exists(yml).catch(() => false);
  if (hasYml) return { isDocument: true, configPath: yml };

  const hasYaml = await exists(yaml).catch(() => false);
  if (hasYaml) return { isDocument: true, configPath: yaml };

  return { isDocument: false, configPath: null };
}

async function loadDocumentFromDir(
  dirPath: string,
  configPath: string,
): Promise<DoorstopDocument> {
  const fallbackPrefix = dirPath.split("/").filter(Boolean).pop() ?? "DOC";
  const config = await parseDocumentConfig(configPath, fallbackPrefix);

  const entries = await listDirectory(dirPath);
  const itemFiles = entries
    .map(entryName)
    .filter((n): n is string => !!n)
    .filter((n) => isDoorstopItemFileName(n))
    .sort((a, b) => a.localeCompare(b));

  const items: DoorstopItem[] = [];
  for (const fileName of itemFiles) {
    const item = await parseItemFile(
      joinPath(dirPath, fileName),
      fileName,
      config.settings.prefix,
    );
    if (item) items.push(item);
  }

  items.sort((a, b) => a.uid.localeCompare(b.uid));

  return {
    name: fallbackPrefix,
    dirPath,
    configPath,
    config,
    items,
  };
}

export async function scanDoorstopRepository(
  rootPath: string,
): Promise<RepoModel> {
  resetDebug();

  const normalizedRoot = normalizePath(rootPath);
  const directories = await discoverAllDirectories(normalizedRoot);
  lastScanDebug.candidateDirs = [...directories];

  const documents: DoorstopDocument[] = [];
  for (const dirPath of directories) {
    const { isDocument, configPath } = await isDocumentDirectory(dirPath);
    if (!isDocument || !configPath) {
      lastScanDebug.skippedBecauseNoConfig.push(dirPath);
      continue;
    }

    const doc = await loadDocumentFromDir(dirPath, configPath);
    documents.push(doc);
    lastScanDebug.documentDirs.push(dirPath);
  }

  documents.sort((a, b) =>
    a.config.settings.prefix.localeCompare(b.config.settings.prefix),
  );

  return { rootPath: normalizedRoot, documents };
}
