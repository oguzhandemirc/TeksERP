// =============================================================================
// SENARYO L + Y — tek komut (plan §8: dalga sonunda entegrasyon dalında birlikte koşulur)
// =============================================================================
// Koşum (Teks-Erp/ içinden; hedefler YALNIZ `_test` DB — fabrika DB'lerine ASLA):
//   DATABASE_URL='…/<ana>_test?schema=public' SENARYO_DR_DATABASE_URL='…/<dr>_test' \
//   SENARYO_BAYI_DATABASE_URL='…/<bayi>_test' SATICI_DATABASE_URL='…/<satici>_test' \
//   PG_BIN_DIR=<pg16 istemcisi> node ../scripts/agir-is.mjs -- npx tsx scripts/senaryo-ly.ts
// İki senaryo SIRAYLA ve BAĞIMSIZ koşar (biri kırmızıysa diğeri yine koşar); her biri kendi hedef
// kapısını ve temizliğini taşır. Çıktı akışı aynen geçer, sonda iki satırlık özet basılır.
// Çıkış: 0 ikisi de yeşil · 1 kırmızı/kısmi adım var · 2 hedef reddi ya da düzenek kurulamadı.
// =============================================================================
import { spawnSync } from "node:child_process";
import path from "node:path";

const SENARYOLAR = [
  { ad: "Senaryo L (lisans, L1–L34)", dosya: "senaryo-lisans.ts" },
  { ad: "Senaryo Y (yedek şifreleme, Y1–Y6)", dosya: "senaryo-yedek.ts" },
] as const;

const sonuclar: { ad: string; kod: number; sn: number }[] = [];
for (const s of SENARYOLAR) {
  console.log(`\n══════════ ${s.ad} ══════════`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ["--import", "tsx", path.join(__dirname, s.dosya), ...process.argv.slice(2)], {
    cwd: path.join(__dirname, ".."),
    env: process.env,
    stdio: "inherit",
  });
  sonuclar.push({ ad: s.ad, kod: r.status ?? 2, sn: Math.round((Date.now() - t0) / 1000) });
}

console.log("\n══════════ ÖZET ══════════");
for (const s of sonuclar) console.log(`${s.kod === 0 ? "✅" : "❌"} ${s.ad} — çıkış ${s.kod} (${s.sn} sn)`);
process.exit(Math.max(...sonuclar.map((s) => s.kod)));
