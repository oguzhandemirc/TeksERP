// =============================================================================
// BEKÇİ — fatura satırı TÜRÜ (D2): Ürün / Hizmet / Açıklama + türe göre modal seçici
// =============================================================================
// ⭐ Ürün satırı → `lineType: PRODUCT` + `itemId`, `serviceItemId: null`.
// ⭐ Hizmet satırı → `lineType: SERVICE` + `serviceItemId`, `itemId: null` (hizmet kartı `service_items`'ta; ürün
//    ucu onu artık döndürmez — eski panelin kalem seçicisi hizmet seçemiyordu).
// ⭐ Kartı seçilmemiş satır → `TEXT` (kalemsiz satır bugün de serbest), öteki türün kimliği asla gitmez.
// ⭐ Kayıtlı taslağın hizmet satırı HİZMET türünde açılır: detaydaki `item` hizmetin eski-panel AYNASIDIR, ürün sanılırsa
//    backend 400 `INVOICE_LINE_SUBJECT_MISMATCH` verirdi. Sevk ön-dolumunun hizmet satırı da SERVICE açılır.
// NEGATİF SONDA (2026-11-08, geri alındı): `lineSubjectFrom`un SERVICE dalı `item` aynasını ürün sayınca §3+§4 kırmızı.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { InvoiceDetail } from "./service";
import { toPrefillLines } from "@/pages/Operations/AccountingDispatch/invoiceDraftLines";

const getInvoice = vi.fn();
const updateInvoice = vi.fn();
const createInvoice = vi.fn();
vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    getInvoice: (...a: unknown[]) => getInvoice(...a),
    updateInvoice: (...a: unknown[]) => updateInvoice(...a),
    createInvoice: (...a: unknown[]) => createInvoice(...a),
    getCariByCustomer: () => Promise.resolve(null),
  };
});
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: { financeEnabled: false, financeDefaultVatRate: 20 } } }),
}));
vi.mock("@/components/forms/CustomerPickerField", () => ({ CustomerPickerField: () => <div /> }));
// Seçiciler ağ konuşur; burada ölçülen TÜR → doğru seçici → doğru gövde. Sahte seçici tıklanınca kart seçer.
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: ({ value, onChange }: { value: string | null; onChange: (id: string, row: { name: string }) => void }) => (
    <button type="button" data-testid="item-select" data-value={value ?? ""} onClick={() => onChange("itm-1", { name: "PATOS KUMAŞ" })}>
      Ürün seç
    </button>
  ),
}));
vi.mock("@/components/forms/ServiceItemSelect", () => ({
  ServiceItemSelect: ({ value, onChange }: { value: string | null; onChange: (id: string, row: { name: string }) => void }) => (
    <button type="button" data-testid="service-select" data-value={value ?? ""} onClick={() => onChange("svc-1", { name: "Kurşun dikimi" })}>
      Hizmet seç
    </button>
  ),
}));

import { InvoiceFormDialog } from "./InvoiceFormDialog";

const typeGroups = () => screen.getAllByRole("radiogroup", { name: "Satır türü" });
const pickType = (row: number, label: string) => fireEvent.click(within(typeGroups()[row]!).getByRole("radio", { name: label }));
const checkedType = (row: number) => within(typeGroups()[row]!).getByRole("radio", { checked: true }).textContent;
type SentLine = { lineType: string; itemId: string | null; serviceItemId: string | null; description: string };

const DRAFT = {
  id: "inv-1", docNo: "FTR1", type: "SALES", status: "DRAFT", currency: "TRY", exchangeRate: 1,
  issueDate: "2026-11-08T06:00:00.000Z", dueDate: null, externalNo: null, grandTotal: 0, grandTotalTry: 0, paidTotal: 0,
  confirmedAt: null, cancelledAt: null, shipment: null, directShipment: null, subcontractorReceipt: null, returnGroupId: null,
  notes: null, subtotal: 0, discountTotal: 0, vatTotal: 0, withholdingTotal: 0, cancelReason: null,
  createdAt: "2026-11-08T06:00:00.000Z", updatedAt: "2026-11-08T06:00:00.000Z",
  cari: { id: "cari-1", kind: "CUSTOMER", taxOffice: null, customer: { id: "cus-1", code: "M1", name: "ARZU", taxNumber: null }, subcontractor: null },
  goodsReceipt: null,
  lines: [
    {
      id: "ln-1", lineNo: 1, description: "Kurşun dikimi", qty: 100, unit: "m", unitPrice: 2, discountRate: 0, vatRate: 20, withholdingRate: 0,
      lineTotal: 200, vatAmount: 40, lineType: "SERVICE",
      // Eski panel aynası: hizmet satırında `item` hizmetin kendisidir — yeni panel bunu ÜRÜN sanmamalı.
      item: { id: "svc-7", code: "HZM-000007", name: "Kurşun dikimi" },
      serviceItem: { id: "svc-7", code: "HZM-000007", name: "Kurşun dikimi", unit: "MT" },
    },
    {
      id: "ln-2", lineNo: 2, description: "PATOS", qty: 10, unit: "m", unitPrice: 5, discountRate: 0, vatRate: 20, withholdingRate: 0,
      lineTotal: 50, vatAmount: 10, lineType: "PRODUCT", item: { id: "itm-2", code: "STK-2", name: "PATOS" }, serviceItem: null,
    },
  ],
} as unknown as InvoiceDetail;

beforeEach(() => {
  vi.clearAllMocks();
  createInvoice.mockResolvedValue({ data: { id: "inv-9", docNo: "FTR9" } });
  updateInvoice.mockResolvedValue({ data: { id: "inv-1" } });
  getInvoice.mockResolvedValue(DRAFT);
});

describe("fatura satırı türü (D2)", () => {
  it("⭐ §1 ürün satırı itemId+PRODUCT; hizmet satırı serviceItemId+SERVICE; kartsız satır TEXT", async () => {
    renderWithProviders(
      <InvoiceFormDialog
        open
        onOpenChange={() => {}}
        onCreated={() => {}}
        prefill={{
          customerId: "cus-1",
          lines: [
            { description: "", qty: 10, unit: "m", unitPrice: 5, lineType: "PRODUCT" },
            { description: "", qty: 100, unit: "m", unitPrice: 2, lineType: "PRODUCT" },
            { description: "Nakliye", qty: 1, unit: "adet", unitPrice: 50 },
          ],
        }}
      />,
    );
    // Kartsız ön-dolum satırı Açıklama açılır (§5); türü verilen satır o türde → ürün modal seçicisi; Hizmet seçilince hizmet seçicisi.
    expect(checkedType(0)).toBe("Ürün");
    fireEvent.click(screen.getAllByTestId("item-select")[0]!);
    pickType(1, "Hizmet");
    fireEvent.click(screen.getByTestId("service-select"));
    // Kart adı boş açıklamayı ön-doldurur.
    expect(screen.getByDisplayValue("PATOS KUMAŞ")).toBeTruthy();
    expect(screen.getByDisplayValue("Kurşun dikimi")).toBeTruthy();
    pickType(2, "Açıklama");
    expect(within(typeGroups()[2]!.parentElement!).queryByTestId("item-select")).toBeNull();

    fireEvent.click(screen.getByText("Taslağı Oluştur"));
    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1));
    const lines = (createInvoice.mock.calls[0]![0] as { lines: SentLine[] }).lines;
    expect(lines.map(({ lineType, itemId, serviceItemId }) => ({ lineType, itemId, serviceItemId }))).toEqual([
      { lineType: "PRODUCT", itemId: "itm-1", serviceItemId: null },
      { lineType: "SERVICE", itemId: null, serviceItemId: "svc-1" },
      { lineType: "TEXT", itemId: null, serviceItemId: null },
    ]);
  });

  it("⭐ §2 tür değişince öteki türün kartı düşer (ürün kimliği hizmet satırında GİTMEZ)", async () => {
    renderWithProviders(
      <InvoiceFormDialog open onOpenChange={() => {}} onCreated={() => {}} prefill={{ customerId: "cus-1", lines: [{ description: "X", qty: 1, unit: "m", unitPrice: 1, lineType: "PRODUCT" }] }} />,
    );
    fireEvent.click(screen.getByTestId("item-select"));
    pickType(0, "Hizmet");
    expect(screen.getByTestId("service-select").getAttribute("data-value")).toBe("");
    fireEvent.click(screen.getByText("Taslağı Oluştur"));
    await waitFor(() => expect(createInvoice).toHaveBeenCalledTimes(1));
    const [line] = (createInvoice.mock.calls[0]![0] as { lines: SentLine[] }).lines;
    expect(line).toMatchObject({ lineType: "TEXT", itemId: null, serviceItemId: null });
  });

});

describe("fatura satırı türü (D2) — kayıtlı/ön-dolum satırının açılışı", () => {
  it("⭐ §3 kayıtlı taslağın hizmet satırı HİZMET türünde açılır; PATCH konuyu korur", async () => {
    renderWithProviders(<InvoiceFormDialog open editInvoiceId="inv-1" onOpenChange={() => {}} onCreated={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue("Kurşun dikimi")).toBeTruthy());
    expect(checkedType(0)).toBe("Hizmet");
    expect(screen.getByTestId("service-select").getAttribute("data-value")).toBe("svc-7");
    expect(checkedType(1)).toBe("Ürün");
    expect(screen.getByTestId("item-select").getAttribute("data-value")).toBe("itm-2");
    fireEvent.click(screen.getByText("Değişiklikleri Kaydet"));
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledTimes(1));
    const lines = (updateInvoice.mock.calls[0]![1] as { lines: SentLine[] }).lines;
    expect(lines[0]).toMatchObject({ lineType: "SERVICE", itemId: null, serviceItemId: "svc-7" });
    expect(lines[1]).toMatchObject({ lineType: "PRODUCT", itemId: "itm-2", serviceItemId: null });
  });

  it("⭐ §4 sevk taslağı ön-dolumu: hizmet satırı SERVICE, ürün satırı PRODUCT açılır", async () => {
    const lines = toPrefillLines({
      lines: [
        { itemId: "itm-3", description: "PATOS", qty: "10", unit: "m", unitPrice: "5", vatRate: 20 },
        { itemId: "svc-3", lineType: "SERVICE", serviceItemId: "svc-3", description: "Kurşun", qty: "10", unit: "m", unitPrice: "2", vatRate: 20 },
      ],
      orderPriced: 0,
      orderConflicts: 0,
      currency: "TRY",
    });
    expect(lines.map((l) => [l.lineType, l.itemId, l.serviceItemId])).toEqual([
      ["PRODUCT", "itm-3", null],
      ["SERVICE", null, "svc-3"],
    ]);
    renderWithProviders(<InvoiceFormDialog open onOpenChange={() => {}} onCreated={() => {}} prefill={{ customerId: "cus-1", lines }} />);
    expect(checkedType(0)).toBe("Ürün");
    expect(checkedType(1)).toBe("Hizmet");
    expect(screen.getByTestId("service-select").getAttribute("data-value")).toBe("svc-3");
  });

  it("⭐ §5 kartsız ön-dolum satırı AÇIKLAMA türünde açılır", () => {
    renderWithProviders(
      <InvoiceFormDialog open onOpenChange={() => {}} onCreated={() => {}} prefill={{ customerId: "cus-1", lines: [{ description: "Nakliye", qty: 1, unit: "adet", unitPrice: 50 }] }} />,
    );
    expect(checkedType(0)).toBe("Açıklama");
  });
});
