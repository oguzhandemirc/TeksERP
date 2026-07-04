import { describe, expect, it } from "vitest";
import {
  defaultRange,
  errorSummary,
  eventLabel,
  metadataSummary,
  noteLabel,
  quantitySummary,
  rollLabel,
  rollSubLabel,
  summaryLine,
} from "./activity-utils";
import type { ActivityRoll, SessionActivitySummary } from "./types";

describe("eventLabel", () => {
  it("giriş/çıkış/hata/iptal olaylarını Türkçe etiketler", () => {
    expect(eventLabel({ kind: "MOVE_IN" })).toBe("İstasyona giriş");
    expect(eventLabel({ kind: "MOVE_OUT" })).toBe("İstasyondan çıkış");
    expect(eventLabel({ kind: "ERROR" })).toBe("Hata girildi");
    expect(eventLabel({ kind: "ROLL_CANCELLED" })).toBe("İptal edildi");
  });

  it("top girişini (ROLL_CREATED) kaynağa göre etiketler", () => {
    expect(eventLabel({ kind: "ROLL_CREATED", entrySource: "SUPPLIER_RECEIPT" })).toBe("Kumaş girişi");
    expect(eventLabel({ kind: "ROLL_CREATED", entrySource: "TAMBUR_SPLIT" })).toBe("Top ayrıldı (tambur)");
    expect(eventLabel({ kind: "ROLL_CREATED", entrySource: "SUBCONTRACTOR_RETURN" })).toBe("Fason dönüş topu");
    expect(eventLabel({ kind: "ROLL_CREATED" })).toBe("Top girişi");
  });

  it("bilinen op türlerini çevirir", () => {
    expect(eventLabel({ kind: "OPERATION", operationType: "QC2_COMPLETED" })).toBe("KK2 tamamlandı");
    expect(eventLabel({ kind: "OPERATION", operationType: "KURSUN_APPLIED" })).toBe("Kurşun uygulandı");
    expect(eventLabel({ kind: "OPERATION", operationType: "TAMBUR_PROCESSED" })).toBe("Tambur işlendi");
    expect(eventLabel({ kind: "OPERATION", operationType: "SUBCONTRACTOR_SENT" })).toBe("Fasona sevk");
    expect(eventLabel({ kind: "OPERATION", operationType: "SUBCONTRACTOR_RETURNED" })).toBe("Fasondan dönüş");
  });

  it("bilinmeyen op türünde ham türe düşer, tür yoksa genel etiket", () => {
    expect(eventLabel({ kind: "OPERATION", operationType: "YENI_TUR" })).toBe("YENI_TUR");
    expect(eventLabel({ kind: "OPERATION" })).toBe("İşlem");
  });
});

describe("metadataSummary", () => {
  it("QC2 metadata'sını özetler (tr-TR ondalık)", () => {
    expect(metadataSummary({ totalMeters: 120.5, errorCount: 3 })).toBe("120,5 m · 3 hata");
  });

  it("tambur metadata'sını özetler", () => {
    expect(metadataSummary({ foldType: "4-KAT", childRollCount: 3, cutCount: 2 })).toBe(
      "4-KAT · 3 top · 2 kesim",
    );
  });

  it("notu da ekler; sıfır hata gösterilmez, boş/bilinmeyen metadata boş döner", () => {
    expect(metadataSummary({ totalMeters: 80, errorCount: 0, notes: "temiz" })).toBe("80 m · temiz");
    expect(metadataSummary({ bilinmeyen: "x" })).toBe("");
    expect(metadataSummary(null)).toBe("");
    expect(metadataSummary(undefined)).toBe("");
  });
});

describe("quantitySummary", () => {
  it("metraj + kilo birlikte", () => {
    expect(quantitySummary({ qty: 95, weight: 12.3 })).toBe("95 m · 12,3 kg");
  });
  it("yalnız metraj / hiçbiri", () => {
    expect(quantitySummary({ qty: 100, weight: null })).toBe("100 m");
    expect(quantitySummary({ qty: null, weight: null })).toBe("");
  });
});

describe("errorSummary", () => {
  it("metre noktası + hata türü", () => {
    expect(errorSummary({ errorMeter: 50, errorType: "Delik" })).toBe("50. m · Delik");
  });
  it("yalnız metre / yalnız tür / hiçbiri", () => {
    expect(errorSummary({ errorMeter: 50.5, errorType: null })).toBe("50,5. m");
    expect(errorSummary({ errorMeter: null, errorType: "Leke" })).toBe("Leke");
    expect(errorSummary({ errorMeter: null, errorType: null })).toBe("");
  });
});

describe("noteLabel", () => {
  it("bilinen kapanış işaretçilerini rozet etiketine çevirir", () => {
    expect(noteLabel("CANCELLED")).toEqual({ label: "İptal", known: true });
    expect(noteLabel("TAMBUR_CONSUMED")).toEqual({ label: "Tambur kesimi", known: true });
    expect(noteLabel("REDYE_REWIND")).toEqual({ label: "Redye geri sarma", known: true });
    expect(noteLabel("QC2_STEP_FINISHED")).toEqual({ label: "KK2 bitişi", known: true });
  });
  it("serbest metin notu known=false ile aynen döner, boş → null", () => {
    expect(noteLabel("operatör notu")).toEqual({ label: "operatör notu", known: false });
    expect(noteLabel(null)).toBeNull();
    expect(noteLabel(undefined)).toBeNull();
    expect(noteLabel("")).toBeNull();
  });
});

describe("rollLabel / rollSubLabel", () => {
  const mk = (o: Partial<ActivityRoll>): ActivityRoll => ({
    id: "x", barcode: null, itemName: null, colorName: null, ...o,
  });
  it("kumaş adı + renk; barkod alt-etikete düşer", () => {
    const r = mk({ itemName: "PATOS", colorName: "Mavi", barcode: "TEKS123" });
    expect(rollLabel(r)).toBe("PATOS (Mavi)");
    expect(rollSubLabel(r)).toBe("TEKS123");
  });
  it("renksiz kumaş adı; barkod yoksa alt-etiket boş", () => {
    expect(rollLabel(mk({ itemName: "PATOS", barcode: "TEKS9" }))).toBe("PATOS");
    expect(rollSubLabel(mk({ itemName: "PATOS", barcode: null }))).toBe("");
  });
  it("ad yoksa barkoda, o da yoksa 'açık kumaş'a düşer; alt-etiket boş", () => {
    expect(rollLabel(mk({ barcode: "TEKS7" }))).toBe("TEKS7");
    expect(rollLabel(mk({}))).toBe("açık kumaş");
    expect(rollSubLabel(mk({ barcode: "TEKS7" }))).toBe("");
  });
});

describe("summaryLine", () => {
  const base: SessionActivitySummary = {
    rollCreatedCount: 0, moveInCount: 0, errorCount: 0, operationCount: 0, moveOutCount: 0,
    rollCancelledCount: 0,
  };
  it("yalnız sıfır-olmayan sayaçları gösterir (KK1: giriş + iptal)", () => {
    expect(summaryLine({ ...base, rollCreatedCount: 3, rollCancelledCount: 1 })).toBe(
      "3 kumaş girişi · 1 iptal",
    );
  });
  it("KK2 tipi oturum — çok segment sıralı", () => {
    expect(summaryLine({ ...base, errorCount: 2, operationCount: 4, moveOutCount: 4 })).toBe(
      "2 hata · 4 işlem · 4 istasyon çıkışı",
    );
  });
  it("hepsi sıfır → boş", () => {
    expect(summaryLine(base)).toBe("");
  });
});

describe("defaultRange", () => {
  it("son 7 gün (bugün dahil) — sabit now ile deterministik", () => {
    const now = new Date(2026, 6, 3, 15, 30);
    expect(defaultRange(7, now)).toEqual({ from: "2026-06-27", to: "2026-07-03" });
  });
  it("1 gün = yalnız bugün", () => {
    const now = new Date(2026, 0, 5);
    expect(defaultRange(1, now)).toEqual({ from: "2026-01-05", to: "2026-01-05" });
  });
});
