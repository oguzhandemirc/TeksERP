// Salon iş eylemlerinin saf kısmı: hedef satırlar, ilk işaretler (1e kararı: "İş ver"de dolu hat işaretsiz,
// "İşi değiştir"de işaretli), gönderilecek satırlar (engelli/işaretsiz düşer, dolu hatta replaceRunId = açık rıza).
import { describe, expect, it } from "vitest";
import type { LiveLoom } from "../types";
import { assignRowsOf, assignTargetsOf, finishTargetsOf, initialSelection, maxLinesOf, rowKey } from "./plan";
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

  it("⭐ dolu hat replaceRunId ile gider (açık rıza); boş hat null; token satır anahtarından", () => {
    expect(assignRowsOf(rows, new Set(["a:1", "b:1"]), token)).toEqual([
      { machineId: "a", productionLineNo: 1, clientToken: "tok-a:1", replaceRunId: null },
      { machineId: "b", productionLineNo: 1, clientToken: "tok-b:1", replaceRunId: "r-old" },
    ]);
  });

  it("satır anahtarı tezgah + hat", () => {
    expect(rowKey({ machineId: "x", productionLineNo: 2 })).toBe("x:2");
  });
});
