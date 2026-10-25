// Liste: fabrika varsayılanı üstte, müşteri spesifikasyonları altta; boş durum ve bant özeti.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const list = vi.fn();
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), ruleSetService: { list: (...a: unknown[]) => list(...a), create: vi.fn(), update: vi.fn(), setActive: vi.fn() } }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header> }));
vi.mock("@/components/PermissionGate", () => ({ PermissionGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { InspectionRulesPage } from "./InspectionRulesPage";

const band = (maxScore: string | null, label: string) => ({ sortOrder: 0, maxScore, label, accepted: maxScore !== null, qualityGradeId: null });
const set = (over: Record<string, unknown>) => ({ id: "x", name: "S", scope: "FACTORY", customerId: null, itemId: null, unit: "M2", runningCap: "YARD", isActive: true, createdAt: "", updatedAt: "", customer: null, item: null, bands: [band("20.00", "A"), band(null, "B")], ...over });

describe("InspectionRulesPage", () => {
  beforeEach(() => { list.mockReset(); });
  it("boş: iki bölüm de boş durumunu söyler, fabrika varsayılanı düğmesi görünür", async () => {
    list.mockResolvedValue([]);
    renderWithProviders(<InspectionRulesPage />);
    expect(await screen.findByText(/Fabrika varsayılanı yok/)).toBeInTheDocument();
    expect(screen.getByText(/Müşteriye özel kural yok/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fabrika varsayılanı/ })).toBeInTheDocument();
  });
  it("dolu: fabrika seti müşteri setinden ÖNCE; bant özeti; aktif fabrika varken yeni fabrika düğmesi yok", async () => {
    list.mockResolvedValue([
      set({ id: "c", name: "Zara özel", scope: "CUSTOMER", customerId: "k", customer: { id: "k", name: "ZARA" } }),
      set({ id: "f", name: "Fabrika standardı" }),
    ]);
    renderWithProviders(<InspectionRulesPage />);
    const rows = await screen.findAllByTestId("rule-set-row");
    expect(rows.map((r) => within(r).getByText(/standardı|özel/).textContent)).toEqual(["Fabrika standardı", "Zara özel"]);
    expect(within(rows[0]!).getByText("A ≤ 20,00 · B > 20,00")).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/ZARA · tüm ürünler/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Fabrika varsayılanı$/ })).toBeNull();
  });
});
