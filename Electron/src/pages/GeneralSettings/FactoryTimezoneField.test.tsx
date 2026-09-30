// Saat dilimi ekranı — TARİHLİ DÖNEMLER: değişiklik ertesi gün başından geçerli olur, geçmiş kayıtlar değişmez.
// Kayıtlı dilim geçersizken uyarı görünür ve yürürlükteki dilim seçilip kaydedilebilir; uyarı yokken yürürlükteki
// dilimi seçmek değişiklik değildir. Bekleyen değişiklik görünür, iptal edilebilir ve varken yenisi yazılamaz.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const warning = vi.fn();
const pendingHook = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFactoryTimezoneWarning: () => warning(),
  useFactoryTimezonePending: () => pendingHook(),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
const preview = vi.fn();
const update = vi.fn();
const cancel = vi.fn();
const list = vi.fn();
vi.mock("@/services/featureFlagService", () => ({
  featureFlagService: {
    previewFactoryTimezone: (tz: string) => preview(tz),
    updateFactoryTimezone: (b: unknown) => update(b),
    cancelFactoryTimezoneChange: (b: unknown) => cancel(b),
    listFactoryTimezonePeriods: () => list(),
  },
}));

import { FactoryTimezoneField } from "./FactoryTimezoneField";

const TZ_MSG = "Kayıtlı saat dilimi geçersiz; İstanbul kullanılıyor — Şirket Bilgileri → Saat dilimi'den düzeltin";
const pv = (over: Record<string, unknown> = {}) => ({
  data: {
    current: "Europe/Istanbul", proposed: "Europe/Istanbul", changed: true, storedInvalid: true, pending: null,
    currentOffset: "UTC+03:00", proposedOffset: "UTC+03:00", todayCurrent: "2026-09-30",
    effectiveFrom: "2026-09-30T21:00:00.000Z", effectiveFromCurrentLocal: "01.10.2026 00:00", effectiveFromProposedLocal: "01.10.2026 00:00",
    transitionDays: [{ day: "2026-10-01", hours: 24 }],
    warnings: ["Kayıtlı saat dilimi geçersiz; kaydetmek Europe/Istanbul dönemini ekleyerek onu düzeltir."], ...over,
  },
});
const PENDING = { id: "0b8c3f4e-1d2a-4c5b-9e6f-7a8b9c0d1e2f", timeZone: "Europe/Berlin", validFrom: "2026-09-30T22:00:00.000Z", previousTimeZone: "Europe/Istanbul" };

describe("FactoryTimezoneField", () => {
  beforeEach(() => {
    warning.mockReset(); pendingHook.mockReset(); preview.mockReset(); update.mockReset(); cancel.mockReset(); list.mockReset();
    pendingHook.mockReturnValue(null);
    list.mockResolvedValue({ data: [] });
    update.mockResolvedValue({ data: { timeZone: "Europe/Istanbul", changed: true, effectiveFrom: "2026-09-30T21:00:00.000Z", pending: null } });
    cancel.mockResolvedValue({ data: { cancelledId: PENDING.id, timeZone: "Europe/Istanbul", validFrom: PENDING.validFrom } });
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

  it("⭐ önizleme yürürlük anını iki dilimde ve geçiş gününü gösterir", async () => {
    warning.mockReturnValue(null);
    preview.mockResolvedValue(pv({
      proposed: "Europe/Berlin", storedInvalid: false, proposedOffset: "UTC+02:00", effectiveFrom: "2026-09-30T22:00:00.000Z",
      effectiveFromCurrentLocal: "01.10.2026 01:00", effectiveFromProposedLocal: "01.10.2026 00:00",
      transitionDays: [{ day: "2026-10-01", hours: 25 }], warnings: ["Geçmiş kayıtlar DEĞİŞMEZ."],
    }));
    renderWithProviders(<FactoryTimezoneField />);
    fireEvent.change(screen.getByPlaceholderText(/Dilim ara/), { target: { value: "Berlin" } });
    fireEvent.click(screen.getByRole("option", { name: "Europe/Berlin" }));
    expect(await screen.findByText(/01\.10\.2026 00:00/)).toBeTruthy();
    expect(screen.getByText(/01\.10\.2026 25 saat/)).toBeTruthy();
    expect(screen.getByText("Geçmiş kayıtlar DEĞİŞMEZ.")).toBeTruthy();
  });

  it("⭐ bekleyen değişiklik görünür, iptal ters kayıt ucunu çağırır ve yeni değişiklik kapalıdır", async () => {
    warning.mockReturnValue(null);
    pendingHook.mockReturnValue(PENDING);
    renderWithProviders(<FactoryTimezoneField />);
    expect(screen.getByRole("status", { name: "Bekleyen saat dilimi değişikliği" }).textContent).toContain("Europe/Istanbul → Europe/Berlin");
    expect(screen.queryByPlaceholderText(/Dilim ara/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Değişikliği iptal et" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ periodId: PENDING.id }));
  });

  it("dönem geçmişi defter satırlarını durumlarıyla listeler", async () => {
    warning.mockReturnValue(null);
    list.mockResolvedValue({ data: [
      { id: "a", timeZone: "Europe/Istanbul", validFrom: "2026-09-30T22:00:00.000Z", createdAt: "2026-09-30T10:00:00.000Z", reason: "İptal", reversesPeriodId: "b", valid: true, status: "IPTAL_KAYDI", createdBy: { id: "u", username: "admin", fullName: "Yönetici", isSystemAccount: false } },
      { id: "b", timeZone: "Europe/Berlin", validFrom: "2026-09-30T22:00:00.000Z", createdAt: "2026-09-30T09:00:00.000Z", reason: null, reversesPeriodId: null, valid: true, status: "IPTAL_EDILDI", createdBy: null },
    ] });
    renderWithProviders(<FactoryTimezoneField />);
    const table = await screen.findByRole("table", { name: "Saat dilimi dönem geçmişi" });
    expect(table.textContent).toContain("İptal kaydı");
    expect(table.textContent).toContain("İptal edildi");
  });
});
