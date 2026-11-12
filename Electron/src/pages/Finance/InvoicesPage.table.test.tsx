// Faturalar ortak DataTable'da: sütunlar çizilir, statüye göre eylemler (taslak: Düzenle/Onayla/Sil, onaylı: Yazdır/Storno),
// izin kapısı eylemi gizler, "Onayla" somut onay diyaloğunu açar.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { InvoiceRow } from "./service";
import { InvoicesPage } from "./InvoicesPage";

let allowed = true;
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => allowed, hasAnyPermission: () => allowed }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: { data: {} } }) }));
// Başlık (sık kullanılanlar) tercih sağlayıcısı ister; burada ölçülen tablo.
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <div><h1>{title}</h1>{actions}</div> }));

const cari = { id: "c1", kind: "CUSTOMER", customer: { code: "MUS001", name: "ÖRNEK PERDE" }, subcontractor: null };
const base = { currency: "TRY", exchangeRate: 1, issueDate: "2026-11-01T09:00:00.000Z", dueDate: null, externalNo: null, grandTotal: 1500, grandTotalTry: 1500, confirmedAt: null, cancelledAt: null, cari };
const DRAFT = { ...base, id: "i1", docNo: "FT-0001", type: "SALES", status: "DRAFT", paidTotal: 0 } as unknown as InvoiceRow;
const CONFIRMED = { ...base, id: "i2", docNo: "FT-0002", type: "SALES", status: "CONFIRMED", paidTotal: 500, currency: "USD", grandTotalTry: 52000 } as unknown as InvoiceRow;

vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  listInvoices: vi.fn(async (p: { pageSize: number }) =>
    p.pageSize === 1
      ? { data: [], pagination: { page: 1, pageSize: 1, total: 1, totalPages: 1 } }
      : { data: [DRAFT, CONFIRMED], pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 } }),
}));

describe("Faturalar — ortak DataTable", () => {
  beforeEach(() => { allowed = true; });

  it("sütunlar tek satır çizilir; taslak ve onaylı satır kendi eylemlerini taşır; Onayla diyaloğu açar", async () => {
    const { container } = renderWithProviders(<InvoicesPage />);
    const draftRow = (await screen.findByText("FT-0001")).closest("tr")!;
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    for (const h of ["Belge no", "Tür", "Cari", "Tarih", "Durum", "Tutar", "Kapanan / Açık"]) expect(heads.some((t) => t.includes(h))).toBe(true);
    expect(screen.getByRole("button", { name: /Sütunlar/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ara…")).toHaveAttribute("aria-label", "Belge no / cari ara");

    const confirmedRow = screen.getByText("FT-0002").closest("tr")!;
    expect(within(confirmedRow).getByText(/≈/)).toBeInTheDocument();
    expect(within(confirmedRow).getByText("Kısmi")).toBeInTheDocument();
    expect(within(confirmedRow).getByRole("button", { name: "Yazdır" })).toBeInTheDocument();
    expect(within(confirmedRow).getByRole("button", { name: /İptal \(storno\)/ })).toBeInTheDocument();
    expect(within(draftRow).queryByRole("button", { name: "Yazdır" })).toBeNull();
    expect(within(draftRow).getByRole("button", { name: "Taslağı sil" })).toBeInTheDocument();

    fireEvent.click(within(draftRow).getByRole("button", { name: /Onayla/ }));
    expect(await screen.findByText("Faturayı onayla")).toBeInTheDocument();
  });

  it("izin yoksa yazma eylemleri çizilmez, Detay kalır", async () => {
    allowed = false;
    renderWithProviders(<InvoicesPage />);
    const draftRow = (await screen.findByText("FT-0001")).closest("tr")!;
    expect(within(draftRow).getByRole("button", { name: "Detay" })).toBeInTheDocument();
    expect(within(draftRow).queryByRole("button", { name: /Onayla|Düzenle|Taslağı sil/ })).toBeNull();
  });
});
