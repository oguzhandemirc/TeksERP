// Kabul/sevk iptali — yıkıcı işlem: önizleme etkilenen HER kartelayı listeler, engelde onay kapalı,
// 409 SWATCHES_DOWNSTREAM'de engelleyen kartelalar diyalogda; sebep ≥3 karakter.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));

import { CancelDispatchDialog, CancelReceiptDialog } from "./KartelaCancelDialogs";

const sw = (id: string, reasons: string[] = []) => ({
  id, cardNumber: `KRT${id}`, barcode: `KRT${id}`, item: { code: "P", name: "Poplin" },
  blockingReasons: reasons, safeToCancel: reasons.length === 0,
});
const preview = (swatches: ReturnType<typeof sw>[]) => ({
  data: { success: true, data: { receiptNo: "KK-1", cancellable: swatches.every((s) => s.safeToCancel), swatches } },
});

describe("Kabulü İptal Et", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it("önizleme her kartelayı listeler; sebep kısa iken kapalı; gövde yalnız { reason }", async () => {
    get.mockResolvedValue(preview([sw("1"), sw("2")]));
    post.mockResolvedValue({ data: { success: true, data: { id: "k1" } } });
    const onOpenChange = vi.fn();
    renderWithProviders(<CancelReceiptDialog receiptId="k1" onOpenChange={onOpenChange} />);
    const list = await screen.findByTestId("iptal-onizleme");
    expect(get).toHaveBeenCalledWith("/api/kartela/receipts/k1/cancel-preview");
    expect(within(list).getByText("KRT1")).toBeInTheDocument();
    expect(within(list).getByText("KRT2")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /Kabulü İptal Et \(2 kartela\)/ });
    fireEvent.change(screen.getByLabelText("İptal sebebi"), { target: { value: "ab" } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("İptal sebebi"), { target: { value: " yanlış kabul " } });
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/kartela/receipts/k1/cancel", { reason: "yanlış kabul" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("engelli kartela sebebiyle görünür ve onay kapalı kalır", async () => {
    get.mockResolvedValue(preview([sw("1"), sw("2", ["Bir sevkiyatta", "Bir çuvalda"])]));
    renderWithProviders(<CancelReceiptDialog receiptId="k1" onOpenChange={vi.fn()} />);
    expect(await screen.findByText("Bir sevkiyatta · Bir çuvalda")).toBeInTheDocument();
    // Engelli kartela listenin başında (uzun kabulde kaybolmasın).
    expect(screen.getByTestId("iptal-onizleme").firstElementChild).toHaveTextContent("KRT2");
    expect(screen.getByText(/1 kartela sevkiyatta\/çuvalda/)).toBeInTheDocument();
    expect(screen.getByLabelText("İptal sebebi")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Kabulü İptal Et \(2/ })).toBeDisabled();
  });

  it("409 SWATCHES_DOWNSTREAM: engelleyen kart numaraları diyalogda listelenir", async () => {
    // İlk önizleme temiz; 409 sonrası tazelenen önizleme engelli (yarış).
    get.mockResolvedValueOnce(preview([sw("1")])).mockResolvedValue(preview([sw("1", ["Bir çuvalda"])]));
    post.mockRejectedValue({ response: { status: 409, data: { message: "1 kartela…", details: { code: "SWATCHES_DOWNSTREAM", blocked: ["KRT1"] } } } });
    renderWithProviders(<CancelReceiptDialog receiptId="k1" onOpenChange={vi.fn()} />);
    await screen.findByTestId("iptal-onizleme");
    fireEvent.change(screen.getByLabelText("İptal sebebi"), { target: { value: "deneme" } });
    fireEvent.click(screen.getByRole("button", { name: /Kabulü İptal Et \(1/ }));
    expect(await screen.findByText(/iptal yapılamadı/)).toHaveTextContent("KRT1");
    expect(await screen.findByText("Bir çuvalda")).toBeInTheDocument();
    // Aynı engel tek uyarıyla söylenir (sarı uyarı kırmızının tekrarı olmaz).
    expect(screen.queryByText(/kabul iptal edilemez/)).toBeNull();
  });
});

describe("Sevki İptal Et", () => {
  it("gövde { reason }, uçuşta tek istek", async () => {
    post.mockReset().mockReturnValue(new Promise(() => {}));
    renderWithProviders(<CancelDispatchDialog dispatch={{ id: "d1", dispatchNo: "KS-1", itemCount: 3 }} onOpenChange={vi.fn()} />);
    expect(screen.getByText(/3 top kartela firmasından depoya geri döner/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("İptal sebebi"), { target: { value: "yanlış firma" } });
    const btn = screen.getByRole("button", { name: "Sevki İptal Et" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/kartela/dispatches/d1/cancel", { reason: "yanlış firma" });
  });
});
