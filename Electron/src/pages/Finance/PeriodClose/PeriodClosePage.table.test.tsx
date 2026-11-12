// Dönem kapanışı (cari) ortak DataTable'da: sütunlar çizilir, yeniden açılmış satır eylem taşımaz, "Yeniden Aç" diyaloğu açar.
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { PeriodCloseRow } from "./service";
import { PeriodClosePage } from "./PeriodClosePage";

// Başlık (sık kullanılanlar) tercih sağlayıcısı ister; burada ölçülen tablo.
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <div><h1>{title}</h1>{actions}</div> }));
vi.mock("./CariPicker", () => ({ CariPicker: () => <button type="button">Cari seçin…</button> }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }) }));

const base = {
  cariId: "c1", currency: "TRY", closingBalance: "1500", txnCount: 12, notes: null, closedById: null,
  createdAt: "2026-01-05T09:00:00.000Z", reopenedById: null, reopenReason: null,
};
const ACTIVE = { ...base, id: "p1", cariCode: "MUS001", cariName: "ÖRNEK PERDE", periodEnd: "2025-12-31", reopenedAt: null } as unknown as PeriodCloseRow;
const REOPENED = { ...base, id: "p2", cariCode: "MUS002", cariName: "DİĞER TEKSTİL", periodEnd: "2025-11-30", reopenedAt: "2026-01-02T08:00:00.000Z", reopenReason: "düzeltme" } as unknown as PeriodCloseRow;

vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  listPeriodCloses: vi.fn(async () => ({ data: [ACTIVE, REOPENED], pagination: { page: 1, pageSize: 200, total: 2, totalPages: 1 } })),
}));

describe("Dönem kapanışı — ortak DataTable", () => {
  it("sütunlar çizilir; yeniden açılan satır soluk ve eylemsiz; Yeniden Aç diyaloğu açar", async () => {
    const { container } = renderWithProviders(<PeriodClosePage />);
    const activeRow = (await screen.findByText("ÖRNEK PERDE")).closest("tr")!;
    const heads = [...container.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
    for (const h of ["Cari", "Para", "Dönem sonu", "Mühürlü bakiye", "Hareket", "Kapatıldı", "Not"]) expect(heads.some((t) => t.includes(h))).toBe(true);
    expect(screen.getByRole("button", { name: /Sütunlar/ })).toBeInTheDocument();

    const reopenedRow = screen.getByText("DİĞER TEKSTİL").closest("tr")!;
    expect(reopenedRow).toHaveClass("opacity-60");
    expect(within(reopenedRow).getByText(/Açılma: .* — düzeltme/)).toBeInTheDocument();
    expect(within(reopenedRow).queryByRole("button", { name: /Yeniden Aç/ })).toBeNull();
    expect(within(activeRow).getByRole("button", { name: "Doğrula" })).toBeInTheDocument();

    fireEvent.click(within(activeRow).getByRole("button", { name: /Yeniden Aç/ }));
    expect(await screen.findByText("Dönemi yeniden aç")).toBeInTheDocument();
  });
});
