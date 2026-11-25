import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { EMPTY_WEFT, type WeftContent } from "@/pages/WeaveDesigns/tabs/WeftContentFields";
import { WeftCalcPanel } from "./WeftCalcPanel";
import { buildWeftCalcBody, type WeftCalcResult } from "./weft-calc";

const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { post: (...a: unknown[]) => post(...a) } }));

const content: WeftContent = { seq: "", picksPerCm: "22,5", program: "", rows: [{ yarnItemId: "y1", picks: "4", channel: "3" }, { yarnItemId: "y2", picks: "1" }] };

const result = (patch: Partial<WeftCalcResult> = {}): WeftCalcResult => ({
  perMeters: 1000, picksPerCm: 22.5, lengthCm: null, lengthSource: null, wastePct: null,
  rows: [
    { letter: "A", yarnItemId: "y1", code: "IP-1", name: "Polyester 150", denier: 150, picksInRepeat: 4, unit: null, netKg: null, grossKg: null, sharePct: 80, wastePct: null, wasteSource: null },
    { letter: "B", yarnItemId: "y2", code: "PUL-1", name: "Pul", denier: null, picksInRepeat: 1, unit: "ADET", netKg: null, grossKg: null, sharePct: 20, wastePct: null, wasteSource: null },
  ],
  totalNetKg: null, totalGrossKg: null,
  missing: [{ code: "WEFT_LENGTH_MISSING", text: "Atkı boyu kumaştan gelir; bu ekranda atkı boyunu (cm) aşağıya yazın." }],
  ...patch,
});

describe("buildWeftCalcBody", () => {
  it("yarım satırda gövde kurmaz; kanal hesaba gitmez, sıklık sayıya çevrilir", () => {
    expect(buildWeftCalcBody({ ...EMPTY_WEFT, rows: [{ yarnItemId: "", picks: "" }] }, undefined, "")).toBeNull();
    expect(buildWeftCalcBody(content, { itemId: "i1", rawWidthCm: 300 }, "")).toEqual({
      itemId: "i1", rawWidthCm: 300, picksPerCm: 22.5, sequenceCode: null, weftLengthCm: null,
      yarns: [{ yarnItemId: "y1", picksInRepeat: 4 }, { yarnItemId: "y2", picksInRepeat: 1 }],
    });
  });
});

describe("WeftCalcPanel", () => {
  beforeEach(() => post.mockReset());

  it("eksikleri listeler, değer yoksa — yazar, KG dışı iplik kg'a girmez", async () => {
    post.mockResolvedValue({ data: { success: true, data: result() } });
    renderWithProviders(<WeftCalcPanel content={content} />);
    await waitFor(() => expect(screen.getByTestId("weft-calc-missing")).toHaveTextContent("Atkı boyu kumaştan gelir"));
    expect(post).toHaveBeenCalledWith("/api/weft-specs/calc", expect.objectContaining({ picksPerCm: 22.5 }), { suppressErrorToast: true });
    expect(screen.getByTestId("weft-calc-total-net")).toHaveTextContent("—");
    expect(screen.getByTestId("weft-calc-row-B")).toHaveTextContent("kg'a girmez");
  });

  it("satır eksikse istek atmaz", () => {
    renderWithProviders(<WeftCalcPanel content={{ ...EMPTY_WEFT, rows: [{ yarnItemId: "y1", picks: "" }] }} />);
    expect(screen.getByText(/her satırda iplik ve atış adedi/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("boy kaynağını ve kg'ı sunucudan çizer", async () => {
    post.mockResolvedValue({ data: { success: true, data: result({ lengthCm: 310, lengthSource: "TARAK", missing: [], totalNetKg: 120, totalGrossKg: 123.6, wastePct: 3,
      rows: [{ ...result().rows[0]!, netKg: 120, grossKg: 123.6 }] }) } });
    renderWithProviders(<WeftCalcPanel content={content} ctx={{ itemId: "i1" }} />);
    await waitFor(() => expect(screen.getByTestId("weft-calc-length-source")).toHaveTextContent("çözgü kartının tarak eni"));
    expect(screen.getByTestId("weft-calc-total-net")).toHaveTextContent("120");
    expect(screen.getByTestId("weft-calc-row-A")).toHaveTextContent("fireli");
    expect(screen.queryByTestId("weft-calc-missing")).toBeNull();
  });
});
