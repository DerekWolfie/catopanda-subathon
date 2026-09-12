#!/usr/bin/env node
/**
 * Authoring tools for OSC Flow Studio plugin packages. No dependencies.
 *
 *   node ofs-package.mjs validate <plugin-directory>
 *   node ofs-package.mjs pack <plugin-directory> --out <directory>
 *   node ofs-package.mjs listing build <source.json> --out <directory>
 *
 * `validate` applies the same identity, version and size rules the app
 * applies at install. `pack` writes `<packageId>-<version>.zip` plus a
 * `.sha256` file. `listing build` assembles a catalog from a source
 * description and the packed zips, so the hash in the catalog is the hash of
 * the file that is actually served.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const LIMITS = {
  maxZipBytes: 20 * 1024 * 1024,
  maxExtractedBytes: 50 * 1024 * 1024,
  maxFilesPerPlugin: 500,
  maxManifestBytes: 256 * 1024,
};

const PACKAGE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){2,}$/;
const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const RANGE_TOKEN =
  /^(\^|~|>=|<=|>|<|=)?(0|[1-9]\d*|x|X|\*)(?:\.(0|[1-9]\d*|x|X|\*))?(?:\.(0|[1-9]\d*|x|X|\*))?(?:-[0-9A-Za-z.-]+)?$/;

function isValidRange(range) {
  if (typeof range !== "string" || range.trim() === "") return false;
  return range.split("||").every((set) => {
    const trimmed = set.trim();
    if (trimmed === "" || trimmed === "*") return true;
    const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed);
    if (hyphen) return RANGE_TOKEN.test(hyphen[1]) && RANGE_TOKEN.test(hyphen[2]);
    return trimmed.split(/\s+/).every((token) => RANGE_TOKEN.test(token));
  });
}

function isWildcard(range) {
  return range.split("||").every((set) => ["", "*", "x", "X", ">=0.0.0"].includes(set.trim()));
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(relative(base, full).split("\\").join("/"));
  }
  return out;
}

/** Returns a list of problems; empty means the folder passes the app's install rules. */
export function validatePluginDir(dir) {
  const issues = [];
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return ["manifest.json is missing"];
  const manifestSize = statSync(manifestPath).size;
  if (manifestSize > LIMITS.maxManifestBytes) {
    issues.push(`manifest.json is ${manifestSize} bytes; the limit is ${LIMITS.maxManifestBytes}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return [`manifest.json is not valid JSON: ${error.message}`];
  }
  if (!PLUGIN_ID.test(String(manifest.id ?? ""))) issues.push("id must match ^[a-z0-9][a-z0-9-]{1,40}$");
  if (typeof manifest.packageId !== "string") {
    issues.push("packageId is required for catalog distribution");
  } else if (
    !PACKAGE_ID.test(manifest.packageId) ||
    manifest.packageId.length > 128 ||
    manifest.packageId.split(".").some((segment) => segment.endsWith("-"))
  ) {
    issues.push("packageId must be lowercase reverse-domain with at least three segments (com.example.plugin)");
  } else if (manifest.packageId.startsWith("com.oscflowstudio.")) {
    issues.push("com.oscflowstudio.* is reserved for official plugins");
  }
  if (!SEMVER.test(String(manifest.version ?? ""))) issues.push("version must be strict SemVer (1.2.3, no leading v)");
  const engines = manifest.engines?.oscFlowStudio;
  if (typeof engines !== "string") issues.push('engines.oscFlowStudio is required (for example ">=0.4.0 <0.5.0")');
  else if (!isValidRange(engines)) issues.push("engines.oscFlowStudio is not a valid SemVer range");
  else if (isWildcard(engines)) issues.push("engines.oscFlowStudio must not be a bare wildcard");
  if (!manifest.author || typeof manifest.author.name !== "string" || !manifest.author.name) {
    issues.push("author.name is required");
  }
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    if (!PACKAGE_ID.test(dependency)) issues.push(`dependency "${dependency}" is not a valid package id`);
    if (dependency === manifest.packageId) issues.push("a package cannot depend on itself");
    if (!isValidRange(String(range))) issues.push(`dependency "${dependency}" has an invalid range "${range}"`);
  }
  if (manifest.entry) {
    if (/^([A-Za-z]:|\/)/.test(manifest.entry) || /(^|\/)\.\.(\/|$)/.test(manifest.entry)) {
      issues.push("entry must be a relative path inside the plugin");
    } else if (!existsSync(join(dir, manifest.entry))) {
      issues.push(`entry module "${manifest.entry}" is missing`);
    }
    if (typeof manifest.apiVersion !== "number") issues.push("apiVersion is required when entry is set");
  }
  const fields = manifest.configSchema?.fields ?? [];
  if (!fields.some((field) => field.key === "enabled" && field.type === "boolean")) {
    issues.push("configSchema must declare a boolean field keyed enabled");
  }
  for (const node of manifest.nodeTypes ?? []) {
    const pattern = new RegExp(`^(trigger|action)\\.x\\.${manifest.id}\\.[A-Za-z0-9_-]+$`);
    if (!pattern.test(String(node.type))) {
      issues.push(`node type "${node.type}" must be trigger.x.${manifest.id}.<name> or action.x.${manifest.id}.<name>`);
    }
  }
  const files = walk(dir);
  if (files.length > LIMITS.maxFilesPerPlugin) issues.push(`${files.length} files; the limit is ${LIMITS.maxFilesPerPlugin}`);
  const total = files.reduce((sum, file) => sum + statSync(join(dir, file)).size, 0);
  if (total > LIMITS.maxExtractedBytes) issues.push(`${total} bytes of content; the limit is ${LIMITS.maxExtractedBytes}`);
  const lower = new Map();
  for (const file of files) {
    const key = file.toLowerCase();
    if (lower.has(key)) issues.push(`"${file}" collides with "${lower.get(key)}" on a case-insensitive file system`);
    lower.set(key, file);
    for (const part of file.split("/")) {
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(part) || /[\s.]$/.test(part) || part.includes(":")) {
        issues.push(`"${file}" is not a portable file name`);
        break;
      }
    }
  }
  return issues;
}

// Minimal ZIP writer (deflate or stored, no zip64), enough for plugin packages.
function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const FIXED_STAMP = { time: 0, day: ((2026 - 1980) << 9) | (1 << 5) | 1 };

export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(FIXED_STAMP.time, 10);
    local.writeUInt16LE(FIXED_STAMP.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(FIXED_STAMP.time, 12);
    central.writeUInt16LE(FIXED_STAMP.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const centralStart = offset;
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBytes, end]);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Validates, then writes `<packageId>-<version>.zip` and its `.sha256` next to it. */
export function packPluginDir(dir, outDir) {
  const issues = validatePluginDir(dir);
  if (issues.length > 0) {
    throw new Error(`validation failed:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
  }
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const files = walk(dir).sort();
  const entries = files.map((file) => [file, readFileSync(join(dir, file))]);
  const zip = buildZip(entries);
  if (zip.length > LIMITS.maxZipBytes) throw new Error(`zip is ${zip.length} bytes; the limit is ${LIMITS.maxZipBytes}`);
  mkdirSync(outDir, { recursive: true });
  const name = `${manifest.packageId}-${manifest.version}.zip`;
  const target = join(outDir, name);
  writeFileSync(target, zip);
  const digest = sha256(zip);
  writeFileSync(`${target}.sha256`, `${digest}  ${name}\n`);
  return { path: target, name, sha256: digest, size: zip.length, manifest };
}

/** Reads manifest.json out of a zip built by `pack` (stored or deflated, no zip64). */
export function readManifestFromZip(bytes) {
  let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const compressed = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const body = bytes.subarray(start, start + compressed);
    if (name === "manifest.json" || name.endsWith("/manifest.json")) {
      const raw = method === 8 ? inflateRawSync(body) : body;
      return JSON.parse(raw.toString("utf8"));
    }
    offset = start + compressed;
  }
  throw new Error("manifest.json not found in zip");
}

/**
 * Source description for `listing build`:
 * {
 *   "id": "my-catalog", "name": "My catalog", "url": "https://.../listing.json",
 *   "author": { "name": "Me", "url": "https://..." },
 *   "packages": [
 *     { "zip": "dist/com.example.plugin-1.0.0.zip", "url": "https://.../com.example.plugin-1.0.0.zip", "publishedAt": "2026-09-11T00:00:00Z" }
 *   ]
 * }
 * Every zip is hashed here, so the catalog carries the checksum of the served file.
 * Older versions stay listed as long as their entries stay in the source file.
 */
export function buildListingFromSource(source, baseDir) {
  const packages = {};
  for (const entry of source.packages ?? []) {
    const zipPath = resolve(baseDir, entry.zip);
    const bytes = readFileSync(zipPath);
    const manifest = readManifestFromZip(bytes);
    if (!manifest.packageId) throw new Error(`${entry.zip}: manifest has no packageId`);
    const bucket = (packages[manifest.packageId] ??= { versions: {} });
    if (bucket.versions[manifest.version]) throw new Error(`${manifest.packageId}@${manifest.version} listed twice`);
    bucket.versions[manifest.version] = {
      manifest,
      artifact: { url: entry.url, sha256: sha256(bytes), size: bytes.length },
      ...(entry.publishedAt ? { publishedAt: entry.publishedAt } : {}),
    };
  }
  return { schemaVersion: 1, id: source.id, name: source.name, url: source.url, author: source.author, packages };
}

function main(argv) {
  const [command, ...rest] = argv;
  const out = rest.includes("--out") ? rest[rest.indexOf("--out") + 1] : undefined;
  if (command === "validate" && rest[0]) {
    const issues = validatePluginDir(resolve(rest[0]));
    if (issues.length === 0) {
      console.log("ok");
      return 0;
    }
    for (const issue of issues) console.error(`  - ${issue}`);
    return 1;
  }
  if (command === "pack" && rest[0]) {
    const result = packPluginDir(resolve(rest[0]), resolve(out ?? "dist"));
    console.log(`packed ${result.path}`);
    console.log(`sha256 ${result.sha256}`);
    console.log(`size   ${result.size}`);
    return 0;
  }
  if (command === "listing" && rest[0] === "build" && rest[1]) {
    const sourcePath = resolve(rest[1]);
    const source = JSON.parse(readFileSync(sourcePath, "utf8"));
    const listing = buildListingFromSource(source, resolve(sourcePath, ".."));
    const outDir = resolve(out ?? "dist");
    mkdirSync(outDir, { recursive: true });
    const target = join(outDir, basename(new URL(source.url).pathname) || "listing.json");
    writeFileSync(target, `${JSON.stringify(listing, null, 2)}\n`);
    console.log(`wrote ${target} with ${Object.keys(listing.packages).length} package(s)`);
    return 0;
  }
  console.error("usage: ofs-package.mjs validate <dir> | pack <dir> --out <dir> | listing build <source.json> --out <dir>");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
