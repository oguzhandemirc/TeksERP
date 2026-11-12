// Cariler listesi ortak DataTable'da: sütunlar çizilir, satır tıkı seçer (gecikmeli açılış), etkin satır vurgulu,
// panel açıkken ikincil sütunlar düşer, satır içi Düzenle satırı açmadan çalışır.
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { Customer } from "@/pages/Customers/types";
import { CariListTable, useCariTable } from "./CariListTable";
import type { CariRowItem } from "./cari-row";

vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));

const ROWS: CariRowItem[] = [
  {
    kind: "CUSTOMER", id: "c1", code: "C001", name: "ÖRNEK PERDE", taxNumber: "1234567890", phone: "0212", city: "İstanbul",
    isActive: true, roles: { isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false }, record: {} as Customer,
  },
  {
    kind: "CUSTOMER", id: "c2", code: "C002", name: "BURSA TEKSTİL", taxNumber: null, phone: null, city: "Bursa",
    isActive: false, roles: { isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false }, record: {} as Customer,
  },
];

function Harness({ rows = ROWS, compact = false, selectedKey = null, onSelect = () => {}, onEdit = () => {} }: {
  rows?: CariRowItem[]; compact?: boolean; selectedKey?: string | null; onSelect?: (r: CariRowItem) => void; onEdit?: (r: CariRowItem) => void;
}) {
  const table = useCariTable(rows, compact, { onEdit, onOpenFull: () => {} });
  return <CariListTable table={table} selectedKey={selectedKey} onSelect={onSelect} />;
}

describe("Cariler — ortak DataTable", () => {
  it("bakiye sütunu yalnız yanıtta `balances` varsa; para birimi başına satır, toplanmaz", () => {
    const { unmount } = renderWithProviders(<Harness />);
    expect(screen.queryByText("Bakiye")).toBeNull();
    unmount();
    const [first, second] = ROWS as [CariRowItem, CariRowItem];
    const rows: CariRowItem[] = [
      { ...first, balances: [{ currency: "TRY", balance: "325684.90" }, { currency: "USD", balance: "-12.50" }] },
      { ...second, balances: [] },
    ];
    renderWithProviders(<Harness rows={rows} />);
    expect(screen.getByText("Bakiye")).toBeInTheDocument();
    expect(screen.getByText("325.684,90 TRY")).toBeInTheDocument();
    expect(screen.getByText("-12,50 USD")).toBeInTheDocument();
  });


  it("sütunlar çizilir; pasif satır soluk", () => {
    renderWithProviders(<Harness />);
    for (const h of ["Cari", "Rol", "Şehir", "Telefon", "Vergi no", "Durum"]) expect(screen.getByText(h)).toBeInTheDocument();
    expect(screen.getByText("BURSA TEKSTİL").closest("tr")).toHaveClass("text-muted-foreground");
  });

  it("panel açıkken (compact) Şehir/Telefon/Vergi no düşer; etkin satır aria-selected", () => {
    renderWithProviders(<Harness compact selectedKey="C:c1" />);
    expect(screen.queryByText("Şehir")).toBeNull();
    expect(screen.queryByText("Vergi no")).toBeNull();
    expect(screen.getByText("ÖRNEK PERDE").closest("tr")).toHaveAttribute("aria-selected", "true");
  });

  it("satır tıkı seçer; Düzenle düğmesi satırı açmadan düzenlemeyi açar", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    renderWithProviders(<Harness onSelect={onSelect} onEdit={onEdit} />);
    fireEvent.click(screen.getByText("BURSA TEKSTİL"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onSelect).toHaveBeenCalledWith(ROWS[1]);
    onSelect.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "ÖRNEK PERDE — düzenle" }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onEdit).toHaveBeenCalledWith(ROWS[0]);
    expect(onSelect).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
