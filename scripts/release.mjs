// Called only by the tag workflow. Running this script publishes a GitHub release.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { repository, writeCatalog } from "./build-catalog.mjs";
import { changelogSection } from "./versioning.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const runGh = (...args) => execFileSync("gh", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

export async function publishRelease({ environment = process.env, gh = runGh, fetchPublic = fetch, createCatalog = writeCatalog } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, "plugin/manifest.json"), "utf8"));
  const tag = `v${manifest.version}`;
  if (environment.GITHUB_REPOSITORY !== repository || environment.GITHUB_REF !== `refs/tags/${tag}`) {
    throw new Error(`A release exige a tag ${tag} no repositório ${repository}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Este catálogo distribui apenas releases estáveis");
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8").replace(/\r\n/g, "\n");
  const notes = changelogSection(changelog, manifest.version);
  if (!notes) throw new Error(`O CHANGELOG não tem a seção ${manifest.version}; prepare a versão com npm run release:prepare`);
  const releases = JSON.parse(gh("api", `repos/${repository}/releases`, "--paginate", "--slurp")).flat();
  if (releases.some((release) => release.tag_name === tag)) {
    throw new Error(`${tag} já existe. Não sobrescreva artefatos; use uma nova versão ou conclua o draft existente.`);
  }
  const latest = releases.filter((release) => !release.draft && !release.prerelease)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  let previous;
  if (latest) {
    const asset = latest.assets.find((item) => item.name === "listing.json");
    if (!asset) throw new Error("A última release não contém listing.json; recupere o catálogo antes de publicar");
    const response = await fetchPublic(asset.browser_download_url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Falha ao recuperar catálogo público: HTTP ${response.status}`);
    previous = await response.json();
  }
  const catalog = createCatalog(previous);
  const archive = join(root, "dist", `${manifest.packageId}-${manifest.version}.zip`);
  // The catalog and ZIP become public together: no public catalog points at a missing ZIP.
  gh("release", "create", tag, archive, `${archive}.sha256`, catalog,
    "--repo", repository, "--verify-tag", "--draft", "--title", `CatOPanda Subathon ${manifest.version}`,
    "--notes", notes);
  gh("release", "edit", tag, "--repo", repository, "--draft=false", "--latest");
  return `https://github.com/${repository}/releases/tag/${tag}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Release publicada: ${await publishRelease()}`);
}
