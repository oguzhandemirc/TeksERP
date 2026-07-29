import { describe, it, expect } from "vitest";
import type { WorkOrderStatus } from "@/types/enums";
import { collectLinkedWorkOrders, deriveWoRollup } from "./work-order-rollup";

/** Tek WO bağı — rollup util'in beklediği minimal şekil. */
function link(id: string, status: WorkOrderStatus) {
  return { workOrderId: id, workOrder: { id, workOrderNumber: `IE-${id}`, status } };
}
/** Verilen bağları taşıyan tek kalemli liste. */
function lines(...links: ReturnType<typeof link>[]) {
  return [{ workOrderLinks: links }];
}

describe("deriveWoRollup", () => {
  it("bağ yok → NONE", () => {
    expect(deriveWoRollup(undefined).state).toBe("NONE");
    expect(deriveWoRollup([]).state).toBe("NONE");
    expect(deriveWoRollup([{ workOrderLinks: [] }]).state).toBe("NONE");
  });

  it("hepsi CANCELLED → NONE", () => {
    expect(deriveWoRollup(lines(link("a", "CANCELLED"), link("b", "CANCELLED"))).state).toBe("NONE");
  });

  it("yalnız PLANNED → PLANNED", () => {
    const r = deriveWoRollup(lines(link("a", "PLANNED")));
    expect(r.state).toBe("PLANNED");
    expect(r.activeCount).toBe(1);
  });

  it("PLANNED + IN_PROGRESS → IN_PROGRESS", () => {
    const r = deriveWoRollup(lines(link("a", "PLANNED"), link("b", "IN_PROGRESS")));
    expect(r.state).toBe("IN_PROGRESS");
    expect(r.activeCount).toBe(2);
  });

  it("hepsi COMPLETED → COMPLETED", () => {
    expect(deriveWoRollup(lines(link("a", "COMPLETED"), link("b", "COMPLETED"))).state).toBe(
      "COMPLETED",
    );
  });

  it("PLANNED + COMPLETED karışımı → IN_PROGRESS (kullanıcı kararı)", () => {
    expect(deriveWoRollup(lines(link("a", "PLANNED"), link("b", "COMPLETED"))).state).toBe(
      "IN_PROGRESS",
    );
  });

  it("SUPERSEDED rollup'ta sayılmaz (aktif set dışı)", () => {
    // yalnız SUPERSEDED → aktif set boş → NONE
    expect(deriveWoRollup(lines(link("a", "SUPERSEDED"))).state).toBe("NONE");
    // SUPERSEDED + COMPLETED → yalnız COMPLETED sayılır
    const r = deriveWoRollup(lines(link("a", "SUPERSEDED"), link("b", "COMPLETED")));
    expect(r.state).toBe("COMPLETED");
    expect(r.activeCount).toBe(1);
  });

  it("CANCELLED aktif sayıya girmez", () => {
    const r = deriveWoRollup(lines(link("a", "PLANNED"), link("b", "CANCELLED")));
    expect(r.state).toBe("PLANNED");
    expect(r.activeCount).toBe(1);
  });
});

describe("collectLinkedWorkOrders", () => {
  it("CANCELLED hariç, SUPERSEDED dahil (liste izini korur)", () => {
    const got = collectLinkedWorkOrders(
      lines(link("a", "SUPERSEDED"), link("b", "CANCELLED"), link("c", "PLANNED")),
    );
    expect(got.map((w) => w.id).sort()).toEqual(["a", "c"]);
  });

  it("aynı WO iki kalemde → distinct 1", () => {
    const twoLines = [
      { workOrderLinks: [link("a", "IN_PROGRESS")] },
      { workOrderLinks: [link("a", "IN_PROGRESS")] },
    ];
    const got = collectLinkedWorkOrders(twoLines);
    expect(got).toHaveLength(1);
    expect(got[0]!.id).toBe("a");
  });

  it("id + workOrderNumber + status taşınır", () => {
    const got = collectLinkedWorkOrders(lines(link("x", "COMPLETED")));
    expect(got[0]).toEqual({ id: "x", workOrderNumber: "IE-x", status: "COMPLETED" });
  });
});
