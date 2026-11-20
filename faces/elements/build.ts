// SPDX-License-Identifier: Apache-2.0
// Builds each element plugin's Browser module (src/<plugin>/index.ts) into crates/madar-plugins/browser/<plugin>/: index.js, files.rs
// and kinds.json (from src/<plugin>/decl.ts), which the plugin embeds (ADR 0094, 0095).
import { buildModule, writeFilesRs } from "@nuah/browser-kit/build";
import { readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const only = process.argv.slice(2);
for (const name of readdirSync(here("./src"))) {
  if (only.length && !only.includes(name)) continue;
  if (!existsSync(here(`./src/${name}/index.ts`))) continue;
  const out = here(`../../crates/madar-plugins/browser/${name}`);
  rmSync(out, { recursive: true, force: true });
  const r = await buildModule({ entry: here(`./src/${name}/index.ts`), outdir: out, shared: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"], minify: true });
  const { KINDS } = await import(`./src/${name}/decl.ts`);
  writeFileSync(`${out}/kinds.json`, JSON.stringify({ kinds: KINDS }, null, 1) + "\n");
  console.log(`${name}: ${await writeFilesRs(out)} files, ${(r.bytes / 1024).toFixed(0)} kB`);
}
