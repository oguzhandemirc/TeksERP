// =============================================================================
// Bekçi: ÇIKIŞTA sekme defteri temizlenir
// =============================================================================
// Sekme defteri KALICIDIR (`persist`, "teks.tabs"). Temizlenmezse çıkış yapan
// kişinin sekmeleri bir sonraki kullanıcıda hazır açılır — başlıklarında
// müşteri / sipariş adları taşıyorlar, yani ortak kullanılan fabrika
// bilgisayarında hem karıştırıcı hem sızıntı.
//
// ⚠️ `localStorage` bu test ortamında YOK (jsdom açık ama depolama kapalı) —
// ölçüldü: `typeof localStorage === "undefined"`. Store `persist` ile sarılı
// olduğu için import ANINDA depolamaya yazar ve stub olmadan `setItem`
// undefined hatası verir. Bu yüzden stub import'tan ÖNCE kurulur ve store
// dinamik import edilir.
// =============================================================================
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

let useTabsStore: typeof import("./tabs").useTabsStore;

beforeAll(async () => {
  const kutu = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => kutu.get(k) ?? null,
    setItem: (k: string, v: string) => void kutu.set(k, v),
    removeItem: (k: string) => void kutu.delete(k),
    clear: () => kutu.clear(),
    key: () => null,
    length: 0,
  });
  ({ useTabsStore } = await import("./tabs"));
});

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
