import { describe, expect, it } from "vitest";
import {
  operationsTiles,
  type OperationsVisibilityContext,
} from "./tile-config";
import { commandSections } from "@/components/layout/command-entries";
import { definitionTiles } from "@/pages/Definitions/tile-config";

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
  return {
    shipmentConfirmationEnabled: false,
    pendingPlannedShipments: 0,
    // Varsayılan TEK DEPO (fabrika kurulumu) — depo yüzeyleri çizilmemeli.
    multiWarehouse: false,
    // Varsayılan FABRİKA rejimi (muhasebe kapalı) — Cariler karosu çizilmemeli.
    financeEnabled: false,
    ...over,
  };
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

  it("⭐ Depo Transferi TEK depoda çizilmez, ikinci depo açılınca belirir", () => {
    const predicate = tile("warehouse-transfers")?.visibleWhen;
    expect(predicate).toBeDefined();
    // Fabrika kurulumu (tek depo): karo YOK — "sıfır görünür fark" kuralı.
    expect(predicate?.(ctx())).toBe(false);
    // İkinci depo açıldığı an kendiliğinden görünür.
    expect(predicate?.(ctx({ multiWarehouse: true }))).toBe(true);
  });

  it("Mal Kabul karosu depo sayısına BAĞLI DEĞİL (kapısı izindir)", () => {
    const tileDef = tile("goods-receipts");
    expect(tileDef).toBeDefined();
    // Tek depolu bir alım-satım firması da bu ekranı kullanır → koşul konmaz;
    // fabrikada görünmemesini sağlayan şey `goods-receipt:read` izninin hiçbir
    // varsayılan rol şablonunda OLMAMASIDIR.
    expect(tileDef?.visibleWhen).toBeUndefined();
    expect(tileDef?.permission).toBe("goods-receipt:read");
  });

  it("koşullu karolar: Sevk Kapısı + Depo Transferi + Paket D (iplik · alış siparişi)", () => {
    const conditional = operationsTiles.filter((t) => t.visibleWhen).map((t) => t.key);
    // ⚠️ Bu liste AÇIKÇA sayılır ve genişletmek BİLİNÇLİ bir karardır: kümeye
    // sessizce karo eklenmesin diye kurulmuş. 2026-08-14'te iki karo eklendi
    // (Paket D, `finance.enabled` rejimine bağlı).
    expect(conditional.sort()).toEqual([
      "purchase-orders",
      "sack-store",
      "stock-counts",
      "warehouse-transfers",
      "yarn-stock",
    ]);
  });
});

/**
 * ÜÇÜNCÜ GİRİŞ KAPISI: komut paleti. Hub karosu gizlenirken palet girişi kalırsa
 * kural çelişir — "Kurşun Sırası"nda bu somut bir hataydı: route kapısı da aynı
 * koşulu uyguladığı için paletten seçen kullanıcı sayfa yerine hub'a atılıyordu.
 * Bağ AYNI fonksiyon nesnesi üzerinden kurulur (kopyalanmış ikinci bir kural,
 * ilkinden zamanla ayrışırdı).
 */
/**
 * CARİ REJİMİ (2026-08-14): Tanımlar'da bayrak AÇIKKEN tek "Cariler",
 * KAPALIYKEN (fabrika) Müşteriler + Fason Firmalar. Üç örtüşen liste
 * karışıklığının kilidi: rejim kuralı düşerse ya fabrika menüsü değişir
 * (sıfır-fark ihlali) ya ticarette üç liste geri gelir.
 */
describe("Tanımlar — cari rejimi", () => {
  const tile = (key: string) => definitionTiles.find((t) => t.key === key);

  it("fabrika rejimi (bayrak kapalı): Müşteriler + Fason görünür, Cariler görünmez", () => {
    const c = ctx();
    expect(tile("cariler")?.visibleWhen?.(c)).toBe(false);
    expect(tile("customers")?.visibleWhen?.(c)).toBe(true);
    expect(tile("subcontractors")?.visibleWhen?.(c)).toBe(true);
  });

  it("ticaret rejimi (bayrak açık): yalnız Cariler görünür", () => {
    const c = ctx({ financeEnabled: true });
    expect(tile("cariler")?.visibleWhen?.(c)).toBe(true);
    expect(tile("customers")?.visibleWhen?.(c)).toBe(false);
    expect(tile("subcontractors")?.visibleWhen?.(c)).toBe(false);
  });

  it("palet, Tanımlar karolarının rejim yüklemini AYNI fonksiyon olarak taşıyor", () => {
    const defEntries = commandSections
      .filter((s2) => s2.heading.startsWith("Tanımlar"))
      .flatMap((s2) => s2.entries);
    for (const key of ["cariler", "customers", "subcontractors"]) {
      const t = tile(key);
      const entry = defEntries.find((e) => e.to === t?.to);
      expect(entry?.visibleWhen, `palet girişi yüklem taşımıyor: ${key}`).toBe(t?.visibleWhen);
    }
  });
});

describe("komut paleti — karo yüklemi taşınıyor", () => {
  const opsEntries =
    commandSections.find((s) => s.heading === "Operasyon")?.entries ?? [];

  it("her karo için bir giriş üretilir (karo sessizce düşmez)", () => {
    const entryKeys = new Set(opsEntries.map((e) => e.key));
    const missing = operationsTiles
      .map((t) => `ops:${t.key}`)
      .filter((k) => !entryKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("karo dışı girişler AÇIKÇA listelidir", () => {
    // Bölüm hub karolarından türer; karosu olmayan bir giriş eklemek bilinçli
    // bir karardır (hub'da görünmeyen ama paletten açılan ekran) — sessizce
    // birikmesin diye burada tek tek yazılır.
    const extra = opsEntries
      .filter((e) => !operationsTiles.some((t) => `ops:${t.key}` === e.key))
      .map((e) => e.key);
    expect(extra).toEqual(["ops:work-order-new"]);
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
