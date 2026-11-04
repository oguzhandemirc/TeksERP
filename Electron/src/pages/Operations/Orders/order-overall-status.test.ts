import { describe, it, expect } from "vitest";
import type { WorkOrderStatus } from "@/types/enums";
import { deriveOrderOverallState, orderOverallText } from "./order-overall-status";
import { TERIM } from "@/lib/terim";
import type { Order } from "./types";

// Etiket TERIM rejiminden çözülür ("İş Emri yok" / "Terbiye İş Emri yok").
const NO_WO = `${TERIM.terbiyeIsEmri.cumleBasi.yalin} yok`;

const wo = (id: string, status: WorkOrderStatus) => ({ workOrder: { id, workOrderNumber: id, status } });
const ord = (status: Order["status"], ...wos: ReturnType<typeof wo>[]) =>
  ({ status, lines: [{ workOrderLinks: wos }] }) as unknown as Pick<Order, "status" | "lines">;

describe("Genel durum türetme tablosu", () => {
  it.each([
    ["CANCELLED", [wo("a", "IN_PROGRESS")], "İptal"],
    ["COMPLETED", [], "Tamamlandı"],
    ["PARTIAL_SHIPPED", [wo("a", "PLANNED")], "Kısmi sevk"],
    ["APPROVED", [wo("a", "IN_PROGRESS")], "Üretimde"],
    ["PENDING", [wo("a", "PLANNED")], "Üretimde"],
    ["APPROVED", [wo("a", "COMPLETED"), wo("b", "PLANNED")], "Üretimde"],
    ["APPROVED", [wo("a", "COMPLETED"), wo("b", "COMPLETED")], "Üretim bitti, sevk bekliyor"],
    ["PENDING", [wo("a", "COMPLETED"), wo("b", "SUPERSEDED")], "Üretim bitti, sevk bekliyor"],
    ["APPROVED", [], NO_WO],
    ["APPROVED", [wo("a", "CANCELLED"), wo("b", "SUPERSEDED")], NO_WO],
  ] as const)("%s + %j → %s", (status, wos, text) => {
    expect(orderOverallText(ord(status, ...wos))).toBe(text);
  });

  it("kalemsiz onaylı sipariş: iş emri yok", () => {
    expect(deriveOrderOverallState({ status: "APPROVED", lines: undefined } as unknown as Pick<Order, "status" | "lines">)).toBe(
      "NO_WORK_ORDER",
    );
  });
});
