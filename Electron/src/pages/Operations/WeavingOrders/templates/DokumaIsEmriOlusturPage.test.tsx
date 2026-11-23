// "Dokuma İş Emri oluştur" (İE ayrımı 2026-11-23): yalnız dokuma — Standart Dokuma + özel dokuma şablonları.
// Negatif sonda: şablon karosunda `preset` kaldırılınca "ön-dolguyla gezinir" kırmızı.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { DokumaIsEmriOlusturPage } from "./DokumaIsEmriOlusturPage";
import type { WeavingOrderTemplate } from "./types";

const navigateActive = vi.fn();
vi.mock("@/store/tabs", () => ({ useTabsStore: (sel: (s: unknown) => unknown) => sel({ navigateActive }) }));
vi.mock("@/components/layout/PageHeader", () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
const list: { rows: WeavingOrderTemplate[] } = { rows: [] };
vi.mock("./service", () => ({
  WEAVING_TEMPLATES_KEY: ["weaving-order-templates"],
  weavingTemplateService: { listActive: () => Promise.resolve(list.rows), create: vi.fn(), update: vi.fn(), deactivate: vi.fn() },
}));
vi.mock("./WeavingTemplateFormDialog", () => ({ WeavingTemplateFormDialog: ({ initial }: { initial: WeavingOrderTemplate | null }) => <div data-testid="tpl-dialog">{initial?.name ?? "yeni"}</div> }));

const tpl: WeavingOrderTemplate = {
  id: "t1", name: "Fason — Ayhan", description: null, itemId: "i1", executionKind: "SUBCONTRACTED", subcontractorId: "s1",
  plannedM: "1200.000", notes: null, sortOrder: 0, isActive: true, subcontractor: { id: "s1", code: "F1", name: "Ayhan" },
};

beforeEach(() => {
  navigateActive.mockReset();
  list.rows = [];
});

describe("Dokuma İş Emri oluştur", () => {
  it("⭐ Standart satırda YALNIZ Dokuma; tık listeye oluşturma diyaloğu açık gider", async () => {
    renderWithProviders(<DokumaIsEmriOlusturPage />);
    const row = screen.getByTestId("wo-row-standard");
    expect(within(row).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByTestId("oie-terbiye")).toBeNull();
    await userEvent.click(screen.getByTestId("wo-standard"));
    expect(navigateActive).toHaveBeenCalledWith("/operations/weaving-orders", { state: { openNew: true } });
  });
  it("⭐ şablon karosu ön-dolguyla gezinir; 'Yeni özel' kartı son sırada ve diyaloğu açar", async () => {
    list.rows = [tpl];
    renderWithProviders(<DokumaIsEmriOlusturPage />);
    await userEvent.click(await screen.findByText("Fason — Ayhan"));
    expect(navigateActive).toHaveBeenCalledWith("/operations/weaving-orders", {
      state: { openNew: true, preset: { itemId: "i1", executionKind: "SUBCONTRACTED", subcontractorId: "s1", plannedM: "1200" } },
    });
    const tiles = within(screen.getByTestId("wo-row-templates")).getAllByTestId(/^wo-(template|new-template)$/);
    expect(tiles.at(-1)).toHaveAttribute("data-testid", "wo-new-template");
    await userEvent.click(screen.getByTestId("wo-new-template"));
    expect(screen.getByTestId("tpl-dialog")).toHaveTextContent("yeni");
  });
  it("düzenle düğmesi gezinmeden şablon diyaloğunu açar", async () => {
    list.rows = [tpl];
    renderWithProviders(<DokumaIsEmriOlusturPage />);
    await userEvent.click(await screen.findByTestId("wo-template-edit"));
    expect(screen.getByTestId("tpl-dialog")).toHaveTextContent("Fason — Ayhan");
    expect(navigateActive).not.toHaveBeenCalled();
  });
});
