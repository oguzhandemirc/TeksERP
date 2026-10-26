// MAL-6: teklif / fiyat listesi belge düğmesi — doğru tür, yazma izni, TASLAK önizleme ve Excel'in `/tables`tan gelmesi.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

const seen: { props: Record<string, unknown> | null } = { props: null };
vi.mock("@/components/print/PrintedDocDialog", () => ({
  PrintedDocDialog: (p: Record<string, unknown>) => {
    seen.props = p;
    return null;
  },
}));
const getTables = vi.fn();
vi.mock("@/services/printedDocumentService", () => ({ printedDocumentService: { getTables: (...a: unknown[]) => getTables(...a) } }));
vi.mock("@/lib/xlsx-export", () => ({ buildWorkbook: vi.fn(async () => new Blob()), saveWorkbook: vi.fn(async () => undefined) }));
vi.mock("@/lib/doc-tables-export", () => ({ docTablesToSheets: vi.fn(() => []) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CommercialDocButton } from "./CommercialDocButton";
import { saveWorkbook } from "@/lib/xlsx-export";

describe("CommercialDocButton", () => {
  beforeEach(() => {
    seen.props = null;
    getTables.mockReset();
  });

  it("teklif: tıklayınca SALES_QUOTE diyaloğu, quote:write, DRAFT'ta taslak önizleme", async () => {
    renderWithProviders(<CommercialDocButton docType="SALES_QUOTE" sourceId="q1" label="Teklif TKF/R1" draft />);
    expect(seen.props).toBeNull();
    await userEvent.click(screen.getByTestId("commercial-doc-open"));
    expect(seen.props).toMatchObject({ docType: "SALES_QUOTE", sourceId: "q1", writePermission: "quote:write", allowDraft: true });
  });

  it("fiyat listesi: PRICE_LIST, price-list:write, yayınlıda taslak yok; Excel /tables'tan, dosya adında `/` yok", async () => {
    getTables.mockResolvedValue({ data: { documentNo: "FL20260001/R2", docType: "PRICE_LIST", header: [], tables: [], notes: [] } });
    renderWithProviders(<CommercialDocButton docType="PRICE_LIST" sourceId="p1" label="Liste" draft={false} />);
    await userEvent.click(screen.getByTestId("commercial-doc-open"));
    expect(seen.props).toMatchObject({ docType: "PRICE_LIST", writePermission: "price-list:write", allowDraft: false });
    const menu = (seen.props!.toolbarDownloads as (v: { version: number | null; currentTemplate: boolean }) => ReactNode)({ version: 2, currentTemplate: false });
    expect(isValidElement(menu)).toBe(true);
    await (menu as ReactElement<{ onSelect: () => void }>).props.onSelect();
    await vi.waitFor(() => expect(saveWorkbook).toHaveBeenCalled());
    expect(getTables).toHaveBeenCalledWith("PRICE_LIST", "p1", { version: 2, currentTemplate: false });
    expect(vi.mocked(saveWorkbook).mock.calls[0]?.[1]).toBe("FL20260001-R2-fiyat-listesi");
  });
});
