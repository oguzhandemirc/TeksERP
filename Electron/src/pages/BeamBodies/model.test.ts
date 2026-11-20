import { describe, expect, it } from "vitest";
import { beamBodyDefaults, beamBodyFormSchema, buildCreateBody, buildPatchBody, dimsText, placeText } from "./model";
import { isBeamBodiesVisible } from "./beam-body-regime";
import { manualKindsFor } from "./TransitionDialog";
import { buildReturnHtml } from "./returns/return-html";
import type { BeamBody, BeamBodyReturnDoc } from "./types";

const body = (over: Partial<BeamBody> = {}): BeamBody => ({
  id: "b1",
  bodyNo: "LG-00001",
  owner: { kind: "WARPER", label: "Devereci", customer: { id: "c1", code: "C1", name: "Yıldız Devere" } },
  widthCm: "160.00",
  flangeDiameterCm: null,
  tareKg: "45.5",
  status: "EMPTY_STOCK",
  statusLabel: "Depoda boş",
  place: { warehouse: { id: "w1", name: "Depo A" }, subcontractor: null, machine: null },
  ownerReturnDue: true,
  machineFits: [{ id: "m1", code: "T-14", name: "Tezgâh 14" }],
  notes: null,
  isActive: true,
  createdAt: "2026-11-20T08:00:00.000Z",
  updatedAt: "2026-11-20T08:00:00.000Z",
  ...over,
});

describe("gövde formu → istek gövdesi", () => {
  it("yeni kayıt: boş no seriden (null), Bizim sahip carisiz, depoda boşta devereci gitmez", () => {
    const v = { ...beamBodyDefaults(null), widthCm: "160,5", subcontractorId: "s1" };
    const b = buildCreateBody(v);
    expect(b.bodyNo).toBeNull();
    expect(b.owner).toEqual({ kind: "OURS" });
    expect(b.widthCm).toBe(160.5);
    expect(b.subcontractorId).toBeNull();
    expect(b.initialStatus).toBe("EMPTY_STOCK");
  });

  it("devereci sahibi: fason profili seçilince subcontractorId gider (sunucu bağlı cariyi çözer)", () => {
    const v = { ...beamBodyDefaults(null), ownerKind: "WARPER" as const, ownerSubcontractorId: "s9", initialStatus: "AT_SUBCONTRACTOR" as const, subcontractorId: "s9", warehouseId: "w1" };
    const b = buildCreateBody(v);
    expect(b.owner).toEqual({ kind: "WARPER", subcontractorId: "s9" });
    expect(b.warehouseId).toBeNull();
    expect(b.subcontractorId).toBe("s9");
  });

  it("şema: müşteri sahibinde cari, deverecide kayıtta devereci zorunlu; geçersiz no reddedilir", () => {
    const base = beamBodyDefaults(null);
    expect(beamBodyFormSchema.safeParse({ ...base, ownerKind: "CUSTOMER" }).success).toBe(false);
    expect(beamBodyFormSchema.safeParse({ ...base, initialStatus: "AT_SUBCONTRACTOR" }).success).toBe(false);
    expect(beamBodyFormSchema.safeParse({ ...base, bodyNo: "-x" }).success).toBe(false);
    expect(beamBodyFormSchema.safeParse({ ...base, tareKg: "0" }).success).toBe(false);
    expect(beamBodyFormSchema.safeParse({ ...base, bodyNo: "YD-22" }).success).toBe(true);
  });

  it("düzenleme: sahip değişmediyse owner GİTMEZ (meşgul gövdede 409 doğmasın); değişince gider", () => {
    const b = body({ status: "AT_SUBCONTRACTOR" });
    const same = buildPatchBody({ ...beamBodyDefaults(b), notes: "x" }, b);
    expect(same.owner).toBeUndefined();
    expect(same.machineIds).toEqual(["m1"]);
    const changed = buildPatchBody({ ...beamBodyDefaults(b), ownerKind: "OURS", ownerCustomerId: null }, b);
    expect(changed.owner).toEqual({ kind: "OURS" });
  });
});

describe("görüntü ve kapılar", () => {
  it("ölçü ve yer metni", () => {
    expect(dimsText(body())).toBe("160 cm · 45,5 kg dara");
    expect(dimsText(body({ widthCm: null, tareKg: null }))).toBe("—");
    expect(placeText(body().place)).toBe("Depo A");
    expect(placeText({ warehouse: null, subcontractor: null, machine: { id: "m", code: "T-1", name: "Tezgâh 1" } })).toBe("Tezgâh 1 (T-1)");
  });

  it("menü yüklemi: devere açık VE gövde takibi açık; alan yoksa kapalı (bugünkü davranış)", () => {
    expect(isBeamBodiesVisible({ devereEnabled: true })).toBe(false);
    expect(isBeamBodiesVisible({ devereEnabled: true, beamBodyEnabled: true })).toBe(true);
    expect(isBeamBodiesVisible({ devereEnabled: false, beamBodyEnabled: true })).toBe(false);
  });

  it("elle hareket menüsü durumdan; pasif gövdede hiç yok", () => {
    expect(manualKindsFor(body())).toEqual(["SHIP_EMPTY", "MAINTENANCE_IN", "SCRAP"]);
    expect(manualKindsFor(body({ status: "AT_SUBCONTRACTOR" }))).toEqual(["RETURN_EMPTY"]);
    expect(manualKindsFor(body({ status: "MOUNTED" }))).toEqual([]);
    expect(manualKindsFor(body({ isActive: false }))).toEqual([]);
  });

  it("iade belgesi HTML: gövde no'ları kaçışlı basılır, iptal damgası görünür", () => {
    const doc: BeamBodyReturnDoc = {
      id: "r1", docNo: "LGI-2611-0001", status: "CANCELLED", owner: { id: "c1", code: "C1", name: "A<B" }, returnedAt: "2026-11-20T08:00:00.000Z",
      plateNumber: null, driverName: null, notes: null, cancelledAt: "2026-11-20T09:00:00.000Z", cancelReason: "yanlış", createdAt: "2026-11-20T08:00:00.000Z",
      items: [{ bodyId: "b1", bodyNo: "YD-22", ownerRoleLabel: "Devereci", widthCm: "160", tareKg: null, eventId: "e1", reversed: true }],
    };
    const html = buildReturnHtml(doc);
    expect(html).toContain("YD-22");
    expect(html).toContain("A&lt;B");
    expect(html).toContain("İPTAL EDİLDİ");
    expect(html).toContain("Toplam 1 boş levent gövdesi");
  });
});
