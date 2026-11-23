import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const openTab = vi.fn();
const navigateActive = vi.fn();
let allowed = true;
vi.mock("@/store/tabs", () => ({ useTabsStore: { getState: () => ({ openTab, navigateActive }) } }));
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasAnyPermission: (p: string[]) => allowed && p.includes("system:activity") }),
}));

import { TraceLink, activityTraceTarget } from "./TraceLink";

describe("TraceLink — kayıt kartından İşlemler görünümüne", () => {
  beforeEach(() => {
    openTab.mockClear();
    navigateActive.mockClear();
    allowed = true;
  });

  it("kayıt no ile Etkinlik aramasını açar (kodlanmış; varsayılan aynı sekmede)", async () => {
    render(<TraceLink recordNo=" T-2026 0148 " />);
    fireEvent.click(screen.getByTestId("trace-link"));
    await vi.waitFor(() => expect(navigateActive).toHaveBeenCalled());
    expect(navigateActive).toHaveBeenCalledWith("/system/activity", { state: { activityQuery: "T-2026 0148" } });
    expect(openTab).not.toHaveBeenCalled();
  });

  it("numara yoksa ya da çok kısaysa çizilmez (sunucu 400 verirdi)", () => {
    const { container } = render(<><TraceLink recordNo={null} /><TraceLink recordNo="A" /></>);
    expect(container.querySelector("[data-testid=trace-link]")).toBeNull();
  });

  it("Etkinlik izni yoksa çizilmez", () => {
    allowed = false;
    render(<TraceLink recordNo="WO-1" />);
    expect(screen.queryByTestId("trace-link")).toBeNull();
  });

  it("hedef yolu", () => {
    expect(activityTraceTarget("SP-1")).toEqual({ to: "/system/activity", state: { activityQuery: "SP-1" } });
  });
});
