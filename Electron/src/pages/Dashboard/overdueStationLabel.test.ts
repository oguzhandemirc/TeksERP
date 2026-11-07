// Geciken İE'nin konumu İE listesiyle aynı tek kaynaktan (`konum`): pasif istasyonda duran İE gizlenmez, plan imlecinden
// ya da "(pasif istasyon)" ekiyle konum uydurulmaz (prova 11-06 madde 13 → 2. prova düzeltmesi).
// Negatif sonda: etiket yeniden ACTIVE adımdan okununca "plan imleci" vakası kırmızı (ölçüldü 2026-11-06).
import { describe, expect, it } from "vitest";

import { overdueStationLabel } from "./OverdueWorkOrders";
import type { WorkOrderLocation, WorkOrderLocationStation } from "@/pages/Operations/WorkOrders/location";

const st = (ad: string, x: Partial<WorkOrderLocationStation> = {}): WorkOrderLocationStation =>
  ({ istasyonId: ad, ad, tur: "OTHER", dis: false, topSayisi: 2, metre: 100, fasondaTop: 0, fasoncular: [], ...x }) as WorkOrderLocationStation;
const konum = (sinif: WorkOrderLocation["sinif"], istasyonlar: WorkOrderLocationStation[]): WorkOrderLocation => ({ sinif, canliTop: istasyonlar.reduce((s, i) => s + i.topSayisi, 0), istasyonlar });

describe("overdueStationLabel", () => {
  it("⭐ konum canlı toplardan: pasif istasyonda duran top çıplak adıyla (liste ile aynı), ek uydurulmaz", () => {
    expect(overdueStationLabel({ status: "IN_PROGRESS", konum: konum("TEK_ISTASYON", [st("Brode")]) })).toBe("Brode");
  });
  it("⭐ plan imleci kullanılmaz: konum yoksa (eski sunucu) istasyon yazılmaz", () => {
    const wo = { status: "IN_PROGRESS", konum: undefined, steps: [{ status: "ACTIVE", station: { name: "Brode", isActive: false } }] } as never;
    expect(overdueStationLabel(wo)).toBeNull();
  });
  it("bölünmüş: ilk istasyon + diğer sayısı; fasonda: fasoncu adı", () => {
    expect(overdueStationLabel({ status: "IN_PROGRESS", konum: konum("BOLUNMUS", [st("Kurşun", { topSayisi: 3 }), st("Tambur")]) })).toBe("Kurşun +1");
    expect(overdueStationLabel({ status: "IN_PROGRESS", konum: konum("FASONDA", [st("Boyahane", { dis: true, fasondaTop: 2, fasoncular: ["Akın Boya"] })]) })).toBe("Akın Boya");
  });
  it("başlamamış / üretimi bitmiş İE", () => {
    expect(overdueStationLabel({ status: "PLANNED", konum: konum("BASLAMADI", []) })).toBe("Başlamadı");
    expect(overdueStationLabel({ status: "IN_PROGRESS", konum: konum("BITTI", []) })).toBe("Üretim bitti");
  });
});
