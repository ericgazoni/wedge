#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const FILES = {
  packageJson: path.join(ROOT, "package.json"),
  cargoToml: path.join(ROOT, "src-tauri", "Cargo.toml"),
  cargoLock: path.join(ROOT, "src-tauri", "Cargo.lock"),
  tauriConf: path.join(ROOT, "src-tauri", "tauri.conf.json"),
};

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function usage() {
  console.log(`Usage:
  node scripts/version-sync.mjs get
  node scripts/version-sync.mjs check
  node scripts/version-sync.mjs set <version>

Examples:
  node scripts/version-sync.mjs get
  node scripts/version-sync.mjs set 0.2.2
`);
}

function parsePackageVersion(cargoTomlContent) {
  const lines = cargoTomlContent.split(/\r?\n/);
  let inPackage = false;

  for (const line of lines) {
    if (/^\s*\[package\]\s*$/.test(line)) {
      inPackage = true;
      continue;
    }

    if (inPackage && /^\s*\[/.test(line)) {
      break;
    }

    if (inPackage) {
      const match = line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/);
      if (match) {
        return match[1];
      }
    }
  }

  throw new Error("Could not find [package].version in Cargo.toml");
}

function replacePackageVersion(cargoTomlContent, newVersion) {
  const lines = cargoTomlContent.split(/\r?\n/);
  let inPackage = false;
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (/^\s*\[package\]\s*$/.test(line)) {
      inPackage = true;
      return line;
    }

    if (inPackage && /^\s*\[/.test(line)) {
      inPackage = false;
      return line;
    }

    if (inPackage && /^\s*version\s*=\s*"[^"]+"\s*$/.test(line)) {
      replaced = true;
      return `version = "${newVersion}"`;
    }

    return line;
  });

  if (!replaced) {
    throw new Error("Could not update [package].version in Cargo.toml");
  }

  return `${nextLines.join("\n")}\n`;
}

function parseCargoLockVersion(cargoLockContent, packageName) {
  const lines = cargoLockContent.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "[[package]]") {
      continue;
    }

    let name = null;
    let version = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j].trim();

      if (line === "[[package]]") {
        break;
      }

      if (line.startsWith("name = \"")) {
        const match = lines[j].match(/^\s*name\s*=\s*"([^"]+)"\s*$/);
        if (match) {
          name = match[1];
        }
      }

      if (line.startsWith("version = \"")) {
        const match = lines[j].match(/^\s*version\s*=\s*"([^"]+)"\s*$/);
        if (match) {
          version = match[1];
        }
      }

      if (name === packageName && version) {
        return version;
      }
    }
  }

  throw new Error(`Could not find ${packageName} package version in Cargo.lock`);
}

function replaceCargoLockVersion(cargoLockContent, packageName, newVersion) {
  const lines = cargoLockContent.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "[[package]]") {
      continue;
    }

    let nameLineIndex = -1;
    let versionLineIndex = -1;
    let blockEndIndex = lines.length;

    for (let j = i + 1; j < lines.length; j += 1) {
      const trimmed = lines[j].trim();

      if (trimmed === "[[package]]") {
        blockEndIndex = j;
        break;
      }

      if (nameLineIndex < 0 && /^\s*name\s*=\s*"[^"]+"\s*$/.test(lines[j])) {
        nameLineIndex = j;
      }

      if (versionLineIndex < 0 && /^\s*version\s*=\s*"[^"]+"\s*$/.test(lines[j])) {
        versionLineIndex = j;
      }
    }

    if (nameLineIndex < 0 || versionLineIndex < 0 || versionLineIndex > blockEndIndex) {
      continue;
    }

    const nameMatch = lines[nameLineIndex].match(/^\s*name\s*=\s*"([^"]+)"\s*$/);
    if (!nameMatch) {
      continue;
    }

    if (nameMatch[1] !== packageName) {
      continue;
    }

    lines[versionLineIndex] = `version = "${newVersion}"`;
    return `${lines.join("\n")}\n`;
  }

  throw new Error(`Could not update ${packageName} package version in Cargo.lock`);
}

async function readVersions() {
  const packageJsonRaw = await readFile(FILES.packageJson, "utf8");
  const cargoTomlRaw = await readFile(FILES.cargoToml, "utf8");
  const cargoLockRaw = await readFile(FILES.cargoLock, "utf8");
  const tauriConfRaw = await readFile(FILES.tauriConf, "utf8");

  const packageJson = JSON.parse(packageJsonRaw);
  const tauriConf = JSON.parse(tauriConfRaw);
  const packageName = parsePackageName(cargoTomlRaw);

  return {
    packageName,
    packageJsonVersion: packageJson.version,
    cargoTomlVersion: parsePackageVersion(cargoTomlRaw),
    cargoLockVersion: parseCargoLockVersion(cargoLockRaw, packageName),
    tauriConfVersion: tauriConf.version,
  };
}

function parsePackageName(cargoTomlContent) {
  const lines = cargoTomlContent.split(/\r?\n/);
  let inPackage = false;

  for (const line of lines) {
    if (/^\s*\[package\]\s*$/.test(line)) {
      inPackage = true;
      continue;
    }

    if (inPackage && /^\s*\[/.test(line)) {
      break;
    }

    if (inPackage) {
      const match = line.match(/^\s*name\s*=\s*"([^"]+)"\s*$/);
      if (match) {
        return match[1];
      }
    }
  }

  throw new Error("Could not find [package].name in Cargo.toml");
}

function printVersions(versions) {
  console.log(`package.json:        ${versions.packageJsonVersion}`);
  console.log(`src-tauri/Cargo.toml:${versions.cargoTomlVersion}`);
  console.log(`src-tauri/Cargo.lock:${versions.cargoLockVersion}`);
  console.log(`src-tauri/tauri.conf.json: ${versions.tauriConfVersion}`);
}

function findInconsistencies(versions) {
  const values = [
    ["package.json", versions.packageJsonVersion],
    ["src-tauri/Cargo.toml", versions.cargoTomlVersion],
    ["src-tauri/Cargo.lock", versions.cargoLockVersion],
    ["src-tauri/tauri.conf.json", versions.tauriConfVersion],
  ];

  const unique = new Set(values.map(([, version]) => version));
  if (unique.size <= 1) {
    return [];
  }

  return values;
}

async function setVersion(newVersion) {
  if (!VERSION_RE.test(newVersion)) {
    throw new Error(`Invalid version format: ${newVersion}`);
  }

  const [packageJsonRaw, cargoTomlRaw, cargoLockRaw, tauriConfRaw] = await Promise.all([
    readFile(FILES.packageJson, "utf8"),
    readFile(FILES.cargoToml, "utf8"),
    readFile(FILES.cargoLock, "utf8"),
    readFile(FILES.tauriConf, "utf8"),
  ]);

  const packageJson = JSON.parse(packageJsonRaw);
  packageJson.version = newVersion;

  const tauriConf = JSON.parse(tauriConfRaw);
  tauriConf.version = newVersion;

  const packageName = parsePackageName(cargoTomlRaw);
  const nextCargoToml = replacePackageVersion(cargoTomlRaw, newVersion);
  const nextCargoLock = replaceCargoLockVersion(cargoLockRaw, packageName, newVersion);

  await Promise.all([
    writeFile(FILES.packageJson, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
    writeFile(FILES.tauriConf, `${JSON.stringify(tauriConf, null, 2)}\n`, "utf8"),
    writeFile(FILES.cargoToml, nextCargoToml, "utf8"),
    writeFile(FILES.cargoLock, nextCargoLock, "utf8"),
  ]);

  console.log(`Updated versions to ${newVersion}`);
}

async function main() {
  const [command, value] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  if (command === "set") {
    if (!value) {
      usage();
      throw new Error("Missing version argument for set command");
    }

    await setVersion(value);
  }

  if (command !== "set" && command !== "get" && command !== "check") {
    usage();
    throw new Error(`Unknown command: ${command}`);
  }

  const versions = await readVersions();

  if (command === "get") {
    printVersions(versions);
  }

  const inconsistencies = findInconsistencies(versions);
  if (inconsistencies.length === 0) {
    console.log("Versions are consistent.");
    process.exit(0);
  }

  console.error("Version mismatch detected:");
  for (const [file, version] of inconsistencies) {
    console.error(`  ${file}: ${version}`);
  }

  process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

