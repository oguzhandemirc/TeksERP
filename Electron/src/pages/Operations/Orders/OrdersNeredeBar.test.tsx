import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

// Modal seçicinin kendisi ayrı bekçili; burada yalnız URL sözleşmesi ölçülür.
vi.mock("@/components/forms/entity-picker/EntityPickerModal", () => ({
  EntityPickerModal: ({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) => (
    <div>
      <span data-testid="firma-value">{value ?? ""}</span>
      <button type="button" onClick={() => onChange("11111111-1111-4111-8111-111111111111")}>firma-sec</button>
      <button type="button" onClick={() => onChange(null)}>firma-temizle</button>
    </div>
  ),
}));

import { OrdersNeredeBar } from "./OrdersNeredeBar";

function Probe() {
  const loc = useLocation();
  return <output data-testid="url">{decodeURIComponent(loc.search)}</output>;
}

function setup(initial = "/?cursor=abc&page=3", productionEnabled = true) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <OrdersNeredeBar productionEnabled={productionEnabled} />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return () => screen.getByTestId("url").textContent ?? "";
}

describe("OrdersNeredeBar — süzme SUNUCUDA, şerit yalnız URL yazar", () => {
  it("sekme → filter[nerede]; sayfa/cursor sıfırlanır", () => {
    const url = setup();
    fireEvent.click(screen.getByRole("tab", { name: "Fasonda" }));
    expect(url()).toBe("?filter[nerede]=FASONDA");
    expect(screen.getByRole("tab", { name: "Fasonda" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Gecikenler" }));
    expect(url()).toBe("?filter[nerede]=GECIKEN");
  });

  it("Tümü anahtarı SİLER (boş değer yazmaz)", () => {
    const url = setup("/?filter[nerede]=KISMEN&filter[status]=APPROVED");
    expect(screen.getByRole("tab", { name: "Kısmen gidenler" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Tümü" }));
    expect(url()).toBe("?filter[status]=APPROVED");
  });

  it("fason firma seçimi → filter[fasonFirma]; temizle anahtarı siler", () => {
    const url = setup("/");
    fireEvent.click(screen.getByText("firma-sec"));
    expect(url()).toBe("?filter[fasonFirma]=11111111-1111-4111-8111-111111111111");
    expect(screen.getByTestId("firma-value")).toHaveTextContent("11111111");
    fireEvent.click(screen.getByText("firma-temizle"));
    expect(url()).toBe("");
  });

  it("'Fasonda X günden uzun' yazma durunca URL'e işlenir; geçersiz girdi süzgeci kaldırır", () => {
    vi.useFakeTimers();
    try {
      const url = setup("/");
      const input = screen.getByLabelText("Fasonda kaç günden uzun");
      fireEvent.change(input, { target: { value: "3" } });
      expect(url()).toBe(""); // debounce bitmeden istek yok
      act(() => { vi.advanceTimersByTime(500); });
      expect(url()).toBe("?filter[fasonGun]=3");
      fireEvent.change(input, { target: { value: "-1" } });
      act(() => { vi.advanceTimersByTime(500); });
      expect(url()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("üretim kapalıyken fason sekmeleri, firma ve gün girişi çizilmez", () => {
    setup("/", false);
    expect(screen.queryByRole("tab", { name: "Fasonda" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Sevke hazır" })).toBeNull();
    expect(screen.queryByText("firma-sec")).toBeNull();
    expect(screen.queryByLabelText("Fasonda kaç günden uzun")).toBeNull();
    expect(screen.getByRole("tab", { name: "Gecikenler" })).toBeInTheDocument();
  });
});
