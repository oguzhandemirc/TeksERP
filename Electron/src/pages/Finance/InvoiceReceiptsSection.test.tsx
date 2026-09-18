// =============================================================================
// BEKÇİ — Fatura formu "Mal kabul fişleri" alanı (2026-09-18)
// =============================================================================
//   §1 cari yokken tetik pasif ("Önce cari seç"); cari varken liste SUNUCU süzgeciyle istenir (invoiced=false · supplierId · ACTIVE)
//   §2 satıra dokun = ekle/çıkar; Uygula → onChange(küme); YENİ faturada taslak uç TEK çağrı + onDraftCreated(id)
//   §3 düzenlemede yalnız onChange; taslak ucu ÇAĞRILMAZ
//   §4 sunucu 409 → mesaj (+kod) alanın altında, onDraftCreated çağrılmaz
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { AxiosError, AxiosHeaders } from "axios";

const listGoodsReceipts = vi.fn();
const createDraftFromGoodsReceipts = vi.fn();
vi.mock("@/pages/Operations/GoodsReceipts/service", () => ({ listGoodsReceipts: (...a: unknown[]) => listGoodsReceipts(...a) }));
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), createDraftFromGoodsReceipts: (...a: unknown[]) => createDraftFromGoodsReceipts(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { InvoiceReceiptsSection } from "./InvoiceReceiptsSection";

const row = (id: string, no: string) => ({ id, receiptNo: no, status: "ACTIVE", deliveryNoteNo: null, createdAt: "2026-09-10T08:00:00Z", cancelledAt: null, warehouse: null, supplier: null, _count: { rolls: 3 } });
const ROWS = { data: [row("gr-1", "MK-1"), row("gr-2", "MK-2")], pagination: { total: 2, totalPages: 1 } };

beforeEach(() => {
  listGoodsReceipts.mockReset().mockResolvedValue(ROWS);
  createDraftFromGoodsReceipts.mockReset().mockResolvedValue({ data: { id: "inv-9", docNo: "AF-9" }, message: "ok" });
});

async function pick(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
  await user.click(screen.getByRole("button", { name: /Mal kabul fişleri/ }));
  for (const n of names) await user.click(await screen.findByRole("option", { name: new RegExp(n) }));
  await user.click(screen.getByTestId("fis-uygula"));
}

describe("InvoiceReceiptsSection", () => {
  it("§1 cari yok → tetik pasif; cari var → liste sunucu süzgeciyle", async () => {
    const onChange = vi.fn();
    const { unmount } = renderWithProviders(<InvoiceReceiptsSection mode="create" supplierId={null} value={[]} onChange={onChange} />);
    expect(screen.getByRole("button", { name: /Önce cari seç/ })).toBeDisabled();
    unmount();
    const user = userEvent.setup();
    renderWithProviders(<InvoiceReceiptsSection mode="create" supplierId="cust-1" value={[]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /Mal kabul fişleri: yok/ }));
    await waitFor(() => expect(listGoodsReceipts).toHaveBeenCalledWith(expect.objectContaining({ filter: { invoiced: "false", supplierId: "cust-1", status: "ACTIVE" } })));
    expect(await screen.findByRole("option", { name: /MK-1/ })).toBeInTheDocument();
  });

  it("§2 ⭐ yeni fatura: iki fiş seç → onChange(küme) + taslak ucu TEK çağrı + onDraftCreated(id)", async () => {
    const onChange = vi.fn(); const onDraftCreated = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<InvoiceReceiptsSection mode="create" supplierId="cust-1" value={[]} onChange={onChange} onDraftCreated={onDraftCreated} />);
    await pick(user, "MK-1", "MK-2");
    expect(onChange).toHaveBeenCalledWith(["gr-1", "gr-2"]);
    await waitFor(() => expect(onDraftCreated).toHaveBeenCalledWith("inv-9"));
    expect(createDraftFromGoodsReceipts).toHaveBeenCalledTimes(1);
    expect(createDraftFromGoodsReceipts).toHaveBeenCalledWith(["gr-1", "gr-2"]);
  });

  it("§2b satıra ikinci dokunuş çıkarır", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<InvoiceReceiptsSection mode="edit" supplierId="cust-1" value={[]} onChange={onChange} />);
    await pick(user, "MK-1", "MK-2", "MK-1");
    expect(onChange).toHaveBeenCalledWith(["gr-2"]);
  });

  it("§3 düzenleme: küme değişir, taslak ucu çağrılmaz; mevcut bağ etikette", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<InvoiceReceiptsSection mode="edit" supplierId="cust-1" value={["gr-1"]} linked={[{ id: "gr-1", receiptNo: "MK-1", deliveryNoteNo: "4471", receivedAt: "2026-09-10", status: "ACTIVE", currency: "TRY" }]} onChange={onChange} />);
    expect(screen.getByText("MK-1 · irsaliye 4471")).toBeInTheDocument();
    await pick(user, "MK-2");
    expect(onChange).toHaveBeenCalledWith(["gr-1", "gr-2"]);
    expect(createDraftFromGoodsReceipts).not.toHaveBeenCalled();
  });

  it("§4 sunucu 409 → mesaj + kod alanın altında; onDraftCreated çağrılmaz", async () => {
    const err = new AxiosError("x", "409", undefined, undefined, { status: 409, statusText: "Conflict", headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() }, data: { message: "MK-2 zaten AF-3 faturasına bağlı.", details: { code: "GOODS_RECEIPT_ALREADY_INVOICED" } } });
    createDraftFromGoodsReceipts.mockRejectedValue(err);
    const onDraftCreated = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<InvoiceReceiptsSection mode="create" supplierId="cust-1" value={[]} onChange={vi.fn()} onDraftCreated={onDraftCreated} />);
    await pick(user, "MK-2");
    expect(await screen.findByTestId("invoice-receipts-error")).toHaveTextContent("MK-2 zaten AF-3 faturasına bağlı. (GOODS_RECEIPT_ALREADY_INVOICED)");
    expect(onDraftCreated).not.toHaveBeenCalled();
  });
});
