// =============================================================================
// BEKÇİ — Lot kalite menüsü (2026-09-18): §1 Serbest/Bekletme TEK TIK → PATCH {status}, diyalog YOK · §2 Bloke → onay + not →
//   PATCH {status:"BLOCKED", note} · §3 mevcut durum menüde YOK · §4 `quality:write` yoksa menü çizilmez
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";

let canWrite = true;
const setYarnLotQuality = vi.fn();
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => canWrite && p === "quality:write", hasAnyPermission: () => canWrite, hasAllPermissions: () => canWrite }) }));
vi.mock("./service", async (orig) => ({ ...(await orig<typeof import("./service")>()), setYarnLotQuality: (...a: unknown[]) => setYarnLotQuality(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { YarnLotQualityMenu } from "./YarnLotQualityMenu";
import type { YarnLotRow } from "./service";

const row = (qualityStatus?: YarnLotRow["qualityStatus"]): YarnLotRow =>
  ({ id: "lot-1", itemId: "i1", lotNo: "YAN-7", supplierId: null, notes: null, isActive: true, item: { id: "i1", code: "IP1", name: "Ne 30" }, supplier: null, balanceKg: 120, createdAt: "", updatedAt: "", ...(qualityStatus ? { qualityStatus } : {}) }) as YarnLotRow;

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("button", { name: /Kalite işlemleri/ });
  await user.click(trigger);
  await screen.findByRole("menu");
}

beforeEach(() => {
  canWrite = true;
  setYarnLotQuality.mockReset().mockResolvedValue({ success: true, data: row("ON_HOLD"), message: "ok" });
});

describe("YarnLotQualityMenu", () => {
  it("§1 ⭐ Bekletmeye al TEK TIK → PATCH {status:'ON_HOLD'}, diyalog yok, onDone", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<YarnLotQualityMenu row={row()} onDone={onDone} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Bekletmeye al/ }));
    await waitFor(() => expect(setYarnLotQuality).toHaveBeenCalledWith("lot-1", { status: "ON_HOLD" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("§2 ⭐ Bloke et → onay diyaloğu + not → PATCH {status:'BLOCKED', note}", async () => {
    const user = userEvent.setup();
    renderWithProviders(<YarnLotQualityMenu row={row("RELEASED")} onDone={vi.fn()} />);
    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: /Bloke et/ }));
    expect(setYarnLotQuality).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("YAN-7");
    fireEvent.change(screen.getByLabelText("Bloke sebebi"), { target: { value: "mukavemet düşük" } });
    await user.click(screen.getByTestId("lot-bloke-onay"));
    await waitFor(() => expect(setYarnLotQuality).toHaveBeenCalledWith("lot-1", { status: "BLOCKED", note: "mukavemet düşük" }));
  });

  it("§3 mevcut durum menüde sunulmaz (Bekletmede lot: Serbest bırak + Bloke et)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<YarnLotQualityMenu row={row("ON_HOLD")} onDone={vi.fn()} />);
    await openMenu(user);
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent?.trim())).toEqual(["Serbest bırak", "Bloke et"]);
  });

  it("§4 quality:write yoksa menü çizilmez", () => {
    canWrite = false;
    renderWithProviders(<YarnLotQualityMenu row={row()} onDone={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Kalite işlemleri/ })).toBeNull();
  });
});
