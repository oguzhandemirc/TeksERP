// Tezgah Duruşları — kapsam süzgeci → liste parametreleri: "Geçici kapanışlar" `pendingEnd` gönderir ve
// kuyruk gibi GÜN süzgecinden muaftır; diğer kapsamlar günü taşır.
import { describe, expect, it } from "vitest";
import { stopListParamsOf } from "./useStopsPageState";

const base = { machineId: "", shiftInstanceId: "", day: "2026-10-13" };

describe("stopListParamsOf", () => {
  it("⭐ pendingEnd kapsamı → pendingEnd=true, gün yok", () => {
    const p = stopListParamsOf({ ...base, scope: "pendingEnd" });
    expect(p.pendingEnd).toBe(true);
    expect(p.factoryDay).toBeUndefined();
    expect([p.queue, p.open]).toEqual([false, false]);
  });
  it("kuyruk günden muaf; açık duruşlar ve kapsamsız günü taşır", () => {
    expect(stopListParamsOf({ ...base, scope: "queue" }).factoryDay).toBeUndefined();
    expect(stopListParamsOf({ ...base, scope: "open" }).factoryDay).toBe("2026-10-13");
    expect(stopListParamsOf({ ...base, scope: "" })).toMatchObject({ factoryDay: "2026-10-13", pendingEnd: false });
  });
});
