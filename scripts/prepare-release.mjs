// Prepares a release in the working tree: one version everywhere, the changelog section,
// the validated ZIP and the catalog. It never commits, tags or pushes; it prints those steps.
//
//   npm run release:prepare -- patch|minor|major|X.Y.Z [--dry-run] [--skip-build] [--date YYYY-MM-DD]

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERSION_SOURCES,
  applyLockVersion,
  applyVersion,
  changelogSection,
  compareVersions,
  lockVersions,
  nextVersion,
  readVersions,
  releaseChangelog,
  SEMVER,
} from "./versioning.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const LOCK = "package-lock.json";
const CHANGELOG = "CHANGELOG.md";

function usage(message) {
  if (message) console.error(`Erro: ${message}\n`);
  console.error("Uso: npm run release:prepare -- <patch|minor|major|X.Y.Z> [--dry-run] [--skip-build] [--date AAAA-MM-DD]");
  process.exit(message ? 1 : 0);
}

function parseArgs(argv) {
  const now = new Date();
  // The maintainer's calendar day, not UTC: a release cut at 22:00 in Brazil is still today.
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
  const options = { request: "", dryRun: false, skipBuild: false, date: today };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--date") options.date = argv[++i] ?? "";
    else if (arg === "-h" || arg === "--help") usage();
    else if (!options.request) options.request = arg;
    else usage(`argumento inesperado: ${arg}`);
  }
  if (!options.request) usage("informe a versão");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) usage(`data inválida: ${options.date}`);
  return options;
}

/** Files are edited as LF text and written back with the line ending they had on disk. */
function readText(file) {
  const raw = readFileSync(join(root, file), "utf8");
  return { text: raw.replace(/\r\n/g, "\n"), crlf: raw.includes("\r\n") };
}

function git(...args) {
  try {
    // trimEnd, not trim: porcelain status lines start with a meaningful space.
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trimEnd();
  } catch {
    return null;
  }
}

function npm(script) {
  console.log(`\n> npm run ${script}`);
  // npm is a .cmd shim on Windows, which spawn only runs through a shell.
  const result = spawnSync("npm", ["run", script], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  return result.status === 0;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const managed = [...new Set([...VERSION_SOURCES.map((source) => source.file), LOCK, CHANGELOG])];
  const disk = Object.fromEntries(managed.map((file) => [file, readText(file)]));
  const files = Object.fromEntries(managed.map((file) => [file, disk[file].text]));

  const found = readVersions(files);
  const current = found.find((entry) => entry.file === "plugin/manifest.json").version;
  const target = nextVersion(current, options.request);
  const warnings = [];

  // Where each source stood before, so a half-done manual bump is visible.
  const drift = [...new Set([...found.map((entry) => `${entry.file}: ${entry.version}`), ...lockVersions(files[LOCK]).map((v) => `${LOCK}: ${v}`)])]
    .filter((line) => !line.endsWith(`: ${target}`));

  const tags = (git("tag", "--list", "v*") ?? "").split(/\r?\n/).map((tag) => tag.slice(1)).filter((v) => SEMVER.test(v));
  const newer = tags.filter((version) => compareVersions(version, target) > 0).sort(compareVersions);
  if (newer.length > 0) {
    throw new Error(`${target} é menor que a tag v${newer[newer.length - 1]} já existente; escolha uma versão maior`);
  }
  const localTag = tags.includes(target);
  const remoteTag = git("ls-remote", "--tags", "origin", `refs/tags/v${target}`);
  if (localTag || remoteTag) {
    warnings.push(
      `A tag v${target} já existe${localTag ? " localmente" : ""}${localTag && remoteTag ? " e" : ""}${remoteTag ? " no origin" : ""}.`
      + " O workflow de release só publica se a tag apontar para o commit com esta versão."
      + " Se nenhuma release foi publicada com ela, apague antes de criar a nova:"
      + `\n      git tag -d v${target}`
      + `\n      git push origin :refs/tags/v${target}`
      + "\n    Se ela já foi publicada, prepare outra versão (patch).",
    );
  }

  const changes = applyVersion(files, target);
  changes[LOCK] = applyLockVersion(files[LOCK], target);
  if (changes[LOCK] === files[LOCK]) delete changes[LOCK];
  if (changelogSection(files[CHANGELOG], target)) {
    console.log(`O CHANGELOG já tem a seção ${target}; mantida como está.`);
  } else {
    changes[CHANGELOG] = releaseChangelog(files[CHANGELOG], target, options.date);
  }

  const dirty = (git("status", "--porcelain") ?? "").split(/\r?\n/).filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, ""))
    .filter((file) => !managed.includes(file) && !file.startsWith("dist/"));
  if (dirty.length > 0) {
    warnings.push(`Há outras alterações não commitadas (${dirty.join(", ")}). Revise se elas fazem parte desta versão.`);
  }

  console.log(`CatOPanda Subathon: ${current} → ${target}${options.dryRun ? " (simulação)" : ""}`);
  if (drift.length > 0) console.log(`Fora da versão ${target} antes de preparar:\n  ${drift.join("\n  ")}`);
  const changed = Object.keys(changes);
  console.log(changed.length > 0 ? `Arquivos atualizados:\n  ${changed.join("\n  ")}` : "Nenhum arquivo precisou mudar.");

  if (options.dryRun) {
    for (const warning of warnings) console.warn(`\nAtenção: ${warning}`);
    return;
  }
  for (const [file, text] of Object.entries(changes)) {
    writeFileSync(join(root, file), disk[file].crlf ? text.replace(/\n/g, "\r\n") : text);
  }

  // The check proves that every source agrees before anything is built.
  const after = readVersions(Object.fromEntries(managed.map((file) => [file, readText(file).text])));
  const stray = after.filter((entry) => entry.version !== target);
  if (stray.length > 0) throw new Error(`Versões divergentes depois da atualização: ${stray.map((e) => `${e.file} ${e.version}`).join(", ")}`);

  const zip = `dist/io.github.osc-flow-studio.catopanda-subathon-${target}.zip`;
  if (!options.skipBuild) {
    if (!npm("package") || !npm("catalog")) {
      console.error("\nA validação ou o empacotamento falhou. Os arquivos já estão na nova versão:"
        + " corrija o problema e rode o mesmo comando de novo.");
      process.exit(1);
    }
  }

  console.log(`\nPronto: CatOPanda Subathon ${target}.`);
  if (!options.skipBuild) console.log(`Artefatos: ${zip}, ${zip}.sha256 e dist/listing.json`);
  console.log("\nNotas desta versão (vão para a release no GitHub):\n");
  console.log(changelogSection(readText(CHANGELOG).text, target).replace(/^/gm, "  "));
  for (const warning of warnings) console.warn(`\nAtenção: ${warning}`);
  console.log(`
Próximos passos:
  git add ${managed.join(" ")}
  git commit -m "🧹 Chore: Release CatOPanda Subathon ${target}"
  git push
  # espere o workflow "Validate plugin" passar
  git tag v${target}
  git push origin v${target}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
