import { describe, expect, it } from "vitest";
import { adapterCapabilities, eirsaliyeActions, type EIrsaliyeActionInput } from "./eirsaliyeActions";
import type { EIrsaliyeStatus } from "@/types/enums";

const base = (over: Partial<EIrsaliyeActionInput> = {}): EIrsaliyeActionInput => ({
  ready: true, export: false, shipmentStatus: "DISPATCHED", record: null, live: false, canWrite: true, canUndo: true, ...over,
});
const rec = (status: EIrsaliyeStatus, adapter = "disaAktar", documentNo: string | null = "EIR2026000000001") => ({ status, adapter, documentNo });
const on = (a: ReturnType<typeof eirsaliyeActions>) => Object.entries(a).filter(([, v]) => v).map(([k]) => k).sort();

describe("eirsaliyeActions — durum × izin × yetenek", () => {
  it("kayıt yok: yalnız hazırla (sevk edilmiş, yurt içi, HAZIR, yazma izni)", () => {
    expect(on(eirsaliyeActions(base()))).toEqual(["prepare"]);
    expect(on(eirsaliyeActions(base({ shipmentStatus: "PLANNED" })))).toEqual([]);
    expect(on(eirsaliyeActions(base({ export: true })))).toEqual([]);
    expect(on(eirsaliyeActions(base({ ready: false })))).toEqual([]);
    expect(on(eirsaliyeActions(base({ canWrite: false })))).toEqual([]);
  });

  it("dışa aktar akışı: TASLAK → OLUSTURULDU → GONDERILDI → KABUL", () => {
    expect(on(eirsaliyeActions(base({ record: rec("TASLAK", "disaAktar", null), live: true })))).toEqual(["cancel", "editFields", "generate"]);
    expect(on(eirsaliyeActions(base({ record: rec("OLUSTURULDU"), live: true })))).toEqual(["cancel", "download", "editFields", "markSent", "regenerate"]);
    expect(on(eirsaliyeActions(base({ record: rec("GONDERILDI"), live: true })))).toEqual(["download", "response", "undo"]);
    expect(on(eirsaliyeActions(base({ record: rec("KABUL"), live: true })))).toEqual(["download", "undo"]);
    expect(on(eirsaliyeActions(base({ record: rec("HATA"), live: true })))).toEqual(["cancel", "download", "editFields", "regenerate"]);
  });

  it("reddedilmiş (canlı değil): yeni hazırlık + yanıtı geri al", () => {
    expect(on(eirsaliyeActions(base({ record: rec("REDDEDILDI"), live: false })))).toEqual(["download", "prepare", "undo"]);
  });

  it("simülasyon: gönder/sorgula var, elle işaret/yanıt/geri al yok", () => {
    expect(on(eirsaliyeActions(base({ record: rec("OLUSTURULDU", "simulasyon"), live: true })))).toEqual(["cancel", "download", "editFields", "regenerate", "send"]);
    expect(on(eirsaliyeActions(base({ record: rec("GONDERILDI", "simulasyon"), live: true })))).toEqual(["download", "poll"]);
  });

  it("geri alma yalnız eirsaliye:undo ile; yazma izni yoksa yazma eylemi yok", () => {
    expect(on(eirsaliyeActions(base({ record: rec("GONDERILDI"), live: true, canUndo: false })))).toEqual(["download", "response"]);
    expect(on(eirsaliyeActions(base({ record: rec("GONDERILDI"), live: true, canWrite: false })))).toEqual(["undo"]);
  });

  it("hazırlık bozulunca belge doğuranlar kapanır, düzelt/iptal/indir/işaret açık kalır", () => {
    expect(on(eirsaliyeActions(base({ record: rec("OLUSTURULDU"), live: true, ready: false })))).toEqual(["cancel", "download", "editFields", "markSent"]);
  });

  it("tanınmayan bağdaştırıcı hiçbir yetenek almaz (fail-closed)", () => {
    expect(adapterCapabilities("entegratorX")).toEqual({ manual: false, send: false, poll: false });
    expect(adapterCapabilities("constructor")).toEqual({ manual: false, send: false, poll: false });
    expect(on(eirsaliyeActions(base({ record: rec("GONDERILDI", "entegratorX"), live: true })))).toEqual(["download"]);
  });

  it("iptal edilmiş kayıtta indir yok", () => {
    expect(on(eirsaliyeActions(base({ record: rec("IPTAL"), live: false })))).toEqual(["prepare"]);
  });
});
