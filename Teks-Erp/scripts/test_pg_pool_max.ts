// =============================================================================
// BEKÇİ — PG_POOL_MAX: Prisma havuz tavanı ortamdan, varsayılan BUGÜNKÜ davranış (30)
// =============================================================================
// Çalıştırma: npx tsx scripts/run-all-tests.ts pg_pool_max   (DB'siz)
//
// NE ÖLÇER:
//   §1 yok/boş → 30, uyarı yok (kök kural: yeni ayarın varsayılanı = bugünkü davranış)
//   §2 geçerli değer (8 · sınırlar 2 ve 100 · boşluklu) → o değer, uyarı yok
//   §3 geçersiz (abc · 1 · 101 · 8.5 · -5 · 0x10 · 1e2) → 30 + TEK SATIR uyarı (ad + değer + varsayılan)
//   §4 bağlantı: `src/lib/prisma.ts` havuzu `resolvePgPoolMax(process.env.PG_POOL_MAX)` ile kurar,
//      sabit `max: <sayı>` YOK, uyarı loglanır (havuz ayarı bir sabite geri dönmesin)
//   §5 belge: `.env.example` ve `deploy/.env.production.example` ayarı anar
//   §6 uçtan uca: gerçek `src/lib/prisma.ts` alt süreçte yüklenir (bağlantı açılmaz) — env yok → 30,
//      8 → 8, "abc" → 30 + stderr'de tek UYARI satırı
// =============================================================================
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolvePgPoolMax, PG_POOL_MAX_DEFAULT } from "../src/lib/pg-pool-max";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

check("§1 varsayılan sabiti 30 (bugünkü havuz)", PG_POOL_MAX_DEFAULT === 30);
for (const raw of [undefined, "", "   "]) {
  const r = resolvePgPoolMax(raw);
  check(`§1 ${JSON.stringify(raw)} → 30, uyarısız`, r.max === 30 && r.warning === undefined, JSON.stringify(r));
}
for (const [raw, want] of [["8", 8], ["2", 2], ["100", 100], [" 12 ", 12]] as const) {
  const r = resolvePgPoolMax(raw);
  check(`§2 ${JSON.stringify(raw)} → ${want}, uyarısız`, r.max === want && r.warning === undefined, JSON.stringify(r));
}
for (const raw of ["abc", "1", "101", "8.5", "-5", "0x10", "1e2", "0"]) {
  const r = resolvePgPoolMax(raw);
  const w = r.warning ?? "";
  check(
    `§3 ${JSON.stringify(raw)} → 30 + tek satır uyarı`,
    r.max === 30 && w.length > 0 && !w.includes("\n") && w.includes("PG_POOL_MAX") && w.includes(raw.trim()) && w.includes("30"),
    JSON.stringify(r),
  );
}

const KOK = path.join(__dirname, "..");
const prismaTs = fs.readFileSync(path.join(KOK, "src", "lib", "prisma.ts"), "utf8");
const kod = prismaTs.split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");
check("§4 prisma.ts havuzu resolvePgPoolMax(process.env.PG_POOL_MAX) ile kurar", /resolvePgPoolMax\(\s*process\.env\.PG_POOL_MAX\s*\)/.test(kod));
check("§4 prisma.ts'te sabit `max: <sayı>` yok", !/\bmax:\s*\d+/.test(kod));
check("§4 geçersiz değer uyarısı loglanır", /if\s*\(\s*\w+\.warning\s*\)\s*uyari\(/.test(kod));

const envOrnek = fs.readFileSync(path.join(KOK, ".env.example"), "utf8");
const prodOrnek = fs.readFileSync(path.join(KOK, "..", "deploy", ".env.production.example"), "utf8");
check("§5 .env.example PG_POOL_MAX'ı anar", envOrnek.includes("PG_POOL_MAX"));
check("§5 deploy/.env.production.example PG_POOL_MAX'ı anar", prodOrnek.includes("PG_POOL_MAX"));

const SONDA = 'const m=require("./src/lib/prisma"); console.log("MAX=" + m.pool.options.max); m.pool.end()';
for (const [raw, want, uyarili] of [[undefined, 30, false], ["8", 8, false], ["abc", 30, true]] as const) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://x:x@127.0.0.1:1/x_test" };
  delete env.PG_POOL_MAX;
  if (raw !== undefined) env.PG_POOL_MAX = raw;
  const r = spawnSync("npx", ["tsx", "-e", SONDA], { cwd: KOK, env, encoding: "utf8", timeout: 60_000 });
  const max = Number(/MAX=(\d+)/.exec(r.stdout ?? "")?.[1]);
  const uyari = (r.stderr + r.stdout).split("\n").filter((l) => l.includes("PG_POOL_MAX geçersiz"));
  check(
    `§6 uçtan uca PG_POOL_MAX=${JSON.stringify(raw)} → pool.options.max=${want}${uyarili ? " + tek uyarı satırı" : ", uyarısız"}`,
    max === want && uyari.length === (uyarili ? 1 : 0),
    `max=${max} uyarı=${uyari.length} çıkış=${r.status}`,
  );
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exitCode = fail > 0 ? 1 : 0;
