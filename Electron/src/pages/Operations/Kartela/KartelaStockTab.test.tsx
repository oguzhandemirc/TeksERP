// Kartelalık Stok: sorgu WAREHOUSE + serbest + kartelalık; "Sevke ekle" seçilenleri hazır listeyle verir, yalnız kartela:write ile.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

let perms = new Set<string>();
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => perms.has(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => perms.has(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => perms.has(p)),
  }),
}));
vi.mock("@/providers/PreferencesProvider", () => ({
  usePreferences: () => ({ prefs: {}, setPreference: vi.fn() }),
}));
const get = vi.fn();
vi.mock("@/services/apiClient", () => ({ default: { get: (...a: unknown[]) => get(...a), post: vi.fn() } }));

import { KartelaStockTab, KARTELA_STOCK_COLUMN_IDS } from "./KartelaStockTab";

const roll = (id: string, barcode: string, qty: number) => ({
  id, barcode, status: "WAREHOUSE", currentQty: qty, width: 280, markedForKartela: true,
  item: { code: "P", name: "Poplin" }, color: { code: "B", name: "Beyaz" }, properties: [],
  createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-02T08:00:00.000Z",
});

beforeEach(() => {
  get.mockReset().mockResolvedValue({ data: { success: true, data: [roll("r1", "T1", 40), roll("r2", "T2", 12.5)], pagination: { nextCursor: null, hasMore: false, limit: 100, totalEstimate: 2 } } });
});

function queryOf(): URLSearchParams {
  const url = String(get.mock.calls.find((c) => String(c[0]).startsWith("/api/rolls"))?.[0]);
  return new URLSearchParams(url.split("?")[1] ?? "");
}

describe("Kartelalık Stok sekmesi", () => {
  it("sorgu: depoda + çuvalsız/sevkiyatsız + kartelalık; sütunlar barkod·kumaş·renk·en·metre·tarih", async () => {
    perms = new Set(["kartela:read", "roll:read"]);
    renderWithProviders(<KartelaStockTab onAddToDispatch={vi.fn()} />);
    expect(await screen.findByText("T1")).toBeInTheDocument();
    const q = queryOf();
    expect(q.get("filter[status]")).toBe("WAREHOUSE");
    expect(q.get("filter[shipmentScope]")).toBe("free");
    expect(q.get("filter[markedForKartela]")).toBe("true");
    expect(KARTELA_STOCK_COLUMN_IDS).toEqual(["barcode", "item", "color", "width", "currentQty", "updatedAt"]);
    const heads = ["Barkod", "Kumaş", "Renk", "En", "Metre", "Son İşlem"].map((l) => screen.getAllByText(l, { exact: true })[0]!);
    for (let i = 1; i < heads.length; i++) {
      expect(heads[i - 1]!.compareDocumentPosition(heads[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("\"Sevke ekle\" seçili topları sevk satırı olarak verir", async () => {
    perms = new Set(["kartela:read", "kartela:write", "roll:read"]);
    const onAdd = vi.fn();
    renderWithProviders(<KartelaStockTab onAddToDispatch={onAdd} />);
    await screen.findByText("T2");
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Seç" })[1]!);
    fireEvent.click(screen.getByRole("button", { name: /Sevke ekle/ }));
    expect(onAdd).toHaveBeenCalledWith([{ id: "r2", barcode: "T2", itemName: "Poplin", colorName: "Beyaz", qty: 12.5 }]);
  });

  it("kartela:write yoksa \"Sevke ekle\" çizilmez", async () => {
    perms = new Set(["kartela:read", "roll:read"]);
    renderWithProviders(<KartelaStockTab onAddToDispatch={vi.fn()} />);
    await screen.findByText("T1");
    expect(screen.queryByRole("button", { name: /Sevke ekle/ })).toBeNull();
  });
});
