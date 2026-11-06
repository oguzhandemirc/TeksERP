import { describe, expect, it } from "vitest";
import { serviceFormSchema, servicePayload } from "./schema";
import { SERVICE_FILTERS } from "./ServicesPage";
import { servicePricesHref } from "./columns";

describe("Hizmetler ekranı (K3)", () => {
  it("liste yalnız SERVICE türünü sunucudan ister", () => {
    expect(SERVICE_FILTERS).toEqual({ itemType: "SERVICE" });
  });

  it("yeni hizmet SERVICE türüyle doğar; boş kod gönderilmez (sistem verir)", () => {
    expect(servicePayload({ code: "", name: " Kurşun ", unit: "MT" }, false)).toEqual({
      name: "Kurşun",
      unit: "MT",
      itemType: "SERVICE",
    });
    expect(servicePayload({ code: "KUR", name: "Kurşun", unit: "ADET" }, false)).toMatchObject({
      code: "KUR",
    });
  });

  it("düzenlemede kod ve tür gönderilmez", () => {
    expect(servicePayload({ code: "KUR", name: "Kurşun", unit: "KG" }, true)).toEqual({
      name: "Kurşun",
      unit: "KG",
    });
  });

  it("form: ad zorunlu, STK- öneki reddedilir, birim katalogdan", () => {
    expect(serviceFormSchema.safeParse({ code: "", name: "", unit: "MT" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ code: "STK-1", name: "x", unit: "MT" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ code: "", name: "x", unit: "LT" }).success).toBe(false);
    expect(serviceFormSchema.safeParse({ code: "", name: "x", unit: "KG" }).success).toBe(true);
  });

  it("satır bağlantısı fiyat tablosunu hizmet seçili açar", () => {
    expect(servicePricesHref("a b")).toBe("/definitions/service-prices?item=a%20b");
  });
});
