// Yeni Kartela Sevki — gövde tabletle aynı; istek uçuştayken düğme kilitli ve diyalog kapanmaz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const post = vi.fn();
const get = vi.fn();
vi.mock("@/services/apiClient", () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
vi.mock("./useKartelaFirmCategory", () => ({
  useKartelaFirmCategory: () => ({ categoryId: "cat-k", isLoading: false, categoryMissing: false }),
}));
const pickerFilters = vi.fn();
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ onChange, filters }: { onChange: (id: string) => void; filters?: Record<string, string> }) => {
    pickerFilters(filters);
    return <button type="button" onClick={() => onChange("f1")}>firma-sec</button>;
  },
}));
const rollScopes = vi.fn();
vi.mock("@/components/operations/roll-picker/RollPickerDialog", () => ({
  RollPickerDialog: ({ open, onConfirm, scopes }: { open: boolean; onConfirm: (r: unknown[]) => void; scopes: unknown }) => {
    rollScopes(scopes);
    return open ? (
      <button type="button" onClick={() => onConfirm([{ id: "r1", barcode: "T1", itemName: "Poplin", colorName: null, qty: 40, warehouseId: "w", status: "WAREHOUSE" }])}>
        top-onayla
      </button>
    ) : null;
  },
}));

import { KartelaDispatchDialog } from "./KartelaDispatchDialog";

function setup() {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  renderWithProviders(<KartelaDispatchDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);
  return { onOpenChange, onCreated };
}

describe("Yeni Kartela Sevki", () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    pickerFilters.mockReset();
  });

  it("firma seçici yalnız KARTELA kategorisi; top seçici depodaki serbest toplar", () => {
    setup();
    expect(pickerFilters).toHaveBeenLastCalledWith({ categoryId: "cat-k" });
    fireEvent.click(screen.getByRole("button", { name: /Listeden Seç/ }));
    expect(rollScopes).toHaveBeenLastCalledWith([
      expect.objectContaining({ label: "Kartelalık toplar", filters: { "filter[status]": "WAREHOUSE", "filter[shipmentScope]": "free", "filter[markedForKartela]": "true" } }),
      expect.objectContaining({ label: "Tüm bitmiş toplar", filters: { "filter[status]": "WAREHOUSE", "filter[shipmentScope]": "free" } }),
    ]);
  });

  it("\"Sevke ekle\" ön seçimi: toplar listede hazır gelir, yeniden render mükerrer eklemez", () => {
    const seed = [
      { id: "r1", barcode: "T1", itemName: "Poplin", colorName: "Beyaz", qty: 40 },
      { id: "r2", barcode: "T2", itemName: "Saten", colorName: null, qty: 12.5 },
    ];
    const { rerender } = renderWithProviders(<KartelaDispatchDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} initialRolls={seed} />);
    expect(screen.getByText("Poplin · Beyaz")).toBeInTheDocument();
    expect(screen.getByText("T2")).toBeInTheDocument();
    rerender(<KartelaDispatchDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} initialRolls={seed} />);
    expect(screen.getByRole("button", { name: /Sevk Et \(2 top\)/ })).toBeInTheDocument();
  });

  it("gövde tabletle birebir; uçuşta kilit + kapanmaz; başarıda çeki için id döner", async () => {
    let resolve!: (v: unknown) => void;
    post.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { onOpenChange, onCreated } = setup();
    const send = () => screen.getByRole("button", { name: /Sevk Et|Gönderiliyor/ });
    expect(send()).toBeDisabled();
    fireEvent.click(screen.getByText("firma-sec"));
    fireEvent.click(screen.getByRole("button", { name: /Listeden Seç/ }));
    fireEvent.click(screen.getByText("top-onayla"));
    fireEvent.change(screen.getByLabelText("Plaka"), { target: { value: " 34 AB 1 " } });
    fireEvent.click(send());
    fireEvent.click(send()); // çift tık
    await waitFor(() => expect(send()).toHaveTextContent("Gönderiliyor"));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/api/kartela/dispatch", {
      subcontractorId: "f1", rollIds: ["r1"], plateNumber: "34 AB 1", driverName: null, notes: null,
    });
    expect(send()).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    resolve({ data: { success: true, data: { id: "d1", dispatchNo: "KS-1" }, message: "ok" } });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("d1"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("okutulan çuvaldaki top listeye girmez", async () => {
    get.mockResolvedValue({ data: { success: true, data: { id: "r9", barcode: "T9", status: "WAREHOUSE", sackId: "c", sack: { sackNo: "CV-1" }, currentQty: 10 } } });
    setup();
    fireEvent.change(screen.getByPlaceholderText(/Top barkodu/), { target: { value: "t9" } });
    fireEvent.click(screen.getByRole("button", { name: "Ekle" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/rolls/barcode/T9"));
    expect(screen.getByText(/Henüz top eklenmedi/)).toBeInTheDocument();
  });
});
