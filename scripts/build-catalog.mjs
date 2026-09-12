import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildListingFromSource, readManifestFromZip } from "../sdk/ofs-package.mjs";

export const repository = "DerekWolfie/catopanda-subathon";
export const catalogUrl = `https://github.com/${repository}/releases/latest/download/listing.json`;
const root = fileURLToPath(new URL("../", import.meta.url));

export function buildCatalog({ zipPath, previous, publishedAt = new Date().toISOString() }) {
  const manifest = readManifestFromZip(readFileSync(resolve(root, zipPath)));
  const artifactUrl = `https://github.com/${repository}/releases/download/v${manifest.version}/${manifest.packageId}-${manifest.version}.zip`;
  const listing = buildListingFromSource({
    id: "catopanda-subathon",
    name: "CatOPanda Subathon para OSC Flow Studio",
    url: catalogUrl,
    author: { name: "DerekWolfie", url: "https://github.com/DerekWolfie" },
    packages: [{ zip: zipPath, url: artifactUrl, publishedAt }],
  }, root);
  const [packageId, bucket] = Object.entries(listing.packages)[0];
  const [version, entry] = Object.entries(bucket.versions)[0];
  if (packageId !== "io.github.osc-flow-studio.catopanda-subathon" || entry.manifest.id !== "catopanda-subathon") {
    throw new Error("O ZIP não pertence ao CatOPanda Subathon deste repositório");
  }
  if (previous) {
    if (previous.schemaVersion !== 1 || previous.id !== listing.id || previous.url !== catalogUrl
      || !previous.packages?.[packageId]?.versions) {
      throw new Error("Catálogo anterior não corresponde a esta fonte");
    }
    const versions = previous.packages[packageId].versions;
    if (versions[version]) throw new Error(`A versão ${version} já foi publicada; incremente a versão`);
    listing.packages[packageId].versions = { ...versions, [version]: entry };
  }
  return listing;
}

export function writeCatalog(previous) {
  const manifest = JSON.parse(readFileSync(join(root, "plugin/manifest.json"), "utf8"));
  const zipPath = join(root, "dist", `${manifest.packageId}-${manifest.version}.zip`);
  const listing = buildCatalog({ zipPath, previous });
  mkdirSync(join(root, "dist"), { recursive: true });
  const output = join(root, "dist/listing.json");
  writeFileSync(output, JSON.stringify(listing, null, 2) + "\n");
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--previous");
  const previous = index >= 0 ? JSON.parse(readFileSync(process.argv[index + 1], "utf8")) : undefined;
  console.log(writeCatalog(previous));
}
