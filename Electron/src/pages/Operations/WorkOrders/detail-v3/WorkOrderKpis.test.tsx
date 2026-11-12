// "Sipariş Toplam" kartı: fason (müşteri malı) İE → "Müşteri malı" + müşteri + gelen metre; siparişsiz kendi İE → "Stok üretimi";
// siparişli → talep + Sevk/Açık. Ölçüt `isCustomerGoodsWorkOrder` (başlıktaki "Fason İş Emri" etiketiyle aynı).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkOrderKpis } from "./WorkOrderKpis";
import type { WorkOrder } from "../types";

const base = { status: "IN_PROGRESS", plannedEndDate: null, orderLinks: [], inputRolls: { count: 1, totalMeters: 3935 } } as const;
const view = (wo: Partial<WorkOrder>, hasOrders = false, fulfill = { requested: 0, shipped: 0, open: 0 }) =>
  render(
    <MemoryRouter>
      <WorkOrderKpis wo={{ ...base, ...wo } as unknown as WorkOrder} fulfill={fulfill as never} hasOrders={hasOrders} />
    </MemoryRouter>,
  );

describe("İE KPI — Sipariş Toplam kartı", () => {
  it("§1 fason İE → Müşteri malı + müşteri adı + gelen metre; Stok üretimi yok", () => {
    view({ type: "CUSTOMER_GOODS_SERVICE", customer: { id: "c1", name: "GÜLEÇSOY TEKSTİL" }, incoming: { meters: "3935", kg: null, kgSource: null } });
    expect(screen.getByTestId("wo-kpi-customer-goods").textContent).toBe("Müşteri malı");
    expect(screen.getByText("GÜLEÇSOY TEKSTİL")).toBeTruthy();
    expect(screen.getByTestId("wo-kpi-incoming-m").textContent).toBe("Gelen 3935 m");
    expect(screen.queryByText("Stok üretimi")).toBeNull();
  });

  it("§2 siparişsiz kendi malı İE → Stok üretimi", () => {
    view({ type: "STOCK_PRODUCTION" });
    expect(screen.getByText("Stok üretimi")).toBeTruthy();
    expect(screen.queryByTestId("wo-kpi-customer-goods")).toBeNull();
  });

  it("§3 siparişli (fason olsa da) → toplamlar", () => {
    view({ type: "CUSTOMER_GOODS_SERVICE", customer: { id: "c1", name: "X" } }, true, { requested: 500, shipped: 200, open: 300 });
    expect(screen.getByText("Sevk 200")).toBeTruthy();
    expect(screen.getByText("Açık 300")).toBeTruthy();
    expect(screen.queryByText("Müşteri malı")).toBeNull();
    expect(screen.queryByText("Stok üretimi")).toBeNull();
  });
});
