// =============================================================================
// MODÜLLER EKRANI — "RAPORLAR" BÖLÜMÜ (Raporlar K6) — davranış bekçisi
// =============================================================================
// ÖLÇÜLENLER:
//   §1 Katalogdaki HER rapor bir satır; kategori başlıkları altında; sınıf rozeti.
//   §2 canWrite=false (fabrika yöneticisi): her satır görünür ama PASİF; yazma yok.
//   §3 ⭐ Modülü kapalı raporun satırı KİLİT BANDI taşır ve pasiftir — süperadmin bile.
//   §4 ⭐ Toggle tek listeye yazar: kapatınca anahtar listeye girer (sıralı küme),
//      açınca çıkar; `null` gönderilmez.
//   §5 ⭐ Liste OKUNAMADI (null): satır yok, uyarı var, süperadmine "sıfırla" yolu ([] yazar);
//      fabrika yöneticisine o düğme yok.
//
// Negatif sondalar (bir kezlik, geri alındı — sha commit mesajında): `isReportModuleClosed`
// koşulsuz `false` → §3 ❌; `setOpen` listeyi sıralamadan yazdı → §4 ❌ (toEqual sıra bekler).
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { REPORT_CATALOG } from "@/lib/report-catalog";
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

let flagsData: Record<string, unknown> = {};
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => ({ isLoading: false, data: { data: flagsData } }),
}));

let regime: Partial<OperationsVisibilityContext> = {};
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: (): OperationsVisibilityContext => ({
    shipmentConfirmationEnabled: false,
    depoMultiEnabled: false,
    devereEnabled: false,
    dokumaEnabled: true,
    financeEnabled: true,
    productionEnabled: true,
    ticaretEnabled: true,
    iplikEnabled: true,
    reportsClosedKeys: [],
    isReportOpen: () => true,
    ...regime,
  }),
}));

const update = vi.fn();
vi.mock("@/services/featureFlagService", () => ({
  featureFlagService: { update: (patch: unknown) => update(patch) },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ReportVisibilitySection, isReportModuleClosed } from "./ReportVisibilitySection";

const rowOf = (key: string) => screen.getByTestId(`rapor-satir:${key}`);
const checkboxOf = (key: string) => rowOf(key).querySelector<HTMLInputElement>("input[type=checkbox]")!;

describe("Modüller → Raporlar bölümü", () => {
  beforeEach(() => {
    flagsData = { reportsClosedKeys: [] };
    regime = {};
    update.mockReset();
    update.mockResolvedValue({ success: true });
  });

  it("§1 katalogdaki her rapor bir satır, kategori başlıkları ve sınıf rozetleri çizilir", () => {
    renderWithProviders(<ReportVisibilitySection canWrite />);
    for (const r of REPORT_CATALOG) {
      expect(rowOf(r.key)).toBeInTheDocument();
      expect(rowOf(r.key).textContent).toContain(r.baslik);
      expect(rowOf(r.key).textContent).toContain(r.soru);
    }
    expect(screen.getAllByText("Gelişmiş").length).toBe(REPORT_CATALOG.filter((r) => r.sinif === "gelismis").length);
    expect(screen.getAllByText("Basit").length).toBe(REPORT_CATALOG.filter((r) => r.sinif === "basit").length);
    expect(screen.getByText("Ön Muhasebe")).toBeInTheDocument();
    expect(screen.getByText("Dokuma")).toBeInTheDocument();
  });

  it("§2 fabrika yöneticisi (canWrite=false): satırlar görünür, hepsi PASİF, yazma yok", () => {
    renderWithProviders(<ReportVisibilitySection canWrite={false} />);
    for (const r of REPORT_CATALOG) expect(checkboxOf(r.key)).toBeDisabled();
    fireEvent.click(checkboxOf("sales/order-intake"));
    expect(update).not.toHaveBeenCalled();
  });

  it("§3 ⭐ modülü kapalı raporun satırı kilit bandı taşır ve pasiftir; modülsüz (çekirdek) satır serbest", () => {
    regime = { financeEnabled: false, dokumaEnabled: false };
    renderWithProviders(<ReportVisibilitySection canWrite />);
    const financeKeys = REPORT_CATALOG.filter((r) => r.modul === "financeEnabled").map((r) => r.key);
    const dokumaKeys = REPORT_CATALOG.filter((r) => r.modul === "dokumaEnabled").map((r) => r.key);
    expect(financeKeys.length + dokumaKeys.length).toBeGreaterThan(3); // körlük zemini
    for (const k of [...financeKeys, ...dokumaKeys]) {
      expect(screen.getByTestId(`rapor-kilit:${k}`).textContent).toContain("Modül kapalı");
      expect(checkboxOf(k)).toBeDisabled();
    }
    // kontrol grubu: çekirdek (siparis-musteri) rapor kilitsiz ve etkin
    expect(screen.queryByTestId("rapor-kilit:sales/order-intake")).toBeNull();
    expect(checkboxOf("sales/order-intake")).toBeEnabled();
    // üretim AÇIK: üretim raporu kilitsiz
    expect(screen.queryByTestId("rapor-kilit:production/wip")).toBeNull();
  });

  it("§3b saf yüklem: ctx'te olmayan modül anahtarı (yüzeysiz) KİLİTLEMEZ; planlanan/çekirdek kilitlemez", () => {
    const base: OperationsVisibilityContext = {
      shipmentConfirmationEnabled: false, depoMultiEnabled: false, devereEnabled: false, dokumaEnabled: false,
      financeEnabled: false, productionEnabled: true, ticaretEnabled: false, iplikEnabled: false,
      reportsClosedKeys: [], isReportOpen: () => true,
    };
    const fason = REPORT_CATALOG.find((r) => r.modul === "planlanan:fason")!;
    const finance = REPORT_CATALOG.find((r) => r.modul === "financeEnabled")!;
    const dokuma = REPORT_CATALOG.find((r) => r.modul === "dokumaEnabled")!;
    expect(isReportModuleClosed(fason, base)).toBe(false);
    expect(isReportModuleClosed(finance, base)).toBe(true);
    expect(isReportModuleClosed(dokuma, base)).toBe(true);
    expect(isReportModuleClosed({ ...finance, modul: "tezgahEnabled" }, base)).toBe(false);
  });

  it("§4 ⭐ toggle TEK listeye yazar: kapat → anahtar sıralı kümeye girer; aç → çıkar; null gönderilmez", async () => {
    flagsData = { reportsClosedKeys: ["sales/order-leadtime"] };
    renderWithProviders(<ReportVisibilitySection canWrite />);
    expect(checkboxOf("sales/order-leadtime")).not.toBeChecked();
    expect(checkboxOf("sales/order-intake")).toBeChecked();
    fireEvent.click(checkboxOf("sales/order-intake"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenLastCalledWith({ reportsClosedKeys: ["sales/order-intake", "sales/order-leadtime"] });
    fireEvent.click(checkboxOf("sales/order-leadtime"));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update).toHaveBeenLastCalledWith({ reportsClosedKeys: [] });
    for (const c of update.mock.calls) expect((c[0] as { reportsClosedKeys: unknown }).reportsClosedKeys).not.toBeNull();
  });

  it("§5 ⭐ liste OKUNAMADI: satır yok, uyarı var; süperadmine sıfırlama ([] yazar), yöneticiye yok", async () => {
    flagsData = { reportsClosedKeys: null };
    const { unmount } = renderWithProviders(<ReportVisibilitySection canWrite />);
    expect(screen.getByText("Rapor listesi okunamadı")).toBeInTheDocument();
    expect(screen.queryByTestId("rapor-satir:sales/order-intake")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Listeyi sıfırla (hepsini aç)" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ reportsClosedKeys: [] }));
    unmount();
    renderWithProviders(<ReportVisibilitySection canWrite={false} />);
    expect(screen.getByText("Rapor listesi okunamadı")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Listeyi sıfırla (hepsini aç)" })).toBeNull();
  });
});
