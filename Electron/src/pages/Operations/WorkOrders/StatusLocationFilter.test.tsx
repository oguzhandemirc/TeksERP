import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/picker-loader", () => ({
  loadAllForPicker: vi.fn(async () => ({
    success: true,
    data: [
      { id: "st-kursun", name: "Kurşun", type: "INTERNAL", kind: "PROCESS_QC", isActive: true },
      { id: "st-boya", name: "Boyahane", type: "EXTERNAL", kind: "SUBCONTRACTOR", isActive: true },
      { id: "st-tezgah", name: "Tezgah 1", type: "INTERNAL", kind: "WEAVING", isActive: true },
      { id: "st-pasif", name: "Eski Ram", type: "INTERNAL", kind: "OTHER", isActive: false },
    ],
    pagination: { page: 1, pageSize: 500, total: 4, totalPages: 1 },
  })),
}));

import { StatusLocationChips, StatusLocationFilter } from "./StatusLocationFilter";

function Search() {
  return <div data-testid="search">{decodeURIComponent(useLocation().search)}</div>;
}
const search = () => screen.getByTestId("search").textContent ?? "";

describe("StatusLocationFilter", () => {
  it("üç grup: Durum + Şu an nerede (aktif, rota adımı olabilen istasyonlar) + Özel", async () => {
    renderWithProviders(<StatusLocationFilter />);
    await userEvent.click(screen.getByRole("button", { name: /Durum/ }));
    expect(await screen.findByText("Şu an nerede")).toBeInTheDocument();
    expect(screen.getByText("Özel")).toBeInTheDocument();
    expect(screen.getByText("Planlandı")).toBeInTheDocument();
    expect(await screen.findByText("Boyahane")).toBeInTheDocument();
    expect(screen.getByText("(fason)")).toBeInTheDocument();
    expect(screen.queryByText("Tezgah 1")).toBeNull();
    expect(screen.queryByText("Eski Ram")).toBeNull();
    expect(screen.getByText("Birden çok istasyonda")).toBeInTheDocument();
  });

  it("her grup kendi anahtarına CSV yazar; çip tek tıkla kaldırır", async () => {
    renderWithProviders(
      <>
        <StatusLocationFilter />
        <StatusLocationChips />
        <Search />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Durum/ }));
    await userEvent.click(await screen.findByText("Boyahane"));
    await userEvent.click(screen.getByText("Kurşun"));
    await userEvent.click(screen.getByText("Birden çok istasyonda"));
    await userEvent.click(screen.getByText("Devam Ediyor"));
    expect(search()).toContain("filter[konumIstasyon]=st-boya,st-kursun");
    expect(search()).toContain("filter[konumSinifi]=BOLUNMUS");
    expect(search()).toContain("filter[status]=IN_PROGRESS");
    expect(screen.getByRole("button", { name: /Durum \(4\)/ })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    const chips = screen.getByTestId("status-location-chips");
    expect(chips).toHaveTextContent("Nerede:Boyahane");
    await userEvent.click(within(chips).getByText("Boyahane").closest("button") as HTMLElement);
    expect(search()).not.toContain("st-boya");
    expect(search()).toContain("filter[konumIstasyon]=st-kursun");
    await userEvent.click(screen.getByText("Tümünü temizle"));
    expect(search()).toBe("");
    expect(screen.queryByTestId("status-location-chips")).toBeNull();
  });
});
