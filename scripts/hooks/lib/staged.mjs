// =============================================================================
// Staged dosyalardan "hangi alt proje etkilendi" çözümü — TEK KAYNAK.
// =============================================================================
// İki kapı aynı soruyu soruyor: `.githooks/pre-commit` (git) ve
// `scripts/claude-hooks/bash-guard.mjs` (Claude'un Bash aracı). Ayrı kopyalar
// ayrışırsa biri commit'i durdurur öbürü geçirir ve hangisinin doğru olduğu
// belli olmaz — bu repoda "türetilmiş alan / ayrışan yüzey" sınıfı tam olarak
// budur (kök CLAUDE.md § Tek kaynak).
// =============================================================================

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Kod dosyası mı — tip/lint kapısının konusu. */
export function codeFile(f) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|prisma)$/.test(f);
}

/** Commit'e alınmış (staged) dosyalar. Git yoksa boş dizi (kapı sessizce geçer). */
export function stagedFiles(repo) {
  try {
    return execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      cwd: repo,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Alt proje tanımları — dizin, tip kontrolü ve test komutları. */
export const PROJELER = [
  {
    ad: "Teks-Erp",
    typecheck: ["npm", ["run", "typecheck:plain"]],
    lint: ["npm", ["run", "lint"]],
    // Backend bekçi paketi 6,5 dakikadır → commit kadansında DEĞİL (K8: PR/push).
    test: null,
  },
  {
    ad: "Electron",
    typecheck: ["npm", ["run", "typecheck:plain"]],
    lint: ["npm", ["run", "lint"]],
    test: ["npx", ["vitest", "run"]], // ölçüm: 23 sn
  },
  {
    ad: "mobil",
    typecheck: ["npx", ["tsc", "--noEmit", "--pretty", "false"]],
    lint: ["npm", ["run", "lint"]],
    test: ["npx", ["jest", "--runInBand"]], // ölçüm: 29 sn
  },
];

/** Staged dosyalardan etkilenen alt projeler (kod dosyası şartıyla). */
export function etkilenenProjeler(repo, staged) {
  return PROJELER.filter(
    (p) =>
      staged.some((f) => f.startsWith(`${p.ad}/`) && codeFile(f)) &&
      existsSync(join(repo, p.ad, "package.json")),
  );
}
