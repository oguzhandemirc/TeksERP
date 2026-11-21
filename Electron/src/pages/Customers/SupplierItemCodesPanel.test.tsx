// =============================================================================
// BEKÇİ — Tedarikçi kartı "Kalem kodları" sekmesi (Seyitoğlu d5): liste, izinsizde salt-okunur, kaldır onayı
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { SupplierItemCodesPanel } from "./SupplierItemCodesPanel";
import { supplierItemCodeService } from "@/pages/Operations/GoodsReceipts/supplierItemCodeService";

const perms = vi.hoisted(() => ({ write: true }));
vi.mock("@/hooks/useRoleAccess", () => ({ useRoleAccess: () => ({ hasPermission: (p: string) => p === "goods-receipt:write" && perms.write }) }));
vi.mock("@/components/forms/ItemSelect", () => ({
  ItemSelect: (p: { "aria-label"?: string; value?: string | null }) => <button type="button" aria-label={p["aria-label"]}>{p.value}</button>,
}));
vi.mock("@/pages/Operations/GoodsReceipts/supplierItemCodeService", () => ({
  supplierItemCodeService: { list: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

const svc = vi.mocked(supplierItemCodeService);
const ROW = {
  id: "c1", supplierId: "s1", codeKey: "153.01.0652", rawCode: "153.01.0652", itemId: "y1", hitCount: 4,
  lastUsedAt: "2026-11-20T09:00:00.000Z", createdAt: "2026-11-01T09:00:00.000Z", updatedAt: "2026-11-20T09:00:00.000Z",
  supplier: { id: "s1", name: "Yanteks" }, item: { id: "y1", code: "IP1", name: "YAN 1029-K", itemType: "YARN" },
};

describe("SupplierItemCodesPanel", () => {
  beforeEach(() => {
    perms.write = true;
    svc.list.mockResolvedValue({ success: true, data: [ROW] });
    svc.remove.mockResolvedValue({ success: true, data: { id: "c1" } });
  });

  it("öğrenilmiş kodları kullanım sayısıyla listeler; kaldır onaydan sonra çağrılır", async () => {
    renderWithProviders(<SupplierItemCodesPanel supplierId="s1" />);
    expect(await screen.findByText("153.01.0652")).toBeInTheDocument();
    expect(screen.getByText("4 kez")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "153.01.0652 eşlemesini kaldır" }));
    fireEvent.click(await screen.findByRole("button", { name: "Kaldır" }));
    await waitFor(() => expect(svc.remove).toHaveBeenCalledWith("c1"));
  });

  it("yazma izni yoksa kart adı düz metin, kaldır düğmesi yok", async () => {
    perms.write = false;
    renderWithProviders(<SupplierItemCodesPanel supplierId="s1" />);
    expect(await screen.findByText("YAN 1029-K")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /eşlemesini kaldır/ })).toBeNull();
  });
});
