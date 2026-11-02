// K20 (Gülkesim 2026-11-03): İE oluştur/düzenle sayfasında geri oku GELİNEN sayfaya döner (sekme geçmişi);
// geçmiş yoksa kırıntı üstüne (yeni kayıtta liste, düzenlemede detay). Kırıntı hiyerarşi olarak kalır.
// Negatif sonda: WorkOrderFormPage'e `onBack={() => navigateActive(backPath)}` geri konunca "geçmişli" testler kırmızı.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { WorkOrderFormPage } from "../../WorkOrderFormPage";

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({ usePreferences: () => ({ prefs: {}, setPreference: vi.fn() }) }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useTargetQuantityEnabled: () => false }));
vi.mock("../../WorkOrderFormView", () => ({ WorkOrderFormView: () => <div data-testid="wo-form" /> }));
vi.mock("../IsEmriGiris", () => ({ IsEmriGiris: () => <div data-testid="oie-giris" /> }));
vi.mock("../refakatPrint", () => ({ useRefakatAutoPrint: () => false, printRefakatCard: vi.fn(), AUTO_PRINT_TEXT: {} }));
vi.mock("../../service", () => ({
  workOrderService: { getById: () => Promise.resolve({ data: { id: "w1", workOrderNumber: "IE-000001" } }) },
}));

function renderAt(entries: string[]) {
  const router = createMemoryRouter(
    [
      { path: "/operations", element: <div>OPERASYON</div> },
      { path: "/operations/work-orders", element: <div>LİSTE</div> },
      { path: "/operations/work-orders/new", element: <WorkOrderFormPage /> },
      { path: "/operations/work-orders/:id/edit", element: <WorkOrderFormPage /> },
      { path: "/operations/work-orders/:id", element: <div>DETAY</div> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><RouterProvider router={router} /></QueryClientProvider>);
  return router;
}

describe("İE formu — geri oku (K20)", () => {
  it("⭐ Operasyon'dan gelindiyse geri Operasyon'a döner (listeye değil); kırıntı yine liste", async () => {
    const router = renderAt(["/operations", "/operations/work-orders/new"]);
    expect(screen.getByRole("button", { name: /İş Emirleri/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(router.state.location.pathname).toBe("/operations");
    expect(screen.getByText("OPERASYON")).toBeInTheDocument();
  });

  it("geçmiş yoksa (sekme doğrudan açıldı) listeye düşer", async () => {
    const router = renderAt(["/operations/work-orders/new"]);
    await userEvent.click(screen.getByRole("button", { name: "Geri" }));
    expect(router.state.location.pathname).toBe("/operations/work-orders");
  });

  it("⭐ düzenleme: listeden gelindiyse listeye; geçmiş yoksa İE detayına", async () => {
    const r1 = renderAt(["/operations/work-orders", "/operations/work-orders/w1/edit"]);
    await userEvent.click(await screen.findByRole("button", { name: "Geri" }));
    expect(r1.state.location.pathname).toBe("/operations/work-orders");
    document.body.innerHTML = "";
    const r2 = renderAt(["/operations/work-orders/w1/edit"]);
    await userEvent.click(await screen.findByRole("button", { name: "Geri" }));
    expect(r2.state.location.pathname).toBe("/operations/work-orders/w1");
  });
});
