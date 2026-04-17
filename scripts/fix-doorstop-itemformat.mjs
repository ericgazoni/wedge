#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { dump, load } from "js-yaml";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".idea",
  ".vscode",
]);

function normalizePath(value) {
  return value.replace(/\\/g, "/");
}

function isDoorstopConfigName(name) {
  return name === ".doorstop.yml" || name === ".doorstop.yaml";
}

function isYamlExt(name) {
  return /\.ya?ml$/i.test(name);
}

function isMarkdownExt(name) {
  return /\.md$/i.test(name) || /\.markdown$/i.test(name);
}

function isDoorstopItemFileName(name) {
  if (isDoorstopConfigName(name)) return false;
  return isYamlExt(name) || isMarkdownExt(name);
}

function uidFromFileName(fileName) {
  return fileName.replace(/\.(ya?ml|md|markdown)$/i, "");
}

function normalizeItemFormat(value) {
  const raw = String(value ?? "yaml").trim().toLowerCase();
  if (raw === "markdown" || raw === "md") return "markdown";
  return "yaml";
}

function extensionFromItemFormat(format) {
  return format === "markdown" ? ".md" : ".yml";
}

function ensureTrailingNewline(text) {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function parseMarkdownFrontmatter(raw) {
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

  let frontmatter = {};
  try {
    const parsed = load(fmText);
    if (parsed && typeof parsed === "object") {
      frontmatter = parsed;
    }
  } catch {
    // Ignore broken frontmatter and keep empty metadata.
  }

  return { frontmatter, body };
}

function extractMarkdownHeaderAndText(body) {
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

function composeMarkdownBody(header, text) {
  const h = String(header ?? "").trim();
  const t = typeof text === "string" ? text : "";

  if (!h && !t) return "";
  if (!h) return t;
  if (!t) return `# ${h}`;
  return `# ${h}\n\n${t}`;
}

function parseItemData(fileName, raw) {
  let data = {};

  if (isYamlExt(fileName)) {
    data = (load(raw) ?? {}) || {};
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

  return data;
}

function serializeItemToFile(data, targetPath) {
  if (isMarkdownExt(targetPath)) {
    const frontmatter = { ...data };
    const header = typeof frontmatter.header === "string" ? frontmatter.header : "";
    const text = typeof frontmatter.text === "string" ? frontmatter.text : "";
    const body = composeMarkdownBody(header, text);

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

async function discoverDirectories(rootPath) {
  const queue = [rootPath];
  const seen = new Set();
  const out = [];

  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);

    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    out.push(current);

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      queue.push(path.join(current, entry.name));
    }
  }

  return out;
}

async function findDocumentConfigPath(dirPath) {
  const yml = path.join(dirPath, ".doorstop.yml");
  const yaml = path.join(dirPath, ".doorstop.yaml");

  try {
    await fs.access(yml);
    return yml;
  } catch {
    // fallthrough
  }

  try {
    await fs.access(yaml);
    return yaml;
  } catch {
    return null;
  }
}

async function loadDocumentItemFormat(configPath) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = (load(raw) ?? {}) || {};
    return normalizeItemFormat(parsed?.settings?.itemformat);
  } catch {
    return "yaml";
  }
}

function parseArgs(argv) {
  const args = {
    root: ".",
    apply: false,
  };

  for (const token of argv) {
    if (token === "--apply") {
      args.apply = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    args.root = token;
  }

  return args;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log("Usage: node scripts/fix-doorstop-itemformat.mjs [rootPath] [--apply]");
    console.log("Without --apply, the script runs in dry-run mode.");
    return;
  }

  const rootPath = path.resolve(process.cwd(), args.root);
  const dryRun = !args.apply;

  const directories = await discoverDirectories(rootPath);
  const plans = [];

  for (const dirPath of directories) {
    const configPath = await findDocumentConfigPath(dirPath);
    if (!configPath) continue;

    const desiredFormat = await loadDocumentItemFormat(configPath);
    const desiredExt = extensionFromItemFormat(desiredFormat);

    let entries = [];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!isDoorstopItemFileName(entry.name)) continue;

      const sourcePath = path.join(dirPath, entry.name);
      const uid = uidFromFileName(entry.name);
      const targetPath = path.join(dirPath, `${uid}${desiredExt}`);

      let sourceRaw = "";
      try {
        sourceRaw = await fs.readFile(sourcePath, "utf8");
      } catch {
        continue;
      }

      let data;
      try {
        data = parseItemData(entry.name, sourceRaw);
      } catch {
        continue;
      }

      const serialized = serializeItemToFile(data, targetPath);
      const samePath = normalizePath(sourcePath) === normalizePath(targetPath);

      if (samePath) {
        if (sourceRaw !== serialized) {
          plans.push({ type: "rewrite", sourcePath, targetPath, content: serialized });
        }
        continue;
      }

      let targetRaw = null;
      try {
        targetRaw = await fs.readFile(targetPath, "utf8");
      } catch {
        targetRaw = null;
      }

      if (targetRaw == null) {
        plans.push({ type: "convert", sourcePath, targetPath, content: serialized });
      } else if (targetRaw === serialized) {
        plans.push({ type: "cleanup", sourcePath, targetPath, content: null });
      } else {
        plans.push({ type: "conflict", sourcePath, targetPath, content: null });
      }
    }
  }

  const counts = {
    rewrite: plans.filter((p) => p.type === "rewrite").length,
    convert: plans.filter((p) => p.type === "convert").length,
    cleanup: plans.filter((p) => p.type === "cleanup").length,
    conflict: plans.filter((p) => p.type === "conflict").length,
  };

  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);
  console.log(`Repository: ${rootPath}`);
  console.log(`Planned rewrites: ${counts.rewrite}`);
  console.log(`Planned conversions: ${counts.convert}`);
  console.log(`Planned cleanups: ${counts.cleanup}`);
  console.log(`Conflicts (skipped): ${counts.conflict}`);

  if (!dryRun) {
    for (const plan of plans) {
      if (plan.type === "conflict") continue;

      if (plan.type === "rewrite") {
        await fs.writeFile(plan.sourcePath, plan.content, "utf8");
        continue;
      }

      if (plan.type === "convert") {
        await fs.writeFile(plan.targetPath, plan.content, "utf8");
        await fs.unlink(plan.sourcePath).catch(() => {});
        continue;
      }

      if (plan.type === "cleanup") {
        await fs.unlink(plan.sourcePath).catch(() => {});
      }
    }
  }

  if (counts.conflict > 0) {
    console.log("\nConflicts:");
    for (const plan of plans.filter((p) => p.type === "conflict")) {
      console.log(`- ${plan.sourcePath} -> ${plan.targetPath}`);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

