#!/usr/bin/env node
// =============================================================================
// deneme-veri/doldur — deneme kurulumunu TÜM modüllerde gerçekçi sunum/test verisiyle doldurur. YALNIZ panel API'si
// (servis yolu: defter, bakiye, numara, audit doğru aktörle doğar); doğrudan INSERT yok.
//
// İdempotent: tokenlı uçlarda clientToken = UUIDv5(mantıksal anahtar) ve gövde ÇAPA TARİHTEN türer (saatten değil) ⇒
// ikinci koşum sunucunun replay boğazına düşer; tokensız uçlarda ara-yoksa-yarat; durum geçişlerinde canlı durum okunur.
// Belirsiz hatada (ağ/5xx/429) aynı gövde + aynı token ile yeniden denenir (lib/istemci.mjs).
// "Salon bugünü" adımı fabrikanın BUGÜNÜnü boyar (açık koşum/duruş); gün dönünce yeniden koşulur (sunum-hazırla eşi).
//
//   node scripts/deneme-veri/doldur.mjs --url <adres> --sir <Anahtar Zinciri servisi> [--cap 2026-10-16] [--adim a,b]
// Hesap: `demoveri` (hizmet-hesabi.mjs kurar). Çıktı sır basmaz.
// =============================================================================
import { istemciKur, zincirOku } from "./lib/istemci.mjs";
import { baglamKur } from "./lib/baglam.mjs";
import { anaVeri } from "./adimlar/ana-veri.mjs";
import { ticaret } from "./adimlar/ticaret.mjs";
import { dokuma } from "./adimlar/dokuma.mjs";

/** Sonraki adımların kimlik okuduğu adımlar — seçimde de koşar (yazacakları yoksa no-op). */
const ZORUNLU = new Set(["ana-veri"]);

export const ADIMLAR = [
  ["ana-veri", anaVeri],
  ["ticaret", ticaret],
  ["dokuma", dokuma],
];

const arg = (ad, v) => { const i = process.argv.indexOf(ad); return i > 0 ? process.argv[i + 1] : v; };

async function main() {
  const url = arg("--url"), sir = arg("--sir"), cap = arg("--cap", "2026-10-16");
  const secim = arg("--adim")?.split(",");
  if (!url || !sir) throw new Error("kullanım: doldur.mjs --url <adres> --sir <zincir servisi> [--cap YYYY-AA-GG] [--adim a,b]");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cap)) throw new Error("--cap YYYY-AA-GG");
  const parola = zincirOku(sir);
  if (!parola) throw new Error(`Anahtar Zinciri'nde '${sir}' yok — önce hizmet-hesabi.mjs`);
  const ist = istemciKur({ url, kullanici: arg("--kullanici", "demoveri"), parola });
  await ist.giris();
  const c = baglamKur({ api: ist.api, cap });
  const t0 = Date.now();
  try {
    for (const [ad, fn] of ADIMLAR) {
      // Ana veri her koşumda okunur (sonraki adımlar kimliklerini kullanır); yazacak bir şey yoksa no-op.
      if (secim && !secim.includes(ad) && !ZORUNLU.has(ad)) continue;
      const s = Date.now();
      console.log(`▶ ${ad}`);
      await fn(c);
      console.log(`  ✓ ${ad} (${((Date.now() - s) / 1000).toFixed(1)} sn)`);
    }
  } finally {
    console.log("\n== SAYAÇ (modül: yeni · mevcut)");
    for (const [m, v] of [...c.sayac].sort()) console.log(`  ${m.padEnd(26)} ${v.yeni} · ${v.mevcut}`);
    console.log(`istek ${ist.sayac.istek} · yeniden deneme ${ist.sayac.yeniden} · ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
    await ist.cikis();
  }
}
main().catch((e) => { console.error("HATA: " + e.message); process.exit(1); });
