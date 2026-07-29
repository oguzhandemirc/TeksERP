import { describe, it, expect } from "vitest";
import type { WorkOrderStatus, OrderStatus } from "@/types/enums";
import { deriveDeadlineRisk } from "./deadline-risk";
import type { OrderLine } from "./types";

/** Sabit "bugün" — determinist test. */
const TODAY = new Date("2026-07-29T10:00:00");
/** N gün sonrası ISO (negatif = geçmiş). */
function inDays(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString();
}
/** WO bağı taşıyan tek kalemli liste (rollup girdisi — minimal şekil cast'lenir). */
function lines(...statuses: WorkOrderStatus[]): OrderLine[] {
  return [
    {
      workOrderLinks: statuses.map((s, i) => ({
        workOrderId: `w${i}`,
        workOrder: { id: `w${i}`, workOrderNumber: `IE-${i}`, status: s },
      })),
    } as unknown as OrderLine,
  ];
}
/** deriveDeadlineRisk girdisi. */
function order(
  deadline: string | null,
  status: OrderStatus,
  woStatuses: WorkOrderStatus[] = [],
) {
  return { deadline, status, lines: lines(...woStatuses) };
}

describe("deriveDeadlineRisk (DAR kural — NO_WORK_ORDER)", () => {
  it("termin yok → null", () => {
    expect(deriveDeadlineRisk(order(null, "APPROVED"), TODAY)).toBeNull();
  });

  it("COMPLETED / CANCELLED sipariş → null", () => {
    expect(deriveDeadlineRisk(order(inDays(1), "COMPLETED"), TODAY)).toBeNull();
    expect(deriveDeadlineRisk(order(inDays(-5), "CANCELLED"), TODAY)).toBeNull();
  });

  it("termin uzak (5 gün) → null", () => {
    expect(deriveDeadlineRisk(order(inDays(5), "APPROVED"), TODAY)).toBeNull();
  });

  it("2 gün kaldı + İE yok → risk, overdue=false", () => {
    const r = deriveDeadlineRisk(order(inDays(2), "APPROVED"), TODAY);
    expect(r).not.toBeNull();
    expect(r?.overdue).toBe(false);
    expect(r?.daysLeft).toBe(2);
    expect(r?.label).toContain("iş emri açılmamış");
  });

  it("termin geçmiş + İE yok → risk, overdue=true", () => {
    const r = deriveDeadlineRisk(order(inDays(-3), "PENDING"), TODAY);
    expect(r).not.toBeNull();
    expect(r?.overdue).toBe(true);
    expect(r?.label).toContain("Termin geçti");
  });

  it("PLANNED İE var → dar kuralda null", () => {
    expect(deriveDeadlineRisk(order(inDays(1), "APPROVED", ["PLANNED"]), TODAY)).toBeNull();
  });

  it("COMPLETED rollup → null", () => {
    expect(deriveDeadlineRisk(order(inDays(1), "APPROVED", ["COMPLETED"]), TODAY)).toBeNull();
  });

  it("yalnız CANCELLED İE bağı → aktif İE yok sayılır → risk", () => {
    // CANCELLED bağ rollup'ta NONE → dar kuralda "İE açılmamış" riski.
    const r = deriveDeadlineRisk(order(inDays(1), "APPROVED", ["CANCELLED"]), TODAY);
    expect(r).not.toBeNull();
  });
});

describe("deriveDeadlineRisk (GENİŞ kural — NOT_COMPLETED, parametreyle)", () => {
  it("PLANNED İE var → geniş kuralda risk", () => {
    const r = deriveDeadlineRisk(order(inDays(1), "APPROVED", ["PLANNED"]), TODAY, "NOT_COMPLETED");
    expect(r).not.toBeNull();
    expect(r?.label).toContain("üretim tamamlanmamış");
  });

  it("COMPLETED rollup → geniş kuralda da null", () => {
    expect(
      deriveDeadlineRisk(order(inDays(1), "APPROVED", ["COMPLETED"]), TODAY, "NOT_COMPLETED"),
    ).toBeNull();
  });
});
