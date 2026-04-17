import { exists, readDir, readTextFile, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { dump, load } from "js-yaml";
import type {
  DocumentConfig,
  DoorstopDocument,
  DoorstopItem,
  RepoModel,
} from "../types/doorstop";

type ItemFormat = "yaml" | "markdown";

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
      itemformat: "yaml",
      prefix,
      parent: null,
      sep: "",
    },
    attributes: {},
  };
}

function normalizeItemFormat(value: unknown): ItemFormat {
  const raw = String(value ?? "yaml").trim().toLowerCase();
  if (raw === "markdown" || raw === "md") return "markdown";
  return "yaml";
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
        itemformat: normalizeItemFormat(settings.itemformat),
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

function extractMarkdownHeaderAndText(body: string): {
  header: string;
  text: string;
} {
  const lines = body.split(/\r?\n/);
  let firstContentIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().length) {
      firstContentIndex = i;
      break;
    }
  }

  if (firstContentIndex === -1) {
    return { header: "", text: "" };
  }

  const firstContent = lines[firstContentIndex];
  const match = firstContent.match(/^#{1,6}\s+(.+)\s*$/);
  if (!match) {
    return { header: "", text: body.trim() ? body : "" };
  }

  const header = match[1].trim();
  const remaining = lines.slice(firstContentIndex + 1).join("\n");
  const text = remaining.replace(/^\s*\n/, "");

  return { header, text };
}

function composeMarkdownBody(header: string, text: string): string {
  const h = header.trim();
  const t = text;

  if (!h && !t) return "";
  if (!h) return t;
  if (!t) return `# ${h}`;
  return `# ${h}\n\n${t}`;
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

      const extracted = extractMarkdownHeaderAndText(body);
      const hasFrontmatterHeader =
        typeof data.header === "string" && data.header.trim().length > 0;

      if (extracted.header.length) {
        data.header = extracted.header;
      } else if (!hasFrontmatterHeader) {
        data.header = "";
      }

      const hasText = Object.prototype.hasOwnProperty.call(data, "text");
      if (!hasText || extracted.header.length) {
        data.text = extracted.text;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extFromPath(path: string): "yaml" | "markdown" {
  return isMarkdownExt(path) ? "markdown" : "yaml";
}

function extensionFromItemFormat(format: ItemFormat): ".yml" | ".md" {
  return format === "markdown" ? ".md" : ".yml";
}

function withItemFormatExtension(path: string, format: ItemFormat): string {
  const ext = extensionFromItemFormat(format);
  if (/\.(ya?ml|md|markdown)$/i.test(path)) {
    return path.replace(/\.(ya?ml|md|markdown)$/i, ext);
  }
  return `${path}${ext}`;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function serializeItemToFile(
  data: Record<string, unknown>,
  filePath: string,
): string {
  if (extFromPath(filePath) === "markdown") {
    const frontmatter = { ...data };
    const header = typeof frontmatter.header === "string" ? frontmatter.header : "";
    const text = typeof frontmatter.text === "string" ? frontmatter.text : "";
    const body = composeMarkdownBody(header, text);

    // In markdown mode, header/text live in the markdown body, not frontmatter.
    delete frontmatter.header;
    delete frontmatter.text;

    const fm = dump(frontmatter, {
      sortKeys: false,
      lineWidth: -1,
      noRefs: true,
    }).trimEnd();

    const parts = ["---", fm.length ? fm : "{}", "---"];
    if (body.length) parts.push(body);
    return ensureTrailingNewline(parts.join("\n"));
  }

  return ensureTrailingNewline(
    dump(data, {
      sortKeys: false,
      lineWidth: -1,
      noRefs: true,
    }),
  );
}

function parseLinks(input: unknown): Array<Record<string, string | null>> {
  if (!Array.isArray(input)) return [];
  const links: Array<Record<string, string | null>> = [];

  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const key = Object.keys(obj)[0];
    if (!key) continue;
    const value = obj[key];
    links.push({ [key]: value == null ? null : String(value) });
  }

  return links;
}

function normalizeDoorstopData(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...input };
  out.links = parseLinks(out.links);
  return out;
}

function buildDefaultItemData(
  defaults?: Record<string, unknown>,
): Record<string, unknown> {
  return normalizeDoorstopData({
    active: true,
    derived: false,
    header: "",
    level: 1.0,
    links: [],
    normative: true,
    ref: "",
    reviewed: null,
    text: "",
    ...(defaults ?? {}),
  });
}

function getNextUidNumber(document: DoorstopDocument): number {
  const { prefix, sep } = document.config.settings;
  const re = new RegExp(
    `^${escapeRegExp(prefix)}${escapeRegExp(sep)}(\\d+)$`,
    "i",
  );

  let max = 0;
  for (const item of document.items) {
    const match = item.uid.match(re);
    if (!match) continue;
    const n = Number(match[1]);
    if (!Number.isFinite(n)) continue;
    max = Math.max(max, n);
  }

  return max + 1;
}

function buildUid(document: DoorstopDocument, n: number): string {
  const { prefix, sep, digits } = document.config.settings;
  return `${prefix}${sep}${String(n).padStart(Math.max(1, digits), "0")}`;
}

function itemPathFromUid(document: DoorstopDocument, uid: string): string {
  const ext = extensionFromItemFormat(document.config.settings.itemformat);
  return joinPath(document.dirPath, `${uid}${ext}`);
}

export function getCustomAttributes(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const standard = new Set([
    "active",
    "derived",
    "header",
    "level",
    "links",
    "normative",
    "ref",
    "reviewed",
    "text",
  ]);

  const attrs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!standard.has(k)) attrs[k] = v;
  }
  return attrs;
}

export async function writeDoorstopItem(
  filePath: string,
  data: Record<string, unknown>,
  itemformat?: ItemFormat,
): Promise<string> {
  const normalized = normalizeDoorstopData(data);
  const targetPath = itemformat
    ? withItemFormatExtension(filePath, itemformat)
    : filePath;

  await writeTextFile(targetPath, serializeItemToFile(normalized, targetPath));

  if (normalizePath(filePath) !== normalizePath(targetPath)) {
    const hadOldPath = await exists(filePath).catch(() => false);
    if (hadOldPath) {
      await remove(filePath);
    }
  }

  return targetPath;
}

export async function createDoorstopItem(
  document: DoorstopDocument,
  partial?: Record<string, unknown>,
): Promise<DoorstopItem> {
  let next = getNextUidNumber(document);
  let uid = buildUid(document, next);
  let filePath = itemPathFromUid(document, uid);

  while (await exists(filePath)) {
    next += 1;
    uid = buildUid(document, next);
    filePath = itemPathFromUid(document, uid);
  }

  const defaults = document.config.attributes?.defaults as
    | Record<string, unknown>
    | undefined;
  const data = normalizeDoorstopData({
    ...buildDefaultItemData(defaults),
    ...(partial ?? {}),
  });

  filePath = await writeDoorstopItem(
    filePath,
    data,
    document.config.settings.itemformat,
  );

  return {
    uid,
    filePath,
    docPrefix: document.config.settings.prefix,
    data,
  };
}

export async function deleteDoorstopItem(filePath: string): Promise<void> {
  await remove(filePath);
}

