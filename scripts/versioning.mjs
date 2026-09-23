// Every place that carries the plugin version, and the rules to read and rewrite each one.
// Kept free of I/O so the release script and the tests share exactly the same rules.

export const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const ANY = "\\d+\\.\\d+\\.\\d+";

/**
 * `pattern` must capture the version in group 2, between groups 1 and 3, so a rewrite keeps
 * everything around it. `all` rewrites every match; otherwise exactly one match is required.
 * Only lines that describe the current release are listed: history such as
 * "Na versão 0.4.4, ..." is never touched.
 */
export const VERSION_SOURCES = [
  { file: "package.json", pattern: new RegExp(`^(  "version": ")(${ANY})(",?)$`, "m") },
  { file: "plugin/manifest.json", pattern: new RegExp(`^(  "version": ")(${ANY})(",?)$`, "m") },
  { file: "plugin/index.mjs", pattern: new RegExp(`^(const PLUGIN_VERSION = ")(${ANY})(";)$`, "m") },
  { file: "README.md", pattern: new RegExp(`^(\\| Versão do plugin \\| )(${ANY})( \\|)$`, "m") },
  { file: "README.md", pattern: new RegExp(`(catopanda-subathon-)(${ANY})(\\.zip)`, "g"), all: true },
  { file: "README.md", pattern: new RegExp(`(Prepare CatOPanda Subathon )(${ANY})( package)`, "g"), all: true },
  { file: "README.md", pattern: new RegExp(`^(git tag v)(${ANY})()$`, "gm"), all: true },
  { file: "README.md", pattern: new RegExp(`^(git push origin v)(${ANY})()$`, "gm"), all: true },
  { file: "plugin/README.md", pattern: new RegExp(`^(# CatOPanda Subathon )(${ANY})()$`, "m") },
];

export function parseVersion(text) {
  const match = SEMVER.exec(text);
  if (!match) throw new Error(`"${text}" não é uma versão X.Y.Z`);
  return match.slice(1).map(Number);
}

export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** `patch`, `minor`, `major` or an explicit X.Y.Z. */
export function nextVersion(current, request) {
  const [major, minor, patch] = parseVersion(current);
  if (request === "patch") return `${major}.${minor}.${patch + 1}`;
  if (request === "minor") return `${major}.${minor + 1}.0`;
  if (request === "major") return `${major + 1}.0.0`;
  parseVersion(request);
  return request;
}

/** The versions each source currently holds, grouped by file, for the consistency report. */
export function readVersions(files) {
  const found = [];
  for (const source of VERSION_SOURCES) {
    const text = files[source.file];
    if (text === undefined) throw new Error(`${source.file} não encontrado`);
    const matches = [...text.matchAll(new RegExp(source.pattern.source, source.pattern.flags.includes("g") ? source.pattern.flags : source.pattern.flags + "g"))];
    if (matches.length === 0) throw new Error(`${source.file}: não encontrei ${source.pattern}`);
    if (!source.all && matches.length > 1) throw new Error(`${source.file}: ${source.pattern} aparece mais de uma vez`);
    for (const match of matches) found.push({ file: source.file, version: match[2], text: match[0] });
  }
  return found;
}

/** Rewrites every source to `version` and returns the changed files only. */
export function applyVersion(files, version) {
  parseVersion(version);
  const next = { ...files };
  for (const source of VERSION_SOURCES) {
    next[source.file] = next[source.file].replace(source.pattern, (_match, before, _old, after) => before + version + after);
  }
  return Object.fromEntries(Object.entries(next).filter(([file, text]) => text !== files[file]));
}

/** npm keeps the version twice in the lockfile: at the root and on the root package. */
export function applyLockVersion(lockText, version) {
  const lock = JSON.parse(lockText);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  return JSON.stringify(lock, null, 2) + "\n";
}

export function lockVersions(lockText) {
  const lock = JSON.parse(lockText);
  return [lock.version, lock.packages?.[""]?.version].filter(Boolean);
}

const UNRELEASED = /^## Unreleased[ \t]*\r?\n/m;

/** The body of `## Unreleased`, trimmed; empty when there is nothing to release. */
export function unreleasedNotes(changelog) {
  const start = changelog.search(UNRELEASED);
  if (start < 0) return "";
  const body = changelog.slice(start).replace(UNRELEASED, "");
  const end = body.search(/^## /m);
  return (end < 0 ? body : body.slice(0, end)).trim();
}

/**
 * Turns `## Unreleased` into `## <version> (<date>)` and opens a fresh, empty
 * `## Unreleased` above it for the next round of changes.
 */
export function releaseChangelog(changelog, version, date) {
  if (changelogSection(changelog, version)) throw new Error(`O CHANGELOG já tem a seção ${version}`);
  if (!unreleasedNotes(changelog)) {
    throw new Error("A seção \"## Unreleased\" do CHANGELOG está vazia: descreva o que muda nesta versão antes de prepará-la");
  }
  return changelog.replace(UNRELEASED, `## Unreleased\n\n## ${version} (${date})\n`);
}

/** The notes of one released version, as the GitHub release shows them. */
export function changelogSection(changelog, version) {
  const heading = new RegExp(`^## ${version.replace(/\./g, "\\.")}(?: \\(|\\s*$)`, "m");
  const start = changelog.search(heading);
  if (start < 0) return "";
  const rest = changelog.slice(start);
  const firstBreak = rest.indexOf("\n");
  const body = firstBreak < 0 ? "" : rest.slice(firstBreak + 1);
  const end = body.search(/^## /m);
  return (end < 0 ? body : body.slice(0, end)).trim();
}
