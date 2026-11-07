// Yazma eylemleri `kartela:write` ister — izin yoksa düğme hiç çizilmez (salt-okuma GERÇEK).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

let perms = new Set<string>();
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => perms.has(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => perms.has(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => perms.has(p)),
  }),
}));
const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: vi.fn() } }));

import { DispatchCancelAction, ReceiptCancelAction } from "./KartelaDetailActions";
import { OutstandingTab } from "./OutstandingTab";

const dispatch = { id: "d1", dispatchNo: "KS-1", cancelledAt: null, items: [{}], receipts: [] };
const outstanding = { data: { success: true, data: [{
  dispatchedQty: 40, dispatchedWeight: null,
  dispatch: { id: "d1", dispatchNo: "KS-1", dispatchedAt: "2026-11-01T08:00:00.000Z", subcontractor: { id: "f1", name: "Firma" } },
  roll: { id: "r1", barcode: "T1", currentQty: 40, width: null, weightKg: null, qualityGrade: "A", markedForKartela: false,
    item: { code: "P", name: "Poplin" }, color: null, properties: [] },
}] } };

describe("kartela:write görünürlüğü", () => {
  beforeEach(() => {
    get.mockReset().mockImplementation((url: string) => (url === "/api/kartela/outstanding" ? Promise.resolve(outstanding) : Promise.resolve({ data: { data: {} } })));
  });

  it("izin yoksa iptal ve Kabul Et düğmeleri yok", async () => {
    perms = new Set(["kartela:read"]);
    renderWithProviders(<><DispatchCancelAction dispatch={dispatch} /><ReceiptCancelAction receipt={{ id: "k1", cancelledAt: null }} /><OutstandingTab /></>);
    expect(await screen.findByText("KS-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sevki İptal Et/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Kabulü İptal Et/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Kabul Et/ })).toBeNull();
  });

  it("izin varsa görünür; iptal/kabullü sevkte iptal düğmesi yok", async () => {
    perms = new Set(["kartela:read", "kartela:write"]);
    renderWithProviders(<><DispatchCancelAction dispatch={dispatch} /><ReceiptCancelAction receipt={{ id: "k1", cancelledAt: null }} /><OutstandingTab /></>);
    expect(await screen.findByRole("button", { name: /Kabul Et$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sevki İptal Et/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kabulü İptal Et/ })).toBeInTheDocument();
  });

  it("kabul edilmiş ya da iptal edilmiş sevkte iptal düğmesi çizilmez", () => {
    perms = new Set(["kartela:write"]);
    renderWithProviders(<>
      <DispatchCancelAction dispatch={{ ...dispatch, receipts: [{}] }} />
      <DispatchCancelAction dispatch={{ ...dispatch, cancelledAt: "2026-11-02T00:00:00Z" }} />
      <ReceiptCancelAction receipt={{ id: "k1", cancelledAt: "2026-11-02T00:00:00Z" }} />
    </>);
    expect(screen.queryByRole("button", { name: /İptal Et/ })).toBeNull();
  });
});
