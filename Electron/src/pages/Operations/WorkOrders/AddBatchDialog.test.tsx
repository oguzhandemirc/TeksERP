// Negatif sonda (2026-09-26): anahtar yapışması kaldırılınca iki test, kumaş kilidi kaldırılınca kapsam testi kırmızı.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { addBatchError, addBatchScopes, slotAfterFailure, tokenFor } from "./addBatchModel";

const addBatch = vi.fn();
vi.mock("./service", () => ({ workOrderService: { addBatch: (...a: unknown[]) => addBatch(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const R1 = { id: "r1", barcode: "B-1", itemName: "PATOS", colorName: null, qty: 100, warehouseId: "w1", status: "STOCK" };
const R2 = { id: "r2", barcode: "B-2", itemName: "PATOS", colorName: "Mavi", qty: 40, warehouseId: "w1", status: "WAREHOUSE" };
vi.mock("@/components/operations/roll-picker/RollPickerDialog", () => ({
  RollPickerDialog: ({ open, onConfirm }: { open: boolean; onConfirm: (r: unknown[]) => void }) =>
    open ? <button type="button" onClick={() => onConfirm([R1, R2])}>sonda-sec</button> : null,
}));

import { AddBatchDialog } from "./AddBatchDialog";

const WO = { id: "wo-1", workOrderNumber: "IE-1", targetItemId: "i1", steps: [{ stepSequence: 2, station: { name: "Tambur" } }, { stepSequence: 1, station: { name: "Kurşun" } }] } as never;

async function secVeKaydet() {
  await userEvent.click(screen.getByRole("button", { name: /Top Seç/ }));
  await userEvent.click(screen.getByText("sonda-sec"));
}

describe("AddBatchDialog", () => {
  beforeEach(() => addBatch.mockReset());

  it("seçilenler listelenir, önizleme ilk adımı söyler; Kaydet barkodları ve istek anahtarını gönderir", async () => {
    addBatch.mockResolvedValue({ success: true, message: "P07 partisi eklendi · 2 top", data: { warnings: [] } });
    const onOpenChange = vi.fn();
    renderWithProviders(<AddBatchDialog open onOpenChange={onOpenChange} wo={WO} />);
    await secVeKaydet();
    expect(screen.getByText("Yeni parti açılacak · 2 top · 140 m · ilk adım: Kurşun")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Parti Ekle (2)" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(addBatch).toHaveBeenCalledWith("wo-1", { clientToken: expect.any(String), rollBarcodes: ["B-1", "B-2"] });
  });

  it("belirsiz hatada aynı anahtar; kesin retten sonra yeni anahtar ve ret satırı", async () => {
    addBatch
      .mockRejectedValueOnce({ response: { status: 502 }, message: "Network" })
      .mockRejectedValueOnce({ response: { status: 400, data: { message: "Parti eklenemedi", details: { rejects: [{ barcode: "B-2", reason: "Farklı kumaş" }] } } } })
      .mockResolvedValueOnce({ success: true, message: "ok", data: { warnings: [] } });
    renderWithProviders(<AddBatchDialog open onOpenChange={vi.fn()} wo={WO} />);
    await secVeKaydet();
    const kaydet = () => userEvent.click(screen.getByRole("button", { name: "Parti Ekle (2)" }));
    await kaydet();
    await waitFor(() => expect(addBatch).toHaveBeenCalledTimes(1));
    await kaydet();
    expect(await screen.findByText("B-2 — Farklı kumaş")).toBeTruthy();
    await kaydet();
    await waitFor(() => expect(addBatch).toHaveBeenCalledTimes(3));
    const [t1, t2, t3] = addBatch.mock.calls.map((c) => (c[1] as { clientToken: string }).clientToken);
    expect(t2).toBe(t1);
    expect(t3).not.toBe(t1);
  });
});

describe("addBatchModel", () => {
  it("kapsamlar kumaşa kilitli; Ham Stok ve Bitmiş Depo tablet süzgeçleriyle aynı", () => {
    const [raw, fin] = addBatchScopes("i1");
    expect(raw?.filters).toEqual({ "filter[rollScope]": "RAW_STOCK", "filter[rollKind]": "WOUND_ROLL", "filter[itemId]": "i1" });
    expect(fin?.filters["filter[status]"]).toBe("WAREHOUSE,A1_STOCK");
    expect(fin?.filters["filter[shipmentScope]"]).toBe("free");
    expect(addBatchScopes(null)[0]?.filters["filter[itemId]"]).toBeUndefined();
  });

  it("anahtar: aynı küme aynı; 5xx/ağ yapışır, 4xx düşer; ret listesi biçimsiz satırı eler", () => {
    const a = tokenFor(null, ["B", "A"], () => "t1");
    expect(tokenFor(a, ["A", "B"], () => "t2")).toBe(a);
    expect(slotAfterFailure(a, { response: { status: 503 } })).toBe(a);
    expect(slotAfterFailure(a, { message: "Network Error" })).toBe(a);
    expect(slotAfterFailure(a, { response: { status: 409 } })).toBeNull();
    expect(addBatchError({ response: { data: { details: { rejects: [{ barcode: "X", reason: "y" }, { barcode: 1 }] } } } }).rejects).toEqual([{ barcode: "X", reason: "y" }]);
  });
});
