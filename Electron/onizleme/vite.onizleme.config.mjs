// Önizleme sunucusu (YALNIZ GELİŞTİRME): worktree'nin web config'i + sembolik bağlı
// node_modules için fs izni. Kullanım: cd Electron && npx vite --config onizleme/vite.onizleme.config.mjs
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import base from "../vite.config.web.ts";

const electronDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = fileURLToPath(new URL("../..", import.meta.url));
const real = (p) => realpathSync(fileURLToPath(new URL(p, import.meta.url)));

export default (env) => {
  const c = typeof base === "function" ? base(env) : base;
  return {
    ...c,
    root: electronDir,
    server: { port: 5391, strictPort: true, fs: { allow: [repoDir, real("../node_modules"), real("../../node_modules")] } },
  };
};
