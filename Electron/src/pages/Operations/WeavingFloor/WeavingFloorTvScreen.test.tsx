// Kabuksuz TV ekranı: kapı açıkken `WeavingFloorPage tv` çizilir; izin/modül yoksa sayfa
// çizilmez, yerine neden yazılır; bayrak yüklenmeden hiçbir şey çizilmez.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const access = { permitted: true };
const ctx = { flagsReady: true, flagsFailed: false, tezgahEnabled: true };
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => access.permitted && p === "loom:live-view" }) }));
vi.mock("../useOperationsVisibility", () => ({ useOperationsVisibilityContext: () => ctx }));
vi.mock("./WeavingFloorPage", () => ({ WeavingFloorPage: ({ tv }: { tv?: boolean }) => <div data-testid="floor-page">{tv ? "tv" : "normal"}</div> }));

import { WeavingFloorTvScreen } from "./WeavingFloorTvScreen";

describe("WeavingFloorTvScreen", () => {
  afterEach(() => {
    access.permitted = true;
    Object.assign(ctx, { flagsReady: true, flagsFailed: false, tezgahEnabled: true });
  });

  it("⭐ izin + modül açık → salon TV kipinde", () => {
    render(<WeavingFloorTvScreen />);
    expect(screen.getByTestId("floor-page").textContent).toBe("tv");
  });

  it("⭐ izin yok → sayfa çizilmez, neden yazılır", () => {
    access.permitted = false;
    render(<WeavingFloorTvScreen />);
    expect(screen.queryByTestId("floor-page")).toBeNull();
    expect(screen.getByTestId("tv-closed").textContent).toContain("izni yok");
  });

  it("modül kapalı → sayfa çizilmez; bayrak yüklenmediyse hiçbir şey", () => {
    ctx.tezgahEnabled = false;
    const { unmount } = render(<WeavingFloorTvScreen />);
    expect(screen.getByTestId("tv-closed").textContent).toContain("modülü");
    unmount();
    ctx.flagsReady = false;
    const { container } = render(<WeavingFloorTvScreen />);
    expect(container.innerHTML).toBe("");
  });
});
