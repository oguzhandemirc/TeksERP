// D4-B4 kabulü: Ölçüm kolonu varsayılan gizli + etiketler; simüle metre şeridi koşullu ve kalıcı; düzeltme diyaloğu
// 409 metnini gösterir, token mantıksal deneme başına (belirsiz hatada yapışır, kesin hatada yenilenir).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const post = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { post: (...a: unknown[]) => post(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const perms = { allow: true };
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => perms.allow, hasAnyPermission: () => perms.allow, hasAllPermissions: () => perms.allow }),
}));
const flags: { data?: Record<string, unknown> } = {};
vi.mock("@/hooks/usePricingEnabled", () => ({ useFeatureFlags: () => ({ data: flags.data ? { data: flags.data } : undefined }) }));

import { RollMeasurementsCard } from "../RollMeasurementsCard";
import { MeterCorrectionDialog } from "../MeterCorrectionDialog";
import { isMeasureColumnVisible, measureSourceLabel, readingStatusLabel, type RollMeasurements, type RollMeterReadingView } from "../measure-source";
import { SimulatedMeterBanner, shouldShowSimulatedMeterBanner } from "@/components/operations/SimulatedMeterBanner";

const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>);

const reading = (over: Partial<RollMeterReadingView>): RollMeterReadingView => ({
  id: over.id ?? "r1", phase: "CUT", meters: 30, source: "SIMULATED", stepId: "s1", stationName: "Tambur", machineName: "T-1",
  createdAt: "2026-10-30T08:00:00.000Z", createdByName: null, revokedAt: null, revokeReason: null, ...over,
});

const sample: RollMeasurements = {
  readings: [
    reading({ id: "a", source: "MACHINE", phase: "IN" }),
    reading({ id: "b", source: "OPERATOR", phase: "OUT" }),
    reading({ id: "c", source: "SIMULATED", revokedAt: "2026-10-30T09:00:00.000Z" }),
    reading({ id: "d", source: "SUPERVISOR" }),
  ],
  variances: [{ id: "v1", kind: "OVERAGE", qty: 20, source: "TAMBUR_FINALIZE", measureSource: null, reasonCode: null, createdAt: "2026-10-30T08:00:00.000Z", reversedAt: null }],
};

beforeEach(() => {
  post.mockReset();
  perms.allow = true;
  flags.data = undefined;
});
afterEach(cleanup);

describe("Ölçüm kolonu (opt-in)", () => {
  it("varsayılan GİZLİ: tercih yoksa kolon başlığı ve kaynak çipi yok", () => {
    expect(isMeasureColumnVisible(undefined)).toBe(false);
    expect(isMeasureColumnVisible({ "roll-measurements": { measureSource: false } })).toBe(false);
    wrap(<RollMeasurementsCard measurements={sample} onChanged={() => {}} />);
    expect(screen.queryByText("Ölçüm", { selector: "th" })).toBeNull();
    expect(screen.queryAllByTestId("measure-source")).toHaveLength(0);
  });

  it("açılınca kaynak etiketleri doğru (NULL = Bilinmiyor)", () => {
    wrap(<RollMeasurementsCard measurements={sample} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Ölçüm kolonunu göster" }));
    expect(screen.getByText("Ölçüm", { selector: "th" })).toBeTruthy();
    expect(screen.getAllByTestId("measure-source").map((e) => e.textContent)).toEqual(["Makine", "Operatör", "Simülasyon", "Süpervizör", "Bilinmiyor"]);
    expect(measureSourceLabel(null)).toBe("Bilinmiyor");
    expect(readingStatusLabel(reading({ revokedAt: "x", revokeReason: "TAMBUR_METER_CORRECTION: ölçüldü" }))).toBe("Düzeltildi");
    expect(readingStatusLabel(reading({ revokedAt: "x", revokeReason: "TAMBUR_UNDO" }))).toBe("Geri alındı");
  });

  it("Düzelt yalnız aktif CUT okumasında; izin yoksa düğme yok", () => {
    wrap(<RollMeasurementsCard measurements={sample} onChanged={() => {}} />);
    const rows = screen.getAllByTestId("reading-row");
    expect(rows.map((r) => within(r).queryByRole("button", { name: "Düzelt" }) !== null)).toEqual([false, false, false, true]);
    cleanup();
    perms.allow = false;
    wrap(<RollMeasurementsCard measurements={sample} onChanged={() => {}} />);
    expect(screen.queryByRole("button", { name: "Düzelt" })).toBeNull();
  });
});

describe("Simüle metre şeridi (kalıcı)", () => {
  it("ayar açıkken görünür, kapalıyken / üretim kapalıyken yok", () => {
    expect(shouldShowSimulatedMeterBanner({ productionEnabled: true, tamburSimulatedMeterEnabled: true })).toBe(true);
    expect(shouldShowSimulatedMeterBanner({ productionEnabled: true, tamburSimulatedMeterEnabled: false })).toBe(false);
    expect(shouldShowSimulatedMeterBanner({ productionEnabled: false, tamburSimulatedMeterEnabled: true })).toBe(false);
    expect(shouldShowSimulatedMeterBanner(undefined)).toBe(false);
    flags.data = { productionEnabled: true, tamburSimulatedMeterEnabled: false };
    wrap(<SimulatedMeterBanner />);
    expect(screen.queryByTestId("simulated-meter-banner")).toBeNull();
    cleanup();
    flags.data = { productionEnabled: true, tamburSimulatedMeterEnabled: true };
    wrap(<SimulatedMeterBanner />);
    const banner = screen.getByTestId("simulated-meter-banner");
    expect(banner.textContent).toContain("Simüle metre stoğa giriyor");
    expect(within(banner).queryByRole("button")).toBeNull(); // kapatılamaz
  });

  it("iki ekranda bağlı: Ayarlar kabuğu + Kumaş Stoğu (Tambur sekmesi)", () => {
    for (const f of ["pages/GeneralSettings/SettingsSurfacePage.tsx", "pages/Operations/Rolls/RollsPage.tsx"]) {
      expect(readFileSync(resolve(__dirname, "../../../../..", f), "utf8")).toMatch(/<SimulatedMeterBanner \/>/);
    }
  });
});

describe("Düzeltme diyaloğu", () => {
  const fill = () => fireEvent.change(screen.getByLabelText("Sebep"), { target: { value: "şerit metreyle ölçüldü" } });
  const tokenOf = (i: number) => (post.mock.calls[i]?.[1] as { clientToken: string } | undefined)?.clientToken;

  it("ağ hatasında token yapışır, 409'da metni gösterir ve sonraki deneme yeni token alır", async () => {
    const onChanged = vi.fn();
    post
      .mockRejectedValueOnce(Object.assign(new Error("Network Error"), { isAxiosError: true, response: undefined }))
      .mockRejectedValueOnce(Object.assign(new Error("409"), {
        isAxiosError: true,
        response: { status: 409, data: { success: false, message: "Bu iş SF-0001 faturasına bağlı — önce faturayı iptal edin", details: { code: "SERVICE_ALREADY_BILLED" } } },
      }))
      .mockResolvedValueOnce({ data: { success: true } });
    wrap(<MeterCorrectionDialog reading={reading({})} onClose={() => {}} onChanged={onChanged} />);
    fill();
    const btn = screen.getByRole("button", { name: "Düzelt" });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("cut-correct-error").textContent).toMatch(/ulaşılamadı/));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByTestId("cut-correct-error").textContent).toContain("SF-0001 faturasına bağlı"));
    expect(tokenOf(1)).toBe(tokenOf(0));
    fireEvent.click(btn);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
    expect(tokenOf(2)).not.toBe(tokenOf(1));
    expect(post.mock.calls[0]?.[0]).toBe("/api/tambur/meter-readings/r1/correct");
    expect(post.mock.calls[0]?.[1]).toMatchObject({ meters: 30, reason: "şerit metreyle ölçüldü" });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(3));
  });

  it("409 'değişti' (eşzamanlı düzeltme) metni diyalogda; mesajsız yanıtta kod metnine düşer", async () => {
    post.mockRejectedValueOnce(Object.assign(new Error("409"), {
      isAxiosError: true,
      response: { status: 409, data: { success: false, details: { code: "METER_READING_ALREADY_CORRECTED" } } },
    }));
    wrap(<MeterCorrectionDialog reading={reading({})} onClose={() => {}} onChanged={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Düzelt" }));
    await waitFor(() => expect(screen.getByTestId("cut-correct-error").textContent).toMatch(/az önce düzeltildi/));
  });
});
