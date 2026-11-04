import { describe, it, expect } from "vitest";
import { deriveOrderOverallState, orderOverallStatusText } from "./order-overall-status";
import type { Order } from "./types";

type WoStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "SUPERSEDED";
const ord = (status: Order["status"], wos: WoStatus[]): Pick<Order, "status" | "lines"> =>
  ({
    status,
    lines: [
      {
        id: "l1",
        workOrderLinks: wos.map((s, i) => ({
          workOrderId: `w${i}`,
          workOrder: { id: `w${i}`, workOrderNumber: `IE-${i}`, status: s },
        })),
      },
    ],
  }) as unknown as Pick<Order, "status" | "lines">;

describe("Genel durum türetmesi", () => {
  it.each([
    ["CANCELLED", ["IN_PROGRESS"], "İptal"],
    ["COMPLETED", ["PLANNED"], "Tamamlandı"],
    ["PARTIAL_SHIPPED", ["IN_PROGRESS"], "Kısmi sevk"],
    ["PARTIAL_SHIPPED", [], "Kısmi sevk"],
    ["APPROVED", ["IN_PROGRESS"], "Üretimde"],
    ["PENDING", ["PLANNED"], "Üretimde"],
    ["APPROVED", ["PLANNED", "COMPLETED"], "Üretimde"],
    ["APPROVED", ["COMPLETED", "COMPLETED"], "Üretim bitti, sevk bekliyor"],
    ["PENDING", ["COMPLETED", "SUPERSEDED", "CANCELLED"], "Üretim bitti, sevk bekliyor"],
    ["APPROVED", [], "İş emri yok"],
    ["PENDING", ["CANCELLED", "SUPERSEDED"], "İş emri yok"],
  ] as const)("%s + %j → %s", (status, wos, label) => {
    expect(orderOverallStatusText(ord(status, [...wos]))).toBe(label);
  });

  it("kalemsiz açık sipariş → iş emri yok", () => {
    expect(deriveOrderOverallState({ status: "APPROVED", lines: undefined } as never)).toBe("NO_WORK_ORDER");
  });
});
