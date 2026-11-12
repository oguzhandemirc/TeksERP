// Bekçi malzemesi: geliştirmede Gülkesim kâğıtlarından elle yazılmış 5 gönderen şablonu (pakette YOK, 2026-11-09).
// Süreç içi kayıt: aynı süreçteki `loadTemplates()`/`engineTemplates()`/`templateByCode` bunları dosya şablonu sayar.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadTemplates, registerFixtureTemplates } from "../../src/lib/gelen-belge/motor/templates";
import type { DocumentTemplate } from "../../src/lib/gelen-belge/motor";

export const TEST_SABLON_DIZINI = join(__dirname, "..", "..", "src", "lib", "gelen-belge", "motor", "__tests__", "sablonlar");

/** Eski `loadTemplates()` sırası korunur (eşit puanda sınıflandırma sırası değişmesin). */
export const TEST_SABLON_KODLARI = ["ceki-listesi-a", "cikis-ceki-listesi", "urun-sevk-fisi", "kesim-takip-formu", "kumas-irsaliyesi"] as const;

/** Fikstür şablonları (GENEL yok). */
export function testSablonlari(): DocumentTemplate[] {
  return TEST_SABLON_KODLARI.map((c) => JSON.parse(readFileSync(join(TEST_SABLON_DIZINI, `${c}.json`), "utf8")) as DocumentTemplate);
}

/** Fikstürleri süreç içi kaydeder; motorun dosya şablonu kümesini (fikstürler + GENEL sonda) döner. */
export function testSablonlariniKaydet(): DocumentTemplate[] {
  registerFixtureTemplates(testSablonlari());
  return loadTemplates();
}
