import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";

// =============================================================================
// AKIŞLI EXCEL ↔ ESKİ YOL EŞİTLİĞİ (Perf-2 B4). Aynı liste sayfası eski `buildWorkbook`
// (renderer, bellekte kitap) ve gerçek `xlsx.ipc.ts` (ana süreç WorkbookWriter) ile
// yazılır, ikisi exceljs ile geri okunup hücre hücre karşılaştırılır: değer, numFmt,
// font, hiza, dolgu, kolon genişliği, donmuş görünüm, autoFilter. Parça sınırı 7'ye
// indirilir → 30 satır beş parçada gider (parça birleşimi de ölçülür).
// =============================================================================

type Handler = (e: unknown, payload: unknown) => Promise<unknown>;
const h = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), savePath: "" as string | null, rowsCalls: 0, filesSaves: 0 }));

vi.mock("@shared/xlsx-stream", async (orig) => ({ ...(await orig<object>()), XLSX_STREAM_MAX_CHUNK: 7 }));
vi.mock("../../shared/xlsx-stream.js", async () => ({ ...(await vi.importActual<object>("@shared/xlsx-stream")), XLSX_STREAM_MAX_CHUNK: 7 }));
// Eşik 25'e iner: yönlendirme testi küçük listeyle ölçülür (gerçek eşik XLSX_STREAM_MIN_ROWS).
vi.mock("./xlsx-stream", async (orig) => ({ ...(await orig<object>()), XLSX_STREAM_MIN_ROWS: 25 }));
vi.mock("./file-save", () => ({
  saveBlobAs: async () => {
    h.filesSaves++;
    return true;
  },
  saveTextAs: vi.fn(),
  downloadBlob: vi.fn(),
}));
vi.mock("../../electron/security/trusted-ipc.js", () => ({
  handleTrusted: (ch: string, fn: Handler) => h.handlers.set(ch, fn),
}));
vi.mock("../../electron/ipc/dialog-window.js", () => ({
  showSaveDialogFor: async () => (h.savePath ? { canceled: false, filePath: h.savePath } : { canceled: true }),
}));

const ipc = await import("../../electron/ipc/xlsx.ipc");
const { buildWorkbook } = await import("./xlsx-export");
const { buildListSheet, exportRowsToXlsx } = await import("./list-export");
const { streamSheetToXlsx } = await import("./xlsx-stream");
const wire = await import("@shared/xlsx-stream");

ipc.registerXlsxIpc();
const sender = { id: 1, once: vi.fn() };
const call = (ch: string, payload: unknown, s: unknown = sender) => h.handlers.get(ch)!({ sender: s }, payload);

beforeEach(() => {
  h.rowsCalls = 0;
  h.filesSaves = 0;
  vi.stubGlobal("window", {
    api: {
      xlsx: {
        streamBegin: (o: unknown) => call("xlsx:streamBegin", o),
        streamRows: (o: unknown) => {
          h.rowsCalls++;
          return call("xlsx:streamRows", o);
        },
        streamEnd: (o: unknown) => call("xlsx:streamEnd", o),
        streamAbort: (id: unknown) => call("xlsx:streamAbort", id),
      },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

interface Row {
  kod: string;
  ad: string | null;
  metre: number;
  kg: number | string;
  adet: number;
}
const COLS = [
  { label: "Kod", value: (r: Row) => r.kod },
  { label: "Ad", value: (r: Row) => r.ad },
  { label: "Metre", value: (r: Row) => r.metre, summable: true },
  { label: "Kg", value: (r: Row) => r.kg, summable: true },
  { label: "Adet", value: (r: Row) => r.adet },
];
const ROWS: Row[] = Array.from({ length: 30 }, (_, i) => ({
  kod: i === 3 ? "=1+1" : `TP-${i}`,
  ad: i % 5 === 0 ? null : `Kumaş ${i} ğüşiöç`,
  metre: i % 2 ? i * 1.25 : i * 10,
  kg: i === 7 ? "12,5 kg" : i * 0.333,
  adet: i,
}));
const NOTES = ["Rakamlar sevk anına aittir.", "İade düşülmemiştir."];

/** jsdom Blob'unda arrayBuffer() yok — FileReader ile oku. */
const blobBytes = (blob: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });

async function readBook(buf: ArrayBuffer | Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb.worksheets[0]!;
}

/** Sayfanın karşılaştırılan yüzü: hücre değeri + biçim + görünüm (yazım ayrıntısı değil). */
function snapshot(ws: ExcelJS.Worksheet, colCount: number) {
  const cells: unknown[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      // Paylaşımsız dizgide exceljs boş metni `t="str"` boş değerle yazar, geri okunca boş hücredir;
      // Excel'de ikisi de boş görünür → "" ≡ boş sayılır (tek bilinçli normalleştirme).
      cells.push({ at: `${r}:${c}`, value: cell.value === "" ? null : (cell.value ?? null), numFmt: cell.numFmt ?? null, font: cell.font ?? null, alignment: cell.alignment ?? null, fill: cell.fill ?? null });
    }
  }
  return {
    name: ws.name,
    rowCount: ws.rowCount,
    widths: Array.from({ length: colCount }, (_, i) => ws.getColumn(i + 1).width ?? null),
    views: ws.views.map((v) => ({ state: v.state, ySplit: (v as { ySplit?: number }).ySplit })),
    autoFilter: ws.autoFilter,
    cells,
  };
}

describe("Akışlı Excel ↔ eski buildWorkbook eşitliği", () => {
  it("⭐ liste sayfası: değer, numFmt, font, hiza, dolgu, genişlik, donmuş görünüm, autoFilter aynı", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xlsx-akis-"));
    h.savePath = join(dir, "Liste.xlsx");
    const spec = buildListSheet(COLS, ROWS, "Kumaş Stoğu 2026-10-13", NOTES);

    const oldWs = await readBook(await blobBytes(await buildWorkbook([spec])));
    expect(await streamSheetToXlsx(spec, "Kumaş Stoğu 2026-10-13")).toBe(true);
    const newWs = await readBook(await readFile(h.savePath));

    expect(h.rowsCalls).toBe(5);
    expect(await readdir(dir)).toEqual(["Liste.xlsx"]); // .part taşındı
    const a = snapshot(oldWs, COLS.length);
    const b = snapshot(newWs, COLS.length);
    expect(b).toEqual(a);
    // Ölçünün boş olmadığını sabitle: TOPLAM kalın, kesirli sayı biçimli, not italik.
    expect(a.views).toEqual([{ state: "frozen", ySplit: 4 }]);
    expect(a.rowCount).toBe(4 + 30 + 1 + 1 + NOTES.length);
    expect(b.cells).toContainEqual(expect.objectContaining({ at: "6:3", value: 1.25, numFmt: "#,##0.0##" }));
    expect(b.cells).toContainEqual(expect.objectContaining({ at: "4:1", value: "Kod", font: expect.objectContaining({ bold: true }), fill: expect.objectContaining({ pattern: "solid" }) }));
    expect(b.cells).toContainEqual(expect.objectContaining({ at: "35:3", font: expect.objectContaining({ bold: true }), alignment: { horizontal: "right" } }));
    expect(b.cells).toContainEqual(expect.objectContaining({ at: "37:1", value: NOTES[0], font: expect.objectContaining({ italic: true }) }));
    expect(b.widths).toEqual([20, 20, 20, 20, 20]);
    expect(b.autoFilter).toBeTruthy();
    expect(ipc.openXlsxSessionCount()).toBe(0);
  });
});

describe("Akışlı Excel oturumu ve girdi kapısı", () => {
  it("⭐ diyalog iptali: oturum açılmaz, false döner", async () => {
    h.savePath = null;
    expect(await streamSheetToXlsx(buildListSheet(COLS, ROWS, "x"), "x")).toBe(false);
    expect(ipc.openXlsxSessionCount()).toBe(0);
  });

  it("⭐ başka gönderenin oturumuna satır yazılamaz; geçersiz parça oturumu düşürür ve .part silinir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xlsx-akis-"));
    h.savePath = join(dir, "L.xlsx");
    const begin = (await call("xlsx:streamBegin", { suggestedName: "L", sheetName: "L", columns: [{ header: "A", width: 10 }], preamble: [] })) as { ok: true; sessionId: string };
    expect(begin.ok).toBe(true);
    expect(await call("xlsx:streamRows", { sessionId: begin.sessionId, rows: [["a"]] }, { id: 2, once: vi.fn() })).toEqual({ ok: false, error: "Excel verisi geçersiz" });
    expect(ipc.openXlsxSessionCount()).toBe(1);
    // Kolon sayısından uzun satır, fonksiyon/nesne hücre, 7'den büyük parça: hepsi ret.
    expect(await call("xlsx:streamRows", { sessionId: begin.sessionId, rows: [["a", "b"]] })).toMatchObject({ ok: false });
    expect(ipc.openXlsxSessionCount()).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it("⭐ başlangıç yükü doğrulanır: kolonsuz, uzun ad, yanlış hiza, sayı olmayan genişlik", async () => {
    h.savePath = "/yok/olmamali.xlsx";
    const base = { suggestedName: "L", sheetName: "L", columns: [{ header: "A", width: 10 }], preamble: [] };
    for (const bad of [
      { ...base, columns: [] },
      { ...base, suggestedName: "x".repeat(201) },
      { ...base, columns: [{ header: "A", width: 10, align: "justify" }] },
      { ...base, columns: [{ header: "A", width: "10" }] },
      { ...base, preamble: [[{ v: 1 }]] },
      null,
    ]) {
      expect(await call("xlsx:streamBegin", bad)).toEqual({ ok: false, error: "Excel verisi geçersiz" });
    }
  });

  it("⭐ yarıda iptal (abort): .part silinir, oturum kapanır", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xlsx-akis-"));
    h.savePath = join(dir, "L.xlsx");
    const begin = (await call("xlsx:streamBegin", { suggestedName: "L", sheetName: "L", columns: [{ header: "A", width: 10 }], preamble: [] })) as { sessionId: string };
    await call("xlsx:streamRows", { sessionId: begin.sessionId, rows: [["a"], [{ v: 1.5, f: "#,##0.0##" }]] });
    await call("xlsx:streamAbort", begin.sessionId);
    expect(ipc.openXlsxSessionCount()).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("exportRowsToXlsx yönlendirmesi (tek giriş)", () => {
  it("⭐ eşik ve üstü akışa, altı eski yola (renderer kitabı + files.save) gider", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xlsx-akis-"));
    h.savePath = join(dir, "L.xlsx");
    expect(await exportRowsToXlsx(COLS, ROWS.slice(0, 24), "L")).toBe(true);
    expect([h.rowsCalls, h.filesSaves]).toEqual([0, 1]);
    expect(await exportRowsToXlsx(COLS, ROWS, "L")).toBe(true);
    expect([h.rowsCalls, h.filesSaves]).toEqual([5, 1]);
  });
});

describe("Tel doğrulayıcısı (ana süreç girişi)", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  it("⭐ yalnız string|number|null|{v,f} hücre; fazladan anahtar, sonsuz sayı, boş biçim, uzun metin ret", () => {
    expect(wire.parseXlsxStreamRows({ sessionId: id, rows: [["a", 1, null, { v: 2.5, f: "#,##0.0##" }]] }, 4)).not.toBeNull();
    for (const cell of [{ v: 1, f: "0", x: 1 }, Number.POSITIVE_INFINITY, { v: 1, f: "" }, "x".repeat(wire.XLSX_MAX_CELL_CHARS + 1), true, { v: {}, f: "0" }]) {
      expect(wire.parseXlsxStreamRows({ sessionId: id, rows: [[cell]] }, 4)).toBeNull();
    }
    expect(wire.parseXlsxStreamRows({ sessionId: "../x", rows: [] }, 4)).toBeNull();
    expect(wire.parseXlsxStreamEnd({ sessionId: id, notes: [1] }, 4)).toBeNull();
  });
});
