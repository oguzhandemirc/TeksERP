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

  // 2026-11-02 demo 2. tur: "genel ayarlar" 5 sonuç veriyordu, Gelen Belge ayarı yoktu (ekranın eski adı).
  it('"genel ayarlar" sonuçlarında Gelen Belge ayar bölümü de var; ilk sıra yine Özellik Anahtarları', () => {
    const r = ranked("genel ayarlar");
    expect(r.map((x) => x.to)).toContain("/system/feature-flags?tab=gelen-belge");
    expect(r[0]!.to).toBe("/system/feature-flags");
  });

  it.each(["gelen belge ayar", "gelen belge ayarları", "Gelen Belge Ayarları"])('"%s" → Gelen Belge ayar bölümü ilk sırada', (q) => {
    expect(top(q).to).toBe("/system/feature-flags?tab=gelen-belge");
  });

  it.each(["belge geneli", "müşteri mt"])('"%s" → Gelen Belge ayar bölümü ilk sırada (belge geneli beyan kipi)', (q) => {
    expect(top(q).to).toBe("/system/feature-flags?tab=gelen-belge");
  });
});
