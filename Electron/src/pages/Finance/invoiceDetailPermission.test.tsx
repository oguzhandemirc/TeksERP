// =============================================================================
// BEKÇİ — FATURA DETAYINDAKİ "DÜZENLE" İZİNSİZ ÇİZİLMEZ
// =============================================================================
// ⭐ NEDEN VAR (2026-08-15). Aynı eylem İKİ yüzeyde farklı kapıya bağlanmıştı:
//    liste satırındaki "Düzenle" `PermissionGate finance:write` içindeydi,
//    detay diyaloğundaki ikizi KOŞULSUZDU. Uç ise kapılı:
//    `PATCH /api/finance/invoices/:id` → `requirePermission("finance:write")`.
//
//    Saha senaryosu: "Kasa / Tahsilat" rolü (`role-template-catalog` →
//    finance:read + finance:payment + finance:cheque; finance:write YOK)
//    Faturalar'ı açar, listede Düzenle GÖRMEZ, taslağın detayını açınca GÖRÜR;
//    tıklar, formu doldurur, "Değişiklikleri Kaydet" der ve 403 ile bütün
//    emeğini kaybeder. Kod tabanının kendi kuralı: iş yapmayan düğme konmaz
//    ("gri buton bile olmayan bir yolu vaat eder").
//
// ⭐ ÖLÇÜLEN: aynı taslak, aynı bileşen, YALNIZ izin listesi değişiyor.
//    İzinsizde düğme YOK · izinliyde VAR ve geri çağrıyı tetikliyor.
//
// NEGATİF SONDA (koşuldu, kırmızı görüldü): `InvoiceDetailDialog`taki
// `PermissionGate` sarmalayıcısı kaldırıldı → "izinsizde çizilmez" KIRMIZI.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import type { JwtPayload } from "@/types/auth";
import type { InvoiceDetail } from "./service";

const getInvoice = vi.fn();
const listAllocations = vi.fn();

vi.mock("./service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./service")>();
  return {
    ...actual,
    getInvoice: (...a: unknown[]) => getInvoice(...a),
    listAllocations: (...a: unknown[]) => listAllocations(...a),
  };
});

import { InvoiceDetailDialog } from "./InvoiceDetailDialog";

const draft = {
  id: "inv-1",
  docNo: "AF1508260001",
  type: "PURCHASE",
  status: "DRAFT",
  currency: "TRY",
  exchangeRate: "1",
  issueDate: new Date().toISOString(),
  dueDate: null,
  externalNo: null,
  notes: null,
  subtotal: "0",
  vatTotal: "0",
  grandTotal: "0",
  grandTotalTry: "0",
  paidTotal: "0",
  cari: { id: "c1", kind: "CUSTOMER", customer: { id: "x", code: "X", name: "Tedarikçi" } },
  lines: [],
} as unknown as InvoiceDetail;

function login(permissions: string[]) {
  useAuthStore.setState({
    user: { userId: "u1", username: "t", permissions } as unknown as JwtPayload,
    isHydrated: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // ⚠️ `getInvoice` sarmalayıcı DEĞİL, doğrudan `InvoiceDetail` döner
  // (`InvoiceDetailDialog` → `const inv = q.data`).
  getInvoice.mockResolvedValue(draft);
  listAllocations.mockResolvedValue({ data: [], pagination: { total: 0 } });
});

describe("InvoiceDetailDialog — Düzenle izin kapısı", () => {
  it("⭐ finance:write YOKKEN 'Düzenle' ÇİZİLMEZ (uç 403 verirdi)", async () => {
    login(["finance:read", "finance:payment", "finance:cheque"]);
    const onEditDraft = vi.fn();
    renderWithProviders(
      <InvoiceDetailDialog
        invoiceId="inv-1"
        open
        onOpenChange={() => {}}
        onEditDraft={onEditDraft}
      />,
    );
    // Diyalog gerçekten açıldı (körlük zemini): belge numarası ekranda.
    await waitFor(() => expect(screen.getAllByText(/AF1508260001/).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /düzenle/i })).toBeNull();
  });

  it("finance:write VARKEN 'Düzenle' çizilir ve geri çağrıyı tetikler", async () => {
    login(["finance:read", "finance:write"]);
    const onEditDraft = vi.fn();
    renderWithProviders(
      <InvoiceDetailDialog
        invoiceId="inv-1"
        open
        onOpenChange={() => {}}
        onEditDraft={onEditDraft}
      />,
    );
    const btn = await screen.findByRole("button", { name: /düzenle/i });
    btn.click();
    await waitFor(() => expect(onEditDraft).toHaveBeenCalledTimes(1));
  });
});
