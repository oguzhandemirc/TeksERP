import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NumberingTable } from "./NumberingTable";
import type { NumberSeriesRow } from "./types";

// =============================================================================
// BEKÇİ — SAYAÇ AYARLARININ ÇIKIŞ YÜZEYİ VAR MI? (2026-09-23)
// =============================================================================
// ⭐ NEDEN VAR: bu ekran "Düzenle" düğmesini YALNIZ `row.editable`a bakarak
//    açıyordu ve o bayrak BİÇİM kilidini anlatır. Sayaç ayarları AYRI bir kilide
//    tabi ve biçimi kilitli 46 seride AÇIK ⇒ düğme kapalı kalsaydı motoru ve
//    izni olan ama HİÇBİR YÜZEYDEN ulaşılamayan bir yetenek doğardı. Bu depoda
//    adı konmuş kural: bir yetenek "VAR" sayılmak için motor + çıkış yüzeyi +
//    izin, ÜÇÜ birden.
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-23): `disabled`ı `!row.editable`a geri
//    çevirince ilk iddia KIRMIZI; geri alınca yeşil.
// =============================================================================

function seriesRow(over: Partial<NumberSeriesRow> = {}): NumberSeriesRow {
  return {
    key: "workOrder",
    label: "İş emri no",
    prefix: "IE",
    dateSegment: "DDMMYY",
    digits: 4,
    separator: "",
    retiredPrefixes: [],
    editable: false,
    lockedReason: "Kart no = iş emri no.",
    lockKind: "YAPISAL",
    panelGroup: "uretim",
    panelGroupLabel: "Üretim",
    counter: { startValue: true, step: true, maxValue: true, reset: false, resetReason: "Sayaç geriye alınamaz." },
    startValue: null,
    step: null,
    maxValue: null,
    preview: "IE2309230001",
    ...over,
  };
}

describe("Numaralandırma tablosu — sayaç ayarlarının çıkış yüzeyi", () => {
  it("⭐ biçimi KİLİTLİ ama sayacı AÇIK seride Düzenle düğmesi açıktır", () => {
    render(<NumberingTable rows={[seriesRow()]} onEdit={() => {}} />);
    expect(screen.getByRole("button", { name: "Düzenle" })).not.toBeDisabled();
  });

  it("⭐ ikisi de kapalıysa düğme kapalıdır (kapı fazla geniş değil)", () => {
    render(
      <NumberingTable
        rows={[
          seriesRow({
            key: "roll",
            counter: {
              startValue: false, step: false, maxValue: false, reset: false,
              lockedReason: "Kendi sayaç tablosu var.", resetReason: "Sayaç geriye alınamaz.",
            },
          }),
        ]}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Düzenle" })).toBeDisabled();
  });

  it("biçimi AÇIK seride düğme zaten açıktır (eski davranış korunur)", () => {
    render(<NumberingTable rows={[seriesRow({ key: "packingLotCode", editable: true, lockKind: undefined })]} onEdit={() => {}} />);
    expect(screen.getByRole("button", { name: "Düzenle" })).not.toBeDisabled();
  });
});
