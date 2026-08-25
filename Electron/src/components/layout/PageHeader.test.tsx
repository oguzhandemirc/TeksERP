import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { PageHeader } from "./PageHeader";
import { findBreadcrumbParent } from "./command-entries";
import { TabIdProvider } from "./tabs/tab-active";
import { forgetTab, trackTabLocation } from "./tabs/history-depth";

/**
 * GERİ OKU — saha şikâyeti "geri tuşu çalışmıyor" (2026-08-22) bekçisi.
 *
 * Kök neden: her sekme izole bir memory router'dır ve menüden/hub'dan/yeni
 * sekmeden açılan sekme DOĞRUDAN o sayfada başlar → geçmiş tek girişliktir,
 * `navigate(-1)` sessizce hiçbir şey yapmaz. Ok görünür ama ekran durur.
 *
 * Kilitlenen davranış: çizilen ok HER ZAMAN bir şey yapar — sırayla açık hedef
 * (`onBack`) > sekme geçmişi > breadcrumb üstü.
 */

vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [], isFavorite: () => false, toggleFavorite: vi.fn(), reorderFavorites: vi.fn() }),
}));

// Breadcrumb üstü OLAN gerçek bir sayfa — kural katalogdan çözülür, testte sabitlenmez.
const CHILD = "/operations/rolls";
const PARENT = findBreadcrumbParent(CHILD);

const TAB = "tab-test";

function renderAt(entries: string[], extra?: { onBack?: () => void; tabbed?: boolean }) {
  const router = createMemoryRouter(
    [
      { path: PARENT?.to ?? "/operations", element: <div>ÜST SAYFA</div> },
      { path: CHILD, element: <PageHeader title="Envanter" onBack={extra?.onBack} /> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  const ui = <RouterProvider router={router} />;
  render(extra?.tabbed ? <TabIdProvider value={TAB}>{ui}</TabIdProvider> : ui);
  return router;
}

describe("PageHeader — geri oku", () => {
  it("ön koşul: seçilen sayfanın breadcrumb üstü var", () => {
    expect(PARENT).not.toBeNull();
  });

  it("sekme DOĞRUDAN bu sayfada açıldıysa (geçmiş boş) breadcrumb üstüne gider — sessiz kalmaz", async () => {
    const user = userEvent.setup();
    const router = renderAt([CHILD]);
    await user.click(screen.getByRole("button", { name: "Geri" }));
    expect(router.state.location.pathname).toBe(PARENT!.to);
    expect(screen.getByText("ÜST SAYFA")).toBeInTheDocument();
  });

  it("sekme içinde zincirle gelindiyse bir adım GERİ gider (üste atlamaz)", async () => {
    const user = userEvent.setup();
    const router = renderAt([PARENT!.to, CHILD]);
    await user.click(screen.getByRole("button", { name: "Geri" }));
    expect(router.state.location.pathname).toBe(PARENT!.to);
    // Geçmişten pop edildi → ilk girişteyiz (yol aynı ama mekanizma farklı).
    expect(router.state.location.key).toBe("default");
  });

  it("açılışta URL'e filtre yazan sayfa (REPLACE) yine de üste gider — `location.key` yanıltır", async () => {
    // Envanter/Siparişler gibi liste sayfaları mount'ta `setSearchParams(…,
    // { replace: true })` çağırır: anahtar "default" olmaktan çıkar ama geçmiş
    // BÜYÜMEZ. Sekme bağlamı varken karar derinlik defterinden gelir.
    forgetTab(TAB);
    trackTabLocation(TAB, "default", "POP");
    const user = userEvent.setup();
    const router = renderAt([CHILD], { tabbed: true });
    await act(async () => {
      await router.navigate(`${CHILD}?tab=RAW_STOCK`, { replace: true });
    });
    trackTabLocation(TAB, router.state.location.key, router.state.historyAction);

    await user.click(screen.getByRole("button", { name: "Geri" }));
    expect(router.state.location.pathname).toBe(PARENT!.to);
  });

  it("`onBack` verilmişse geçmişe de üste de bakılmaz — sayfanın hedefi kazanır", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const router = renderAt([PARENT!.to, CHILD], { onBack });
    await user.click(screen.getByRole("button", { name: "Geri" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe(CHILD);
  });
});
