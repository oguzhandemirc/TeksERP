import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusAgeCell, minAgeFilter, statusAgeText } from "./StatusAgeCell";

describe("StatusAgeCell (devere S4)", () => {
  it("metin: alan yok → —, 0 → Bugün, n → n gün", () => {
    expect(statusAgeText(undefined)).toBe("—");
    expect(statusAgeText(0)).toBe("Bugün");
    expect(statusAgeText(12)).toBe("12 gün");
  });

  it("eşik üstünde uyarı rengi, eşik yoksa nötr", () => {
    const { rerender } = render(<StatusAgeCell days={30} staleAt={30} />);
    expect(screen.getByText("30 gün").className).toContain("text-warning");
    rerender(<StatusAgeCell days={30} staleAt={null} />);
    expect(screen.getByText("30 gün").className).not.toContain("text-warning");
  });

  it("süzgeç: minAgeDays anahtarı, seçenekler 'N+ gün'", () => {
    const f = minAgeFilter([7, 30]);
    if (f.kind !== "select") throw new Error("select bekleniyordu");
    expect(f.key).toBe("minAgeDays");
    expect(f.options.map((o) => o.label)).toEqual(["7+ gün", "30+ gün"]);
  });
});
