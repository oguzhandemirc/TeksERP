import { describe, expect, it } from "vitest";
import { commandSections } from "./command-entries";
import { scoreCommandValue } from "./command-score";

/**
 * Ayar araması bekçisi (2026-11-02 saha bulgusu): "genel ayarlar" Baskı & Cihazlar'ı açıyordu
 * (yalnız açıklamadaki "Org-geneli"ye takılıyordu), "gelen belge ayarları" HİÇ sonuç vermiyordu
 * (Türkçe ek), "gelen belge ayar" modül sayfasıyla berabere kalıyordu. Ölçüm paletin kendi değer
 * dizisiyle yapılır (CommandPalette: etiket + açıklama + anahtar kelime + bölüm başlığı).
 */
function ranked(search: string): { to: string; score: number }[] {
  return commandSections
    .flatMap((section) =>
      section.entries.map((e) => ({
        to: e.to,
        score: scoreCommandValue([e.label, e.description, e.keywords, section.heading].filter(Boolean).join(" "), search),
      })),
    )
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

function top(search: string): { to: string; score: number } {
  const [first, second] = ranked(search);
  expect(first, `"${search}" sonuç vermedi`).toBeDefined();
  // Berabere ilk sıra DOM sırasına kalır — kazanan kesin önde olmalı.
  if (second && second.to !== first!.to) expect(first!.score).toBeGreaterThan(second.score);
  return first!;
}

describe("palet: ayar araması", () => {
  it('"genel ayarlar" → Özellik Anahtarları (eski Genel Ayarlar ekranı)', () => {
    expect(top("genel ayarlar").to).toBe("/system/feature-flags");
  });

  it.each(["gelen belge ayar", "gelen belge ayarları", "Gelen Belge Ayarları"])('"%s" → Gelen Belge ayar bölümü ilk sırada', (q) => {
    expect(top(q).to).toBe("/system/feature-flags?tab=gelen-belge");
  });
});
