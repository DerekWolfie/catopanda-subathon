import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { validatePluginDir } from "../sdk/ofs-package.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const manifest = read("../plugin/manifest.json");
const pkg = read("../package.json");
const schema = read("../sdk/community-plugin-manifest.schema.json");
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const issues = validatePluginDir(fileURLToPath(new URL("../plugin", import.meta.url)));
if (!validate(manifest)) issues.push(ajv.errorsText(validate.errors, { separator: "\n" }));
if (manifest.version !== pkg.version) issues.push("package.json e manifest.json precisam ter a mesma versão");
if (manifest.engines.oscFlowStudio !== ">=0.5.0 <0.6.0") issues.push("Faixa de compatibilidade diferente do SDK validado (0.5.x)");
if (issues.length) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${manifest.id} ${manifest.version}: schema e regras de pacote do SDK 0.5.0 válidos`);
}
