// =============================================================================
// Sipariş listesi "Metre" sütunu — gönderilen / istenen metre (panel 1.3.11)
// =============================================================================
// Saha (Adnan Şahin, 2026-11-06): "siparişler bölümünde metreler gözükmüyor". 1.3.10'da "Sevk"
// sütunu cümleye dönünce istenen metre listeden düştü; gönderilmemiş siparişte hiç metre yoktu.
// Hücre, Excel ve yan panel AYNI fonksiyondan (`orderMetreParts`/`orderMetreText`) okur.
// =============================================================================
import { describe, it, expect } from "vitest";
import { fireEvent, render, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { buildCsv } from "@/lib/table-export";
import { buildOrderColumns } from "./columns";
import { orderMetreParts, orderMetreProgress, orderMetreText } from "./order-cell-text";
import type { Order, OrderLine } from "./types";

const line = (p: Partial<OrderLine>): OrderLine =>
  ({
    id: "l1",
    itemId: "i1",
    colorId: null,
    quantity: 100,
    unit: "MT",
    width: null,
    unitPrice: null,
    customerItemName: null,
    customerColorName: null,
    cutNote: null,
    cancelledAt: null,
    shippedQty: 0,
    workOrderLinks: [],
    ...p,
  }) as OrderLine;

const order = (p: Partial<Order> = {}): Order =>
  ({
    id: "o1",
    orderNumber: "SP-001",
    customerId: "m1",
    branchId: null,
    currency: "TRY",
    totalAmount: null,
    status: "APPROVED",
    shippedQty: 0,
    orderDate: "2026-11-01T09:00:00.000Z",
    deadline: null,
    completedAt: null,
    manualClosedById: null,
    manualCloseReason: null,
    lines: [line({ quantity: 300 })],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...p,
  }) as Order;

describe("orderMetreText — tek kaynak hesap", () => {
  it("gönderilmemiş siparişte de istenen metre görünür (şikâyetin kendisi)", () => {
    expect(orderMetreText(order({ shippedQty: 0, lines: [line({ quantity: 500 })] }))).toBe("0 / 500 m (%0)");
  });

  it("kısmi sevk: gönderilen / istenen + yüzde; binlik ayraç sevk cümlesiyle aynı", () => {
    const o = order({ shippedQty: 1200, lines: [line({ quantity: 1000 }), line({ id: "l2", quantity: 1400 })] });
    expect(orderMetreText(o)).toBe("1.200 / 2.400 m (%50)");
    expect(orderMetreParts(o)).toEqual({ qty: "1.200 / 2.400 m", pct: "%50" });
  });

  it("yalnız ölçülü (metre) kalemler toplanır; kg/adet istenene girmez", () => {
    const o = order({
      shippedQty: 120,
      lines: [line({ quantity: 500 }), line({ id: "k", unit: "KG", quantity: 900 }), line({ id: "a", unit: "ADET", quantity: 7 })],
    });
    expect(orderMetreProgress(o)).toEqual({ shipped: 120, requested: 500, pct: 24 });
  });

  it("birimsiz kalem (eski sunucu) metre sayılır", () => {
    expect(orderMetreProgress(order({ shippedQty: 10, lines: [line({ unit: undefined, quantity: 40 })] }))?.requested).toBe(40);
  });

  it("istenen 0 → '—' (yalnız kg siparişi, kalemsiz sipariş)", () => {
    expect(orderMetreText(order({ lines: [line({ unit: "KG", quantity: 900 })] }))).toBe("—");
    expect(orderMetreText(order({ lines: [] }))).toBe("—");
    expect(orderMetreParts(order({ lines: [] }))).toBeNull();
  });

  it("sevk BRÜT: sipariş sevk toplamı olduğu gibi yazılır (iade düşülmez)", () => {
    // Sunucu shippedQty BRÜT tutar; panel kendi başına net'e çevirmez.
    expect(orderMetreProgress(order({ shippedQty: 250, lines: [line({ quantity: 300 })] }))?.shipped).toBe(250);
  });

  it("iptal kalem: yalnız sevk edilmiş kısmı istenene girer (sunucu cümlesiyle aynı payda)", () => {
    const o = order({
      shippedQty: 340,
      lines: [line({ quantity: 300, shippedQty: 300 }), line({ id: "x", quantity: 200, shippedQty: 40, cancelledAt: "2026-11-02T00:00:00Z" })],
    });
    expect(orderMetreText(o)).toBe("340 / 340 m (%100)");
  });

  it("aşırı sevkte yüzde 100'de durur; Decimal metin gelse de sayıya çevrilir", () => {
    const o = order({ shippedQty: "520.000" as unknown as number, lines: [line({ quantity: "500.000" as unknown as number })] });
    expect(orderMetreText(o)).toBe("520 / 500 m (%100)");
  });
});

function tableOf(rows: Order[], productionEnabled = true) {
  return renderHook(() =>
    useReactTable({ data: rows, columns: buildOrderColumns(false, productionEnabled), getCoreRowModel: getCoreRowModel() }),
  ).result.current;
}

describe("liste 'Metre' sütunu", () => {
  it("'Sevk durumu' cümlesi kalır, 'Metre' hemen yanında; üretimsiz kurulumda da var", () => {
    const ids = buildOrderColumns(false, true).map((c) => c.id);
    expect(ids).toContain("shipped");
    expect(ids.indexOf("metre")).toBe(ids.indexOf("shipped") + 1);
    expect(buildOrderColumns(false, false).map((c) => c.id)).toContain("metre");
  });

  it("Excel/CSV 'Metre' hücresi = orderMetreText; gönderilmemiş siparişte de dolu", () => {
    const rows = [
      order({ id: "a", shippedQty: 0, lines: [line({ quantity: 500 })] }),
      order({ id: "b", shippedQty: 1200, status: "PARTIAL_SHIPPED", lines: [line({ quantity: 2400 })] }),
      order({ id: "c", lines: [line({ unit: "KG", quantity: 900 })] }),
    ];
    const csv = buildCsv(tableOf(rows), rows).replace(/^\uFEFF/, "").trim().split("\r\n").map((r) => r.split(";"));
    const head = csv[0]!;
    const col = head.indexOf("Metre");
    expect(col).toBeGreaterThan(-1);
    expect(csv.slice(1).map((r) => r[col])).toEqual(["0 / 500 m (%0)", "1.200 / 2.400 m (%50)", "—"]);
    rows.forEach((o, i) => expect(csv[i + 1]![col]).toBe(orderMetreText(o)));
  });

  it("ekran hücresi Excel ile aynı metni gösterir", () => {
    const o = order({ shippedQty: 1200, lines: [line({ quantity: 2400 })] });
    const cell = tableOf([o]).getRowModel().rows[0]!.getAllCells().find((c) => c.column.id === "metre")!;
    const { container } = render(<>{flexRender(cell.column.columnDef.cell, cell.getContext())}</>);
    expect(container.textContent).toBe(orderMetreText(o));
  });

  it("başlık sevk edilen metreye göre sıralar (sortBy=shippedQty)", () => {
    const header = tableOf([order()]).getFlatHeaders().find((h) => h.column.id === "metre")!;
    function Search() {
      return <output data-testid="search">{useLocation().search}</output>;
    }
    const { getByRole, getByTestId } = render(
      <MemoryRouter>
        {flexRender(header.column.columnDef.header, header.getContext())}
        <Search />
      </MemoryRouter>,
    );
    const btn = getByRole("button");
    expect(btn).toHaveTextContent("Metre");
    fireEvent.click(btn);
    expect(new URLSearchParams(getByTestId("search").textContent ?? "").get("sortBy")).toBe("shippedQty");
  });
});
