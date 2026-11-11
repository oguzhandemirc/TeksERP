import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CARI_TARGETS, type CariSourceKey } from "./cari-sources";
import { customerRow, type CariRowItem } from "./cari-row";
import type { Customer } from "@/pages/Customers/types";

let access: Record<CariSourceKey, boolean>;
let perms: string[];
const allOpen = () => Object.fromEntries(Object.keys(CARI_TARGETS).map((k) => [k, true])) as Record<CariSourceKey, boolean>;
const ACCOUNT = { id: "acc1", defaultCurrency: "TRY", balances: [{ currency: "TRY", balance: 1500 }, { currency: "USD", balance: 200 }], overdue: [], riskLimit: null, taxOffice: null, paymentTermDays: null };
const STATS = { totalCount: 4, byStatus: { PENDING: 1, APPROVED: 1 }, totalOrderedQty: 900, totalShippedQty: 300, totalOpenQty: 600, overdueCount: 3, dueThisWeekCount: 0, noWorkOrderCount: 0, amountByCurrency: {} };

vi.mock("./useCariOverview", () => ({
  useCariAccess: () => access,
  useCustomerRecord: () => ({ data: undefined }),
  useCariAccount: (_id: string | null, enabled: boolean) => ({ data: enabled ? ACCOUNT : undefined, isLoading: false, isError: false }),
  useCariOrderStats: (_id: string | null, enabled: boolean) => ({ data: enabled ? STATS : undefined }),
  useCariMovements: () => ({ items: [], loading: false, error: false, retry: () => {} }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }) }));
vi.mock("@/pages/Customers/CustomerFinanceSection", () => ({ useCustomerFinanceAccess: () => ({ canWrite: perms.includes("finance:write") }) }));
vi.mock("@/pages/Finance/StatementDialog", () => ({ StatementDialog: () => null }));
vi.mock("@/pages/Finance/PaymentFormDialog", () => ({ PaymentFormDialog: () => null }));

const { CariSidePanel } = await import("./CariSidePanel");
const { useCariSelection } = await import("./useCariSelection");

const card = { id: "11111111-2222-4333-8444-555555555555", code: "MUS-1", name: "ÖRNEK PERDE", isActive: true, isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false, city: "Bursa" } as unknown as Customer;

function renderPanel(onOpenFull = vi.fn()) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CariSidePanel row={customerRow(card)} onClose={vi.fn()} onPrev={null} onNext={null} onOpenFull={onOpenFull} onEdit={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onOpenFull;
}

describe("CariSidePanel — izin ve modül kapıları", () => {
  beforeEach(() => {
    access = allOpen();
    perms = ["customer:read", "customer:write", "finance:read", "finance:write", "order:read"];
  });

  it("tam erişim: hesap TRY ve USD AYRI satır, tahsilat + ekstre + düzenle; gecikme sayacı YOK", () => {
    renderPanel();
    expect(screen.getByText("Hesap")).toBeTruthy();
    expect(screen.getByText(/1\.500,00/)).toBeTruthy();
    expect(screen.getByText(/200,00/)).toBeTruthy();
    expect(screen.queryByText(/1\.700/)).toBeNull();
    expect(screen.getByRole("button", { name: /Tahsilat al/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ekstre/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Düzenle/ })).toBeTruthy();
    expect(screen.getByText("Kalan metre")).toBeTruthy();
    expect(screen.queryByText(/Gecikmiş/)).toBeNull();
  });

  it("finans kapalı (izin ya da modül): Hesap bölümü, Ekstre ve Tahsilat hiç çizilmez", () => {
    access = { ...allOpen(), finance: false, payments: false };
    perms = ["customer:read", "order:read"];
    renderPanel();
    expect(screen.queryByText("Hesap")).toBeNull();
    expect(screen.queryByRole("button", { name: /Ekstre/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tahsilat/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Düzenle/ })).toBeNull();
  });

  it("sipariş kapalı: sipariş özeti ve 'Siparişleri' eylemi yok", () => {
    access = { ...allOpen(), orders: false };
    renderPanel();
    expect(screen.queryByText("Kalan metre")).toBeNull();
    expect(screen.queryByRole("button", { name: /Siparişleri/ })).toBeNull();
  });

  it("'Tam sayfa aç' düğmesi kayıt sayfası geçişini çağırır", () => {
    const open = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Tam sayfa aç" }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("useCariSelection — adres çubuğu durumu", () => {
  const rows: CariRowItem[] = ["a", "b", "c"].map((s, i) => customerRow({ ...card, id: `${s.repeat(8)}-0000-4000-8000-00000000000${i}`, name: s } as Customer));
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={["/definitions/cariler?filter=x"]}>{children}</MemoryRouter>;

  it("seç → ?kayit=C:<id> (öteki parametreler korunur); ↓/↑ komşu; uçta durur; kapat → parametre silinir", () => {
    const { result } = renderHook(() => ({ sel: useCariSelection(rows), loc: useLocation() }), { wrapper });
    act(() => result.current.sel.select(rows[0]!));
    expect(result.current.loc.search).toContain(`kayit=C%3A${rows[0]!.id}`);
    expect(result.current.loc.search).toContain("filter=x");
    expect(result.current.sel.prev).toBeNull();
    act(() => result.current.sel.next!());
    expect(result.current.sel.selected?.name).toBe("b");
    act(() => result.current.sel.next!());
    expect(result.current.sel.next).toBeNull();
    act(() => result.current.sel.prev!());
    expect(result.current.sel.selected?.name).toBe("b");
    act(() => result.current.sel.select(null));
    expect(result.current.loc.search).not.toContain("kayit");
    expect(result.current.sel.selected).toBeNull();
  });
});
