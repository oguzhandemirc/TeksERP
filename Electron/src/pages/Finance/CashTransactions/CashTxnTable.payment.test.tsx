// BEKÇİ — Kasa Hareketleri tablosu, tek yazar (2026-09-18): ödemeden doğan satır (paymentId) Kaynak hücresinde ödemeyi gösterir
//   ve tıklayınca Tahsilat/Ödeme listesine belge no aramasıyla gider; İPTAL düğmesi çizilmez (iptali ödemenin iptalidir);
//   masraf satırında iptal düğmesi durur, Kaynak "—".
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { CashTxnRow } from "./service";

const opened: string[] = [];
vi.mock("@/components/layout/tabs/use-tab-target", () => ({ useDrillTarget: (to: string) => ({ onClick: () => opened.push(to), onAuxClick: () => {}, onContextMenu: () => {} }) }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true }) }));
import { CashTxnTable } from "./CashTxnTable";

const base = { status: "ACTIVE", currency: "TRY", amount: 100, txnDate: "2026-09-18T08:00:00Z", category: null, description: null, reference: null, transferGroupId: null, cashBox: { id: "k1", name: "Ana Kasa" }, bankAccount: null } as const;
const rows: CashTxnRow[] = [
  { ...base, id: "a", docNo: "KH-1", kind: "COLLECTION", direction: "IN", paymentId: "p1", payment: { id: "p1", docNo: "TH-77", direction: "IN", cari: { id: "c1", name: "Müşteri A" } } },
  { ...base, id: "b", docNo: "KH-2", kind: "EXPENSE", direction: "OUT", paymentId: null, payment: null },
];

describe("CashTxnTable — ödeme satırı", () => {
  it("⭐ Kaynak hücresi ödemeyi gösterir ve Tahsilat/Ödeme listesine arama ile gider; iptal düğmesi yalnız masraf satırında", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CashTxnTable rows={rows} onCancel={onCancel} />);
    expect(screen.getByText("Tahsilat")).toBeInTheDocument();
    const link = screen.getByTitle("Tahsilat/Ödeme kaydını aç");
    expect(link).toHaveTextContent("TH-77");
    expect(link).toHaveTextContent("Müşteri A");
    await user.click(link);
    expect(opened).toEqual(["/finance/payments?search=TH-77"]);
    const cancelButtons = screen.getAllByRole("button", { name: /İptal/ });
    expect(cancelButtons).toHaveLength(1);
    const expenseRow = screen.getByText("KH-2").closest("tr")!;
    expect(expenseRow).toContainElement(cancelButtons[0]!);
    expect(expenseRow).toHaveTextContent("—");
  });
});
