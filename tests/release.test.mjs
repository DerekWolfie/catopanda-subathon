import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { publishRelease } from "../scripts/release.mjs";
import { repository } from "../scripts/build-catalog.mjs";
import { changelogSection } from "../scripts/versioning.mjs";

const manifest = JSON.parse(readFileSync(new URL("../plugin/manifest.json", import.meta.url), "utf8"));
const tag = `v${manifest.version}`;
const environment = { GITHUB_REPOSITORY: repository, GITHUB_REF: `refs/tags/${tag}` };

test("release assembles all assets in a draft before making the catalog public", async () => {
  const calls = [];
  const url = await publishRelease({
    environment,
    gh: (...args) => { calls.push(args); return args[0] === "api" ? "[[]]" : ""; },
    createCatalog: (previous) => { assert.equal(previous, undefined); return "dist/listing.json"; },
    fetchPublic: () => { throw new Error("First release must not fetch a previous catalog"); },
  });
  assert.equal(url, `https://github.com/${repository}/releases/tag/${tag}`);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].slice(0, 3), ["release", "create", tag]);
  assert.ok(calls[1].includes("--draft"));
  assert.ok(calls[1].includes("--verify-tag"));
  assert.ok(calls[1].includes("dist/listing.json"));
  assert.ok(calls[1].some((arg) => arg.endsWith(".zip.sha256")));
  assert.ok(calls[2].includes("--draft=false"));
  // The release shows only this version's notes, not the whole changelog.
  const notes = calls[1][calls[1].indexOf("--notes") + 1];
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(notes, changelogSection(changelog, manifest.version));
  assert.ok(notes.length > 0);
  assert.ok(!notes.includes("## "));
});

test("release preserves the previous public catalog and never overwrites an existing release", async () => {
  const previous = { schemaVersion: 1, history: "kept" };
  const latest = { tag_name: "v0.4.0", published_at: "2026-09-01T00:00:00Z", assets: [{ name: "listing.json", browser_download_url: "https://example.com/listing.json" }] };
  let mutations = 0;
  const dependencies = {
    environment,
    gh: (...args) => {
      if (args[0] === "api") return JSON.stringify([[latest]]);
      mutations++;
      return "";
    },
    fetchPublic: async () => ({ ok: true, json: async () => previous }),
    createCatalog: (catalog) => { assert.equal(catalog, previous); return "dist/listing.json"; },
  };
  await publishRelease(dependencies);
  assert.equal(mutations, 2);
  mutations = 0;
  await assert.rejects(publishRelease({ ...dependencies, gh: () => JSON.stringify([[{ tag_name: tag }]]) }), /já existe/);
  await assert.rejects(publishRelease({ ...dependencies, environment: { ...environment, GITHUB_REF: "refs/tags/v9.9.9" } }), /exige a tag/);
  await assert.rejects(publishRelease({ ...dependencies, fetchPublic: async () => ({ ok: false, status: 404 }) }), /HTTP 404/);
  await assert.rejects(publishRelease({ ...dependencies, gh: () => JSON.stringify([[{ ...latest, assets: [] }]]) }), /não contém/);
  assert.equal(mutations, 0);
});
