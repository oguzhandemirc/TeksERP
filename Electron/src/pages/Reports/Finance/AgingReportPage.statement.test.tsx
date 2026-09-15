// =============================================================================
// CARİ YAŞLANDIRMA → EKSTRE DÜĞMESİ — rapor kapısı DİYALOG için de geçerli (Raporlar K5)
// =============================================================================
// `finance/statement` bir diyalog raporudur (katalog `yuzey: "diyalog"`); karo/route/palet
// yolu yok, tetikleyicisi Aging satırındaki "Cari ekstresi" düğmesi. Kapalıysa düğme BELİRMEZ
// ve diyalog mount edilmez — backend zaten 403 verir, düğme kalsa "tıklanan boş hata" olurdu.
//
// Negatif sonda (bir kezlik, geri alındı — sha commit mesajında): `AgingReportPage`te
// `statementOpen` koşulu kaldırıldı (handler her zaman geçti) → §1 ❌.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";
import type { AgingReport } from "./service";

let closed: string[] = [];
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: false, dokumaEnabled: false,
    financeEnabled: true, productionEnabled: true, ticaretEnabled: false, iplikEnabled: false,
    reportsClosedKeys: closed,
    isReportOpen: (key: string) => !closed.includes(key),
  }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ isAdmin: true, hasPermission: () => true }) }));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));
vi.mock("./service", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./service")>();
  // R5b-d: uç artık ZARF döner (`data` + `meta.secenekler` + `suzgec`).
  return { ...mod, getAgingReport: () => Promise.resolve({ success: true as const, data: REPORT, meta: { secenekler: { cariId: [{ id: "c1", ad: "Deneme Cari", kod: "C-1" }] } } }) };
});

const B = { current: "0", d1_30: "0", d31_60: "0", d61_90: "0", d90p: "0" } as unknown as AgingReport["blocks"][number]["totals"]["gross"];
const REPORT: AgingReport = {
  asOf: "2026-09-15T20:59:59.999Z",
  buckets: [],
  blocks: [
    {
      currency: "TRY",
      tryRate: null,
      rateDate: null,
      rows: [
        {
          cariId: "c1", code: "C-1", name: "Deneme Cari", kind: "CUSTOMER", currency: "TRY",
          gross: B, net: B, virtualOffset: "0", openTotal: "100", unappliedCredit: "0", overdueTotal: "0",
          ledgerBalance: "100", storedBalance: "100", reconDiff: "0", storedDiff: "0", oldestDueDate: null, oldestDaysOverdue: null,
        } as AgingReport["blocks"][number]["rows"][number],
      ],
      totals: { gross: B, net: B, virtualOffset: "0", openTotal: "100", unappliedCredit: "0", overdueTotal: "0", ledgerBalance: "100" },
      totalsTry: null,
    },
  ],
  notes: [],
  reconciliation: { rowsChecked: 1, mismatchedRows: 0, samples: [], allocationDriftInvoices: 0, allocationDriftPayments: 0 },
};

import { AgingReportPage } from "./AgingReportPage";

describe("Aging → ekstre düğmesi rapor kapısına bağlı", () => {
  beforeEach(() => {
    closed = [];
  });

  it("§0 zemin: rapor açıkken satır çizilir ve 'Cari ekstresi' düğmesi VAR", async () => {
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText("Deneme Cari")).toBeInTheDocument());
    expect(screen.getByTitle("Cari ekstresi")).toBeInTheDocument();
  });

  it("§1 ⭐ `finance/statement` KAPALI → düğme belirmez; yaşlandırma satırı ve fatura dökümü düğmesi durur", async () => {
    closed = ["finance/statement"];
    renderWithProviders(<AgingReportPage />);
    await waitFor(() => expect(screen.getByText("Deneme Cari")).toBeInTheDocument());
    expect(screen.queryByTitle("Cari ekstresi")).toBeNull();
    expect(screen.getByTitle("Açık fatura dökümü")).toBeInTheDocument(); // kontrol grubu: komşu düğme dokunulmadı
  });
});
