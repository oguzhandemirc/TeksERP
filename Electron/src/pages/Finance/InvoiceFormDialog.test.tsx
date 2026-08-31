// =============================================================================
// BEKÇİ — fatura formu: TASLAK DÜZENLEME + para birimi ön-dolumu
// =============================================================================
// ⭐ SAHA KİLİTLENMESİ UÇTAN UCA: 0 fiyatlı otomatik taslak açılır, fiyat
//    girilir, kaydedilir ve panel gerçekten `PATCH /invoices/:id` çağırır.
//    Uç 2026-08-14'ten beri vardı ve panel onu HİÇ çağırmıyordu — kullanıcı
//    faturayı ne onaylayabiliyor (confirm 0 fiyatı reddediyor) ne
//    düzeltebiliyordu; tek çıkış silmekti ve silmek kaynak bağını götürüyordu.
// ⭐ PATCH GÖVDESİ `.strict()`: tür/cari/para birimi GÖNDERİLMEZ. Tek fazla
//    anahtar tüm isteği 400'e düşürür; o alanlar formda da KİLİTLİDİR (aksi
//    hâlde "kaydettim ama değişmedi" yalanı).
// ⭐ NOT KORUNUR: otomatik taslağın "kontrol edin" notu, kullanıcı yalnız fiyat
//    düzelttiğinde sessizce silinemez.
// ⭐ PARA BİRİMİ cari kartından ön-dolar ama KAYNAK BELGEYİ ezmez.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { InvoiceDetail } from "./service";

const getInvoice = vi.fn();
const updateInvoice = vi.fn();
const createInvoice = vi.fn();
const listCari = vi.fn();

vi.mock("./service", async (importOriginal) => {
  // `money` / `INVOICE_TYPE_LABEL` gibi saf yardımcılar GERÇEK kalır: ekrandaki
  // tutar biçimini de sahteleyen bir mock, testi ekrandan koparırdı.
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    getInvoice: (...a: unknown[]) => getInvoice(...a),
    updateInvoice: (...a: unknown[]) => updateInvoice(...a),
    createInvoice: (...a: unknown[]) => createInvoice(...a),
    listCari: (...a: unknown[]) => listCari(...a),
  };
});

// Cari/kalem seçicileri ağ konuşur; burada ölçülen şey seçici DEĞİL.
vi.mock("@/components/forms/ReferenceSelect", () => ({
  ReferenceSelect: ({ value, disabled }: { value: string | null; disabled?: boolean }) => (
    <div data-testid="ref-select" data-value={value ?? ""} data-disabled={disabled ? "1" : "0"} />
  ),
}));

const flags = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => flags(),
}));

const getCustomerById = vi.fn();
vi.mock("@/pages/Customers/service", () => ({
  customerService: { getById: (...a: unknown[]) => getCustomerById(...a) },
}));
vi.mock("@/pages/Subcontractors/service", () => ({
  subcontractorService: { getById: vi.fn() },
}));
vi.mock("@/pages/Items/service", () => ({
  itemService: { getById: vi.fn() },
}));

import { InvoiceFormDialog } from "./InvoiceFormDialog";

/** ⚠️ Diyalog PORTAL'a çizilir: `render` sonucundaki `container` onu KAPSAMAZ
 *  ve boş küme sorgulayan bir test sessizce yeşil kalır. */
const selectsInDialog = () => Array.from(document.querySelectorAll("select"));
const currencySelect = () => selectsInDialog()[2] as HTMLSelectElement;

/** Sevkten otomatik doğan 0 fiyatlı taslak (saha vakası). */
const DRAFT: InvoiceDetail = {
  id: "inv-1",
  docNo: "FTR1508260001",
  type: "SALES",
  status: "DRAFT",
  currency: "USD",
  exchangeRate: 34.5,
  issueDate: "2026-08-15T06:00:00.000Z",
  dueDate: "2026-09-14T00:00:00.000Z",
  externalNo: null,
  grandTotal: 0,
  grandTotalTry: 0,
  paidTotal: 0,
  confirmedAt: null,
  cancelledAt: null,
  shipment: { id: "sh-1", shipmentNo: "SVK1508260001" },
  directShipment: null,
  subcontractorReceipt: null,
  returnGroupId: null,
  notes: "Sevkiyattan otomatik oluşturuldu — sipariş fiyatı çelişkili, kontrol edin",
  subtotal: 0,
  discountTotal: 0,
  vatTotal: 0,
  withholdingTotal: 0,
  cancelReason: null,
  createdAt: "2026-08-15T06:00:00.000Z",
  updatedAt: "2026-08-15T06:00:00.000Z",
  cari: {
    id: "cari-1",
    kind: "CUSTOMER",
    taxOffice: null,
    customer: { id: "cus-1", code: "MUS1508260001", name: "ARZU TEKSTİL", taxNumber: null },
    subcontractor: null,
  },
  goodsReceipt: null,
  lines: [
    {
      id: "ln-1",
      lineNo: 1,
      description: "PATOS · SİYAH",
      qty: 612.5,
      unit: "m",
      unitPrice: 0,
      discountRate: 0,
      vatRate: 20,
      withholdingRate: 0,
      lineTotal: 0,
      vatAmount: 0,
      item: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  flags.mockReturnValue({ data: { data: { financeEnabled: false, financeDefaultVatRate: 20 } } });
  getInvoice.mockResolvedValue(DRAFT);
  updateInvoice.mockResolvedValue({ data: { id: "inv-1" }, message: "Taslak güncellendi." });
  listCari.mockResolvedValue({ data: [], pagination: { total: 0, totalPages: 1 } });
});

describe("düzenleme modu", () => {
  it("⭐ kayıtlı taslağı yükler ve başlıkta belge numarasını basar", async () => {
    renderWithProviders(
      <InvoiceFormDialog open editInvoiceId="inv-1" onOpenChange={() => {}} onCreated={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText(/Taslağı Düzenle — FTR1508260001/)).toBeTruthy());
    expect(getInvoice).toHaveBeenCalledWith("inv-1");
    expect(screen.getByDisplayValue("PATOS · SİYAH")).toBeTruthy();
  });

  it("⭐ SAHA SENARYOSU: 0 fiyatlı satıra fiyat girilir → PATCH çağrılır", async () => {
    renderWithProviders(
      <InvoiceFormDialog open editInvoiceId="inv-1" onOpenChange={() => {}} onCreated={() => {}} />,
    );
    await waitFor(() => expect(screen.getByDisplayValue("PATOS · SİYAH")).toBeTruthy());

    // Fiyat kutusu boş görünür (0 → ""), kullanıcı yazar.
    const priceInput = screen.getByDisplayValue("612.5").parentElement?.querySelectorAll("input")[3];
    expect(priceInput).toBeTruthy();
    fireEvent.change(priceInput as HTMLInputElement, { target: { value: "4.25" } });

    fireEvent.click(screen.getByText("Değişiklikleri Kaydet"));
    await waitFor(() => expect(updateInvoice).toHaveBeenCalledTimes(1));

    const [id, body] = updateInvoice.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe("inv-1");
    const lines = body.lines as Array<{ unitPrice: number; qty: number }>;
    expect(lines[0]!.unitPrice).toBe(4.25);
    expect(lines[0]!.qty).toBe(612.5);
  });

  it("⭐ PATCH gövdesi tür/cari/para birimi TAŞIMAZ (.strict() 400 üretirdi)", async () => {
    renderWithProviders(
      <InvoiceFormDialog open editInvoiceId="inv-1" onOpenChange={() => {}} onCreated={() => {}} />,
    );
    await waitFor(() => expect(screen.getByDisplayValue("PATOS · SİYAH")).toBeTruthy());
    fireEvent.click(screen.getByText("Değişiklikleri Kaydet"));
    await waitFor(() => expect(updateInvoice).toHaveBeenCalled());

    const body = (updateInvoice.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(Object.keys(body).sort()).toEqual(["dueDate", "externalNo", "lines", "notes"]);
  });

  it("⭐ otomatik taslağın NOTU korunur (yalnız fiyat düzeltilse bile)", async () => {
    renderWithProviders(
      <InvoiceFormDialog open editInvoiceId="inv-1" onOpenChange={() => {}} onCreated={() => {}} />,
    );
    await waitFor(() => expect(screen.getByDisplayValue("PATOS · SİYAH")).toBeTruthy());
    fireEvent.click(screen.getByText("Değişiklikleri Kaydet"));
    await waitFor(() => expect(updateInvoice).toHaveBeenCalled());

    const body = (updateInvoice.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(body.notes).toBe(DRAFT.notes);
  });

  it("⭐ tür / cari türü / para birimi KİLİTLİ çizilir", async () => {
    renderWithProviders(
      <InvoiceFormDialog open editInvoiceId="inv-1" onOpenChange={() => {}} onCreated={() => {}} />,
    );
    await waitFor(() => expect(screen.getByDisplayValue("PATOS · SİYAH")).toBeTruthy());
    // ⚠️ Diyalog PORTAL'a çizilir — `container` onu KAPSAMAZ; sorgular
    // `document` üzerinden yapılır (yoksa test boş küme görüp sessizce geçer).
    const selects = selectsInDialog();
    // tür · cari türü · para birimi
    expect(selects.length).toBe(3);
    selects.forEach((s) => expect((s as HTMLSelectElement).disabled).toBe(true));
    // Satır "Kalem" seçicileri de aynı bileşendir; CARİ seçicisi taşıdığı
    // değerle ayrılır (satır seçicileri boş).
    const partyPicker = screen
      .getAllByTestId("ref-select")
      .find((el) => el.getAttribute("data-value") === "cus-1");
    expect(partyPicker?.getAttribute("data-disabled")).toBe("1");
  });

  it("⭐ ONAYLI fatura düzenlenemez — form HİÇ açılmaz", async () => {
    getInvoice.mockResolvedValue({ ...DRAFT, status: "CONFIRMED" });
    renderWithProviders(
      <InvoiceFormDialog open editInvoiceId="inv-1" onOpenChange={() => {}} onCreated={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText(/artık taslak değil/)).toBeTruthy());
    expect(screen.queryByText("Değişiklikleri Kaydet")).toBeNull();
  });

  it("yükleme hatası 'silinmiş' DEMEZ", async () => {
    getInvoice.mockRejectedValue(new Error("network"));
    renderWithProviders(
      <InvoiceFormDialog open editInvoiceId="inv-1" onOpenChange={() => {}} onCreated={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText(/silindiği anlamına gelmez/)).toBeTruthy());
  });
});

describe("para birimi ön-dolumu", () => {
  beforeEach(() => {
    flags.mockReturnValue({ data: { data: { financeEnabled: true, financeDefaultVatRate: 20 } } });
    getCustomerById.mockResolvedValue({ data: { id: "cus-1", code: "MUS-1", name: "ARZU" } });
    listCari.mockResolvedValue({
      data: [
        {
          id: "cari-1",
          kind: "CUSTOMER",
          code: "MUS-1",
          name: "ARZU",
          defaultCurrency: "USD",
          paymentTermDays: null,
          balances: [],
          isActive: true,
          taxNumber: null,
          taxOffice: null,
          riskLimit: null,
          notes: null,
        },
      ],
      pagination: { total: 1, totalPages: 1 },
    });
  });

  it("⭐ dokunulmamış alan cari kartının para birimine döner (USD müşteriye TRY fatura yok)", async () => {
    renderWithProviders(
      <InvoiceFormDialog
        open
        onOpenChange={() => {}}
        onCreated={() => {}}
        prefill={{ customerId: "cus-1", lines: [] }}
      />,
    );
    expect(currencySelect().value).toBe("TRY");
    await waitFor(() => expect(currencySelect().value).toBe("USD"));
    expect(screen.getByText(/Cari kartından geldi \(USD\)/)).toBeTruthy();
  });

  it("⭐ KAYNAK BELGE para birimi dayattıysa öneri EZMEZ", async () => {
    renderWithProviders(
      <InvoiceFormDialog
        open
        onOpenChange={() => {}}
        onCreated={() => {}}
        prefill={{ customerId: "cus-1", currency: "EUR", lines: [], sourceLabel: "SVK-1" }}
      />,
    );
    expect(currencySelect().value).toBe("EUR");
    // Cari sorgusu settle olduktan sonra da EUR kalmalı.
    await waitFor(() => expect(listCari).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(currencySelect().value).toBe("EUR");
  });

  it("⭐ kullanıcının SEÇTİĞİ para birimi ezilmez", async () => {
    renderWithProviders(
      <InvoiceFormDialog
        open
        onOpenChange={() => {}}
        onCreated={() => {}}
        prefill={{ customerId: "cus-1", lines: [] }}
      />,
    );
    fireEvent.change(currencySelect(), { target: { value: "GBP" } });
    await waitFor(() => expect(listCari).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(currencySelect().value).toBe("GBP");
  });
});
