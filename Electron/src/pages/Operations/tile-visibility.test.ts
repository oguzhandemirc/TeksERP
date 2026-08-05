import { describe, expect, it } from "vitest";
import {
  operationsTiles,
  type OperationsVisibilityContext,
} from "./tile-config";
import { commandSections } from "@/components/layout/command-entries";

/**
 * Karo görünürlüğünün doğruluk tablosu.
 *
 * 2026-08-05: iki kurşun karosunun (Kurşun Sırası / Kurşun Dağıtım) bayrak +
 * sayaç bazlı görünürlük kuralları KALDIRILDI — ekranlar tek "Kurşun Planlama"
 * karosunda birleşti ve o karo `production.kursunBypassEnabled`'dan BAĞIMSIZ.
 * Bayrak yalnız ekranın İÇİNDEKİ dağıtım kontrollerini açıp kapatıyor.
 *
 * Bu dosya artık iki şeyi kilitler: (1) koşullu karo kümesi beklenenden BÜYÜMESİN
 * (yeni bir bayrak bağımlılığı sessizce girmesin), (2) komut paleti karolarla
 * birebir aynı kapıyı uygulasın.
 */

function ctx(
  over: Partial<OperationsVisibilityContext> = {},
): OperationsVisibilityContext {
  return { shipmentConfirmationEnabled: false, pendingPlannedShipments: 0, ...over };
}

describe("karo bağlantıları", () => {
  const tile = (key: string) => operationsTiles.find((t) => t.key === key);

  it("Kurşun Planlama TEK karodur ve koşulsuzdur (bayraktan bağımsız)", () => {
    expect(tile("kursun-queue")).toBeUndefined();

    const kursun = tile("kursun-dagitim");
    expect(kursun).toBeDefined();
    expect(kursun?.title).toBe("Kurşun Planlama");
    expect(kursun?.visibleWhen).toBeUndefined();
    // Kaliteci (sıra) ve dağıtımcı (makine) AYNI ekranı kullanır.
    expect(kursun?.permissionAny).toEqual(["quality:write", "workorder:distribute"]);
    // Tek izinli `permission` alanı kalırsa kaliteci ekranı göremezdi.
    expect(kursun?.permission).toBeUndefined();
  });

  it("Sevk Kapısı: bayrak açık VEYA çıkış bekleyen sevkiyat varsa görünür", () => {
    const predicate = tile("sack-store")?.visibleWhen;
    expect(predicate?.(ctx({ shipmentConfirmationEnabled: true }))).toBe(true);
    expect(predicate?.(ctx())).toBe(false);
    // Bayrak KAPALI ama onay açıkken kurulmuş PLANNED sevkiyat kaldıysa: çıkış
    // onayı yalnız bu ekrandan yapılır → karo gizlenirse mal kapıda kalır.
    expect(predicate?.(ctx({ pendingPlannedShipments: 1 }))).toBe(true);
    expect(predicate?.(ctx({ shipmentConfirmationEnabled: true, pendingPlannedShipments: 3 }))).toBe(true);
  });

  it("koşullu karo YALNIZ Sevk Kapısı (kurşun karoları koşulsuzlaştı)", () => {
    const conditional = operationsTiles.filter((t) => t.visibleWhen).map((t) => t.key);
    expect(conditional.sort()).toEqual(["sack-store"]);
  });
});

/**
 * ÜÇÜNCÜ GİRİŞ KAPISI: komut paleti. Hub karosu gizlenirken palet girişi kalırsa
 * kural çelişir — "Kurşun Sırası"nda bu somut bir hataydı: route kapısı da aynı
 * koşulu uyguladığı için paletten seçen kullanıcı sayfa yerine hub'a atılıyordu.
 * Bağ AYNI fonksiyon nesnesi üzerinden kurulur (kopyalanmış ikinci bir kural,
 * ilkinden zamanla ayrışırdı).
 */
describe("komut paleti — karo yüklemi taşınıyor", () => {
  const opsEntries =
    commandSections.find((s) => s.heading === "Operasyon")?.entries ?? [];

  it("Operasyon bölümü karolarla aynı sayıda giriş üretir", () => {
    expect(opsEntries).toHaveLength(operationsTiles.length);
  });

  it("her operasyon girişi karosunun yüklemini AYNEN taşır", () => {
    for (const tile of operationsTiles) {
      const entry = opsEntries.find((e) => e.key === `ops:${tile.key}`);
      expect(entry, `ops:${tile.key} palet girişi yok`).toBeDefined();
      expect(entry?.visibleWhen).toBe(tile.visibleWhen);
    }
  });

  it("kurşun girişi paletten GİZLENMEZ (bayrak ne olursa olsun)", () => {
    const entry = opsEntries.find((e) => e.key === "ops:kursun-dagitim");
    expect(entry).toBeDefined();
    expect(entry?.visibleWhen).toBeUndefined();
    // Silinen ekranın palet girişi de gitmiş olmalı.
    expect(opsEntries.find((e) => e.key === "ops:kursun-queue")).toBeUndefined();
  });
});
