// Ürün penceresi > Çözgü > Tahar planı (T1): seçili planın kısa özeti + şerit; yerinde düzenleme kuralı;
// gövde kuralı (doluysa id, kayıtta vardı + boş → null, görünmezse anahtar yok).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { renderWithProviders } from "@/test/render";
import type { DrawingInPlan } from "@/pages/DrawingInPlans/types";
import { isPlanExclusive } from "@/pages/DrawingInPlans/useDrawingInPlanRecordForm";
import { drawingInPlanPayload } from "../ItemConstructionPickers";
import type { ItemFormValues } from "../schema";

const PLAN: DrawingInPlan = {
  id: "p1", code: "THR-0001", name: "Düz 4", frameCount: 4, threading: [1, 2, 3, 4], notation: "1-2-3-4", threadingKey: "k",
  selvedgeThreading: [], notes: null, isActive: true, createdAt: "", updatedAt: "", _count: { fabricItems: 1 },
};
const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const { ItemDrawingInSection } = await import("./ItemDrawingInSection");

function Harness({ planId }: { planId: string }) {
  const form = useForm<ItemFormValues>({ defaultValues: { drawingInPlanId: planId } as Partial<ItemFormValues> as ItemFormValues });
  return <ItemDrawingInSection form={form} savedPlanId={planId || null} />;
}

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url: string) => Promise.resolve({ data: { success: true, data: url === "/api/drawing-in-plans/p1" ? PLAN : url === "/api/drawing-in-plans/p1/machines" ? MACHINES : [] } }));
});

const MACHINES = {
  plan: { id: "p1", code: "THR-0001", name: "Düz 4", frameCount: 4 },
  machines: [
    { id: "m1", code: "T-07", name: "Tezgah 7", frameCount: 8, source: "AUTO", mountedAt: null, planId: "p1", planCode: "THR-0001" },
    { id: "m2", code: "T-09", name: "Tezgah 9", frameCount: null, source: "MANUAL", mountedAt: null, planId: "p9", planCode: "THR-0009" },
  ],
};

describe("ItemDrawingInSection — uyan tezgâhlar (T3)", () => {
  it("bu taharın takılı olduğu tezgâhlar listelenir; aynı özetli başka plan kodu parantezde", async () => {
    renderWithProviders(<Harness planId="p1" />);
    const box = await screen.findByTestId("plan-machines");
    expect(box.textContent).toContain("Bu taharın takılı olduğu tezgâhlar");
    expect(box.textContent).toContain("T-07");
    expect(box.textContent).toContain("T-09(THR-0009)");
    expect(box.textContent).not.toContain("(THR-0001)");
  });

  it("takılı tezgâh yoksa açıklayıcı boş durum", async () => {
    get.mockImplementation((url: string) => Promise.resolve({ data: { success: true, data: url === "/api/drawing-in-plans/p1" ? PLAN : url.endsWith("/machines") ? { ...MACHINES, machines: [] } : [] } }));
    renderWithProviders(<Harness planId="p1" />);
    expect((await screen.findByTestId("plan-machines")).textContent).toContain("bu tahar takılı tezgâh yok");
  });
});

describe("ItemDrawingInSection", () => {
  it("seçili planın adı, yazımı ve tel→çerçeve şeridi çizilir", async () => {
    renderWithProviders(<Harness planId="p1" />);
    const summary = await screen.findByTestId("drawing-in-summary");
    expect(summary.textContent).toContain("Düz 4");
    expect(summary.textContent).toContain("4 çerçeve · 1-2-3-4");
    expect(screen.getByTestId("drawing-in-preview")).toBeTruthy();
  });

  it("plan seçili değilken özet yok ve plan sorgusu atılmaz", async () => {
    renderWithProviders(<Harness planId="" />);
    expect(await screen.findByTestId("item-drawing-in")).toBeTruthy();
    expect(screen.queryByTestId("drawing-in-summary")).toBeNull();
    expect(get).not.toHaveBeenCalledWith("/api/drawing-in-plans/", expect.anything());
  });
});

describe("tahar planı kullanım yeri kuralları", () => {
  it("yerinde Düzenle yalnız başka kumaşta kullanılmayan planda", () => {
    expect(isPlanExclusive({ ...PLAN, _count: { fabricItems: 0 } }, null)).toBe(true);
    expect(isPlanExclusive(PLAN, "p1")).toBe(true);
    expect(isPlanExclusive(PLAN, "p2")).toBe(false);
    expect(isPlanExclusive({ ...PLAN, _count: { fabricItems: 2 } }, "p1")).toBe(false);
    expect(isPlanExclusive({ ...PLAN, _count: undefined }, "p1")).toBe(false);
  });

  it("gövde: doluysa id, kayıtta vardı + boş → null, görünmezse anahtar yok", () => {
    expect(drawingInPlanPayload("p1", null, true)).toEqual({ drawingInPlanId: "p1" });
    expect(drawingInPlanPayload("", "p1", true)).toEqual({ drawingInPlanId: null });
    expect(drawingInPlanPayload("", null, true)).toEqual({});
    expect(drawingInPlanPayload("p1", "p1", false)).toEqual({});
  });
});
