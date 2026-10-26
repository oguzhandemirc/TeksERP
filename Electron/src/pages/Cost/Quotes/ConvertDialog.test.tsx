// Dönüştürme modalı: `order:write` yoksa düğme kapalı + açıklama; ürünsüz kalem bağlanmadan gönderilmez, bağlanınca
// `lineItems` gider; çift tık TEK istek; token belirsiz hatada (5xx) yapışır, kesin 4xx'te yenilenir;
// sunucunun QUOTE_LINE_ITEM_MISSING satırı işaretlenir.
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import type { QuoteDetail, QuoteLine } from "./quote-types";

let perms: string[] = [];
const convert = vi.fn();
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p), hasAnyPermission: () => true }) }));
vi.mock("./service", () => ({ quoteService: { convert: (...a: unknown[]) => convert(...a) } }));
vi.mock("@/components/forms/ItemPickerModal", () => ({
  ItemPickerModal: ({ open, onPick }: { open: boolean; onPick: (r: { id: string; code: string; name: string }) => void }) =>
    open ? <button onClick={() => onPick({ id: "item-9", code: "K9", name: "Kumaş 9" })}>pick-item</button> : null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
import { ConvertDialog } from "./ConvertDialog";

const l = (lineNo: number, itemId: string | null) => ({ id: `l${lineNo}`, lineNo, itemId, description: `Kalem ${lineNo}` }) as QuoteLine;
const quote = (lines: QuoteLine[]) => ({ id: "q1", lines }) as QuoteDetail;
const err = (status: number, details: Record<string, unknown> = {}) => {
  const e = new AxiosError("x");
  e.response = { status, data: { details } } as AxiosResponse;
  return e;
};

describe("ConvertDialog", () => {
  beforeEach(() => {
    convert.mockReset();
    perms = ["quote:convert", "order:write"];
  });
  it("order:write yok → düğme kapalı + açıklama", () => {
    perms = ["quote:convert"];
    renderWithProviders(<ConvertDialog quote={quote([l(1, "i1")])} open onOpenChange={() => {}} />);
    expect(screen.getByTestId("convert-confirm")).toBeDisabled();
    expect(screen.getByText(/Sipariş oluşturma yetkiniz yok/)).toBeInTheDocument();
  });
  it("ürünsüz kalem bağlanmadan kapalı; bağlanınca lineItems gider; çift tık tek istek", async () => {
    let resolve!: (v: unknown) => void;
    convert.mockImplementation(() => new Promise((r) => (resolve = r)));
    renderWithProviders(<ConvertDialog quote={quote([l(1, "i1"), l(2, null)])} open onOpenChange={() => {}} />);
    expect(screen.getByTestId("convert-confirm")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Ürün bağla/ }));
    fireEvent.click(screen.getByText("pick-item"));
    const btn = screen.getByTestId("convert-confirm");
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(convert).toHaveBeenCalledTimes(1));
    expect(convert.mock.calls[0]?.[2]).toEqual([{ lineNo: 2, itemId: "item-9" }]);
    await act(async () => resolve({ data: { id: "q1" }, orderId: "o1", orderNumber: "SIP-1" }));
    expect(await screen.findByTestId("convert-order-link")).toHaveTextContent("SIP-1");
  });
  it("token: 5xx'te aynı token, kesin 4xx'te yeni", async () => {
    convert.mockRejectedValueOnce(err(503)).mockRejectedValueOnce(err(400, { code: "QUOTE_LINE_ITEM_MISSING", lines: [{ lineNo: 1, description: "x" }] })).mockRejectedValueOnce(err(409));
    renderWithProviders(<ConvertDialog quote={quote([l(1, "i1")])} open onOpenChange={() => {}} />);
    const btn = screen.getByTestId("convert-confirm");
    fireEvent.click(btn);
    await waitFor(() => expect(convert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(convert).toHaveBeenCalledTimes(3));
    const [t1, t2, t3] = convert.mock.calls.map((c) => c[1]);
    expect(t2).toBe(t1);
    expect(t3).not.toBe(t2);
  });
});
