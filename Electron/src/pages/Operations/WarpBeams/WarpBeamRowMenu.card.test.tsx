import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { WarpBeamRowMenu } from "./WarpBeamRowMenu";
import type { WarpBeam } from "./types";

// A6 levent kartı menü satırı (devere-levent S5): yalnız `warpbeam:read` ile görünür; sarılmamış/iptal levent pasif.
let permissions: string[] = [];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => permissions.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => permissions.includes(p)),
  }),
}));
vi.mock("@/components/ui/context-menu", () => ({
  ContextMenuItem: ({ children, disabled, onSelect }: { children: ReactNode; disabled?: boolean; onSelect?: () => void }) => (
    <button type="button" disabled={disabled} onClick={onSelect}>{children}</button>
  ),
  ContextMenuSeparator: () => <hr />,
}));

const beam = (status: WarpBeam["status"]) => ({ id: "b1", beamNo: "LV-1", status, warpingOrderId: null }) as unknown as WarpBeam;
const noop = () => {};
const renderMenu = (row: WarpBeam, onPrintCard = vi.fn()) => {
  render(
    <WarpBeamRowMenu row={row} mountTracking={false} onEdit={noop} onDelete={noop} onWind={noop} onCancel={noop}
      onPrintLabel={noop} onBeamAction={noop} onReject={noop} onPrintCard={onPrintCard} />,
  );
  return onPrintCard;
};

describe("WarpBeamRowMenu — levent kartı", () => {
  beforeEach(() => {
    permissions = [];
  });

  it("warpbeam:read yoksa satır çizilmez", () => {
    permissions = ["label:print"];
    renderMenu(beam("READY"));
    expect(screen.queryByText(/Levent kartı/)).toBeNull();
  });

  it("izinle sarılmış levente açık ve tıklayınca açıcı çağrılır", () => {
    permissions = ["warpbeam:read"];
    const spy = renderMenu(beam("READY"));
    const btn = screen.getByText(/Levent kartı/).closest("button")!;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(["PLANNED", "CANCELLED"] as const)("%s levent pasif", (s) => {
    permissions = ["warpbeam:read"];
    renderMenu(beam(s));
    expect(screen.getByText(/Levent kartı/).closest("button")!.disabled).toBe(true);
  });
});
