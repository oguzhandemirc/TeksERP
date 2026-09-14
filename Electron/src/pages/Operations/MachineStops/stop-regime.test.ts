// =============================================================================
// TEZGAH DURUŞLARI GÖRÜNÜRLÜĞÜ — BEKÇİ (`weaving-regime.test.ts` kalıbı)
// =============================================================================
import { describe, expect, it } from "vitest";
import { isMachineStopsVisible } from "./stop-regime";
import { LOSS_CLASS_META, formatDuration, localInputToIso } from "./types";

describe("rejim", () => {
  it("⭐ fabrikada (dokuma modülü kapalı) GÖRÜNMEZ", () => {
    expect(isMachineStopsVisible({ dokumaEnabled: false })).toBe(false);
  });
  it("dokuma modülü açıkken görünür", () => {
    expect(isMachineStopsVisible({ dokumaEnabled: true })).toBe(true);
  });
  it("⭐ yüklem ÜRETİME BAKMAZ — zincir bağlamı kuran hook'ta", () => {
    const effectiveOnly = { dokumaEnabled: true, productionEnabled: false };
    expect(isMachineStopsVisible(effectiveOnly)).toBe(true);
  });
});

describe("sözlük ve biçim", () => {
  it("beş kayıp sınıfı da etiketli (MINOR bir SÜRE sınıfı, yine de gösterilir)", () => {
    expect(Object.keys(LOSS_CLASS_META).sort()).toEqual(["MINOR", "NON_SCHEDULED", "PLANNED", "SETUP", "UNPLANNED"]);
  });
  it("süre: sunucu saniyesi öncelikli; açık duruşta şimdiye göre; ileri damga —", () => {
    const t0 = Date.parse("2026-09-14T10:00:00.000Z");
    expect(formatDuration(3900, "2026-09-14T10:00:00.000Z", "2026-09-14T11:05:00.000Z", t0)).toBe("1 sa 05 dk");
    expect(formatDuration(null, "2026-09-14T10:00:00.000Z", null, t0 + 12 * 60_000)).toBe("12 dk");
    expect(formatDuration(null, "2026-09-14T10:00:00.000Z", null, t0 - 60_000)).toBe("—");
  });
  it("datetime-local → ISO; boş → null", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("2026-09-14T10:30")).toMatch(/^2026-09-14T\d{2}:30:00\.000Z$/);
  });
});
