// Emanet çıkış saf mantığı: taslak anahtarı/yerine geçme, önizleme eşleşmesi, kg ayrıştırma, sahip yüklemleri.
import { describe, expect, it } from "vitest";
import { buildBody, previewLineFor, upsertItem, type DraftItem } from "../draft";
import { blockedReasonText, parseKg } from "../consignmentText";
import { beamDisabledReason } from "../BeamPicker";
import { lotDisabledReason, yarnKey } from "../YarnLinePicker";
import type { ConsignmentBeamCandidate, ConsignmentYarnCandidate } from "../types";

const yarn = (kg: string): DraftItem => ({
  key: "yarn:l1:w1",
  input: { kind: "YARN", yarnItemId: "i", warehouseId: "w1", lotId: "l1", qtyKg: kg },
  label: "",
  sub: "",
});
const beam: DraftItem = {
  key: "beam:b1",
  input: { kind: "WARP_BEAM", warpBeamId: "b1" },
  label: "",
  sub: "",
};

describe("taslak", () => {
  it("aynı lot × depo ikinci kez eklenirse yerine geçer (çift satır yok)", () => {
    const xs = upsertItem(upsertItem([beam], yarn("5")), yarn("7"));
    expect(xs).toHaveLength(2);
    expect(xs[1]!.input).toMatchObject({ qtyKg: "7" });
  });
  it("gövde: boş metin null, kalem sırası korunur", () => {
    expect(buildBody("c", [beam, yarn("1")], { plateNumber: " ", driverName: "Ali", notes: "" })).toEqual({
      ownerCustomerId: "c",
      items: [beam.input, yarn("1").input],
      plateNumber: null,
      driverName: "Ali",
      notes: null,
    });
  });
  it("önizleme satırı refId ile eşlenir; eşleşmeyen sıra yanlış satıra bağlanmaz", () => {
    const p = {
      ownerCustomer: { id: "c", name: "" },
      totals: { beamCount: 0, beamLengthM: "0", yarnKg: "0" },
      canCreate: true,
      warnings: [],
      lines: [
        {
          kind: "YARN" as const,
          refId: "l1",
          label: "",
          qty: "1",
          unit: "KG" as const,
          ownerCustomerId: "c",
          blockedReason: null,
        },
        {
          kind: "WARP_BEAM" as const,
          refId: "b1",
          label: "",
          qty: "9",
          unit: "METER" as const,
          ownerCustomerId: "c",
          blockedReason: null,
        },
      ],
    };
    expect(previewLineFor(p, [beam, yarn("1")], "beam:b1")?.qty).toBe("9");
    expect(previewLineFor(p, [beam], "beam:x")).toBeNull();
  });
});

describe("metin", () => {
  it("kg: virgül kabul, ≤0 / 4 ondalık / harf reddedilir", () => {
    expect(parseKg("12,5")).toBe("12.5");
    expect(parseKg("0")).toBeNull();
    expect(parseKg("1.2345")).toBeNull();
    expect(parseKg("abc")).toBeNull();
  });
  it("tanınmayan kod ham basılmaz", () => {
    expect(blockedReasonText("YENI_KOD")).toBe("Bu kalem çıkışa uygun değil");
    expect(blockedReasonText(null)).toBeNull();
  });
});

describe("aday satırı seçilebilirliği (engel SUNUCUDAN; istemci yalnız 'belgede var'ı ekler)", () => {
  const b = (blocked: ConsignmentBeamCandidate["blockedReason"]): ConsignmentBeamCandidate => ({
    warpBeamId: "b1", beamNo: "LV1", warpSpecName: null, remainingM: "10.000", blockedReason: blocked,
  });
  const y = (blocked: ConsignmentYarnCandidate["blockedReason"]): ConsignmentYarnCandidate => ({
    lotId: "l1", lotNo: "77", yarnItemId: "i", itemCode: "IP", itemName: "İplik", warehouseId: "w1", warehouseName: "Ana", balanceKg: "3.000", blockedReason: blocked,
  });
  it("levent: engelsiz seçilir · sunucu engeli Türkçe · belgede olan seçilemez", () => {
    expect(beamDisabledReason(b(null), new Set())).toBeNull();
    expect(beamDisabledReason(b("CONSIGNMENT_BEAM_NOT_READY"), new Set())).toBe("Levent hazır (boşta) değil");
    expect(beamDisabledReason(b(null), new Set(["beam:b1"]))).toMatch(/zaten/);
  });
  it("lot: pasif lot engeli Türkçe · aynı lot × depo ikinci kez seçilemez", () => {
    expect(lotDisabledReason(y(null), new Set())).toBeNull();
    expect(lotDisabledReason(y("YARN_LOT_INACTIVE"), new Set())).toMatch(/pasif/);
    expect(lotDisabledReason(y(null), new Set([yarnKey(y(null))]))).toMatch(/zaten/);
  });
});
