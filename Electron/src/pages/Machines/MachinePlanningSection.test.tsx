// =============================================================================
// BEKÇİ — Tezgâh kartı "Planlama" bölümü (Seyitoğlu temel)
// NEGATİF SONDA (2026-11-11, geri alındı): null-temizle dalı silindi → §2b ❌.
// =============================================================================
// ⭐ §1 Dokuma kapalı → bölüm yok; açık → kapalı gelir, dolu değerle açık.
// ⭐ §2 Gövde (buildMachinePayload): dolu → sayı · boş + kayıtsız → anahtar YOK · boş + kayıtlı → null.
// ⭐ §3 Doğrulama: verim 0–100, devir tam sayı > 0, en > 0.
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import { MachineFormDialog } from "./MachineFormDialog";
import { buildMachinePayload } from "./machinePayload";
import { machineFormDefaults, machineFormSchema, type MachineFormValues } from "./schema";
import type { Machine } from "./types";

const flags = vi.hoisted(() => ({ dokuma: true }));
vi.mock("@/hooks/usePricingEnabled", () => ({ useDevereEnabled: () => false, useDokumaEnabled: () => flags.dokuma }));
vi.mock("@/components/forms/SimilarNamesWarning", () => ({ SimilarNamesWarning: () => null }));
vi.mock("@/components/forms/ReferenceSelect", () => ({ ReferenceSelect: () => null }));

const machine = (over: Partial<Machine> = {}): Machine => ({
  id: "m1", stationId: "s1", code: "T-07", name: "Tezgah 7", isActive: true, warpBeamSlots: 1, createdAt: "", updatedAt: "", ...over,
});
const section = () => screen.getByTestId("machine-planning") as HTMLDetailsElement;

beforeEach(() => {
  flags.dokuma = true;
});

describe("Tezgâh planlama — görünürlük", () => {
  it("⭐ §1 dokuma kapalı → bölüm yok; açık + boş → kapalı; dolu → açık ve virgüllü", () => {
    flags.dokuma = false;
    const r1 = renderWithProviders(<MachineFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={machine()} />);
    expect(screen.queryByTestId("machine-planning")).toBeNull();
    r1.unmount();
    flags.dokuma = true;
    const r2 = renderWithProviders(<MachineFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={machine()} />);
    expect(section().open).toBe(false);
    expect(screen.getByLabelText("Devir (dk)")).toBeInTheDocument();
    expect(screen.getByLabelText("Verim (%)")).toBeInTheDocument();
    expect(screen.getByLabelText("En geniş çalışma eni (cm)")).toBeInTheDocument();
    r2.unmount();
    renderWithProviders(<MachineFormDialog open onOpenChange={() => {}} onSubmit={() => {}} initial={machine({ planEfficiencyPct: "85.50" })} />);
    expect(section().open).toBe(true);
    expect(screen.getByLabelText("Verim (%)")).toHaveValue("85,5");
  });
});

describe("Tezgâh planlama — istek gövdesi", () => {
  it("⭐ §2a formdan girilen değerler gövdeye SAYI gider", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const m = machine();
    renderWithProviders(<MachineFormDialog open onOpenChange={() => {}} initial={m} onSubmit={(v) => onSubmit(buildMachinePayload(v, m))} />);
    await user.type(screen.getByLabelText("Devir (dk)"), "600");
    await user.type(screen.getByLabelText("Verim (%)"), "85,5");
    await user.type(screen.getByLabelText("En geniş çalışma eni (cm)"), "340");
    await user.click(screen.getByRole("button", { name: /Kaydet|Güncelle/ }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ planRpm: 600, planEfficiencyPct: 85.5, maxWorkingWidthCm: 340 });
  });

  it("⭐ §2b boş + kayıtsız → anahtar YOK; boş + kayıtlı → null", () => {
    const v: MachineFormValues = { ...machineFormDefaults, stationId: "s1", name: "T" };
    const fresh = buildMachinePayload(v, null) as Record<string, unknown>;
    for (const k of ["planRpm", "planEfficiencyPct", "maxWorkingWidthCm"]) expect(k in fresh).toBe(false);
    const cleared = buildMachinePayload(v, machine({ planRpm: 600 })) as Record<string, unknown>;
    expect(cleared.planRpm).toBeNull();
    expect("planEfficiencyPct" in cleared).toBe(false);
  });
});

describe("Tezgâh planlama — doğrulama", () => {
  const parse = (over: Partial<MachineFormValues>) =>
    machineFormSchema.safeParse({ ...machineFormDefaults, stationId: "s1", name: "T", ...over }).success;
  it("⭐ §3 sınırlar", () => {
    expect(parse({ planEfficiencyPct: "100" })).toBe(true);
    expect(parse({ planEfficiencyPct: "0" })).toBe(true);
    expect(parse({ planEfficiencyPct: "120" })).toBe(false);
    expect(parse({ planRpm: "600" })).toBe(true);
    expect(parse({ planRpm: "0" })).toBe(false);
    expect(parse({ planRpm: "600,5" })).toBe(false);
    expect(parse({ maxWorkingWidthCm: "0" })).toBe(false);
    expect(parse({ maxWorkingWidthCm: "340,25" })).toBe(true);
  });
});
