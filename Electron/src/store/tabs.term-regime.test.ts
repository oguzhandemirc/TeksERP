// @vitest-environment jsdom
// =============================================================================
// Bekçi: sekme başlığı iş emri adı rejimini izler (QA 2026-11-03)
// =============================================================================
// Taze cihazda rejim bilinmeden açılan sekme "Terbiye İş Emirleri" adını alıyor ve kalıcı defterde öyle kalıyordu
// (komut kataloğu etiketi modül yüklenirken kopyalanıyordu). Bayrak ucu rejimi uygulayınca katalogdan çözülen başlık
// tazelenir; sayfanın yazdığı özel başlığa dokunulmaz. Kurulum ayrıntıları `tabs.logout.test.ts` başlığında.
// =============================================================================
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const kutu = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => kutu.get(k) ?? null,
    setItem: (k: string, v: string) => void kutu.set(k, v),
    removeItem: (k: string) => void kutu.delete(k),
    clear: () => kutu.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

vi.mock("@/components/layout/tabs/tab-routers", () => ({
  getTabRouter: vi.fn(),
  navigateTabRouter: vi.fn(() => true),
  goBackTabRouter: vi.fn(() => true),
  disposeTabRouter: vi.fn(),
}));

const { useTabsStore, subscribeTermRegimeTitles } = await import("./tabs");
const { applyTermRegime } = await import("@/lib/terim-rejim");
const { terimDokumaAyarla } = await import("@/lib/terim");

const { allCommandEntries } = await import("@/components/layout/command-entries");
const titleOf = (path: string) => useTabsStore.getState().tabs.find((t) => t.path === path)?.title;

describe("sekme başlığı iş emri rejimini izler", () => {
  // Kabuk (TabHost) bağlanınca abone olur; burada kabuğun yerine.
  const unsubscribe = subscribeTermRegimeTitles();
  afterAll(() => unsubscribe());
  beforeEach(() => {
    terimDokumaAyarla(true); // rejim bilinmiyor → bugünkü ad
    useTabsStore.getState().resetTabs();
  });
  afterAll(() => terimDokumaAyarla(true));

  it("rejim bilinmeden açılan sekme, dokuma kapalı bildirilince yalın adı alır", () => {
    useTabsStore.getState().openTab("/operations/work-orders");
    useTabsStore.getState().openTab("/operations/work-order-events", { forceNew: true });
    useTabsStore.getState().openTab("/operations/machine-stops", { forceNew: true });
    expect(titleOf("/operations/work-orders")).toBe("Terbiye İş Emirleri");
    expect(titleOf("/operations/machine-stops")).toBe("Tezgah Duruşları");
    applyTermRegime({ productionEnabled: true, dokumaEnabled: false });
    expect(titleOf("/operations/work-orders")).toBe("İş Emirleri");
    expect(titleOf("/operations/work-order-events")).toBe("İş Emri Hareketleri");
    expect(titleOf("/operations/machine-stops")).toBe("Makine Duruşları");
  });

  it("sayfanın yazdığı özel başlık rejim tazelemesinde korunur", () => {
    useTabsStore.getState().openTab("/operations/work-orders");
    const id = useTabsStore.getState().tabs[0]!.id;
    useTabsStore.getState().updateTabTitle(id, "IE0211260001");
    applyTermRegime({ productionEnabled: true, dokumaEnabled: false });
    expect(titleOf("/operations/work-orders")).toBe("IE0211260001");
  });

  it("palet: 'İş Emri oluştur' açıklaması dokuma kapalıyken dokuma iş emrini anmaz", () => {
    const entry = allCommandEntries.find((e) => e.key === "ops:work-order-create");
    expect(entry?.description).toMatch(/dokuma iş emri/);
    applyTermRegime({ productionEnabled: true, dokumaEnabled: false });
    expect(entry?.label).toBe("İş Emri oluştur");
    expect(entry?.description).not.toMatch(/dokuma/i);
  });
});
