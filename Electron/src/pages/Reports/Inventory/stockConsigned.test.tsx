// Stok & Ölü Stok emanet satırı (genel fason P1): emanet açıkken (summary.consigned / consignedTotals) ekranda satır,
// dosyada tablo + not; kapalıyken çıktı bugünküyle aynı (ek tablo/not YOK).
// Negatif sonda (2026-11-08): `buildStockExport`ta emanet tablosu koşulsuz eklenince §1 kırmızı.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildStockExport, CONSIGNED_EXPORT_NOTE, type StockScorecard } from "./stockScorecard";
import { buildStockKalemExport, consignedKalemText, type StockKalem } from "./stockKalem";
import { ConsignedStockRow } from "./ConsignedStockRow";

const sc = (consigned?: StockScorecard["summary"]["consigned"]): StockScorecard => ({
  summary: {
    finishedQty: 100, finishedCount: 2, rawQty: 50, rawCount: 1, semiQty: 0, semiCount: 0, agedQty: 0, deadQty: 0,
    deadStockDays: 90, unagedCount: 0, unagedQty: 0, ...(consigned ? { consigned } : {}),
  },
  byAge: [], byItem: [], oldest: [],
});
const consigned = { finishedQty: 40, finishedCount: 1, rawQty: 300.5, rawCount: 3, semiQty: 20, semiCount: 1 };

describe("Stok & Ölü Stok — emanet", () => {
  it("§1 emanet kapalı: tablo ve not yok (bugünkü çıktı)", () => {
    const spec = buildStockExport(sc());
    expect(spec.tables.map((t) => t.name)).toEqual(["Yaş Dağılımı", "Kumaş Bazında", "En Eski Toplar"]);
    expect(spec.meta).not.toContain(CONSIGNED_EXPORT_NOTE);
  });
  it("§2 emanet açık: ayrı tablo, toplam satırı, not", () => {
    const spec = buildStockExport(sc(consigned));
    const t = spec.tables.find((x) => x.name === "Emanet (Müşteri Malı)");
    expect(t?.rows).toEqual([
      { label: "Bitmiş depo", count: 1, qty: 40 },
      { label: "Ham stok", count: 3, qty: 300.5 },
      { label: "Yarı mamul", count: 1, qty: 20 },
    ]);
    expect(t?.totalRow).toMatchObject({ count: 5, qty: 360.5 });
    expect(spec.meta).toContain(CONSIGNED_EXPORT_NOTE);
  });
  it("§3 ekran satırı aynı üç kalemi basar", () => {
    render(<ConsignedStockRow consigned={consigned} />);
    const txt = screen.getByTestId("stock-consigned-row").textContent ?? "";
    expect(txt).toMatch(/Bitmiş depo: 40 m \(1 top\)/);
    expect(txt).toMatch(/Ham stok: 300,5 m \(3 top\)/);
  });
  it("§4 kalem: emanet cümlesi dosyada yalnız açıkken", () => {
    const k: StockKalem = { totals: { hamCount: 1, hamQty: 5, bitmisCount: 0, bitmisQty: 0 }, ham: [], bitmis: [] };
    const off = buildStockKalemExport(k);
    const on = buildStockKalemExport({ ...k, consignedTotals: { hamCount: 2, hamQty: 12, bitmisCount: 1, bitmisQty: 3 } });
    const text = consignedKalemText({ hamCount: 2, hamQty: 12, bitmisCount: 1, bitmisQty: 3 });
    expect(off.meta).not.toContain(text);
    expect(on.meta).toContain(text);
  });
});
