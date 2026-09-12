import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { packPluginDir, readManifestFromZip } from "../sdk/ofs-package.mjs";
import { buildCatalog, catalogUrl } from "../scripts/build-catalog.mjs";

test("standalone SDK builds reproducible installable ZIPs with matching catalog hashes", () => {
  const out = mkdtempSync(join(tmpdir(), "catopanda-package-"));
  try {
    const pluginDir = fileURLToPath(new URL("../plugin", import.meta.url));
    const first = packPluginDir(pluginDir, join(out, "first"));
    const second = packPluginDir(pluginDir, join(out, "second"));
    assert.equal(first.sha256, second.sha256);
    const bytes = readFileSync(first.path);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), first.sha256);
    const manifest = readManifestFromZip(bytes);
    assert.equal(manifest.id, "catopanda-subathon");
    const workspace = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(manifest.version, workspace.version);
    assert.equal(manifest.engines.oscFlowStudio, ">=0.5.0 <0.6.0");
    const listing = buildCatalog({ zipPath: first.path });
    assert.equal(listing.url, catalogUrl);
    const entry = listing.packages[manifest.packageId].versions[manifest.version];
    assert.equal(entry.artifact.sha256, first.sha256);
    assert.equal(entry.artifact.size, bytes.length);
    assert.equal(entry.artifact.url, `https://github.com/DerekWolfie/catopanda-subathon/releases/download/v${manifest.version}/${first.name}`);
    assert.throws(() => buildCatalog({ zipPath: first.path, previous: listing }), /já foi publicada/);
    const previous = structuredClone(listing);
    const old = previous.packages[manifest.packageId].versions;
    old["0.4.0"] = { ...old[manifest.version], manifest: { ...manifest, version: "0.4.0" } };
    delete old[manifest.version];
    const upgraded = buildCatalog({ zipPath: first.path, previous });
    assert.deepEqual(upgraded.packages[manifest.packageId].versions["0.4.0"], old["0.4.0"]);
    assert.equal(Object.keys(upgraded.packages[manifest.packageId].versions).length, 2);
    assert.throws(() => buildCatalog({ zipPath: first.path, previous: { ...previous, url: "https://example.com" } }), /não corresponde/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
