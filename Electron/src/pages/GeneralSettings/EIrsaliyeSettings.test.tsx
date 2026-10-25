// e-İrsaliye yapılandırması (E3-AYAR): varsayılan "Kapalı" (bugünkü davranış), simülasyon uyarısı,
// Kaydet gövdesi yalnız `eIrsaliyeConfig` taşır ve taslak sunucu cevabından kurulur; resmi künye
// kartı VKN ipucunu yalnız İPUCU olarak gösterir, boş unvanda firma adını ÖNERİR (yazmaz).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const flags = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => ({ isLoading: false, data: { data: flags() } }),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
const update = vi.fn();
vi.mock("@/services/featureFlagService", () => ({ featureFlagService: { update: (b: unknown) => update(b) } }));
const readiness = vi.fn();
vi.mock("@/pages/Operations/Shipments/eirsaliye/service", () => ({ eIrsaliyeService: { readiness: () => readiness() } }));

import { EIrsaliyeSettingsSection } from "./EIrsaliyeSettingsSection";
import { EIrsaliyeReadinessPanel } from "@/pages/Operations/Shipments/eirsaliye/EIrsaliyeReadinessPanel";
import { CompanyLegalIdentityCard } from "./CompanyLegalIdentityCard";
import { DEFAULT_COMPANY_LEGAL_IDENTITY, taxIdHint } from "@/services/eIrsaliyeSettings";

describe("EIrsaliyeSettingsSection", () => {
  beforeEach(() => {
    flags.mockReset();
    update.mockReset();
    readiness.mockReset().mockResolvedValue({ durum: "YAPILANDIRILMAMIS", eksikler: ["e-İrsaliye yürürlük tarihi girilmemiş"] });
  });

  it("⭐ hazırlık rozeti sunucudan: eksik sayısı + eksik listesi (E7)", async () => {
    renderWithProviders(<EIrsaliyeReadinessPanel />);
    const box = await screen.findByTestId("eirsaliye-readiness");
    expect(box.textContent).toContain("Eksik (1)");
    expect(box.textContent).toContain("yürürlük tarihi girilmemiş");
  });

  it("⭐ yük alanı yoksa varsayılan Kapalı seçili, simülasyon uyarısı yok", () => {
    flags.mockReturnValue({});
    renderWithProviders(<EIrsaliyeSettingsSection />);
    expect((screen.getByRole("radio", { name: /Kapalı/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("⭐ simülasyon seçilince uyarı görünür; Kaydet yalnız eIrsaliyeConfig gönderir, taslak cevaptan kurulur", async () => {
    flags.mockReturnValue({ eIrsaliyeConfig: { adapter: "yok", yururlukTarihi: null } });
    update.mockResolvedValue({ data: { eIrsaliyeConfig: { adapter: "simulasyon", yururlukTarihi: null } } });
    renderWithProviders(<EIrsaliyeSettingsSection />);
    fireEvent.click(screen.getByRole("radio", { name: /Simülasyon/ }));
    expect(screen.getByRole("alert").textContent).toContain("GİB'e GİTMEZ");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![0]).toEqual({ eIrsaliyeConfig: { adapter: "simulasyon", yururlukTarihi: null } });
  });
});

describe("CompanyLegalIdentityCard", () => {
  beforeEach(() => {
    flags.mockReset();
    update.mockReset();
  });

  it("⭐ boş unvanda firma adını önerir, tıklanınca yazar (kendiliğinden yazmaz)", () => {
    flags.mockReturnValue({ companyName: "Örnek Tekstil", companyLegalIdentity: DEFAULT_COMPANY_LEGAL_IDENTITY });
    renderWithProviders(<CompanyLegalIdentityCard onDirtyChange={() => {}} />);
    const unvan = screen.getByLabelText(/Ticari unvan/) as HTMLInputElement;
    expect(unvan.value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /Firma adını kullan/ }));
    expect(unvan.value).toBe("Örnek Tekstil");
  });

  it("⭐ kişi adı/soyadı yalnız TCKN seçiliyken görünür", () => {
    flags.mockReturnValue({ companyLegalIdentity: DEFAULT_COMPANY_LEGAL_IDENTITY });
    renderWithProviders(<CompanyLegalIdentityCard onDirtyChange={() => {}} />);
    expect(screen.queryByLabelText(/Kişi adı/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /TCKN/ }));
    expect(screen.getByLabelText(/Kişi adı/)).toBeTruthy();
  });

  it("VKN/TCKN ipucu: sağlaması tutan numara sessiz, bozuk numara ipucu verir", () => {
    expect(taxIdHint("VKN", "1234567890")).toBeNull();
    expect(taxIdHint("VKN", "1234567891")).toMatch(/son hanesi/);
    expect(taxIdHint("VKN", "123")).toMatch(/10 hane/);
    expect(taxIdHint("TCKN", "10000000146")).toBeNull();
    expect(taxIdHint("VKN", "")).toBeNull();
  });
});
