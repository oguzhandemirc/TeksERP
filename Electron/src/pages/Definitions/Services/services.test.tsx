// BEKÇİ — Hizmet Kartları ekranı (D2): kart `service_items`'ta; panel `/api/service-items`i konuşur, gövdede tür
// alanı YOK (uç `.strict()`), yaşam döngüsü aynı tabloya gider, karo/rota/başlık "Hizmet Kartları".
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serviceFormSchema, servicePayload } from "./schema";
import { servicePricesHref } from "./columns";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));

const { serviceItemService, serviceItemLifecycleApi } = await import("./service");
const { SERVICE_ITEMS_QUERY_KEY } = await import("./ServicesPage");
const { catalogTiles } = await import("../tiles/catalog");

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { success: true, data: [] } });
  post.mockReset().mockResolvedValue({ data: { success: true, data: {} } });
});

describe("Hizmet Kartları ekranı (D2)", () => {
  it("⭐ liste ve yaşam döngüsü /api/service-items'a gider (ürün kartı ucu değil)", async () => {
    await serviceItemService.getById("s1");
    expect(get.mock.calls[0]![0]).toBe("/api/service-items/s1");
    await serviceItemLifecycleApi.lifecyclePreview("s1", "ARCHIVED");
    expect(get.mock.calls[1]![0]).toBe("/api/service-items/s1/lifecycle-preview");
    await serviceItemLifecycleApi.transitionLifecycle("s1", "PHASE_OUT", null);
    expect(post).toHaveBeenCalledWith("/api/service-items/s1/lifecycle", { to: "PHASE_OUT", reason: null });
    await serviceItemLifecycleApi.lifecycleSummary(["a", "b"]);
    expect(get.mock.calls[2]).toEqual(["/api/service-items/lifecycle-summary", { params: { ids: "a,b" } }]);
    expect(serviceItemLifecycleApi.queryRoot).toBe(SERVICE_ITEMS_QUERY_KEY);
  });

  it("⭐ yeni kart gövdesinde tür alanı YOK; boş kod gönderilmez (sistem HZM- verir)", () => {
    expect(servicePayload({ code: "", name: " Kurşun ", unit: "MT" }, false)).toEqual({ name: "Kurşun", unit: "MT" });
    expect(servicePayload({ code: "KUR", name: "Kurşun", unit: "ADET" }, false)).toEqual({ code: "KUR", name: "Kurşun", unit: "ADET" });
  });

  it("düzenlemede kod gönderilmez", () => {
    expect(servicePayload({ code: "KUR", name: "Kurşun", unit: "KG" }, true)).toEqual({ name: "Kurşun", unit: "KG" });
  });

  it("form: ad zorunlu, STK-/HZM- öneki reddedilir, birim katalogdan", () => {
    expect(serviceFormSchema.safeParse({ code: "", name: "", unit: "MT" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ code: "STK-1", name: "x", unit: "MT" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ code: "hzm-1", name: "x", unit: "MT" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ code: "", name: "x", unit: "LT" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ code: "", name: "x", unit: "KG" }).success).toBe(true);
  });

  it("satır bağlantısı fiyat tablosunu hizmet seçili açar", () => {
    expect(servicePricesHref("a b")).toBe("/definitions/service-prices?item=a%20b");
  });

  it("⭐ menüde bulunur: karolar 'Ürün Kartları' / 'Hizmet Kartları' (palet karodan türer)", () => {
    const t = (k: string) => catalogTiles.find((x) => x.key === k);
    expect(t("items")).toMatchObject({ title: "Ürün Kartları", to: "/definitions/items", permission: "item:read" });
    expect(t("services")).toMatchObject({ title: "Hizmet Kartları", to: "/definitions/services", permission: "item:read" });
    // Ayna: backend ekran kataloğu title'ı karoyla AYNI (yetki/modül ekranları o adı gösterir).
    const katalog = readFileSync(resolve(process.cwd(), "../Teks-Erp/src/constants/screen-catalog.ts"), "utf8");
    const title = (key: string) => katalog.match(new RegExp(`key: "${key}"[^\\n]*title: "([^"]+)"`))?.[1];
    expect(title("definitions/items")).toBe(t("items")!.title);
    expect(title("definitions/services")).toBe(t("services")!.title);
  });
});
