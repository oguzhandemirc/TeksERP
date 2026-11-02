// Gözden geçirme yüzeyi: toplam fark şeridi backend `totalsCheck` hükmünü gösterir (yeniden hesap yok); "yalnız sorunlu
// satırlar" süzgeci backend `problems` alanını okur (istemci kendi kuralını kurmaz) ve "gösterilen / toplam" sayar.
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { TotalsStrip } from "../TotalsStrip";
import { LinesTable } from "../LinesTable";
import { describeDiff, visibleLines } from "../reviewView";
import type { DeliveryNoteDetail, DeliveryNoteLine } from "../types";
import type { TotalsCheck } from "../reviewTypes";

vi.mock("@/components/forms/color-picker/ColorPickerModal", () => ({ ColorPickerModal: () => <button type="button">Renk seç</button> }));
vi.mock("@/components/forms/ItemPickerModal", () => ({ ItemPickerModal: () => null }));

const block = (o: Partial<TotalsCheck["blocks"][number]>): TotalsCheck["blocks"][number] => ({ blockNo: 1, lines: { count: 2, m: 200, kg: 0 }, declared: null, diffs: [], ok: null, ...o });
const check = (o: Partial<TotalsCheck>): TotalsCheck => ({ ok: null, tolerance: 0.005, blocks: [], mismatches: [], warnings: [], ...o });

describe("toplam fark şeridi", () => {
  it("kapı geçiyorsa yeşil 'Toplamlar tutuyor'", () => {
    renderWithProviders(<TotalsStrip check={check({ ok: true, blocks: [block({ ok: true, declared: { count: 2, m: 200, kg: null } })] })} />);
    expect(screen.getByTestId("totals-strip").dataset.ok).toBe("true");
    expect(screen.getByTestId("totals-verdict")).toHaveTextContent("Toplamlar tutuyor");
    expect(within(screen.getByTestId("block-1")).getByText("Beyanla tutuyor")).toBeInTheDocument();
  });

  it("kapı geçmiyorsa kırmızı; hangi blokta ne kadar fark olduğunu söyler", () => {
    renderWithProviders(
      <TotalsStrip
        check={check({
          ok: false,
          blocks: [
            block({ ok: true, declared: { count: 2, m: 200, kg: null } }),
            block({ blockNo: 2, lines: { count: 1, m: 50, kg: 0 }, ok: false, declared: { count: null, m: 60, kg: null }, diffs: [{ field: "m", declared: 60, actual: 50, diff: -10 }] }),
            block({ blockNo: 3 }),
          ],
          mismatches: ["Blok 2: beyan 60 m, satır toplamı 50.000 m."],
          warnings: ["Belgede 5 top yazıyor, satır sayısı 4."],
        })}
      />,
    );
    expect(screen.getByTestId("totals-strip").dataset.ok).toBe("false");
    expect(screen.getByTestId("totals-verdict")).toHaveTextContent("Toplamlar tutmuyor");
    expect(screen.getByTestId("block-2").dataset.ok).toBe("false");
    expect(within(screen.getByTestId("block-2")).getByText("Metre: beyan 60 m, satırlar 50 m (fark −10 m)")).toBeInTheDocument();
    expect(screen.getByTestId("block-3").dataset.ok).toBe("unknown");
    expect(screen.getByText("Belgede 5 top yazıyor, satır sayısı 4. (uyarı)")).toBeInTheDocument();
  });

  it("beyan yoksa doğrulanamaz; alan gelmezse (eski backend) şerit çizilmez", () => {
    const { unmount } = renderWithProviders(<TotalsStrip check={check({ blocks: [block({})] })} />);
    expect(screen.getByTestId("totals-verdict")).toHaveTextContent("doğrulanamaz");
    unmount();
    renderWithProviders(<TotalsStrip check={undefined} />);
    expect(screen.queryByTestId("totals-strip")).toBeNull();
  });

  it("fark metni: adet işaretli, okunamayan beyan farksız", () => {
    expect(describeDiff({ field: "count", declared: 5, actual: 6, diff: 1 })).toBe("Top: beyan 5 top, satırlar 6 top (fark +1 top)");
    expect(describeDiff({ field: "kg", declared: null, actual: 12.5, diff: null })).toBe("Kilo: beyan okunamadı, satırlar 12,5 kg");
  });
});

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

describe("yalnız sorunlu satırlar süzgeci", () => {
  it("açınca yalnız backend'in sorunlu dediği satırlar kalır ve sayaç '2 / 4 satır' der", async () => {
    renderTable([
      line("a", 1),
      line("b", 2, { itemId: null, item: null, problems: ["ITEM_UNRESOLVED"] }),
      line("c", 3, { status: "FAILED", failReason: "iplik kalemi", problems: ["FAILED"] }),
      // İstemci kural KURMAZ: needsReview işaretli ama backend sorun demiyorsa süzgeçte görünmez.
      line("d", 4, { needsReview: true, problems: [] }),
    ]);
    expect(screen.getAllByTestId("line-row")).toHaveLength(4);
    expect(screen.getByText("Yalnız sorunlu satırlar (2)")).toBeInTheDocument();
    expect(screen.queryByTestId("problem-filter-count")).toBeNull();
    await userEvent.click(screen.getByTestId("problem-filter"));
    expect(screen.getAllByTestId("line-row")).toHaveLength(2);
    expect(screen.getByTestId("problem-filter-count")).toHaveTextContent("2 / 4 satır");
    expect(screen.getByTestId("line-problem").dataset.code).toBe("ITEM_UNRESOLVED");
    await userEvent.click(screen.getByTestId("problem-filter"));
    expect(screen.getAllByTestId("line-row")).toHaveLength(4);
  });

  it("sorunlu satır yoksa açık süzgeç boş tablo yerine 'bütün satırlar temiz' der", async () => {
    renderTable([line("a", 1), line("b", 2)]);
    await userEvent.click(screen.getByTestId("problem-filter"));
    expect(screen.queryAllByTestId("line-row")).toHaveLength(0);
    expect(screen.getByTestId("no-problem-lines")).toBeInTheDocument();
    expect(screen.getByTestId("problem-filter-count")).toHaveTextContent("0 / 2 satır");
  });

  it("saf süzgeç: alan yoksa (eski backend) sorunlu sayılmaz", () => {
    const v = visibleLines([{ problems: ["NEEDS_REVIEW"] }, {}, { problems: [] }], true);
    expect([v.rows.length, v.problemCount, v.total]).toEqual([1, 1, 3]);
  });
});
