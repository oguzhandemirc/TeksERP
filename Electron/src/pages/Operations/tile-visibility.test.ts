import { describe, expect, it } from "vitest";
import {
  operationsTiles,
  type OperationsVisibilityContext,
} from "./tile-config";
import { commandSections } from "@/components/layout/command-entries";
import { definitionTiles } from "@/pages/Definitions/tile-config";
import { isGoodsReceiptVisible } from "./GoodsReceipts/goodsReceipt-regime";
import {
  isKursunPlanningVisible,
  isProductBalanceVisible,
  isWorkOrdersVisible,
} from "./production-regime";
import {
  isProductRecipesVisible,
  isRoutesVisible,
  isTravelerCardVisible,
} from "@/pages/Definitions/production-regime";

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
    // Varsayılan TEK DEPO (fabrika kurulumu) — depo yüzeyleri çizilmemeli.
    depoMultiEnabled: false,
    // Varsayılan FABRİKA rejimi (muhasebe kapalı) — Cariler karosu çizilmemeli.
    financeEnabled: false,
    // Üretim modülü varsayılan AÇIK (backend default'u ile aynı yön).
    productionEnabled: true,
    // Ticaret ve iplik modülleri fabrikada KAPALI (migration'ın damgaladığı
    // değerler) — alış siparişi / stok sayımı / iplik karoları çizilmemeli.
    ticaretEnabled: false,
    // ⚠️ ETKİN değer (ticaret && iplik) — bağlamı kuran hook zinciri çözer.
    iplikEnabled: false,
    ...over,
  };
}

describe("karo bağlantıları", () => {
  const tile = (key: string) => operationsTiles.find((t) => t.key === key);

  it("Kurşun Planlama TEK karodur; kapısı KURŞUN BAYRAĞI değil ÜRETİM MODÜLÜ", () => {
    expect(tile("kursun-queue")).toBeUndefined();

    const kursun = tile("kursun-dagitim");
    expect(kursun).toBeDefined();
    expect(kursun?.title).toBe("Kurşun Planlama");
    // ⚠️ İKİ FARKLI BAYRAK — 2026-09-03'te karışmasın diye açıkça ölçülüyor.
    // Ekran hâlâ `production.kursunBypassEnabled`ten BAĞIMSIZ (o bayrak yalnız
    // ekranın İÇİNDEKİ dağıtım kontrollerini açar). Yeni kapı MODÜL anahtarı:
    // `production.enabled` — backend `kursun-bypass.routes` ikizi.
    expect(kursun?.visibleWhen).toBe(isKursunPlanningVisible);
    expect(kursun?.visibleWhen?.(ctx({ productionEnabled: false }))).toBe(false);
    expect(kursun?.visibleWhen?.(ctx({ productionEnabled: true }))).toBe(true);
    // Kaliteci (sıra) ve dağıtımcı (makine) AYNI ekranı kullanır.
    expect(kursun?.permissionAny).toEqual(["quality:write", "workorder:distribute"]);
    // Tek izinli `permission` alanı kalırsa kaliteci ekranı göremezdi.
    expect(kursun?.permission).toBeUndefined();
  });

  it("⭐ üretim karoları modül KAPALIYKEN çizilmez, AÇIKKEN çizilir (fabrika = açık)", () => {
    for (const [key, fn] of [
      ["work-orders", isWorkOrdersVisible],
      ["product-balance", isProductBalanceVisible],
      ["kursun-dagitim", isKursunPlanningVisible],
    ] as const) {
      const t = tile(key);
      // Yüklem KİMLİĞİ — palet girişi aynı nesneyi taşımak zorunda.
      expect(t?.visibleWhen, key).toBe(fn);
      expect(t?.visibleWhen?.(ctx({ productionEnabled: false })), key).toBe(false);
      // ⭐ "Sıfır görünür fark": fabrika damgasında (`productionEnabled: true`)
      // üç karo da BUGÜNKÜ gibi çizilir.
      expect(t?.visibleWhen?.(ctx()), key).toBe(true);
    }
  });

  it("Sevk Kapısı: YALNIZ sevk onayı bayrağı açıkken görünür (2026-08-22)", () => {
    const predicate = tile("sack-store")?.visibleWhen;
    expect(predicate?.(ctx({ shipmentConfirmationEnabled: true }))).toBe(true);
    // Bayrak KAPALI → gizli. Eski "VEYA çıkış bekleyen PLANNED sevkiyat varsa"
    // kuralı kalktı: storno artık kapalı rejimde sevkiyatı kapatır (çuvallar
    // depoya) ve bekleyen PLANNED sevkiyat Sevkiyatlar detayından "Sevk Et" /
    // "İptal Et" ile çözülür — bu ekrana ihtiyaç yok. Bağlama sayaç geri
    // eklenirse bu test derlenmez (ctx tipi tek alan) — bilinçli.
    expect(predicate?.(ctx())).toBe(false);

    // ⚠️ KONTROL BİÇİMİ DEĞİŞTİ, NİYETİ DEĞİL (2026-09-01, birleştirme).
    // Eskiden `Object.keys(ctx())` tek elemanlıydı ve bu, "bağlama sayaç geri
    // eklenmedi" iddiasının vekiliydi. Depo/muhasebe karoları bağlama MEŞRU
    // alanlar getirdi (`depoMultiEnabled` → Depo Transferi, `financeEnabled` →
    // Cariler/İplik) — anahtar listesini kilitlemek artık o meşru alanları da
    // yasaklar. Asıl iddia doğrudan yazılıyor: bağlamda SAYAÇ/SONDA yok ve
    // Sevk Kapısı yalnız bayrağa bakar.
    expect(Object.keys(ctx())).not.toContain("pendingPlannedShipments");
    expect(
      Object.entries(ctx()).filter(([, v]) => typeof v === "number"),
    ).toEqual([]);
    // Diğer alanlar ne olursa olsun karar DEĞİŞMEZ — yüklem saf bayraktır.
    expect(
      predicate?.(
        ctx({ depoMultiEnabled: true, financeEnabled: true, productionEnabled: false }),
      ),
    ).toBe(false);
  });

  it("⭐ Depo Transferi çoklu depo modülü KAPALIYKEN çizilmez", () => {
    const predicate = tile("warehouse-transfers")?.visibleWhen;
    expect(predicate).toBeDefined();
    // Fabrika kurulumu (modül kapalı): karo YOK — "sıfır görünür fark" kuralı.
    expect(predicate?.(ctx())).toBe(false);
    // ⚠️ 2026-09-02: kapı artık depo SAYISI değil, `depo.multiEnabled` modül
    // anahtarı — ikinci depo açmak tek başına yüzeyi getirmez (backend transfer
    // uçları da aynı anahtarla kapılı; ayrışırsa karo var / uç 403 olurdu).
    expect(predicate?.(ctx({ depoMultiEnabled: true }))).toBe(true);
  });

  it("⭐ Mal Kabul: kapı TİCARET modülü — depo sayısına hâlâ BAĞLI DEĞİL", () => {
    const tileDef = tile("goods-receipts");
    expect(tileDef).toBeDefined();
    // 2026-09-03'te düzeltilen CANLI AYRIŞMA: backend `goods-receipt.routes`
    // 2026-09-02'den beri `requireTicaretEnabled` taşıyor, karo ise kapısızdı →
    // ticaret modülü kapalı + izin verilmiş bir kurulumda kart görünür, her
    // tıklama 403. İzin kapısı KALDIRILMADI, üstüne rejim EKLENDİ.
    expect(tileDef?.visibleWhen).toBe(isGoodsReceiptVisible);
    expect(tileDef?.permission).toBe("goods-receipt:read");
    expect(tileDef?.visibleWhen?.(ctx())).toBe(false);
    expect(tileDef?.visibleWhen?.(ctx({ ticaretEnabled: true }))).toBe(true);
    // Tek depolu bir alım-satım firması da bu ekranı kullanır → çoklu depo
    // anahtarı kararı DEĞİŞTİRMEZ.
    expect(tileDef?.visibleWhen?.(ctx({ ticaretEnabled: true, depoMultiEnabled: false }))).toBe(
      true,
    );
  });

  it("koşullu karolar: sevk onayı + çoklu depo + ticaret paketi + ÜRETİM modülü", () => {
    const conditional = operationsTiles.filter((t) => t.visibleWhen).map((t) => t.key);
    // ⚠️ Bu liste AÇIKÇA sayılır ve genişletmek BİLİNÇLİ bir karardır: kümeye
    // sessizce karo eklenmesin diye kurulmuş. 2026-08-14'te iki karo eklendi
    // (Paket D, ticaret paketi); 2026-09-03'te DÖRT karo daha (P5):
    // `goods-receipts` (ticaret — canlı ayrışma düzeltmesi) ve üç üretim karosu.
    expect(conditional.sort()).toEqual([
      "goods-receipts",
      "kursun-dagitim",
      "product-balance",
      "purchase-orders",
      "sack-store",
      "stock-counts",
      "warehouse-transfers",
      "work-orders",
      "yarn-stock",
    ]);
  });

  it("⭐ ÇEKİRDEK karolar koşulsuz KALIR (kapı yayılmadı)", () => {
    // Modül bağlama turunun en kolay hatası "hepsini bir bayrağa bağla"dır.
    // Bu satır çekirdeği açıkça sayar: sipariş · envanter · sevkiyat · paketleme
    // · yeniden etiketle · muhasebe sevkiyatı · iade · kartela (anahtarı YOK).
    const unconditional = operationsTiles.filter((t) => !t.visibleWhen).map((t) => t.key).sort();
    expect(unconditional).toEqual([
      "accounting-dispatch",
      // 2026-09-06: defter onarımı — modül anahtarı YOK, sevkiyat çekirdek blokta.
      // Görünürlüğü BAYRAK değil İZİN belirler (`shipping:repair-allocation`),
      // o yüzden koşulsuz karolar listesindedir.
      "allocation-repair",
      "kartela",
      "orders",
      "relabel-station",
      "returns",
      "rolls",
      "sack-content-edit",
      "shipments",
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

  it("⭐ Tanımlar'ın üretim karoları modül KAPALIYKEN çizilmez, AÇIKKEN çizilir", () => {
    for (const [key, fn] of [
      ["routes", isRoutesVisible],
      ["product-recipes", isProductRecipesVisible],
      ["traveler-card", isTravelerCardVisible],
    ] as const) {
      expect(tile(key)?.visibleWhen, key).toBe(fn);
      expect(tile(key)?.visibleWhen?.(ctx({ productionEnabled: false })), key).toBe(false);
      expect(tile(key)?.visibleWhen?.(ctx()), key).toBe(true);
    }
    // Kartın ŞABLONU belge nesnesidir — üretimle birlikte gizlenmez.
    expect(tile("traveler-card-studio")?.visibleWhen).toBeUndefined();
  });

  it("⭐ Kalem Fiyatları TİCARET bayrağında (ön muhasebe DEĞİL)", () => {
    const predicate = tile("item-prices")?.visibleWhen;
    expect(predicate).toBeDefined();
    // 2026-09-03: backend `item-price.routes` `requireTicaretEnabled` taşıyor;
    // panel `financeEnabled`te kalmıştı → ticaret açık + muhasebe kapalı
    // kurulumda uç 200 döner, karo GİZLİ olurdu (yönü ters ayrışma).
    expect(predicate?.(ctx({ ticaretEnabled: true, financeEnabled: false }))).toBe(true);
    expect(predicate?.(ctx({ ticaretEnabled: false, financeEnabled: true }))).toBe(false);
  });

  it("palet, Tanımlar karolarının rejim yüklemini AYNI fonksiyon olarak taşıyor", () => {
    const defEntries = commandSections
      .filter((s2) => s2.heading.startsWith("Tanımlar"))
      .flatMap((s2) => s2.entries);
    for (const key of [
      "cariler",
      "customers",
      "subcontractors",
      "item-prices",
      "routes",
      "product-recipes",
      "traveler-card",
    ]) {
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

  it("kurşun girişi paletten karo ile AYNI kapıyı taşır (kurşun bayrağı DEĞİL)", () => {
    const entry = opsEntries.find((e) => e.key === "ops:kursun-dagitim");
    expect(entry).toBeDefined();
    // 2026-09-03 öncesi burada `toBeUndefined()` vardı ve doğruydu: ekranın hiç
    // kapısı yoktu. Artık ÜRETİM MODÜLÜ kapısı var; ölçülen şey palet ile karonun
    // AYNI nesneyi taşıması (kopyalanan ikinci kural bir gün ayrışır).
    expect(entry?.visibleWhen).toBe(isKursunPlanningVisible);
    // Silinen ekranın palet girişi de gitmiş olmalı.
    expect(opsEntries.find((e) => e.key === "ops:kursun-queue")).toBeUndefined();
  });
});
