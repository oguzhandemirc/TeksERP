// Salon iş eylemlerinin saf kısmı: hedef satırlar, ilk işaretler (1e kararı: "İş ver"de dolu hat işaretsiz,
// "İşi değiştir"de işaretli), gönderilecek satırlar (engelli/işaretsiz düşer, dolu hatta replaceRunId = açık rıza).
import { describe, expect, it } from "vitest";
import type { LiveLoom } from "../types";
import { NO_JOB, allJobsChosen, assignRowsOf, assignTargetsOf, effectiveJobOf, finishTargetsOf, initialSelection, isMixed, maxLinesOf, rowKey, withRowJobs } from "./plan";
import type { BulkPreviewRow } from "./runService";

const loom = (id: string, lines?: number, openRuns?: LiveLoom["openRuns"]): LiveLoom => ({ id, code: `T-${id}`, lines, openRuns }) as LiveLoom;
const run = (id: string, line: number) => ({ id, line, jobId: "w1", jobNo: "DI-1", startedAt: 0 });
const row = (machineId: string, outcome: BulkPreviewRow["outcome"], p: Partial<BulkPreviewRow> = {}): BulkPreviewRow => ({
  machineId,
  productionLineNo: 1,
  machineCode: `T-${machineId}`,
  machineName: `Tezgah ${machineId}`,
  productionLineCount: 1,
  current: null,
  outcome,
  defaultSelected: outcome === "START" || outcome === "FINISH",
  warnings: [],
  block: outcome === "BLOCKED" ? { code: "MACHINE_INACTIVE", message: "Tezgah pasif" } : null,
  ...p,
});
const cur = { id: "r-old", weavingOrderId: "w0", weavingOrderNumber: "DI-0", startedAt: "2026-10-10T08:00:00.000Z" };

describe("plan — hedefler", () => {
  it("hat sorusu yalnız çok hatlı tezgah varken (en büyük hat sayısı)", () => {
    expect(maxLinesOf([loom("a"), loom("b", 1)])).toBe(1);
    expect(maxLinesOf([loom("a"), loom("b", 2)])).toBe(2);
  });

  it("İş ver hedefi: tek hatlı tezgah hep 1. hat, çok hatlıda seçilen hat", () => {
    expect(assignTargetsOf([loom("a"), loom("b", 2)], 2)).toEqual([
      { machineId: "a", productionLineNo: 1 },
      { machineId: "b", productionLineNo: 2 },
    ]);
  });

  it("Bitir hedefi: seçili tezgahların açık koşumu olan HER hattı; açık koşumsuz tezgah yok", () => {
    expect(finishTargetsOf([loom("a", 2, [run("r1", 1), run("r2", 2)]), loom("b", 1, []), loom("c", 1, null)])).toEqual([
      { machineId: "a", productionLineNo: 1 },
      { machineId: "a", productionLineNo: 2 },
    ]);
  });
});

describe("plan — ilk işaretler", () => {
  const rows = [row("a", "START"), row("b", "REPLACE", { current: cur }), row("c", "SAME_JOB", { current: cur }), row("d", "BLOCKED")];

  it("⭐ İş ver: yalnız sunucunun varsayılanı — dolu hat (Değiştir) ve aynı iş İŞARETSİZ", () => {
    expect([...initialSelection(rows, "assign")]).toEqual(["a:1"]);
  });

  it("⭐ İşi değiştir: Değiştir satırları da işaretli (niyet zaten değiştirmek); aynı iş ve engel hâlâ işaretsiz", () => {
    expect([...initialSelection(rows, "replace")].sort()).toEqual(["a:1", "b:1"]);
  });
});

describe("plan — gönderilecek satırlar", () => {
  const rows = [row("a", "START"), row("b", "REPLACE", { current: cur }), row("d", "BLOCKED")];
  const token = (k: string) => `tok-${k}`;

  it("⭐ işaret kaldırılan ve engelli satır gövdede YOK", () => {
    const sent = assignRowsOf(rows, new Set(["a:1", "d:1"]), token);
    expect(sent.map((r) => r.machineId)).toEqual(["a"]);
  });

  it("⭐ dolu hat replaceRunId ile gider (açık rıza); boş hat null; token satır anahtarı + işten; tek işte satır alanı YOK", () => {
    expect(assignRowsOf(rows, new Set(["a:1", "b:1"]), token)).toEqual([
      { machineId: "a", productionLineNo: 1, clientToken: "tok-a:1|-", replaceRunId: null },
      { machineId: "b", productionLineNo: 1, clientToken: "tok-b:1|-", replaceRunId: "r-old" },
    ]);
  });

  it("⭐ C.6 karışık seçimde satırın işi önizlemeden gider (null = işsiz); iş değişince token anahtarı değişir", () => {
    const mixed = [row("a", "START", { weavingOrder: { id: "w1", weavingOrderNumber: "DI-1" } }), row("b", "START", { weavingOrder: null })];
    expect(assignRowsOf(mixed, new Set(["a:1", "b:1"]), token, true)).toEqual([
      { machineId: "a", productionLineNo: 1, clientToken: "tok-a:1|w1", replaceRunId: null, weavingOrderId: "w1" },
      { machineId: "b", productionLineNo: 1, clientToken: "tok-b:1|-", replaceRunId: null, weavingOrderId: null },
    ]);
  });

  it("satır anahtarı tezgah + hat", () => {
    expect(rowKey({ machineId: "x", productionLineNo: 2 })).toBe("x:2");
  });
});

describe("plan — tezgah başına iş (C.6)", () => {
  const looms = [loom("a"), loom("b"), loom("c")];

  it("⭐ ayrı iş seçilmeyen tezgah ortak işi alır; karışıklık yalnız ortaktan farklı iş varken", () => {
    const o = new Map([["b", "w2"]]);
    expect(looms.map((l) => effectiveJobOf(l.id, "w1", o))).toEqual(["w1", "w2", "w1"]);
    expect(isMixed(looms, "w1", o)).toBe(true);
    expect(isMixed(looms, "w1", new Map())).toBe(false);
  });

  it("⭐ önizleme her tezgahın işi seçiliyken: ortak yokken tek tezgah eksikse kapalı", () => {
    expect(allJobsChosen(looms, null, new Map([["a", "w1"], ["b", "w2"]]))).toBe(false);
    expect(allJobsChosen(looms, null, new Map([["a", "w1"], ["b", "w2"], ["c", NO_JOB]]))).toBe(true);
  });

  it("⭐ karışık seçimde hedefe satır işi eklenir (numune → null); tek işte hedef bugünkü gibi", () => {
    const targets = assignTargetsOf(looms.slice(0, 2), 1);
    expect(withRowJobs(targets, (id) => (id === "a" ? "w1" : NO_JOB))).toEqual([
      { machineId: "a", productionLineNo: 1, weavingOrderId: "w1" },
      { machineId: "b", productionLineNo: 1, weavingOrderId: null },
    ]);
    expect(withRowJobs(targets, null)).toEqual(targets);
  });
});
