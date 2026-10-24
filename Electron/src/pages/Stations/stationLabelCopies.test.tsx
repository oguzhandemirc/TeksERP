// İstasyon varsayılan etiket adedi (2026-10-24): gövdeye girer (boş → null = genel adet),
// şema 1–5 dışını reddeder, alan "Sistem geneli"nde soluk + açıklamalı, "İstasyon"da etkin.
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import { stationFormDefaults, stationFormSchema, type StationFormValues } from "./schema";
import { buildStationPayload } from "./stationPayload";

let flags: Record<string, unknown> = {};
vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: flags } }),
}));

import { StationLabelCopiesField } from "./StationLabelCopiesField";

function Host() {
  const form = useForm<StationFormValues>({ defaultValues: stationFormDefaults });
  return <StationLabelCopiesField form={form} />;
}

describe("İstasyon formu — varsayılan etiket adedi", () => {
  it("gövde allowlist'i alanı taşır; boş → null", () => {
    const v = { ...stationFormDefaults, name: "KK1-A" };
    expect(buildStationPayload({ ...v, defaultLabelCopies: 3 }, null)).toMatchObject({ defaultLabelCopies: 3 });
    expect(buildStationPayload(v, null)).toMatchObject({ defaultLabelCopies: null });
  });

  it("şema 1–5 tam sayı ya da boş kabul eder", () => {
    const base = { ...stationFormDefaults, name: "KK1-A" };
    expect(stationFormSchema.safeParse({ ...base, defaultLabelCopies: 5 }).success).toBe(true);
    expect(stationFormSchema.safeParse({ ...base, defaultLabelCopies: null }).success).toBe(true);
    expect(stationFormSchema.safeParse({ ...base, defaultLabelCopies: 6 }).success).toBe(false);
    expect(stationFormSchema.safeParse({ ...base, defaultLabelCopies: 0 }).success).toBe(false);
  });

  it("Sistem geneli modunda açıklama bunu söyler", () => {
    flags = { labelCopiesSource: "GLOBAL", labelCopies: 2 };
    renderWithProviders(<Host />);
    expect(screen.getByText(/Sistem geneli kullanılıyor/)).toBeTruthy();
  });

  it("İstasyon modunda genel adedi yedek olarak gösterir", () => {
    flags = { labelCopiesSource: "STATION", labelCopies: 2 };
    renderWithProviders(<Host />);
    expect(screen.getByText(/Boş bırakılırsa genel adet \(2\)/)).toBeTruthy();
    expect(screen.getByTestId("station-default-label-copies").getAttribute("placeholder")).toBe("Genel (2)");
  });
});
