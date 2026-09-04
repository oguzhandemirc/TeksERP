// @vitest-environment jsdom
// =============================================================================
// Bekçi: ÇIKIŞTA sekme defteri temizlenir
// =============================================================================
// Sekme defteri KALICIDIR (`persist`, "teks.tabs"). Temizlenmezse çıkış yapan
// kişinin sekmeleri bir sonraki kullanıcıda hazır açılır — başlıklarında
// müşteri / sipariş adları taşıyorlar, yani ortak kullanılan fabrika
// bilgisayarında hem karıştırıcı hem sızıntı.
//
// ⚠️ İKİ KURULUM AYRINTISI, İKİSİ DE ÖLÇÜLDÜ:
//
// 1. `localStorage` bu ortamda YOK (jsdom açık ama depolama kapalı; ölçüldü:
//    `typeof localStorage === "undefined"`). Store `persist` ile sarılı olduğu
//    için import ANINDA depolamaya yazar → stub, import'lardan ÖNCE kurulmalı.
//    `beforeAll` içinde kurmak YETMEZ: import statement'ları hoist edilir.
//    `vi.hoisted` tam bu iş için var.
//
// 2. `tab-routers` MOCKLANIR (`tabs.back.test.ts` ile aynı gerekçe): gerçek
//    registry tüm sayfa ağacını (content-routes) import eder. Mocklanmazsa
//    dosya TEK BAŞINA geçer ama TÜM TAKIMDA yükleme 10 sn'de zaman aşımına
//    düşer — ölçüldü: "Hook timed out in 10000ms". Tek dosya koşumu bu hatayı
//    GÖSTERMEZ; suite koşumu gösterir.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { useTabsStore } = await import("./tabs");

describe("çıkışta sekmeler kapanır", () => {
  beforeEach(() => useTabsStore.getState().resetTabs());

  it("körlük zemini — açılan sekmeler gerçekten defterde", () => {
    useTabsStore.getState().openTab("/orders");
    useTabsStore.getState().openTab("/customers", { forceNew: true });
    expect(useTabsStore.getState().tabs.length).toBe(2);
  });

  it("⭐ resetTabs defteri BOŞALTIR (sekme + aktif seçim)", () => {
    useTabsStore.getState().openTab("/orders");
    useTabsStore.getState().openTab("/customers", { forceNew: true });
    useTabsStore.getState().resetTabs();
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(useTabsStore.getState().activeId).toBeNull();
  });

  it("⭐ KALICI kopya da boşalır (asıl risk: sonraki kullanıcı onu okur)", () => {
    useTabsStore.getState().openTab("/orders");
    useTabsStore.getState().resetTabs();
    const ham = localStorage.getItem("teks.tabs");
    expect(ham).toBeTruthy();
    expect(JSON.parse(ham as string).state.tabs).toEqual([]);
  });

  it("boş defterde çağrılmak güvenli (çıkış iki kez tetiklenebilir)", () => {
    expect(() => useTabsStore.getState().resetTabs()).not.toThrow();
    expect(useTabsStore.getState().tabs).toEqual([]);
  });

  it("⭐ `logout` gövdesi resetTabs'i ÇAĞIRIR — kaynak sözleşmesi", async () => {
    // Davranış testi değil kaynak kontrolü: `logout` token deposuna ve IPC'ye
    // dokunduğu için burada koşturulamıyor; asıl risk çağrının SESSİZCE
    // düşmesiydi (dinamik import, `void`, `.catch` — üçü de hatayı yutar).
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const dir = path.dirname(url.fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(dir, "auth.ts"), "utf8");
    const govde = src.slice(src.indexOf("logout: async"));
    expect(govde).toMatch(/resetTabs\(\)/);
  });
});
