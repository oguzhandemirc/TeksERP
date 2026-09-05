#!/usr/bin/env node
// =============================================================================
// Claude Code PreToolUse hook — Bash komut kapısı (2026-09-05).
// Kök CLAUDE.md'deki "yasak komut" kuralları burada MEKANİKTİR: modelin hafızasına
// değil kapıya bağlıdır. stdin: {tool_name, tool_input:{command}}. exit 2 = engelle
// (stderr Claude'a gösterilir), exit 0 = izin. Kaçış: TEKSERP_HOOK_SKIP=1.
// Ayrıca `git commit` komutunda staged alt projelerde tip kontrolü koşar (commit
// öncesi tsc — kullanıcı kararı: her düzenlemede değil, commit anında).
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const REPO = process.cwd();
if (process.env.TEKSERP_HOOK_SKIP === "1") process.exit(0);
let input = "";
try { input = readFileSync(0, "utf8"); } catch { process.exit(0); }
let payload;
try { payload = JSON.parse(input || "{}"); } catch { process.exit(0); }
if (payload.tool_name !== "Bash") process.exit(0);
const cmd = String(payload.tool_input?.command ?? "");
if (!cmd.trim()) process.exit(0);

// --- 1) Yasak komutlar (kök CLAUDE.md § Yasaklar) ---
const BANS = [
  { re: /pkill\s+-f\s+["']?tsx/i, why: "`pkill -f tsx` YASAK — başkasının sunucusunu da öldürür. Yalnız kendi başlattığın PID'i durdur ya da ayrı port kullan (docs/GELISTIRME-DONGUSU.md)." },
  { re: /\bkillall\s+(node|tsx)\b/i, why: "`killall node` YASAK — tek-process invariantı: yalnız kendi PID'in." },
  { re: /prisma\s+migrate\s+reset\b/i, why: "`prisma migrate reset` YASAK — PRODUCTION CANLI kuralı; dev DB'de bile fixture'ları ve `_prisma_migrations` defterini sıfırlar. Yedekten restore ya da `<canlı>_restore_<damga>` kopyası kullan." },
  { re: /prisma\s+migrate\s+dev\b(?![^\n]*--create-only)/i, why: "`prisma migrate dev` (create-only'siz) YASAK — iki DEFERRABLE composite FK'yı DROP etmek ister. Yeni migration: `prisma migrate dev --create-only` + DropForeignKey satırlarını sil; pull'lanmış migration: `npm run prisma:migrate` (deploy)." },
  { re: /prisma\s+db\s+push\b/i, why: "`prisma db push` YASAK — migration defteri olmadan şema yazar, drift bekçisi kırmızıya döner. Migration yaz." },
  { re: /\b(TRUNCATE|DROP\s+(TABLE|DATABASE|SCHEMA))\b/i, why: "`TRUNCATE` / `DROP TABLE|DATABASE` YASAK — canlı veri kuralı. Kopya DB'de çalış (`db-copy`), toplu düzeltme script'i dry-run + `--apply`." },
  { re: /\bDELETE\s+FROM\b(?![^\n]*\bWHERE\b)/i, why: "WHERE'siz `DELETE FROM` YASAK — toplu DELETE canlı veri kuralına aykırı; soft delete ya da dry-run'lı script." },
  { re: /git\s+push\b[^\n]*(--force\b|\s-f\b)/i, why: "`git push --force` YASAK — paylaşılan dalın geçmişini ezer. Gerekiyorsa kullanıcı `!` ile kendisi koşar." },
  { re: /npm\s+run\s+build:win\b/i, why: "Ham `npm run build:win` YASAK — bir önceki müşterinin yayın adresiyle derler. `./deploy/electron-paketle.sh <müşteri>` kullan." },
  { re: /gradlew\s+assembleRelease\b/i, why: "`./gradlew assembleRelease` ELLE ÇAĞRILMAZ — `cd mobil && npm run build:apk -- --musteri=<kod>` (adres doğrulaması + bundle kontrolü)." },
];
for (const b of BANS) {
  if (b.re.test(cmd)) {
    process.stderr.write(`⛔ Komut kapısı: ${b.why}\n(kaçış yalnız kullanıcı kararıyla: TEKSERP_HOOK_SKIP=1)\n`);
    process.exit(2);
  }
}

// --- 2) git commit → staged alt projelerde tip kontrolü ---
if (/\bgit\s+commit\b/.test(cmd) && !/--no-verify/.test(cmd)) {
  let staged = [];
  try { staged = execSync("git diff --cached --name-only", { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean); } catch { process.exit(0); }
  const codeFile = (f) => /\.(ts|tsx|js|mjs|cjs|prisma)$/.test(f);
  const targets = [
    { dir: "Teks-Erp", when: staged.some((f) => f.startsWith("Teks-Erp/") && codeFile(f)), cmd: ["npm", ["run", "typecheck:plain"]] },
    { dir: "Electron", when: staged.some((f) => f.startsWith("Electron/") && codeFile(f)), cmd: ["npm", ["run", "typecheck:plain"]] },
    { dir: "mobil", when: staged.some((f) => f.startsWith("mobil/") && codeFile(f)), cmd: ["npx", ["tsc", "--noEmit", "--pretty", "false"]] },
  ].filter((t) => t.when && existsSync(join(REPO, t.dir, "package.json")));
  for (const t of targets) {
    process.stderr.write(`⏳ commit kapısı: ${t.dir} tip kontrolü…\n`);
    const r = spawnSync(t.cmd[0], t.cmd[1], { cwd: join(REPO, t.dir), encoding: "utf8", timeout: 240_000 });
    if (r.status !== 0) {
      const tail = `${r.stdout || ""}\n${r.stderr || ""}`.split("\n").filter(Boolean).slice(-30).join("\n");
      process.stderr.write(`⛔ commit kapısı: ${t.dir} tip kontrolü KIRMIZI (çıkış ${r.status}). Hata düzeltilmeden commit atılmaz.\n${tail}\n`);
      process.exit(2);
    }
  }
}
process.exit(0);
