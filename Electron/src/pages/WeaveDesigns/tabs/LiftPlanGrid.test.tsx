// Armür ızgarası yön düğmesi yalnız ÇİZİMİ çevirir: alttan yukarıda ilk çizilen satır son atkıdır, ama
// hücrenin `data-pick`i veri satırıdır — tıklama aynı hücreyi değiştirir (veri sırası korunur).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LiftPlanGrid } from "./LiftPlanGrid";

const PLAN = [[1, 0], [0, 0], [0, 1]];

function setup(direction: "bottom-up" | "top-down") {
  const onClick = vi.fn((e: { target: EventTarget }) => (e.target as HTMLElement).dataset.pick);
  render(<LiftPlanGrid plan={PLAN} frames={2} rows={3} leno={new Set()} selector={[1, 2, 1]} selCount={2} canWrite direction={direction} onClick={onClick} />);
  return onClick;
}

describe("LiftPlanGrid yönü", () => {
  it("alttan yukarı: ilk çizilen satır 3. atkı, başlık en altta", () => {
    setup("bottom-up");
    const rows = screen.getAllByRole("row");
    expect(rows[0]!.getAttribute("data-row")).toBe("2");
    expect(rows.at(-1)!.querySelector("[role=columnheader]")).not.toBeNull();
  });
  it("yukarıdan aşağı: bugünkü sıra, başlık üstte", () => {
    setup("top-down");
    const rows = screen.getAllByRole("row");
    expect(rows[0]!.querySelector("[role=columnheader]")).not.toBeNull();
    expect(rows[1]!.getAttribute("data-row")).toBe("0");
  });
  it("tıklanan hücre yöne bakmadan veri satırını taşır", () => {
    const onClick = setup("bottom-up");
    const firstDrawn = screen.getAllByRole("row")[0]!.querySelector<HTMLElement>("[data-pick]")!;
    fireEvent.click(firstDrawn);
    expect(onClick).toHaveReturnedWith("2");
  });
});
