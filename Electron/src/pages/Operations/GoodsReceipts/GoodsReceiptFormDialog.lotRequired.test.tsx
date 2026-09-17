// =============================================================================
// BEKÇİ — Mal kabul: DOĞRULAMA sınıfı satır hatası formda ANINDA, modal AÇIK kalır, fiş DOĞMAZ (C8, 2026-09-17)
// =============================================================================
// Bulgu: lot zorunluyken lotsuz iplik satırı sunucuda düşüyor, panel "1 satır atlandı" deyip kapanıyordu → içi boş fiş.
// ① bayrak biliniyorsa (useDevereLotRequired=true) lotsuz iplik satırı: lot kutusu kırmızı + role="alert" "Lot zorunlu",
//    "Fişi Oluştur" KAPALI (title sebep), sunucuya gidilmez; lot yazılınca açılır. ② bayrak yüklenmemişse (false) sunucu
//    400 `RECEIPT_LINES_INVALID` `details.lines[{lineNo}]` aynı satıra bağlanır, modal kapanmaz, toast yok; satır düzelince
//    işaret silinir. ③ saf katman: `expandLineKeys` adet çoğaltmasını izler (lineNo → anahtar).
// Negatif sonda (kırmızı görüldü): `localLineIssues` hep boş → (1)(3) ❌; `onError`da `setServerIssues` düşer → (2) ❌.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { GoodsReceiptFormDialog } from "./GoodsReceiptFormDialog";
import { emptyLine, type DraftLine } from "./ReceiptLineRows";
import { expandLineKeys, localLineIssues, receiptLinesInvalidFrom, serverLineIssues, LOT_REQUIRED_TEXT } from "./receiptLineIssues";

let lotRequired = false;
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { financeEnabled: false } } }),
  useDevereLotRequired: () => lotRequired,
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => false, hasAnyPermission: () => false, hasAllPermissions: () => false }) }));
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), warning: (...a: unknown[]) => toastWarning(...a), info: vi.fn(), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("./ReceiptImportButton", () => ({ ReceiptImportButton: () => null }));
vi.mock("@/components/forms/ReferenceSelect", () => ({ ReferenceSelect: () => null }));
vi.mock("@/components/forms/SupplierSelect", () => ({ SupplierSelect: () => null }));
vi.mock("./LinePropertiesButton", () => ({ LinePropertiesButton: () => null }));
vi.mock("@/hooks/useFoldValues", () => ({ useFoldValues: () => ({ values: [] }) }));
// Ürün kutusu: tıklayınca iplik kalemini seçen stub (modal yerine)
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: (p: { value: string | null; onChange: (id: string) => void; "aria-label"?: string }) => (
    <button type="button" aria-label={p["aria-label"]} onClick={() => p.onChange("yarn-1")}>{p.value ?? "Kumaş / iplik ara..."}</button>
  ),
}));
const createGoodsReceipt = vi.fn();
vi.mock("./service", () => ({ createGoodsReceipt: (...a: unknown[]) => createGoodsReceipt(...a) }));
vi.mock("./useItemTypes", () => ({
  useItemTypes: (ids: Array<string | null>) => new Map(ids.filter((i): i is string => i === "yarn-1").map((i) => [i, "YARN"])),
  yarnIdsFrom: (m: Map<string, string>) => new Set([...m.entries()].filter(([, t]) => t === "YARN").map(([id]) => id)),
}));
vi.mock("@/hooks/useWarehouses", () => ({
  useMultiWarehouse: () => ({ multiWarehouse: false, warehouses: [] }),
  useDefaultWarehouse: () => ({ id: "w1", code: "D1", name: "Merkez Depo" }),
  WAREHOUSES_QUERY_KEY: ["warehouses"],
}));
vi.mock("@/services/apiClient", () => ({ default: { get: vi.fn().mockRejectedValue(new Error("stub")), post: vi.fn() } }));
vi.mock("../PurchaseOrders/GoodsReceiptOrderSection", () => ({ GoodsReceiptOrderSection: () => null }));

const axiosLike = (lines: Array<{ lineNo: number; code: string; message: string }>) =>
  Object.assign(new Error("400"), { isAxiosError: true, response: { status: 400, data: { success: false, message: "x", details: { code: "RECEIPT_LINES_INVALID", lines } } } });

async function yarnLineWithQty() {
  const user = userEvent.setup();
  renderWithProviders(<GoodsReceiptFormDialog open onOpenChange={() => {}} onCreated={() => {}} />);
  await user.click(screen.getByRole("button", { name: "Kumaş" })); // ItemSelect stub → iplik kalemi
  const kg = await screen.findByRole("spinbutton", { name: "Miktar (kg)" });
  await user.clear(kg);
  await user.type(kg, "10");
  return user;
}
const submitBtn = () => screen.getByRole("button", { name: /Fişi Oluştur/ });

beforeEach(() => {
  createGoodsReceipt.mockReset();
  toastSuccess.mockReset();
  toastWarning.mockReset();
  toastError.mockReset();
});

describe("Mal kabul — doğrulama sınıfı hata satırda (C8)", () => {
  it("(1) ⭐ bayrak biliniyor: lotsuz iplik → lot kutusu kırmızı + alert, 'Fişi Oluştur' KAPALI (title), sunucuya gidilmez; lot yazılınca açılır", async () => {
    lotRequired = true;
    const user = await yarnLineWithQty();
    const lot = screen.getByRole("textbox", { name: "Lot numarası" });
    expect(lot.className).toMatch(/border-destructive/);
    expect(screen.getByRole("alert")).toHaveTextContent(LOT_REQUIRED_TEXT);
    expect(submitBtn()).toBeDisabled();
    expect(submitBtn()).toHaveAttribute("title", expect.stringContaining("lot eksik"));
    expect(createGoodsReceipt).not.toHaveBeenCalled();
    await user.type(lot, "YAN-1");
    await waitFor(() => expect(submitBtn()).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("(2) ⭐ bayrak yüklenmemiş: sunucu 400 RECEIPT_LINES_INVALID → satıra bağlanır, modal AÇIK, toast YOK; satır düzelince işaret gider", async () => {
    lotRequired = false;
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    createGoodsReceipt.mockRejectedValueOnce(axiosLike([{ lineNo: 1, code: "YARN_LOT_REQUIRED", message: "İplik satırında lot numarası zorunlu (ayar)." }]));
    renderWithProviders(<GoodsReceiptFormDialog open onOpenChange={onOpenChange} onCreated={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Kumaş" }));
    const kg = await screen.findByRole("spinbutton", { name: "Miktar (kg)" });
    await user.clear(kg);
    await user.type(kg, "10");
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(submitBtn());
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("lot numarası zorunlu");
    expect(screen.getByRole("textbox", { name: "Lot numarası" }).className).toMatch(/border-destructive/);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(createGoodsReceipt).toHaveBeenCalledTimes(1);
    await user.type(screen.getByRole("textbox", { name: "Lot numarası" }), "L");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("(3) saf katman: expandLineKeys adet çoğaltmasını izler; serverLineIssues lineNo→anahtar; receiptLinesInvalidFrom başka hatada null", () => {
    const a: DraftLine = { ...emptyLine(), key: "a", itemId: "f1", initialQty: 5, count: 2 };
    const b: DraftLine = { ...emptyLine(), key: "b", itemId: "yarn-1", initialQty: 3, count: 1 };
    const bos: DraftLine = { ...emptyLine(), key: "c" };
    expect(expandLineKeys([a, bos, b])).toEqual(["a", "a", "b"]);
    const m = serverLineIssues([{ lineNo: 3, code: "YARN_LOT_REQUIRED", message: "lot" }, { lineNo: 9, code: "X", message: "yok" }], ["a", "a", "b"]);
    expect([...m.entries()]).toEqual([["b", "lot"]]);
    expect(localLineIssues([b], new Set(["yarn-1"]), true).get("b")).toBe(LOT_REQUIRED_TEXT);
    expect(localLineIssues([b], new Set(["yarn-1"]), false).size).toBe(0);
    expect(localLineIssues([{ ...b, lotNo: " L1 " }], new Set(["yarn-1"]), true).size).toBe(0);
    expect(receiptLinesInvalidFrom(new Error("ağ"))).toBeNull();
    expect(receiptLinesInvalidFrom(axiosLike([]))).toEqual([]);
  });
});
