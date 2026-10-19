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
//   node scripts/deneme-veri/doldur.mjs --url <adres> --sir <Anahtar Zinciri servisi> [--cap 2026-10-16] [--adim a,b] [--kuru]
// --kuru: yalnız GET (lib/kuru.mjs) — yazımlar ağa çıkmaz, adım başına "METHOD yol → adet" basılır (uygulama öncesi önizleme).
// Hesap: `demoveri` (hizmet-hesabi.mjs kurar). Çıktı sır basmaz.
// =============================================================================
import { istemciKur, zincirOku } from "./lib/istemci.mjs";
import { baglamKur } from "./lib/baglam.mjs";
import { kuruSarmala, yazimOzeti } from "./lib/kuru.mjs";
import { anaVeri } from "./adimlar/ana-veri.mjs";
import { ticaret } from "./adimlar/ticaret.mjs";
import { dokuma } from "./adimlar/dokuma.mjs";
import { salon } from "./adimlar/salon.mjs";
import { uretim } from "./adimlar/uretim.mjs";
import { finans } from "./adimlar/finans.mjs";
import { depo } from "./adimlar/depo.mjs";
import { kalite } from "./adimlar/kalite.mjs";
import { kartela } from "./adimlar/kartela.mjs";
import { finansGecmis } from "./adimlar/finans-gecmis.mjs";

/** Sonraki adımların kimlik okuduğu adımlar — seçimde de koşar (yazacakları yoksa no-op). */
const ZORUNLU = new Set(["ana-veri"]);

export const ADIMLAR = [
  ["ana-veri", anaVeri],
  ["ticaret", ticaret],
  ["dokuma", dokuma],
  ["salon", salon],
  ["uretim", uretim],
  ["finans", finans],
  // dolgu-2 (dv2: ad alanı); kalite → finans-gecmis sırası şart (iade faturası iadeleri okur)
  ["depo", depo],
  ["kalite", kalite],
  ["kartela", kartela],
  ["finans-gecmis", finansGecmis],
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
  const kuru = process.argv.includes("--kuru") ? kuruSarmala(ist.api) : null;
  if (kuru) console.log("KURU KOŞU — yalnız GET; yazımlar sayılır, gönderilmez");
  const c = baglamKur({ api: kuru?.api ?? ist.api, cap });
  const t0 = Date.now();
  try {
    for (const [ad, fn] of ADIMLAR) {
      // Ana veri her koşumda okunur (sonraki adımlar kimliklerini kullanır); yazacak bir şey yoksa no-op.
      if (secim && !secim.includes(ad) && !ZORUNLU.has(ad)) continue;
      const s = Date.now();
      const y0 = kuru?.yazim.length ?? 0;
      console.log(`▶ ${ad}`);
      await fn(c);
      console.log(`  ✓ ${ad} (${((Date.now() - s) / 1000).toFixed(1)} sn)`);
      if (kuru) for (const [y, n] of yazimOzeti(kuru.yazim.slice(y0))) console.log(`    [kuru] ${y.padEnd(52)} × ${n}`);
    }
  } finally {
    console.log("\n== SAYAÇ (modül: yeni · mevcut · belirsiz[tokenlı, yanıtta zaman yok])");
    for (const [m, v] of [...c.sayac].sort()) console.log(`  ${m.padEnd(26)} ${v.yeni} · ${v.mevcut}${v.belirsiz ? " · " + v.belirsiz : ""}`);
    console.log(`istek ${ist.sayac.istek} · yeniden deneme ${ist.sayac.yeniden} · ${((Date.now() - t0) / 1000).toFixed(0)} sn${kuru ? ` · KURU: ${kuru.yazim.length} yazım GÖNDERİLMEDİ` : ""}`);
    await ist.cikis();
  }
}
main().catch((e) => { console.error("HATA: " + e.message); process.exit(1); });
