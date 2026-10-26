// BEKÇİ — Kasa defteri: belge para birimi hesap para biriminden farklıysa satırda
// uyarı rozeti + ipucu (yalnız gösterim, kur çevrimi yok); eski backend → rozet yok.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { CashTxnRow } from "./service";
import { currencyMismatchOf } from "./currencyMismatch";

vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useDrillTarget: () => ({ onClick: () => {}, onAuxClick: () => {}, onContextMenu: () => {} }) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
import { CashTxnTable } from "./CashTxnTable";

const base = { status: "ACTIVE", currency: "TRY", amount: 100, txnDate: "2026-09-18T08:00:00Z", category: null, description: null, reference: null, transferGroupId: null, bankAccount: null, kind: "EXPENSE", direction: "OUT", paymentId: null, payment: null } as const;
const usdBox = { id: "k2", name: "Döviz Kasası", currency: "USD" } as const;
const tryBox = { id: "k1", name: "Ana Kasa", currency: "TRY" } as const;

describe("kasa defteri — para birimi rozeti", () => {
  it("belge TRY, kasa USD → rozet + ipucu; eşit ve eski backend → yok", () => {
    const rows: CashTxnRow[] = [
      { ...base, id: "a", docNo: "KH-1", cashBox: usdBox },
      { ...base, id: "b", docNo: "KH-2", cashBox: tryBox },
      { ...base, id: "c", docNo: "KH-3", cashBox: { id: "k3", name: "Eski" } },
    ];
    renderWithProviders(<CashTxnTable rows={rows} onCancel={() => {}} />);
    const badges = screen.getAllByTestId("currency-mismatch");
    expect(badges).toHaveLength(1);
    expect(screen.getByText("KH-1").closest("tr")).toContainElement(badges[0]!);
    expect(badges[0]).toHaveTextContent("Hesap USD");
    expect(badges[0]!.getAttribute("title")).toContain("Belge TRY");
  });

  it("ödeme belgesinin para birimi de ölçülür", () => {
    const row = { ...base, currency: "USD", cashBox: usdBox, payment: { id: "p", docNo: "TH-1", direction: "IN", currency: "EUR", cari: { id: "c", name: "X" } } } as const;
    expect(currencyMismatchOf(row as unknown as CashTxnRow)).toMatchObject({ doc: "EUR", account: "USD" });
    expect(currencyMismatchOf({ ...row, payment: null } as unknown as CashTxnRow)).toBeNull();
  });
});
