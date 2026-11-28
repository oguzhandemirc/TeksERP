// =============================================================================
// Desen kartı > Armür > Kumaş görünümü — tahar kaynağı (T1 paneli).
//   §1 plan VAR: önizleme plan dizisinden çizilir (hücreler sunucu `test_weave_drawdown` §6a örneğiyle aynı), not "Tahar: THR-…"
//   §2 plan YOK: bugünkü tür dizilimi ve metin aynen
//   §3 plan örgüye sığmıyor: türe düşer, not bunu söyler (sunucu §6b ikizi)
// =============================================================================
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { computeDrawdown, groundFrameIndexes } from "@/components/weave/weave-drawdown";
import { FabricPreviewSection } from "./FabricPreviewSection";
import { drawingInPlanNote, resolvePreviewDrawingIn } from "./fabric-preview-drawing-in";
import type { WeaveDesign } from "../types";

const LIFT = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
const GROUND = groundFrameIndexes(4);
const PLAN = { code: "THR-0003", threading: [1, 1, 2, 3, 4] };
const DESIGN = {
  kind: "DOBBY", shedMechanism: "DOBBY", weaveStructure: "PLAIN", drawingInNote: null, drawingInType: "SKIP", lenoSetup: null,
} as unknown as Pick<WeaveDesign, "kind" | "shedMechanism" | "weaveStructure" | "drawingInNote" | "drawingInType" | "lenoSetup">;

function cellsWith(plan: typeof PLAN | null) {
  const src = resolvePreviewDrawingIn(plan, 4, GROUND, "SKIP");
  return { src, dd: computeDrawdown({ liftPlan: LIFT, drawingInType: "SKIP", threading: src.threading }) };
}

describe("Kumaş görünümü tahar kaynağı", () => {
  it("§1 ⭐ tahar planı varsa plan dizisinden çizilir (sunucu basımıyla aynı hücreler)", () => {
    const { src, dd } = cellsWith(PLAN);
    expect(src).toEqual({ threading: [1, 1, 2, 3, 4], unitEnds: 5, planApplied: true });
    expect(dd.draw).toEqual([0, 0, 1, 2, 3]);
    expect(dd.cells).toEqual([[0, 0, 1, 1, 1], [1, 1, 0, 1, 1], [1, 1, 1, 0, 1], [1, 1, 1, 1, 0]]);
    renderWithProviders(<FabricPreviewSection design={DESIGN} plan={LIFT} lenoFrames={[]} selector={null} yarnNames={[]} direction="top-down" drawingInPlan={PLAN} />);
    expect(screen.getByTestId("drawing-in-plan-note")).toHaveTextContent("Tahar: THR-0003.");
    // 2× tekrar × 5 tel (plan raporu) = 10 sütun × 14 px + 30 etiket + 1.
    expect(screen.getByRole("img", { name: "Kumaş görünümü" })).toHaveAttribute("width", "171");
    expect(screen.getByText(/Tahar planından çizildi/)).toBeInTheDocument();
  });

  it("§2 ⭐ tahar planı yoksa bugünkü tür dizilimi ve metin aynen kalır", () => {
    const { src, dd } = cellsWith(null);
    expect(src).toEqual({ threading: null, unitEnds: 4, planApplied: false });
    expect(dd.draw).toEqual([0, 2, 1, 3]);
    expect(dd.cells).toEqual(computeDrawdown({ liftPlan: LIFT, drawingInType: "SKIP" }).cells);
    renderWithProviders(<FabricPreviewSection design={DESIGN} plan={LIFT} lenoFrames={[]} selector={null} yarnNames={[]} direction="top-down" />);
    expect(screen.queryByTestId("drawing-in-plan-note")).toBeNull();
    expect(screen.getByText(/Atlamalı tahar ile çizildi/)).toBeInTheDocument();
    // 2× tekrar × 4 tel (tür raporu) = 8 sütun.
    expect(screen.getByRole("img", { name: "Kumaş görünümü" })).toHaveAttribute("width", "143");
  });

  it("§3 plan çerçeveleri örgüyü aşarsa türe düşer ve not bunu söyler", () => {
    const wide = { code: "THR-0009", threading: [1, 5] };
    const src = resolvePreviewDrawingIn(wide, 4, GROUND, "SKIP");
    expect(src.planApplied).toBe(false);
    expect(src.threading).toBeNull();
    expect(drawingInPlanNote(wide, false)).toMatch(/^Tahar: THR-0009 — /);
    expect(drawingInPlanNote(null, false)).toBeNull();
  });
});
