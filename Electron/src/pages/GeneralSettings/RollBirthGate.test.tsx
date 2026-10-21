// Genel Ayarlar › Dokuma: "Dokuma topu nerede doğar" enum satırı — seçenek etiketleri, varsayılan = bugünkü yol,
// KK1_* seçiliyken Devere levent anahtarları kapalıysa amber bant (kaydı engellemez), menü yolu katalogdan.
// Negatif sonda (2026-10-21, geri alındı): bant koşulu `moduleOn && rows.every` → `rows.every` yapıldı
// (Devere modülü kapalı sayılmadı) → "modül kapalı" testi ❌.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { useAuthStore } from "@/store/auth";
import { SETTINGS_CATEGORIES, settingsCategoryTrail } from "./settings-config";

const flags = vi.fn();
vi.mock("@/hooks/usePricingEnabled", () => ({
  FEATURE_FLAGS_QUERY_KEY: ["feature-flags"],
  useFeatureFlags: () => flags(),
}));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ isAdmin: false, hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock("@/pages/Operations/useOperationsVisibility", () => ({
  useOperationsVisibilityContext: () => ({ dokumaEnabled: true }),
}));

import { FeatureFlagSection } from "./FeatureFlagSection";

const dokuma = SETTINGS_CATEGORIES.find((c) => c.id === "dokuma")!;
const devere = SETTINGS_CATEGORIES.find((c) => c.id === "devere")!;
const flagsOf = (c: typeof dokuma) => ("flags" in c && c.flags) || [];
const enumsOf = (c: typeof dokuma) => ("enumFlags" in c && c.enumFlags) || [];
const satir = () => enumsOf(dokuma).find((x) => x.enumKey === "dokumaRollBirth")!;
const devereBaslik = (k: string) => flagsOf(devere).find((f) => f.key === k)!.title;

const sunucu = (over: Record<string, unknown> = {}) =>
  flags.mockReturnValue({
    isLoading: false,
    data: {
      data: {
        dokumaRunWeavingOrderRequired: false,
        dokumaOrderLineLinkRequired: false,
        dokumaRollBirth: "TABLET_DOFF",
        devereEnabled: true,
        devereMountTracking: false,
        devereAutoConsume: false,
        ...over,
      },
    },
  });
const ciz = () => renderWithProviders(<FeatureFlagSection flags={flagsOf(dokuma)} enumFlags={enumsOf(dokuma)} />);
const bant = () => screen.queryByTestId("roll-birth-levent-warning");

beforeEach(() => {
  sunucu();
  useAuthStore.setState({ isSystemAccount: false, systemAccountExists: true });
});

describe("dokuma topu doğuş yolu ayarı", () => {
  it("⭐ satır Dokuma kategorisinde; varsayılan TABLET_DOFF (bugünkü), üç seçenek etiketi ve açıklaması", () => {
    const f = satir();
    expect(f).toMatchObject({ title: "Dokuma topu nerede doğar", defaultValue: "TABLET_DOFF", display: "radio" });
    expect(f.options.map((o) => [o.value, o.label])).toEqual([
      ["TABLET_DOFF", "Tablette indirme (bugünkü)"],
      ["KK1_LABEL_OR_ORDER", "Ham girişte: tezgah etiketi ya da dokuma iş emri"],
      ["KK1_LABEL_ONLY", "Ham girişte: yalnız tezgah etiketi"],
    ]);
    for (const o of f.options) expect(o.hint.length).toBeGreaterThan(20);
    expect(f.gate).toBeDefined();
  });

  it("açıklamadaki menü yolu ve ayar adları katalogla aynı (elle yazılmış yol kaymaz)", () => {
    const d = satir().desc;
    expect(d).toContain(settingsCategoryTrail(devere));
    expect(d).toContain(devereBaslik("devereMountTracking"));
    expect(d).toContain(devereBaslik("devereAutoConsume"));
  });

  it("TABLET_DOFF iken bant yok", () => {
    ciz();
    expect(screen.getByRole("radio", { name: /Tablette indirme \(bugünkü\)/ })).toBeTruthy();
    expect(bant()).toBeNull();
  });

  it("⭐ taslakta KK1 seçilince bant çıkar, anahtarların durumunu söyler; Kaydet kilitlenmez", () => {
    sunucu({ devereMountTracking: true, devereAutoConsume: false });
    ciz();
    fireEvent.click(screen.getByRole("radio", { name: /Ham girişte: yalnız tezgah etiketi/ }));
    const b = bant()!;
    expect(b).toBeTruthy();
    expect(b.textContent).toContain("Levent dengesi için");
    expect(b.textContent).toContain(settingsCategoryTrail(devere));
    expect(b.textContent).toContain(`${devereBaslik("devereMountTracking")}: açık`);
    expect(b.textContent).toContain(`${devereBaslik("devereAutoConsume")}: kapalı`);
    expect((screen.getByRole("button", { name: "Kaydet" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("KK1 kayıtlı + iki anahtar açık + modül açık → bant yok", () => {
    sunucu({ dokumaRollBirth: "KK1_LABEL_OR_ORDER", devereMountTracking: true, devereAutoConsume: true });
    ciz();
    expect(bant()).toBeNull();
  });

  it("anahtarlar açık ama Devere modülü kapalı → bant modülü de söyler", () => {
    sunucu({ dokumaRollBirth: "KK1_LABEL_OR_ORDER", devereEnabled: false, devereMountTracking: true, devereAutoConsume: true });
    ciz();
    expect(bant()?.textContent).toContain("Devere modülü: kapalı");
  });
});
