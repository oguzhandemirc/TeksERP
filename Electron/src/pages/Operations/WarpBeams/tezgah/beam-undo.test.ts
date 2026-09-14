// =============================================================================
// GERİ ALMA ADAYLARI — LIFO aynası + tezgah hücresi + canlı levent yüklemi (saf fonksiyonlar)
// =============================================================================
// NEGATİF SONDA: `undoCandidates`te `reversed` süzgeci düşürülünce ② kırmızı (geri alınmış MOUNTED
// yeniden aday olur); `UNDOABLE_STATUS_KINDS`e "WOUND" eklenince ③ kırmızı.
// =============================================================================
import { describe, expect, it } from "vitest";
import { loomCell } from "../columns";
import { isLiveBeam, type WarpBeamEvent } from "../types";
import { undoCandidates, undoMenuEnabled } from "./beam-undo";

const ev = (id: string, kind: string, createdAt: string, extra: Partial<WarpBeamEvent> = {}): WarpBeamEvent =>
  ({ id, kind, reversesEventId: null, fromStatus: "READY", toStatus: "READY", lengthM: null, machine: null, endsCount: null, denier: null, theoreticalKg: null, kgSource: null, sectionCount: null, endsPerSection: null, breakCount: null, startedAt: null, reasonCode: null, reason: null, createdAt, mountPosition: null, beamRole: null, mountMethod: null, setupStartedAt: null, setupMinutes: null, machineCounter: null, lengthSource: null, grossKg: null, tareKg: null, fabricLengthM: null, ...extra });

describe("undoCandidates — LIFO", () => {
  it("① sarılmış + takılmış levent: LIFO adayı MOUNTED, tüketim yok", () => {
    const c = undoCandidates([ev("w", "WOUND", "2026-09-15T01:00:00Z"), ev("m", "MOUNTED", "2026-09-15T02:00:00Z")]);
    expect(c.lifo?.id).toBe("m");
    expect(c.blockedBy).toBeNull();
    expect(c.consumed).toEqual([]);
  });
  it("② ⭐ geri alınmış MOUNTED aday değildir; son aktif durum olayı WOUND → bu uçtan geri alınamaz, adıyla", () => {
    const c = undoCandidates([ev("w", "WOUND", "2026-09-15T01:00:00Z"), ev("m", "MOUNTED", "2026-09-15T02:00:00Z"), ev("mc", "MOUNT_CANCEL", "2026-09-15T03:00:00Z", { reversesEventId: "m" })]);
    expect(c.lifo).toBeNull();
    expect(c.blockedBy).toBe("WOUND");
  });
  it("③ ⭐ WOUND/SHIP_OUT/RETURNED_IN bu uçtan aday olmaz", () => {
    expect(undoCandidates([ev("w", "WOUND", "2026-09-15T01:00:00Z")]).lifo).toBeNull();
    expect(undoCandidates([ev("w", "WOUND", "2026-09-15T01:00:00Z"), ev("s", "SHIP_OUT", "2026-09-15T02:00:00Z")]).blockedBy).toBe("SHIP_OUT");
  });
  it("④ tüketimler LIFO dışı: ters bağı olmayan her CONSUMED aday, en yeni önce; geri alınmış olan düşer", () => {
    const c = undoCandidates([
      ev("w", "WOUND", "2026-09-15T01:00:00Z"),
      ev("c1", "CONSUMED", "2026-09-15T02:00:00Z", { lengthM: 10 }),
      ev("c2", "CONSUMED", "2026-09-15T03:00:00Z", { lengthM: 20 }),
      ev("c1x", "CONSUMED_CANCEL", "2026-09-15T04:00:00Z", { reversesEventId: "c1" }),
      ev("d", "DISMOUNTED", "2026-09-15T05:00:00Z"),
    ]);
    expect(c.consumed.map((e) => e.id)).toEqual(["c2"]);
    expect(c.lifo?.id).toBe("d");
  });
  it("⑤ sıralama createdAt'e göre — dizi karışık gelse de en yeni bulunur", () => {
    const c = undoCandidates([ev("x", "EXHAUSTED", "2026-09-15T09:00:00Z"), ev("m", "MOUNTED", "2026-09-15T02:00:00Z"), ev("w", "WOUND", "2026-09-15T01:00:00Z")]);
    expect(c.lifo?.id).toBe("x");
  });
});

describe("menü yüklemleri", () => {
  it("geri alma menüsü READY/MOUNTED/EXHAUSTED/SCRAPPED'da; PLANNED/CANCELLED/SHIPPED_OUT'ta kapalı", () => {
    expect(["READY", "MOUNTED", "EXHAUSTED", "SCRAPPED"].every((s) => undoMenuEnabled(s as never))).toBe(true);
    expect(["PLANNED", "CANCELLED", "SHIPPED_OUT"].some((s) => undoMenuEnabled(s as never))).toBe(false);
  });
  it("kalan defteri (tüket/düzelt/bitir/hurda) yalnız CANLI leventte: READY · MOUNTED", () => {
    expect(isLiveBeam("READY") && isLiveBeam("MOUNTED")).toBe(true);
    expect(["PLANNED", "SHIPPED_OUT", "EXHAUSTED", "SCRAPPED", "CANCELLED"].some((s) => isLiveBeam(s as never))).toBe(false);
  });
  it("tezgah hücresi: bağlıysa makine · yuva, değilse —", () => {
    expect(loomCell({ currentMachine: null, currentPosition: null })).toBe("—");
    expect(loomCell({ currentMachine: { id: "m", code: "T1", name: "Tezgah 1" }, currentPosition: 2 })).toBe("Tezgah 1 · yuva 2");
  });
});
