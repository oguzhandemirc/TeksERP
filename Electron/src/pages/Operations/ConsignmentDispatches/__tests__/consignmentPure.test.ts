// Emanet çıkış saf mantığı: taslak anahtarı/yerine geçme, önizleme eşleşmesi, kg ayrıştırma, sahip yüklemleri.
import { describe, expect, it } from "vitest";
import { buildBody, previewLineFor, upsertItem, type DraftItem } from "../draft";
import { blockedReasonText, parseKg } from "../consignmentText";
import { beamDisabledReason } from "../BeamPicker";
import { lotDisabledReason } from "../YarnLinePicker";
import type { WarpBeam } from "@/pages/Operations/WarpBeams/types";
import type { YarnLotRow } from "@/pages/Operations/Yarn/service";

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

describe("sahip yüklemleri (görüntü; asıl kapı sunucu önizlemesi)", () => {
  const b = (owner: string | null) =>
    ({
      id: "b1",
      ownerCustomerId: owner,
      ownerCustomer: owner ? { id: owner, name: "X" } : null,
    }) as WarpBeam;
  it("levent: bizim / başka sahip / zaten ekli seçilemez", () => {
    expect(beamDisabledReason(b("cA"), "cA", new Set())).toBeNull();
    expect(beamDisabledReason(b(null), "cA", new Set())).toMatch(/Bizim/);
    expect(beamDisabledReason(b("cB"), "cA", new Set())).toMatch(/başka müşteri/);
    expect(beamDisabledReason(b("cA"), "cA", new Set(["beam:b1"]))).toMatch(/zaten/);
  });
  it("lot: bakiyesiz lot seçilemez", () => {
    const l = (owner: string | null, kg: number) =>
      ({ ownerCustomerId: owner, ownerCustomer: null, balanceKg: kg }) as unknown as YarnLotRow;
    expect(lotDisabledReason(l("cA", 3), "cA")).toBeNull();
    expect(lotDisabledReason(l("cA", 0), "cA")).toMatch(/bakiyesi yok/);
    expect(lotDisabledReason(l("cB", 3), "cA")).toMatch(/başka müşteri/);
  });
});
