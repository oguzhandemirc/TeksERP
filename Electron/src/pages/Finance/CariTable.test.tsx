// Cari Hesaplar ortak DataTable'da: sütunlar çizilir, para birimleri tek satırda, Ekstre/Düzenle satır eylemi çalışır.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { CariRow } from "./service";
import { CariTable, useFinanceCariTable } from "./CariTable";

vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true }) }));

const ROW = {
  id: "c1", code: "MUS001", name: "ÖRNEK PERDE", isActive: true, kind: "CUSTOMER", roles: null, hold: null,
  paymentTermDays: 0, defaultCurrency: "TRY",
  balances: [{ currency: "TRY", balance: "1500" }, { currency: "USD", balance: "-20" }],
  overdue: [],
} as unknown as CariRow;

function Harness({ onStatement = () => {}, onEdit = () => {} }: { onStatement?: (r: CariRow) => void; onEdit?: (r: CariRow) => void }) {
  const table = useFinanceCariTable([ROW], { onStatement, onHold: () => {}, onEdit });
  return <CariTable table={table} isError={false} onRetry={() => {}} />;
}

describe("Cari Hesaplar — ortak DataTable", () => {
  it("sütunlar çizilir; peşin vade yazılır; bakiye sağa hizalı ve tek satır", () => {
    renderWithProviders(<Harness />);
    for (const h of ["Kod", "Ünvan", "Tür", "Vade", "Bakiye", "Gecikmiş"]) expect(screen.getByText(h)).toBeInTheDocument();
    expect(screen.getByText("Peşin")).toBeInTheDocument();
    const cell = screen.getByText("ÖRNEK PERDE").closest("tr")!.querySelectorAll("td")[4]!;
    expect(cell).toHaveClass("text-right");
    expect(cell.querySelector(".inline-flex")).not.toBeNull();
  });

  it("Ekstre ve Düzenle satır eylemleri ilgili satırla çağrılır", () => {
    const onStatement = vi.fn();
    const onEdit = vi.fn();
    renderWithProviders(<Harness onStatement={onStatement} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: /Ekstre/ }));
    fireEvent.click(screen.getByRole("button", { name: /Düzenle/ }));
    expect(onStatement).toHaveBeenCalledWith(ROW);
    expect(onEdit).toHaveBeenCalledWith(ROW);
  });
});
