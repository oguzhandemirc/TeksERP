// =============================================================================
// BEKÇİ — SABİT BİÇİMLİ (GİB e-İrsaliye) SATIR (E2-SERI, 2026-10-24)
// =============================================================================
// Sunucu satırı kısmi YAPISAL döner (dört eksen kilitli, ön ek açık) ve sayaçta
// yalnız başlangıcı açar (yıla bağlı; ilk numaradan sonra sunucu 409 verir).
// Alanlar GİZLENMEZ, PASİFLEŞİR; cümleler sunucudan, panel yalnız çizer.
//
// ⭐ NEGATİF SONDA (ölçüldü, bu commit): `NumberingCounterFields`te adım alanının
//    `disabled={!row.counter.step}` bağı kaldırılınca §2 KIRMIZI; geri alınca yeşil.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NumberingFormDialog } from "./NumberingFormDialog";
import { numberingService } from "./service";
import type { NumberSeriesRow } from "./types";

vi.mock("./service", () => ({
  numberingService: {
    preview: vi.fn(),
    saveChanges: vi.fn(),
  },
}));

const KILIT = "GİB e-İrsaliye numarası 3 karakter seri + yıl + 9 hane. Tarih, hane ve ayraç değiştirilemez.";
const SAYAC_KILIT = "Sıra boşluksuz ilerler; artış adımı, üst sınır ve başa dönme ayarları bu seride kapalı.";
const BAS_NOTU = "Başlangıç değeri yalnız içinde bulunulan yıl için ayarlanabilir; ilk numara üretilince kilitlenir.";

function eIrsaliyeRow(): NumberSeriesRow {
  return {
    key: "eIrsaliye",
    label: "e-İrsaliye no",
    prefix: "EIR",
    dateSegment: "YYYY",
    digits: 9,
    separator: "",
    separator2: null,
    retiredPrefixes: [],
    editable: true,
    lockedReason: KILIT,
    lockUnlock: "Bu kilit kalkmayacak.",
    lockActor: "kimse",
    lockKind: "YAPISAL",
    lockedAxes: ["dateSegment", "digits", "separator", "separator2"],
    panelGroup: "sevkiyat",
    panelGroupLabel: "Sevkiyat",
    counter: {
      startValue: true, step: false, maxValue: false, reset: false,
      lockedReason: SAYAC_KILIT, startValueNote: BAS_NOTU, resetReason: "Sayaç geriye alınamaz.",
    },
    source: { editable: false, value: "FREE" },
    startValue: null,
    step: null,
    maxValue: 999_999_999,
    wrap: false,
    preview: "EIR2026000000001",
  };
}

const ciz = () =>
  render(
    <NumberingFormDialog
      row={eIrsaliyeRow()}
      etkiSayisi={null}
      birim="belge"
      exhaustion={null}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );

describe("Numaralandırma diyaloğu — sabit biçimli (GİB) seri", () => {
  beforeEach(() => {
    vi.mocked(numberingService.preview).mockReset();
    vi.mocked(numberingService.preview).mockResolvedValue({
      preview: "EIR2026000000001", next: "EIR2026000000001", warnings: [],
    });
  });

  it("⭐ §1 yalnız ön ek açık; tarih/hane/ayraçlar pasif ama görünür, kilit cümlesi sunucudan", () => {
    ciz();
    expect(screen.getByLabelText("Ön ek")).not.toBeDisabled();
    expect(screen.getByLabelText("Hane")).toBeDisabled();
    expect(screen.getByLabelText("Tarih")).toBeDisabled();
    expect(screen.getByLabelText("Ayraç (ön ek ile tarih arası)")).toBeDisabled();
    expect(screen.getByLabelText("Ayraç 2 (tarih ile sayaç arası)")).toBeDisabled();
    expect(screen.getByLabelText(new RegExp(KILIT.slice(0, 30).replace(/[+.]/g, "\\$&")))).toBeTruthy();
  });

  it("⭐ §2 sayaçta yalnız başlangıç açık; adım/sınır pasif, sarma kutusu yok, kurallar görünür", () => {
    ciz();
    expect(screen.getByLabelText("Başlangıç")).not.toBeDisabled();
    expect(screen.getByLabelText("Artış adımı")).toBeDisabled();
    expect(screen.getByLabelText("Üst sınır")).toBeDisabled();
    expect(screen.queryByText(/Üst sınıra varınca başa dön/)).toBeNull();
    expect(screen.getByText(SAYAC_KILIT)).toBeInTheDocument();
    expect(screen.getByText(BAS_NOTU)).toBeInTheDocument();
  });
});
