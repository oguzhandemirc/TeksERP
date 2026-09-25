// =============================================================================
// Bekçi: SEVK İRSALİYESİ HTML'İ ALTIN KOPYAYLA BİREBİR — DB gerekmez
// Çalıştır: npx tsx scripts/test_sevk_belge_altin.ts   (yeniden yaz: --yaz)
// =============================================================================
// Kabul kapısı (1e, 2026-09-25): Excel'i PDF'in kolon çözücüsünden türetmek için
// renderer bir tablo MODELİNDEN çizilecek şekilde yeniden kuruldu. Sahadaki PDF bu
// yüzden SESSİZCE değişmemeli — donmuş her belge yeniden basılabilir. 336
// kombinasyon (3 doc × 8 şablon × 14 baskı meta'sı: packingLot · sıra · ad rejimi ·
// ayrık renk · not/iz · bölüm seçimi · TR/EN · hidden/shown/order/labels/blankLabels)
// refactor'dan ÖNCE `scripts/lib/sevk-belge-altin.json`a sha256 olarak yazıldı;
// çıktı boşluk normalizasyonu dışında bayt bayt aynı kalmalı.
//
// Bilinçli bir görünüm değişikliği bu dosyayı kırmızıya düşürür: değişikliği
// gözle doğrula, sonra `--yaz` ile altını yenile ve commit mesajına NEDEN'ini yaz.
//
// Negatif sonda: (commit mesajında) renderer'da çuval listesinin bir kolon başlığı
// modelden bağımsız değiştirildi → kırmızı; md5 ile geri alındı.
// =============================================================================
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { normalizeHtml, sevkBelgeKombinasyonlari } from "./lib/sevk-belge-fikstur";

const ALTIN = join(__dirname, "lib", "sevk-belge-altin.json");
const YAZ = process.argv.includes("--yaz");

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const kombinasyonlar = sevkBelgeKombinasyonlari();
const gercek: Record<string, string> = {};
for (const k of kombinasyonlar) {
  gercek[k.ad] = sha(normalizeHtml(renderShipmentDispatchHtml(k.snapshot, k.meta)));
}

if (YAZ) {
  writeFileSync(ALTIN, JSON.stringify(gercek, null, 1) + "\n");
  console.log(`Altın kopya yazıldı: ${Object.keys(gercek).length} kombinasyon → ${ALTIN}`);
  process.exit(0);
}

console.log("§1 Körlük zemini — kombinasyon uzayı gerçekten farklı çıktılar üretiyor");
check("kombinasyon sayısı ≥ 300", kombinasyonlar.length >= 300, `${kombinasyonlar.length}`);
const farkli = new Set(Object.values(gercek)).size;
// Meta/şablonların çoğu çıktıyı değiştirmeli; hepsi aynı hash'e düşerse fikstür ölü.
check("farklı HTML sayısı ≥ 200", farkli >= 200, `${farkli}`);

console.log("§2 Altın dosya ↔ kombinasyon uzayı iki yönlü");
check("altın dosya var", existsSync(ALTIN), ALTIN);
const altin: Record<string, string> = existsSync(ALTIN) ? JSON.parse(readFileSync(ALTIN, "utf8")) : {};
const eksik = Object.keys(gercek).filter((k) => !(k in altin));
const hayalet = Object.keys(altin).filter((k) => !(k in gercek));
check("altında olmayan kombinasyon yok", eksik.length === 0, eksik.slice(0, 5).join(", "));
check("altında hayalet kombinasyon yok", hayalet.length === 0, hayalet.slice(0, 5).join(", "));

console.log("§3 ⭐ Her kombinasyonun HTML'i altınla aynı");
const degisen = Object.keys(gercek).filter((k) => k in altin && altin[k] !== gercek[k]);
check(
  `${Object.keys(gercek).length} kombinasyonun hepsi altınla aynı`,
  degisen.length === 0,
  degisen.length ? `${degisen.length} değişti: ${degisen.slice(0, 8).join(", ")}` : "",
);

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
