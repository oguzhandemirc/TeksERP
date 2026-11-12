// =============================================================================
// BEKÇİ — "Fason İş Emri" ibaresi yalnız tür CUSTOMER_GOODS_SERVICE iken (liste hücresi + detay başlığı)
// =============================================================================
import type React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CellContext } from "@tanstack/react-table";
import { FasonTag, isCustomerGoodsWorkOrder } from "./FasonTag";
import { workOrderColumns } from "./columns";
import type { WorkOrder } from "./types";

describe("Fason iş emri etiketi", () => {
  it("ölçüt yalnız CUSTOMER_GOODS_SERVICE", () => {
    expect(isCustomerGoodsWorkOrder("CUSTOMER_GOODS_SERVICE")).toBe(true);
    for (const t of ["ORDER_PRODUCTION", "STOCK_PRODUCTION", null, undefined, ""]) expect(isCustomerGoodsWorkOrder(t)).toBe(false);
  });

  it("detay başlığında uzun ibare, diğer türde hiçbir şey çizilmez", () => {
    const { rerender } = render(<FasonTag type="CUSTOMER_GOODS_SERVICE" long />);
    expect(screen.getByTestId("wo-fason-tag").textContent).toMatch(/^Fason .+/);
    rerender(<FasonTag type="STOCK_PRODUCTION" long />);
    expect(screen.queryByTestId("wo-fason-tag")).toBeNull();
  });

  it("liste numara hücresi: fason İE'de 'Fason' etiketi, kendi üretimde yok", () => {
    const col = workOrderColumns.find((c) => "accessorKey" in c && c.accessorKey === "workOrderNumber");
    const cell = col?.cell as (ctx: CellContext<WorkOrder, unknown>) => React.ReactElement;
    const ctx = (type: string) => ({ row: { original: { workOrderNumber: "IE1", type } as unknown as WorkOrder } }) as unknown as CellContext<WorkOrder, unknown>;
    const { unmount } = render(cell(ctx("CUSTOMER_GOODS_SERVICE")));
    expect(screen.getByTestId("wo-fason-tag").textContent).toBe("Fason");
    unmount();
    render(cell(ctx("STOCK_PRODUCTION")));
    expect(screen.getByText("IE1")).toBeTruthy();
    expect(screen.queryByTestId("wo-fason-tag")).toBeNull();
  });
});
