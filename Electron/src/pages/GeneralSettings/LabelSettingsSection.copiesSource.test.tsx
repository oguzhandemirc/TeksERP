// Etiket adedi kaynağı (2026-10-24): varsayılan "Sistem geneli" = bugünkü davranış; "İstasyon"
// seçilip kaydedilince PATCH yalnız `labelCopiesSource` taşır (değişmeyen alan gövdeye girmez).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

let flags: Record<string, unknown> = {};
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => ({ data: { data: flags }, isLoading: false }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
const update = vi.fn();
vi.mock("@/services/featureFlagService", () => ({
  featureFlagService: { update: (b: unknown) => update(b) },
}));

import { LabelSettingsSection } from "./LabelSettingsSection";

beforeEach(() => {
  update.mockReset().mockResolvedValue({ success: true, data: {} });
  flags = { labelCopies: 1, labelCopiesSource: "GLOBAL" };
});

describe("LabelSettingsSection — etiket adedi kaynağı", () => {
  it("varsayılan Sistem geneli seçili; bayrak gelmezse de GLOBAL (eski sunucu)", () => {
    flags = { labelCopies: 1 };
    renderWithProviders(<LabelSettingsSection />);
    expect((screen.getByRole("radio", { name: /Sistem geneli/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: /İstasyon/ }) as HTMLInputElement).checked).toBe(false);
  });

  it("İstasyon seçilip kaydedilince gövde yalnız labelCopiesSource taşır", async () => {
    renderWithProviders(<LabelSettingsSection />);
    fireEvent.click(screen.getByRole("radio", { name: /İstasyon/ }));
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith({ labelCopiesSource: "STATION" });
  });

  it("genel adet 1–5 dışında uyarı verir", () => {
    renderWithProviders(<LabelSettingsSection />);
    fireEvent.change(screen.getByLabelText("Genel etiket adedi"), { target: { value: "7" } });
    expect(screen.getByText("1–5 arası bir sayı girin.")).toBeTruthy();
  });
});
