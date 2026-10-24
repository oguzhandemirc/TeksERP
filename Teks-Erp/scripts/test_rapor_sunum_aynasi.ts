// =============================================================================
// RAPOR SUNUM ZARFI AYNASI — `Teks-Erp/src/services/reports/sunum/sunum.types.ts` TEK KAYNAKTIR;
// panel `Electron/src/pages/Reports/_v2/sunum.ts` onu BAYT-EŞİT taşır (başlık yorumu dahil).
// Ayna kayarsa panel zarfı yanlış okur ve hata sessizdir: tip derlenir, alan ekranda boş kalır.
// Emsal: `test_lisans_protokol_aynasi`. Düzeltme: değişiklik ÖNCE kaynakta, sonra `cp -p` aynaya.
//
// ÜÇ SONUÇ: iki dosyadan biri yoksa KIRMIZI (yokluk "eşit" sayılmaz); kaynak ≥ 1 KB (boş = eşit yok).
// ✓B1 (bu commit) — R0-SABLON 2026-10-24: aynada tek boşluk eklendi → ❌ 1; md5 ile geri alındı, 3/0.
// Koşum: npx tsx scripts/test_rapor_sunum_aynasi.ts   (DB GEREKMEZ)
// =============================================================================
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const KOK = path.resolve(__dirname, "..", "..");
const KAYNAK = "Teks-Erp/src/services/reports/sunum/sunum.types.ts";
const AYNA = "Electron/src/pages/Reports/_v2/sunum.ts";

const oku = (rel: string): Buffer | null => {
  const p = path.join(KOK, rel);
  return existsSync(p) ? readFileSync(p) : null;
};
const ozet = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

function main(): void {
  const kaynak = oku(KAYNAK);
  const ayna = oku(AYNA);
  check(`§1 kaynak var ve dolu (${KAYNAK})`, kaynak !== null && kaynak.length >= 1024, kaynak ? `${kaynak.length} bayt` : "dosya yok");
  check(`§2 ayna var (${AYNA})`, ayna !== null, ayna ? `${ayna.length} bayt` : "dosya yok");
  if (kaynak && ayna) {
    const esit = ozet(kaynak) === ozet(ayna);
    let ilkFark = "";
    if (!esit) {
      const n = Math.min(kaynak.length, ayna.length);
      let i = 0;
      while (i < n && kaynak[i] === ayna[i]) i++;
      ilkFark = `ilk fark bayt ${i}, satır ${kaynak.subarray(0, i).toString("utf8").split("\n").length} — düzelt: cp -p ${KAYNAK} ${AYNA}`;
    }
    check("§3 ayna kaynakla BAYT-EŞİT (sha256)", esit, ilkFark);
  } else {
    check("§3 ayna kaynakla BAYT-EŞİT (sha256)", false, "ölçülemedi: dosya eksik");
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exit(1);
}

main();
