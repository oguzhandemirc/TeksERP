// =============================================================================
// MAL KABUL SATIR EDİTÖRÜ — saf katman bekçisi (Sınıf 5: iplik ayrımı)
// =============================================================================
// İki sözleşmeyi kilitler:
//
// ① **m ↔ kg TOPLANMAZ** (`receiptTotals`): iplik satırının kg'si `meters`e
//    sızarsa formun canlı özeti anlamsız bir "toplam" basar — backend
//    `ReceiptTotals` yorumunun aynası.
//
// ② **İPLİK SATIRI KUMAŞA ÖZGÜ ALANLARI HİÇ GÖNDERMEZ** (`expandLines`):
//    `colorId`/`width`/`weightKg`/`foldType`/`propertyIds` anahtarı payload'da
//    OLMAMALI — backend `addYarnLine` bunları 400 ile reddeder ve hata,
//    operatörün hiç görmediği (ekranda "—" çizilen) bir alandan gelirdi.
//
// `yarnItemIds` verilmeden çağrı ESKİ davranışla bire bir kalmalı (kumaş-only
// kurulumda bu özellik tek bayt fark üretmez).
import { describe, expect, it } from "vitest";
import { expandLines, receiptTotals, type DraftLine } from "./ReceiptLineRows";

const line = (o: Partial<DraftLine>): DraftLine => ({
  key: crypto.randomUUID(),
  itemId: "fabric-1",
  colorId: null,
  initialQty: 100,
  width: null,
  weightKg: null,
  foldType: null,
  unitPrice: null,
  propertyIds: [],
  count: 1,
  ...o,
});

const YARN = new Set(["yarn-1"]);

describe("receiptTotals — iplik ayrımı", () => {
  it("yarnItemIds verilmezse tüm satırlar kumaş sayılır (eski davranış)", () => {
    const t = receiptTotals([line({ initialQty: 100, count: 2 }), line({ itemId: "yarn-1", initialQty: 50 })]);
    expect(t).toMatchObject({ rolls: 3, meters: 250, yarnLines: 0, yarnKg: 0 });
  });

  it("iplik kg'si metreye TOPLANMAZ, ayrı sayaçlara düşer", () => {
    const t = receiptTotals(
      [
        line({ initialQty: 100, count: 2, unitPrice: 10 }), // kumaş: 200 m, 2 top, 2000 para
        line({ itemId: "yarn-1", initialQty: 50, count: 3, unitPrice: 4 }), // iplik: 150 kg, 3 satır, 600 para
      ],
      YARN,
    );
    expect(t.rolls).toBe(2);
    expect(t.meters).toBe(200); // ⚠️ 350 DEĞİL — kg metreye sızmadı
    expect(t.yarnLines).toBe(3);
    expect(t.yarnKg).toBe(150);
    // Para tek birimde (fişin para birimi) — kumaş + iplik BİRLİKTE meşru.
    expect(t.amount).toBe(2600);
  });

  it("yalnız-iplik fişte top sayacı 0, iplik sayaçları dolu (form bunu geçerli sayar)", () => {
    const t = receiptTotals([line({ itemId: "yarn-1", initialQty: 500 })], YARN);
    expect(t).toMatchObject({ rolls: 0, meters: 0, yarnLines: 1, yarnKg: 500 });
  });
});

describe("expandLines — iplik payload sözleşmesi", () => {
  it("iplik satırı kumaşa özgü ANAHTARLARI hiç taşımaz (400 kümesinin aynası)", () => {
    const [p] = expandLines(
      // Bayat değerler bilerek dolu — temizleme effect'i atlanmış olsa bile
      // payload katmanı sızdırmamalı (ikinci hat).
      [line({ itemId: "yarn-1", initialQty: 50, unitPrice: 4, colorId: "c1", width: 250, weightKg: 9, foldType: "4-KAT", propertyIds: ["p1"] })],
      YARN,
    );
    expect(p).toBeDefined();
    expect(p).toMatchObject({ itemId: "yarn-1", initialQty: 50, unitPrice: 4 });
    for (const k of ["colorId", "width", "weightKg", "foldType", "propertyIds"]) {
      expect(p && k in p, `iplik payload'ında "${k}" anahtarı OLMAMALI`).toBe(false);
    }
  });

  // Devere Faz 2 (lot). ⭐ NEGATİF SONDA: yarn dalından `lotNo`/`bobbinCount` düşünce ① ❌ · TRIM kaldırılınca ② ❌ ·
  //    kumaş dalına `lotNo` eklenince ③ ❌.
  it("① iplik satırı lot + bobin taşır (irsaliye metni), kumaş satırı TAŞIMAZ", () => {
    const [p] = expandLines([line({ itemId: "yarn-1", initialQty: 50, lotNo: "YAN 1029-K", bobbinCount: 12 })], YARN);
    expect(p).toMatchObject({ itemId: "yarn-1", lotNo: "YAN 1029-K", bobbinCount: 12 });
    const [k] = expandLines([line({ itemId: "fabric-1", initialQty: 50, lotNo: "X", bobbinCount: 3 })], YARN);
    expect(k && "lotNo" in k).toBe(false);
    expect(k && "bobbinCount" in k).toBe(false);
  });
  it("② lot boş/boşluk → null (sunucu da null sayar), çevresi TRIM, içi AYNEN (normalize yok)", () => {
    const [a] = expandLines([line({ itemId: "yarn-1", initialQty: 1, lotNo: "   " })], YARN);
    expect(a).toMatchObject({ lotNo: null, bobbinCount: null });
    const [b] = expandLines([line({ itemId: "yarn-1", initialQty: 1, lotNo: "  yan 1029-k " })], YARN);
    expect(b).toMatchObject({ lotNo: "yan 1029-k" });
  });

  it("kumaş satırı eski şekliyle açılır ve adet kadar payload doğar", () => {
    const out = expandLines([line({ colorId: "c1", width: 250, count: 3, propertyIds: ["p1"] })], YARN);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ itemId: "fabric-1", colorId: "c1", width: 250, propertyIds: ["p1"] });
    // Her top KENDİ idempotency anahtarını taşır.
    expect(new Set(out.map((x) => x.clientToken)).size).toBe(3);
  });

  it("iplikte adet = N ayrı defter satırı (toplam kg doğru)", () => {
    const out = expandLines([line({ itemId: "yarn-1", initialQty: 50, count: 4 })], YARN);
    expect(out).toHaveLength(4);
    expect(out.every((x) => x.initialQty === 50)).toBe(true);
    expect(new Set(out.map((x) => x.clientToken)).size).toBe(4);
  });

  it("itemId'siz / miktarsız / adetsiz satırlar açılmaz (mevcut süzgeç iplikte de geçerli)", () => {
    const out = expandLines(
      [line({ itemId: "" }), line({ itemId: "yarn-1", initialQty: 0 }), line({ itemId: "yarn-1", count: 0 })],
      YARN,
    );
    expect(out).toHaveLength(0);
  });
});

// EK 5 (2026-09-17): top sınıfı SATIR BAZLI — `rawStock` yalnız satırda seçildiyse gövdeye gider; iplikte HİÇ gitmez;
// `lineKind` doğduğu grubu okur, ürün türü çözülünce ürün türü kazanır.
describe("expandLines / lineKind — top sınıfı satır bazlı (EK 5)", () => {
  it("rawStock null → anahtar gövdede YOK (fiş varsayılanı); true/false → aynen", () => {
    const out = expandLines([line({ rawStock: null }), line({ rawStock: true }), line({ rawStock: false })]);
    expect("rawStock" in out[0]!).toBe(false);
    expect(out[1]).toMatchObject({ rawStock: true });
    expect(out[2]).toMatchObject({ rawStock: false });
  });

  it("iplik satırı rawStock taşımaz — satırda true olsa bile", () => {
    const out = expandLines([line({ itemId: "yarn-1", rawStock: true })], YARN);
    expect(Object.keys(out[0]!)).not.toContain("rawStock");
  });

  it("lineKind: ürün türü > doğduğu grup > kumaş", async () => {
    const { lineKind } = await import("./receiptLineTypes");
    expect(lineKind(line({ itemId: "yarn-1", kind: "FABRIC" }), YARN)).toBe("YARN");
    expect(lineKind(line({ itemId: "", kind: "YARN" }), YARN)).toBe("YARN");
    expect(lineKind(line({ itemId: "fabric-1", kind: "YARN" }), YARN)).toBe("YARN"); // tür bilinmiyor → grup kazanır
    expect(lineKind(line({ itemId: "fabric-1" }))).toBe("FABRIC");
    expect(receiptTotals([line({ itemId: "", kind: "YARN", initialQty: 5, count: 2 }), line({ kind: "YARN", initialQty: 5, count: 2 })]).yarnKg).toBe(10);
  });
});
