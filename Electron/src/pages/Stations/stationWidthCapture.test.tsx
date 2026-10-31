// D4-E2b: istasyon formunda "En ölçer" — gövdeye girer, kayıtlı değer forma geri okunur.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { StationKind, StationType } from "@/types/enums";
import { stationFormDefaults, stationFormSchema } from "./schema";
import { buildStationPayload } from "./stationPayload";
import { capabilityChips } from "./StationListRow";
import type { Station } from "./types";

vi.mock("@/hooks/usePricingEnabled", () => ({
  useFeatureFlags: () => ({ data: { data: {} } }),
  useDevereEnabled: () => false,
  useDokumaEnabled: () => false,
}));
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));

import { StationFormDialog } from "./StationFormDialog";

const station = (over: Partial<Station> = {}): Station => ({
  id: "s1", code: "IST1", name: "Etek Kesim", type: StationType.INTERNAL, kind: StationKind.PROCESS_QC, department: null,
  isActive: true, appliesColor: false, appliesProperty: true, appliesQuality: true, inspectionEnabled: false,
  producesWarpBeam: false, consumesWarpBeam: false, defaultLabelCopies: null, defaultCategoryId: null,
  createdAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z", ...over,
});

describe("İstasyon formu — En ölçer", () => {
  it("varsayılan kapalı (bugünkü davranış) ve gövde allowlist'i alanı taşır", () => {
    expect(stationFormDefaults.capturesWidth).toBe(false);
    const v = { ...stationFormDefaults, name: "Etek" };
    expect(buildStationPayload(v, null)).toMatchObject({ capturesWidth: false });
    expect(buildStationPayload({ ...v, capturesWidth: true }, null)).toMatchObject({ capturesWidth: true });
    expect(stationFormSchema.safeParse({ ...v, capturesWidth: true }).success).toBe(true);
  });

  it("⭐ kayıtlı capturesWidth=true forma geri okunur ve kaydette korunur", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<StationFormDialog open onOpenChange={() => {}} initial={station({ capturesWidth: true })} onSubmit={onSubmit} />);
    const box = screen.getByTestId("station-captures-width") as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(buildStationPayload(onSubmit.mock.calls[0]![0], station())).toMatchObject({ capturesWidth: true });
  });

  it("⭐ kutu işaretlenip kaydedilince gövdede capturesWidth=true; eski backend (alan yok) → kapalı", async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<StationFormDialog open onOpenChange={() => {}} initial={station()} onSubmit={onSubmit} />);
    const box = screen.getByTestId("station-captures-width") as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0].capturesWidth).toBe(true);
  });

  it("liste rozeti yalnız açıkken", () => {
    expect(capabilityChips(station({ capturesWidth: true }))).toContain("En ölçer");
    expect(capabilityChips(station())).not.toContain("En ölçer");
  });
});
