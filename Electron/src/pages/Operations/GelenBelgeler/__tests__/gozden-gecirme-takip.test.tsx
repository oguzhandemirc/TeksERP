// Demo 2. tur takibi (2026-11-02): varsayılan ürünle girecek satır sorunlu değil (bilgi etiketi, backend `itemFallback`);
// belge geneli beyan kartı ("Müşteri MT"); şüpheli değer metre HÜCRESİNDE de vurgulanır. Hükümler backend'den; panel kural kurmaz.
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { TotalsStrip } from "../TotalsStrip";
import { LinesTable } from "../LinesTable";
import type { DeliveryNoteDetail, DeliveryNoteLine } from "../types";
import type { TotalsCheck } from "../reviewTypes";

vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => <button type="button">Renk seç</button> }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));

const line = (id: string, lineNo: number, o: Partial<DeliveryNoteLine> = {}): DeliveryNoteLine =>
  ({
    id, noteId: "n1", lineNo, blockNo: 1, lineKind: "TOP", senderRollNo: null, meters: "100", weightKg: null, widthCm: null, itemText: null, itemId: "i1",
    colorText: null, colorId: null, processText: null, confidence: null, needsReview: false, sourceRects: null, status: "PENDING", failReason: null, rollId: null,
    item: { id: "i1", code: "K", name: "Kumaş" }, color: null, problems: [], ...o,
  }) as DeliveryNoteLine;

const renderTable = (lines: DeliveryNoteLine[]) =>
  renderWithProviders(
    <LinesTable
      note={{ id: "n1", status: "DRAFT", ownerCustomerId: null, lines } as unknown as DeliveryNoteDetail}
      suggestions={undefined}
      editable
      canWrite
      selectedId={null}
      onSelect={vi.fn()}
      onPatch={vi.fn()}
      onDelete={vi.fn()}
    />,
  );

const FB = { id: "mk", name: "MÜŞTERİ KUMAŞI (EMANET)", source: "FACTORY" as const };

describe("varsayılan ürünle girecek satır", () => {
  it("⭐ backend sorunsuz + itemFallback dedi → süzgeç saymaz, Durum'da bilgi etiketi, 'Ürün seçilmedi' yok", async () => {
    renderTable([
      line("a", 1, { itemId: null, item: null, problems: [], itemFallback: FB }),
      line("b", 2, { itemId: null, item: null, problems: [], itemFallback: FB }),
      line("c", 3, { itemId: null, item: null, problems: ["ITEM_UNRESOLVED"] }),
    ]);
    expect(screen.getByText("Yalnız sorunlu satırlar (1)")).toBeInTheDocument();
    const info = screen.getAllByTestId("line-item-fallback");
    expect(info).toHaveLength(2);
    expect(info[0]).toHaveTextContent("Varsayılan ürünle girecek: MÜŞTERİ KUMAŞI (EMANET) (fabrika varsayılanı)");
    expect(info[0]!.dataset.source).toBe("FACTORY");
    await userEvent.click(screen.getByTestId("problem-filter"));
    expect(screen.getAllByTestId("line-row")).toHaveLength(1);
    expect(screen.getByTestId("line-problem").dataset.code).toBe("ITEM_UNRESOLVED");
  });

  it("eski backend (itemFallback yok) → bilgi etiketi çizilmez, sorun etiketi aynen", () => {
    renderTable([line("c", 1, { itemId: null, item: null, problems: ["ITEM_UNRESOLVED"] })]);
    expect(screen.queryByTestId("line-item-fallback")).toBeNull();
    expect(screen.getByText("Ürün seçilmedi")).toBeInTheDocument();
  });
});

describe("şüpheli metre hücresi", () => {
  it("⭐ SUSPECT_VALUE satırında metre girdisinin kendisi vurgulanır; diğer satırda vurgu yok", () => {
    renderTable([
      line("s", 1, { needsReview: true, meters: "1370", problems: ["NEEDS_REVIEW", "SUSPECT_VALUE"] }),
      line("n", 2, { needsReview: true, problems: ["NEEDS_REVIEW"] }),
    ]);
    const [r1, r2] = screen.getAllByTestId("line-row");
    const m1 = within(r1!).getByLabelText("Metre");
    expect(m1.dataset.suspect).toBe("true");
    expect(m1).toHaveAttribute("aria-invalid", "true");
    expect(m1.className).toContain("border-destructive");
    const m2 = within(r2!).getByLabelText("Metre");
    expect(m2.dataset.suspect).toBeUndefined();
    expect(m2.className).not.toContain("border-destructive");
  });
});

describe("belge geneli beyan kartı", () => {
  const base: TotalsCheck = { ok: false, tolerance: 0.005, blocks: [{ blockNo: 1, lines: { count: 1, m: 241, kg: 734 }, declared: { count: null, m: 241, kg: 734 }, diffs: [], ok: true }], mismatches: ["Belge geneli (Müşteri MT): beyan 238 m, satır toplamı 241.000 m."], warnings: [] };

  it("⭐ 'Müşteri MT 238' ↔ satır 241 → kırmızı kart, etiket ve fark", () => {
    renderWithProviders(<TotalsStrip check={{ ...base, document: { lines: { count: 1, m: 241, kg: 734 }, declared: { count: null, m: 238, kg: null }, diffs: [{ field: "m", declared: 238, actual: 241, diff: 3 }], ok: false, labels: { m: "Müşteri MT" } } }} />);
    expect(screen.getByTestId("totals-verdict")).toHaveTextContent("Toplamlar tutmuyor");
    const card = screen.getByTestId("block-document");
    expect(card.dataset.ok).toBe("false");
    expect(card).toHaveTextContent("Belge geneli (Müşteri MT)");
    expect(within(card).getByText("Metre: beyan 238 m, satırlar 241 m (fark +3 m)")).toBeInTheDocument();
  });

  it("eski backend (document yok) → kart çizilmez", () => {
    renderWithProviders(<TotalsStrip check={{ ...base, ok: true, mismatches: [] }} />);
    expect(screen.queryByTestId("block-document")).toBeNull();
  });
});
