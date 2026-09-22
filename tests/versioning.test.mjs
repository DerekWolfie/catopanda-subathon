import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  VERSION_SOURCES,
  applyLockVersion,
  applyVersion,
  changelogSection,
  lockVersions,
  nextVersion,
  readVersions,
  releaseChangelog,
  unreleasedNotes,
} from "../scripts/versioning.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const repoFiles = () => Object.fromEntries([...new Set(VERSION_SOURCES.map((s) => s.file))].map((file) => [file, read(file)]));

test("every place that names the plugin version names the same one", () => {
  const manifest = JSON.parse(read("plugin/manifest.json"));
  const stray = readVersions(repoFiles()).filter((entry) => entry.version !== manifest.version);
  assert.deepEqual(stray, [], `run npm run release:prepare -- ${manifest.version}`);
  assert.deepEqual(lockVersions(read("package-lock.json")), [manifest.version, manifest.version]);
  assert.ok(changelogSection(read("CHANGELOG.md"), manifest.version), `CHANGELOG has no ${manifest.version} section`);
});

test("computes the next version", () => {
  assert.equal(nextVersion("0.4.5", "patch"), "0.4.6");
  assert.equal(nextVersion("0.4.5", "minor"), "0.5.0");
  assert.equal(nextVersion("0.4.5", "major"), "1.0.0");
  assert.equal(nextVersion("0.4.5", "0.4.5"), "0.4.5");
  assert.throws(() => nextVersion("0.4.5", "0.5"), /não é uma versão/);
  assert.throws(() => nextVersion("0.4.5", "v0.4.6"), /não é uma versão/);
});

test("rewrites only the lines that describe the current release", () => {
  const files = repoFiles();
  const changed = applyVersion(files, "9.8.7");
  const readme = changed["README.md"];
  assert.match(readme, /\| Versão do plugin \| 9\.8\.7 \|/);
  assert.match(readme, /catopanda-subathon-9\.8\.7\.zip\.sha256/);
  assert.match(readme, /^git tag v9\.8\.7$/m);
  assert.match(readme, /^git push origin v9\.8\.7$/m);
  // History stays as written.
  assert.match(readme, /Na versão 0\.4\.4, \*\*Metas/);
  assert.match(readme, /A 0\.4\.1 acrescentou/);
  assert.match(changed["plugin/README.md"], /^# CatOPanda Subathon 9\.8\.7$/m);
  assert.match(changed["plugin/README.md"], /Version 0\.4\.4 keeps the other valid goals/);
  assert.match(changed["plugin/index.mjs"], /^const PLUGIN_VERSION = "9\.8\.7";$/m);
  assert.equal(JSON.parse(changed["plugin/manifest.json"]).version, "9.8.7");
  assert.equal(JSON.parse(changed["package.json"]).version, "9.8.7");
  // A manifest template carries its own schemaVersion and flow versions; only the top-level one moves.
  const manifestBefore = files["plugin/manifest.json"].split("\n");
  const manifestAfter = changed["plugin/manifest.json"].split("\n");
  assert.equal(manifestAfter.filter((line, i) => line !== manifestBefore[i]).length, 1);
  assert.deepEqual(readVersions({ ...files, ...changed }).filter((e) => e.version !== "9.8.7"), []);
});

test("updates both version fields of the lockfile and keeps npm's formatting", () => {
  const lock = read("package-lock.json");
  const next = applyLockVersion(lock, "9.8.7");
  assert.deepEqual(lockVersions(next), ["9.8.7", "9.8.7"]);
  assert.equal(applyLockVersion(next, JSON.parse(lock).version), lock);
});

const CHANGELOG = `# Changelog

## Unreleased

- New thing.
- Fixed thing.

## 0.4.4 (2026-09-13)

- Old thing.
`;

test("turns Unreleased into the version section and opens a new Unreleased", () => {
  const released = releaseChangelog(CHANGELOG, "0.4.5", "2026-09-21");
  assert.equal(released, `# Changelog

## Unreleased

## 0.4.5 (2026-09-21)

- New thing.
- Fixed thing.

## 0.4.4 (2026-09-13)

- Old thing.
`);
  assert.equal(unreleasedNotes(released), "");
  assert.equal(changelogSection(released, "0.4.5"), "- New thing.\n- Fixed thing.");
  assert.equal(changelogSection(released, "0.4.4"), "- Old thing.");
  assert.equal(changelogSection(released, "0.4.3"), "");
  assert.throws(() => releaseChangelog(released, "0.4.6", "2026-09-22"), /está vazia/);
  assert.throws(() => releaseChangelog(released, "0.4.5", "2026-09-22"), /já tem a seção/);
});
