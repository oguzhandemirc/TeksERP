// Kart ipucunun içeriği: duruşun sebebi, türü (plan dışı mı), FABRİKA saatiyle başlangıcı, geçen
// süre, hedef ve aşım, kaynak ve dokunan iş; çalışan/verisiz tezgah; levent ve zincir halkaları.
import { describe, expect, it } from "vitest";
import { beamHintOf, chainStepHintOf, hintText, loomHintOf } from "./loomHints";
import type { LiveLoom, OpenStop } from "./types";

const NOW = Date.parse("2026-10-10T08:30:00.000Z"); // fabrika (İstanbul) 11:30

function loom(over: Partial<LiveLoom>): LiveLoom {
  return {
    id: "m1", code: "MAK1010260002", hall: "Hol A", monitored: true, stateSource: "elle", loomType: null, targetRpm: null, rpm: null,
    picksPerCm: null, openStop: null, shift: null, today: { runSec: 2700, plannedSec: 3600 }, stops: [], dayBreakdown: [], events: [],
    job: null, beams: [], source: "OPERATOR", ...over,
  };
}

const stop = (over: Partial<OpenStop>): OpenStop => ({
  reasonCode: "MEKANIK_ARIZA", label: "Mekanik arıza", lossClass: "UNPLANNED", startedAt: NOW - 30 * 60_000, targetMin: 10, graceMin: 0,
  attendant: null, notifiedAt: null, respondedAt: null, escalatedAt: null, ...over,
});

const line = (h: ReturnType<typeof loomHintOf>, label: string) => h.lines.find((l) => l.label === label);

describe("loomHintOf — duran tezgah", () => {
  it("⭐ sebep · tür · fabrika saatiyle başlangıç · süre · hedef aşımı · kaynak · iş", () => {
    const h = loomHintOf(loom({ openStop: stop({}), job: { no: "DK1010260001", fabric: "Poplin", color: "#fff", plannedM: null, producedM: null } }), NOW);
    expect(h.title).toBe("MAK1010260002");
    expect(h.subtitle).toBe("Arıza / kopuş");
    expect(line(h, "Sebep")?.value).toBe("Mekanik arıza");
    expect(line(h, "Tür")?.value).toBe("Plansız duruş (kayıp)");
    expect(line(h, "Başladı")?.value).toBe("11:00");
    expect(line(h, "Süre")?.value).toBe("30 dk duruyor");
    expect(line(h, "Hedef")).toEqual({ label: "Hedef", value: "10 dk · 20 dk aşıldı", tone: "warn" });
    expect(line(h, "Kaynak")?.value).toBe("Elle");
    expect(line(h, "Dokunan iş")?.value).toBe("DK1010260001 · Poplin");
  });

  it("hedef içinde: kalan süre, uyarı tonu yok; patrona iletildi: kırmızı satır", () => {
    const within = loomHintOf(loom({ openStop: stop({ targetMin: 45 }) }), NOW);
    expect(line(within, "Hedef")).toEqual({ label: "Hedef", value: "45 dk · 15 dk kaldı" });
    const esc = loomHintOf(loom({ openStop: stop({ escalatedAt: NOW - 60_000 }) }), NOW);
    expect(line(esc, "Hedef")?.tone).toBe("danger");
    expect(line(esc, "Durum")?.value).toBe("Patrona iletildi");
  });

  it("plan dışı duruş: hedef yok, planlı süreye sayılmadığı yazılır", () => {
    const h = loomHintOf(loom({ openStop: stop({ reasonCode: "SIPARIS_YOK", label: "Sipariş yok", lossClass: "NON_SCHEDULED", targetMin: null }) }), NOW);
    expect(line(h, "Tür")?.value).toContain("Plan dışı");
    expect(line(h, "Hedef")?.value).toBe("Yok — süre izlenmiyor");
  });

  it("sebep bekleyen duruş ve başka güne düşen başlangıç (tarihli)", () => {
    const h = loomHintOf(loom({ openStop: stop({ reasonCode: null, lossClass: null, label: "—", startedAt: NOW - 14 * 3_600_000 }) }), NOW);
    expect(line(h, "Sebep")?.value).toBe("Sebep bekleniyor");
    expect(line(h, "Başladı")?.value).toBe("09.10.2026 21:30");
  });

  it("görevli zinciri: bildirim ve geliş saatleri fabrika saatiyle", () => {
    const s = stop({ attendant: { id: "p", name: "Ali", role: "ATTENDANT" }, notifiedAt: NOW - 25 * 60_000, respondedAt: null });
    expect(line(loomHintOf(loom({ openStop: s }), NOW), "Görevli")?.value).toBe("Ali · bildirim aldı");
    expect(hintText(chainStepHintOf("notify", s, NOW))).toContain("Ali: 11:05");
    expect(chainStepHintOf("respond", s, NOW).title).toBe("Görevli henüz gelmedi");
    expect(chainStepHintOf("escalate", s, NOW).title).toBe("Patrona iletilmedi");
  });
});

describe("loomHintOf — çalışan ve verisiz", () => {
  it("çalışan: bugün payı ve kaynak", () => {
    const h = loomHintOf(loom({ stateSource: "olculen", rpm: 650 }), 0);
    expect(h.subtitle).toBe("Çalışıyor");
    expect(line(h, "Bugün")?.value).toBe("%75 çalıştı");
    expect(line(h, "Devir")?.value).toBe("650 atkı/dk");
    expect(line(h, "Kaynak")?.value).toBe("Ölçülen");
  });

  it("verisiz: 'Veri yok' ve nedeni", () => {
    const h = loomHintOf(loom({ monitored: false, stateSource: "cikarim" }), NOW);
    expect(h.subtitle).toBe("Veri yok");
    expect(h.note).toContain("Sensör yok");
  });
});

describe("beamHintOf", () => {
  it("her levent yuvasıyla ve kalanıyla", () => {
    const text = hintText(beamHintOf([
      { no: "LV-1", slot: 1, warpSpec: null, totalM: 1000, remainingM: 900 },
      { no: "LV-2", slot: 2, warpSpec: null, totalM: 1000, remainingM: 40 },
    ]));
    expect(text).toContain("LV-1 (yuva 1): 900 m kaldı");
    expect(text).toContain("LV-2 (yuva 2): 40 m kaldı");
  });
});
