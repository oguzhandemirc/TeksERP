// BEKÇİ — dönüş kabul belgesi gövde kurucusu (devere ek E2): satırsız sipariş belgeye girmez, hata sipariş no
// önekli (hep-ya-hiç), siparişler arası gövde tekrarı, tartı ayarı (OFF gönderilmez / REQUIRED brüt ister), gövde
// alanları (kayıtlı → beamBodyId, tanımsız → newBody + sahip), irsaliye uyarısının sipariş uyarılarından ayrılması.
import { describe, expect, it } from "vitest";
import { buildReceiveDocBody, deliveryNoteUsesOf, noteWarnings } from "./receive-doc-model";
import { buildReceiveBody, emptyBeamDraft } from "./receive-model";
import type { DeliveryNoteGroup, WarpingReceiveDocPreview } from "./receive-doc-types";

const P = { subcontractorId: "s1", deliveryNoteNo: " DV-1200 ", weighing: "OPTIONAL" as const };

describe("receive-doc-model", () => {
  it("satırsız sipariş atlanır; iki siparişin satırları tek gövdede; irsaliye kırpılır", () => {
    const r = buildReceiveDocBody([
      { orderId: "o1", orderNo: "DS-7", drafts: [emptyBeamDraft("1000"), emptyBeamDraft("1000")] },
      { orderId: "o2", orderNo: "DS-8", drafts: [] },
      { orderId: "o3", orderNo: "DS-9", drafts: [emptyBeamDraft("800"), emptyBeamDraft()] },
    ], P);
    expect(r).toMatchObject({ ok: true, beamCount: 3, totalM: 2800 });
    if (!r.ok) throw new Error("ok bekleniyordu");
    expect(r.body.deliveryNoteNo).toBe("DV-1200");
    expect(r.body.subcontractorId).toBe("s1");
    expect(r.body.orders.map((o) => [o.warpingOrderId, o.beams.length])).toEqual([["o1", 2], ["o3", 1]]);
  });

  it("bir sipariş hatalıysa belge kurulmaz — hata sipariş no önekli; hiç satır yoksa sessiz", () => {
    expect(buildReceiveDocBody([{ orderId: "o1", orderNo: "DS-7", drafts: [emptyBeamDraft("1")] }, { orderId: "o2", orderNo: "DS-8", drafts: [{ ...emptyBeamDraft(), physicalBeamNo: "G" }] }], P))
      .toEqual({ ok: false, error: "DS-8: 1. satır: metre girin." });
    expect(buildReceiveDocBody([{ orderId: "o1", orderNo: "DS-7", drafts: [] }], P)).toEqual({ ok: false, error: null });
  });

  it("aynı gövde iki siparişte → hata", () => {
    const g = { kind: "existing" as const, id: "b1", bodyNo: "LG-0111", hint: "Bizim" };
    const r = buildReceiveDocBody([{ orderId: "o1", orderNo: "DS-7", drafts: [{ ...emptyBeamDraft("1"), body: g }] }, { orderId: "o2", orderNo: "DS-8", drafts: [{ ...emptyBeamDraft("1"), body: g }] }], P);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("DS-7 ve DS-8") });
  });

  it("gövde alanları: kayıtlı → beamBodyId (metin no yok), tanımsız → newBody + sahip", () => {
    const r = buildReceiveBody([
      { ...emptyBeamDraft("500"), physicalBeamNo: "eski", body: { kind: "existing", id: "b1", bodyNo: "LG-1", hint: "" } },
      { ...emptyBeamDraft("500"), body: { kind: "new", bodyNo: "YD-22", ownerKind: "WARPER", subcontractorId: "s1" } },
      { ...emptyBeamDraft("500"), body: { kind: "new", bodyNo: "YD-23", ownerKind: "OURS", subcontractorId: "s1" } },
    ], "");
    if (!r.ok) throw new Error(String(r.error));
    expect(r.body.beams).toEqual([
      { lengthM: 500, physicalBeamNo: null, grossKg: null, tareKg: null, beamBodyId: "b1" },
      { lengthM: 500, physicalBeamNo: null, grossKg: null, tareKg: null, newBody: { bodyNo: "YD-22", owner: { kind: "WARPER", subcontractorId: "s1" } } },
      { lengthM: 500, physicalBeamNo: null, grossKg: null, tareKg: null, newBody: { bodyNo: "YD-23", owner: { kind: "OURS" } } },
    ]);
  });

  it("tartı ayarı: OFF'ta brüt/dara gönderilmez; REQUIRED'da brütsüz satır hata", () => {
    const d = [{ ...emptyBeamDraft("500"), grossKg: "60", tareKg: "30" }];
    expect(buildReceiveBody(d, "", "OFF")).toMatchObject({ ok: true, body: { beams: [{ grossKg: null, tareKg: null }] } });
    expect(buildReceiveBody([emptyBeamDraft("500")], "", "REQUIRED")).toMatchObject({ ok: false, error: expect.stringContaining("tartısı zorunlu") });
    expect(buildReceiveBody(d, "", "REQUIRED")).toMatchObject({ ok: true });
  });

  it("irsaliye uyarıları sipariş uyarılarından ayrılır; önceki canlı kabuller listelenir", () => {
    const p = { warnings: ["İrsaliye DV-1 daha önce kullanıldı", "DS-7: kontrol"], orders: [{ preview: { warnings: ["kontrol"] } }] } as unknown as WarpingReceiveDocPreview;
    expect(noteWarnings(p)).toEqual(["İrsaliye DV-1 daha önce kullanıldı"]);
    const g = {
      docs: [{ docNo: "DK-1", totals: { liveBeamCount: 2 }, orders: [{ orderNo: "DS-7" }, { orderNo: "DS-8" }] }, { docNo: "DK-2", totals: { liveBeamCount: 0 }, orders: [] }],
      receipts: [{ orderNo: "DS-5", receipt: { liveBeamCount: 1 } }],
    } as unknown as DeliveryNoteGroup;
    expect(deliveryNoteUsesOf(g)).toEqual(["DK-1 (DS-7, DS-8)", "DS-5 (belgesiz kabul)"]);
  });
});
