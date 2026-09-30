// Saat dilimi ekranı — kayıtlı dilim geçersizken (sunucu varsayılanla açıldı, FACTORY_TIMEZONE_INVALID_STORED)
// uyarı görünür ve yürürlükteki dilim seçilip kaydedilebilir (geçersiz kaydı düzeltmenin tek yolu).
// Uyarı yokken yürürlükteki dilimi seçmek bir değişiklik değildir (önizleme hiç istenmez).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const warning = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFactoryTimezoneWarning: () => warning(),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
const preview = vi.fn();
const update = vi.fn();
vi.mock("@/services/featureFlagService", () => ({
  featureFlagService: {
    previewFactoryTimezone: (tz: string) => preview(tz),
    updateFactoryTimezone: (b: unknown) => update(b),
  },
}));

import { FactoryTimezoneField } from "./FactoryTimezoneField";

const TZ_MSG = "Kayıtlı saat dilimi geçersiz; İstanbul kullanılıyor — Şirket Bilgileri → Saat dilimi'den düzeltin";
const pv = (over: Record<string, unknown> = {}) => ({
  data: {
    current: "Europe/Istanbul", proposed: "Europe/Istanbul", changed: true, storedInvalid: true,
    currentOffset: "UTC+03:00", proposedOffset: "UTC+03:00", todayCurrent: "2026-09-30", todayProposed: "2026-09-30",
    recentRollsShifted: 0, recentShipmentsShifted: 0, windowDays: 30,
    warnings: ["Kayıtlı değer geçersiz; kaydetmek onu Europe/Istanbul ile değiştirir."], ...over,
  },
});

describe("FactoryTimezoneField — geçersiz kayıtlı dilim", () => {
  beforeEach(() => {
    warning.mockReset(); preview.mockReset(); update.mockReset();
    update.mockResolvedValue({ data: { timeZone: "Europe/Istanbul", changed: true } });
  });

  it("⭐ uyarı sunucunun metniyle görünür ve yürürlükteki dilim kaydedilebilir", async () => {
    warning.mockReturnValue({ code: "FACTORY_TIMEZONE_INVALID_STORED", message: TZ_MSG });
    preview.mockResolvedValue(pv());
    renderWithProviders(<FactoryTimezoneField />);
    expect(screen.getByRole("alert").textContent).toContain(TZ_MSG);
    fireEvent.change(screen.getByPlaceholderText(/Dilim ara/), { target: { value: "Istanbul" } });
    fireEvent.click(screen.getByRole("option", { name: /Europe\/Istanbul \(geçerli\)/ }));
    await waitFor(() => expect(preview).toHaveBeenCalledWith("Europe/Istanbul"));
    const btn = await screen.findByRole("button", { name: "Saat dilimini değiştir" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(update).toHaveBeenCalledWith({ timeZone: "Europe/Istanbul", expectedCurrent: "Europe/Istanbul" }));
  });

  it("uyarı yokken yürürlükteki dilimi seçmek değişiklik değildir (önizleme istenmez)", () => {
    warning.mockReturnValue(null);
    renderWithProviders(<FactoryTimezoneField />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/Dilim ara/), { target: { value: "Istanbul" } });
    fireEvent.click(screen.getByRole("option", { name: /Europe\/Istanbul \(geçerli\)/ }));
    expect(preview).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Saat dilimini değiştir" })).toBeNull();
  });
});
