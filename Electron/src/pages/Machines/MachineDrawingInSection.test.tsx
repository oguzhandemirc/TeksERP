// Tezgâh tanımı > Takılı tahar (T2/T3): iz satırı (kaynak · kim · ne zaman), uyan kumaşlar, bilinmiyor boş durumu,
// planlama bölümünde çerçeve sayısı gövdesi.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { MachineDrawingInFit } from "@/pages/DrawingInPlans/machine-fit";
import { buildMachinePayload } from "./machinePayload";
import { machineFormDefaults, machineFormSchema } from "./schema";

const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const { MachineDrawingInSection, mountTrail } = await import("./MachineDrawingInSection");

const FIT: MachineDrawingInFit = {
  machine: {
    id: "m1", code: "T-07", name: "Tezgah 7", frameCount: 8, mountedDrawingInSource: "AUTO", mountedDrawingInAt: "2026-11-28T11:05:00.000Z",
    mountedDrawingInPlan: { id: "p1", code: "THR-0001", name: "Düz 4", frameCount: 4, notation: "1-2-3-4", isActive: true },
    mountedDrawingInBy: { id: "u1", fullName: "Ayşe Usta" },
  },
  items: [{ id: "i1", code: "TUL-01", name: "Tül A", planId: "p1", planCode: "THR-0001" }, { id: "i2", code: "TUL-02", name: "Tül B", planId: "p2", planCode: "THR-0002" }],
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url: string) => Promise.resolve({ data: { success: true, data: url === "/api/drawing-in-plans/machines/m1" ? FIT : [] } }));
});

describe("MachineDrawingInSection", () => {
  it("iz satırı: kaynak · kim · fabrika saatiyle ne zaman", () => {
    expect(mountTrail(FIT.machine)).toMatch(/^otomatik · Ayşe Usta · 28\.11\.2026 \d\d:05$/);
    expect(mountTrail({ ...FIT.machine, mountedDrawingInSource: null })).toBeNull();
  });

  it("tahar değiştirmeden girebilen kumaşlar listelenir", async () => {
    renderWithProviders(<MachineDrawingInSection machineId="m1" />);
    const items = await screen.findByTestId("machine-fit-items");
    expect(items.textContent).toContain("Tahar değiştirmeden girebilen kumaşlar");
    expect(items.textContent).toContain("TUL-01");
    expect(items.textContent).toContain("TUL-02");
    expect(screen.getByTestId("machine-drawing-in-trail").textContent).toContain("otomatik");
  });

  it("takılı tahar bilinmiyorsa açıklayıcı boş durum, iz satırı yok", async () => {
    get.mockImplementation(() => Promise.resolve({ data: { success: true, data: { machine: { ...FIT.machine, mountedDrawingInPlan: null, mountedDrawingInSource: null }, items: [] } } }));
    renderWithProviders(<MachineDrawingInSection machineId="m1" />);
    expect((await screen.findByTestId("machine-fit-items")).textContent).toContain("Takılı tahar bilinmiyor");
    expect(screen.queryByTestId("machine-drawing-in-trail")).toBeNull();
  });
});

describe("çerçeve sayısı (planlama gövdesi)", () => {
  it("dolu → sayı; boş + kayıtlı → null; boş + kayıtsız → anahtar yok; 17 ve 0 reddedilir", () => {
    const base = { ...machineFormDefaults, stationId: "s1", name: "T" };
    expect(buildMachinePayload({ ...base, frameCount: "12" }, null).frameCount).toBe(12);
    const saved = { id: "m1", stationId: "s1", code: "T-07", name: "T", isActive: true, warpBeamSlots: 1, createdAt: "", updatedAt: "", frameCount: 8 };
    expect(buildMachinePayload({ ...base, frameCount: "" }, saved).frameCount).toBeNull();
    expect("frameCount" in buildMachinePayload({ ...base, frameCount: "" }, null)).toBe(false);
    expect(machineFormSchema.safeParse({ ...base, frameCount: "17" }).success).toBe(false);
    expect(machineFormSchema.safeParse({ ...base, frameCount: "0" }).success).toBe(false);
    expect(machineFormSchema.safeParse({ ...base, frameCount: "16" }).success).toBe(true);
  });
});
