import { beforeEach, describe, expect, it } from "vitest";
import { clearRouteMemory, recallRoute, rememberRoute } from "./route-memory";

describe("route-memory", () => {
  beforeEach(() => clearRouteMemory());

  it("filtreli görünümü hatırlar", () => {
    rememberRoute("/operations/work-orders", "?filter[status]=IN_PROGRESS");
    expect(recallRoute("/operations/work-orders")).toBe(
      "/operations/work-orders?filter[status]=IN_PROGRESS",
    );
  });

  it("hatırlanmayan yol için null döner", () => {
    expect(recallRoute("/operations/orders")).toBeNull();
  });

  // Kural load-bearing: kullanıcı filtreleri TEMİZLEDİĞİNDE de bir konum
  // değişimi olur ve sorgu boşalır. Eski görünümü saklamaya devam etseydik
  // temizleme kararı bir sonraki gelişte sessizce geri alınırdı.
  it("sorgusuz ziyaret hafızayı SİLER (filtre temizleme kararı korunur)", () => {
    rememberRoute("/operations/work-orders", "?search=patos");
    rememberRoute("/operations/work-orders", "");
    expect(recallRoute("/operations/work-orders")).toBeNull();
  });

  it("kök yol hatırlanmaz", () => {
    rememberRoute("/", "?x=1");
    expect(recallRoute("/")).toBeNull();
  });

  it("aynı yol yeniden ziyaret edilince en son görünüm kalır", () => {
    rememberRoute("/operations/rolls", "?tab=RAW_STOCK");
    rememberRoute("/operations/rolls", "?tab=WAREHOUSE");
    expect(recallRoute("/operations/rolls")).toBe("/operations/rolls?tab=WAREHOUSE");
  });
});
