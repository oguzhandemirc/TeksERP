// K20 "Yeni özel iş emri" kartı → Üretim Rotaları: yeni kayıt diyaloğu AÇIK ve "Kısayol" işaretli doğar;
// ilk kapanışta tohum söner. Durumsuz açılış bugünkü gibi (kapalı, işaretsiz).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { RoutesPage } from "../RoutesPage";

type FormParams = { open: boolean; onOpenChange: (o: boolean) => void; initial: null; onSubmit: () => Promise<void>; isSubmitting: boolean };
vi.mock("@/components/layout/CrudPage", async () => {
  const { useState } = await import("react");
  return {
    CrudPage: (p: { openCreateOnMount?: boolean; renderForm: (f: FormParams) => React.ReactNode }) => {
      const [open, setOpen] = useState(p.openCreateOnMount ?? false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Yeni</button>
          {p.renderForm({ open, onOpenChange: setOpen, initial: null, onSubmit: () => Promise.resolve(), isSubmitting: false })}
        </>
      );
    },
  };
});
vi.mock("../RouteFormDialog", () => ({
  RouteFormDialog: (p: { open: boolean; newAsShortcut?: boolean; onOpenChange: (o: boolean) => void }) => (
    <div data-testid="rfd" data-open={String(p.open)} data-shortcut={String(p.newAsShortcut ?? false)}>
      <button type="button" onClick={() => p.onOpenChange(false)}>Kapat</button>
    </div>
  ),
}));

function StateProbe() {
  return <span data-testid="nav-state">{JSON.stringify(useLocation().state ?? null)}</span>;
}

function renderWith(state?: unknown) {
  render(
    <MemoryRouter initialEntries={[{ pathname: "/definitions/routes", state }]}>
      <RoutesPage />
      <StateProbe />
    </MemoryRouter>,
  );
}

describe("RoutesPage — yeni özel iş emri tohumu", () => {
  it("⭐ state.newShortcut → diyalog açık + kısayol işaretli; kapatılıp yeniden 'Yeni' → işaretsiz", async () => {
    renderWith({ newShortcut: true });
    expect(screen.getByTestId("rfd")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("rfd")).toHaveAttribute("data-shortcut", "true");
    await userEvent.click(screen.getByText("Kapat"));
    await userEvent.click(screen.getByText("Yeni"));
    expect(screen.getByTestId("rfd")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("rfd")).toHaveAttribute("data-shortcut", "false");
  });

  it("⭐ tohum geçmiş girdisinden tüketilir (geri dönüşte diyalog yeniden açılmaz) — S8b", () => {
    renderWith({ newShortcut: true });
    expect(screen.getByTestId("rfd")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("nav-state").textContent).toBe("null");
  });

  it("durumsuz açılış bugünkü gibi: kapalı, işaretsiz", () => {
    renderWith();
    expect(screen.getByTestId("rfd")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("rfd")).toHaveAttribute("data-shortcut", "false");
  });
});
