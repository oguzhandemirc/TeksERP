import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { DurationField } from "./DurationField";

// Barındırılan sınıf kilidi (VDS O2): `toggle.locked` notu verilince anahtar kilitlenir ve not
// görünür; verilmezse (LAN) anahtar bugünkü gibi açık.
const base = { label: "Oturum", valueMinutes: 480, onChangeMinutes: vi.fn(), maxMinutes: 43200 };

describe("DurationField sınıf kilidi", () => {
  it("kilit notu → anahtar devre dışı + not görünür", () => {
    renderWithProviders(<DurationField {...base} toggle={{ enabled: true, onToggle: vi.fn(), label: "Otomatik çıkış", locked: "Bulut kurulumu: kilitli" }} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("duration-locked-note").textContent).toBe("Bulut kurulumu: kilitli");
  });
  it("kilitsiz (LAN) → anahtar açık, not yok", () => {
    renderWithProviders(<DurationField {...base} toggle={{ enabled: true, onToggle: vi.fn(), label: "Otomatik çıkış" }} />);
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByTestId("duration-locked-note")).toBeNull();
  });
});
