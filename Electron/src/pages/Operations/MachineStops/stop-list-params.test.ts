// Tezgah Duruşları — kapsam süzgeci → liste parametreleri: "Geçici kapanışlar" `pendingEnd` gönderir ve
// kuyruk gibi GÜN süzgecinden muaftır; diğer kapsamlar günü taşır.
import { describe, expect, it } from "vitest";
import { stopListParamsOf, stopStationKindOptions } from "./useStopsPageState";

const base = { machineId: "", shiftInstanceId: "", day: "2026-10-13" };

describe("stopListParamsOf", () => {
  it("⭐ istasyon türü süzgeci sunucuya gider (D4-A3); boşsa parametre yok", () => {
    expect(stopListParamsOf({ ...base, scope: "", stationKind: "TAMBUR" }).stationKind).toBe("TAMBUR");
    expect(stopListParamsOf({ ...base, scope: "" }).stationKind).toBeUndefined();
  });
  it("tür seçenekleri: dokumasız rejimde yalnız kurşun/brode + tambur; dokuma açıkken tezgah da", () => {
    expect(stopStationKindOptions(false).map((o) => o.value)).toEqual(["PROCESS_QC", "TAMBUR"]);
    expect(stopStationKindOptions(true).map((o) => o.value)).toContain("WEAVING");
  });
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
