// =============================================================================
// DEPO HAREKET DÖKÜMÜ — SAF KATMAN BEKÇİSİ
// =============================================================================
// Kilitlenen üç kural, üçü de "sessizce yanlış" sınıfından:
//  ① YÖN SUNUCUDAN GELİR (`row.direction`). Panel `eventType`ten türetmeye
//     kalksaydı (ENTRY=giren, SHIPMENT=çıkan…) aynı TRANSFER satırı kaynak ve
//     hedef depoda AYNI yöne basılırdı — rakam doğru, cümle yalan.
//  ② BOŞLUK UYDURULMAZ. Belgesiz hareket (KK1 girişi, Tambur, top iptali)
//     MEŞRUDUR; oraya "Elle giriş" gibi bir cümle yazmak olmayan bilgiyi iddia
//     etmektir. Aynısı karşı taraf için: ENTRY'nin kaynağı defterde YOKTUR.
//  ③ KIRPMA SESSİZ DEĞİLDİR. Döküm cursor'lu ve kısmi; altbilgi listenin bitip
//     bitmediğini SÖYLEMEK zorunda — "N kayıt" tek başına sayfanın defterin
//     tamamı olduğu izlenimini verir ve o izlenim sayım kararını değiştirir.
// =============================================================================
import { describe, expect, it } from "vitest";
import {
  WAREHOUSE_EVENT_META,
  WAREHOUSE_EVENT_TYPES,
  counterpartName,
  directionMeta,
  eventBadgeClass,
  isFiltered,
  movementActor,
  movementSource,
  pageFooterText,
  rollLabel,
  signedQty,
  type WarehouseMovementRow,
} from "./movements";

function row(over: Partial<WarehouseMovementRow> = {}): WarehouseMovementRow {
  return {
    id: "m1",
    eventType: "TRANSFER",
    direction: null,
    qty: "100",
    notes: null,
    createdAt: "2026-08-14T09:00:00.000Z",
    fromWarehouseId: "A",
    toWarehouseId: "B",
    fromWarehouse: { id: "A", code: "DP1", name: "Ana Depo" },
    toWarehouse: { id: "B", code: "DP2", name: "Şube Depo" },
    roll: { id: "r1", barcode: "TP0001", width: "150", item: { id: "i", name: "Süprem" }, color: null },
    sack: null,
    transfer: null,
    goodsReceipt: null,
    shipment: null,
    rollReturn: null,
    stockCount: null,
    user: null,
    ...over,
  };
}

describe("yön — bakan depoya göre, olay türünden DEĞİL", () => {
  it("⭐ AYNI transfer satırı bir depoda çıkan, diğerinde giren okunur", () => {
    const asSource = row({ direction: "OUT" });
    const asTarget = row({ direction: "IN" });
    expect(directionMeta(asSource.direction).label).toBe("Çıkan");
    expect(directionMeta(asTarget.direction).label).toBe("Giren");
    // Aynı olay türü, zıt işaret — `eventType`e bakan bir uygulama bunu üretemez.
    expect(asSource.eventType).toBe(asTarget.eventType);
    expect(signedQty(asSource)).toBe("−100 m");
    expect(signedQty(asTarget)).toBe("+100 m");
  });

  it("yön yoksa işaret de yok — '+' basmak uydurma olurdu", () => {
    expect(directionMeta(null).label).toBe("—");
    expect(signedQty(row({ direction: null }))).toBe("100 m");
  });

  it("metraj tr-TR biçiminde ve BİRİMLİ basılır (Decimal STRING gelse bile)", () => {
    expect(signedQty(row({ direction: "IN", qty: "12.5" }))).toBe("+12,5 m");
    expect(signedQty(row({ direction: "IN", qty: 12.5 }))).toBe("+12,5 m");
  });

  it("renk tek başına bilgi taşımaz: her yön KELİMEYLE de yazılır", () => {
    expect(directionMeta("IN").label.trim().length).toBeGreaterThan(0);
    expect(directionMeta("OUT").label.trim().length).toBeGreaterThan(0);
    expect(directionMeta("IN").label).not.toBe(directionMeta("OUT").label);
  });
});

describe("karşı taraf — depo dışına/dışından hareketlerde UYDURULMAZ", () => {
  it("giren satırda kaynak depo, çıkan satırda hedef depo gösterilir", () => {
    expect(counterpartName(row({ direction: "IN" }))).toBe("Ana Depo");
    expect(counterpartName(row({ direction: "OUT" }))).toBe("Şube Depo");
  });

  it("ENTRY'nin kaynağı ve SHIPMENT'ın hedefi defterde YOKTUR → '—'", () => {
    const entry = row({ eventType: "ENTRY", direction: "IN", fromWarehouse: null, fromWarehouseId: null });
    const ship = row({ eventType: "SHIPMENT", direction: "OUT", toWarehouse: null, toWarehouseId: null });
    expect(counterpartName(entry)).toBe("—");
    expect(counterpartName(ship)).toBe("—");
  });

  it("depo süzgeci yokken iki uç birden gösterilir (yön yok, taraf da yok)", () => {
    expect(counterpartName(row({ direction: null }))).toBe("Ana Depo → Şube Depo");
  });
});

describe("belge bağı — boşluk cümleyle doldurulmaz", () => {
  it("typed FK'ler numarasıyla basılır", () => {
    expect(movementSource(row({ transfer: { id: "t", transferNo: "TR0001" } }))).toBe("Transfer TR0001");
    expect(movementSource(row({ goodsReceipt: { id: "g", receiptNo: "MK0001" } }))).toBe("Mal kabul MK0001");
    expect(movementSource(row({ shipment: { id: "s", shipmentNo: "SVK0001" } }))).toBe("Sevk SVK0001");
    expect(movementSource(row({ rollReturn: { id: "rr" } }))).toBe("İade kaydı");
  });

  it("⭐ belgesiz hareket '—' basar — 'Elle giriş' demek olmayan bilgiyi iddia etmektir", () => {
    // KK1 ham girişi / Tambur çıkışı / top iptali hiçbir belgeye bağlı değildir.
    expect(movementSource(row({ eventType: "ENTRY" }))).toBe("—");
    expect(movementSource(row({ eventType: "CANCEL" }))).toBe("—");
  });

  it("kullanıcı: ad → kullanıcı adı → '—' (sistem yazımı)", () => {
    expect(movementActor(row({ user: { id: "u", fullName: "Eda Y.", username: "eda" } }))).toBe("Eda Y.");
    expect(movementActor(row({ user: { id: "u", fullName: "  ", username: "eda" } }))).toBe("eda");
    expect(movementActor(row())).toBe("—");
  });
});

describe("top etiketi", () => {
  it("barkod + kumaş + renk", () => {
    expect(
      rollLabel(
        row({
          roll: {
            id: "r",
            barcode: "TP9",
            width: null,
            item: { id: "i", name: "Süprem" },
            color: { id: "c", name: "Siyah" },
          },
        }),
      ),
    ).toBe("TP9 · Süprem · Siyah");
  });

  it("barkodsuz top GERÇEKTİR — hücre boş bırakılmaz ('veri kayıp' diye okunur)", () => {
    expect(
      rollLabel(
        row({
          roll: { id: "r", barcode: null, width: null, item: { id: "i", name: "Süprem" }, color: null },
        }),
      ),
    ).toBe("(barkodsuz) · Süprem");
  });
});

describe("kırpma sessiz değil", () => {
  it("⭐ devamı varken altbilgi KIRPILDIĞINI söyler", () => {
    const t = pageFooterText(50, true);
    expect(t).toContain("50 hareket");
    expect(t).toMatch(/KIRPILDI/);
  });

  it("liste bittiyse bunu da AÇIKÇA söyler (sessiz son = 'başka yok' sanısı)", () => {
    const t = pageFooterText(3, false);
    expect(t).toContain("başka hareket yok");
    expect(t).not.toMatch(/KIRPILDI/);
  });

  it("sayım kaynaklı satırın belgesi 'Sayım <no>' basar (eskiden '—' idi)", () => {
    expect(movementSource(row({ stockCount: { id: "s1", countNo: "SAY1209260001" } }))).toBe(
      "Sayım SAY1209260001",
    );
  });

  it("belgesiz satır hâlâ '—' (KK1/Tambur/iptal bir belgeden doğmaz)", () => {
    expect(
      movementSource(
        row({ transfer: null, goodsReceipt: null, shipment: null, rollReturn: null, stockCount: null }),
      ),
    ).toBe("—");
  });

  it("iki metin AYRIŞIR — aynı cümle basılsaydı ayrım hiç yapılmamış olurdu", () => {
    expect(pageFooterText(5, true)).not.toBe(pageFooterText(5, false));
  });
});

describe("sözlük bütünlüğü", () => {
  it("backend enum'unun HER değeri etiketli (eksik değer ekranda ham enum basar)", () => {
    // Körlük zemini: liste gerçekten on üç olayı taşıyor.
    expect(WAREHOUSE_EVENT_TYPES.length).toBe(13);
    for (const k of WAREHOUSE_EVENT_TYPES) {
      expect(WAREHOUSE_EVENT_META[k].label.trim().length).toBeGreaterThan(0);
      // `hint` gerçekten gerekiyor: ENTRY tek kapı değil, CANCEL iki olay taşıyor.
      expect(WAREHOUSE_EVENT_META[k].hint.trim().length).toBeGreaterThan(10);
      expect(eventBadgeClass(k).length).toBeGreaterThan(0);
    }
  });

  it("süzgeç listesi sözlükten TÜRETİLİR — elle tutulan ikinci bir kaynak yok", () => {
    // Liste elle yazılsaydı sözlükten ayrışabilirdi: süzgeçte görünen bir olayın
    // rozet haritasında karşılığı olmaz ya da tersi olur.
    expect(WAREHOUSE_EVENT_TYPES).toEqual(Object.keys(WAREHOUSE_EVENT_META));
  });

  it("ters (storno) olaylar ayrı tonda okunur", () => {
    expect(eventBadgeClass("TRANSFER_REVERSAL")).not.toBe(eventBadgeClass("TRANSFER"));
    expect(eventBadgeClass("SHIPMENT_REVERSAL")).not.toBe(eventBadgeClass("SHIPMENT"));
    expect(eventBadgeClass("CANCEL_REVERSAL")).not.toBe(eventBadgeClass("CANCEL"));
  });
});

describe("filtre durumu", () => {
  it("boş filtre 'filtreli' sayılmaz — yoksa boş listede yanlış ipucu basılır", () => {
    expect(isFiltered({ eventType: "", dateFrom: "", dateTo: "" })).toBe(false);
    expect(isFiltered({ eventType: "ENTRY", dateFrom: "", dateTo: "" })).toBe(true);
    expect(isFiltered({ eventType: "", dateFrom: "2026-08-01", dateTo: "" })).toBe(true);
    expect(isFiltered({ eventType: "", dateFrom: "", dateTo: "2026-08-31" })).toBe(true);
  });
});
