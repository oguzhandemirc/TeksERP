// test_gelen_belge_cok_parti §9 (s1a inceleme, 2026-11-03; fabrika cevabı 36): OCR'ın okuduğu "1/2" sayfa damgası UYARIDIR, kapı değil.
// Damga `pageCount` kolonuna yazılmaz (kolon = elle beyan; onayın DELIVERY_NOTE_PAGES_MISSING kapısı yalnız ona bakar), `totalsDeclared.pages`a
// yazılır → /partiler canlı "eksik sayfa" + onayda uyarı. İş emri formunda gerekçe alanı yok; damga kapı olsaydı Kaydet'in çıkışı olmazdı.
// Negatif sonda: `fillEmptyHeader`/`buildDraft` damgayı yeniden `pageCount`a yazınca §9b–c kırmızı.
import prisma from "../../src/lib/prisma";
import { buildDraft, fillBoundDraftTx } from "../../src/services/gelen-belge-taslak-doldur.service";
import type { OcrResult } from "../../src/lib/gelen-belge/motor";

type Check = (label: string, ok: boolean, detay?: string) => void;
type Resp = { status: number; code?: string; data?: Record<string, unknown>; warnings?: string[] };

export interface SayfaCtx {
  check: Check;
  ocr: OcrResult;
  /** Satırsız, taramasız MANUAL taslak açar (id). */
  emptyNote: () => Promise<string>;
  addScan: (noteId: string | null, ocrResult: unknown, pageNo?: number) => Promise<string>;
  parties: (id: string) => Promise<Resp>;
  formWo: (id: string, parties: Array<{ blockNo: number; meters: number }>) => Promise<Resp>;
  /** Elle "2 sayfa" beyanlı, yalnız 1. sayfası taranmış belge (bugünkü kapı). */
  manualTwoPageNote: () => Promise<string>;
}

const pagesOf = (t: unknown): unknown => (t && typeof t === "object" ? (t as { pages?: unknown }).pages : undefined);

export async function sayfaDamgasiUyaridir(c: SayfaCtx): Promise<void> {
  const built = await buildDraft(c.ocr, undefined, { bumpHit: false });
  c.check("§9a yeni OCR taslağı: damga pageCount kolonuna GİTMEZ, totalsDeclared.pages = 2", !("pageCount" in built.headerCols) && pagesOf(built.totalsDeclared) === 2,
    JSON.stringify({ pc: (built.headerCols as Record<string, unknown>).pageCount, pages: pagesOf(built.totalsDeclared) }));

  const id = await c.emptyNote();
  const scan = await c.addScan(id, { ocr: c.ocr }, 1);
  await prisma.$transaction((tx) => fillBoundDraftTx(tx, id, { id: scan, pageNo: 1 }, built));
  const n = await prisma.customerDeliveryNote.findUnique({ where: { id }, select: { pageCount: true, totalsDeclared: true } });
  c.check("§9b bağlı taslak (yalnız 1. sayfa): pageCount boş, damga totalsDeclared.pages = 2", n?.pageCount === null && pagesOf(n?.totalsDeclared) === 2, JSON.stringify({ pc: n?.pageCount, pages: pagesOf(n?.totalsDeclared) }));
  const p = await c.parties(id);
  c.check("§9b /partiler canlı uyarı 'eksik sayfa: 2' (damgadan)", p.status === 200 && /eksik sayfa: 2/.test(((p.data?.warnings ?? []) as string[]).join(" ")), JSON.stringify(p.data?.warnings));
  const r = await c.formWo(id, [{ blockNo: 1, meters: 586 }, { blockNo: 2, meters: 3935 }]);
  c.check("⭐ §9c iş emri formu: '1/2' eksik sayfa KAPI DEĞİL → 201 + 'eksik sayfa' uyarısı", r.status === 201 && (r.warnings ?? []).some((w) => /sayfa/i.test(w) && w.includes("2")),
    `${r.status} ${r.code ?? ""} ${JSON.stringify(r.warnings)}`);

  const m = await c.manualTwoPageNote();
  const rm = await c.formWo(m, [{ blockNo: 1, meters: 330 }, { blockNo: 2, meters: 410 }]);
  c.check("§9d elle beyan (pageCount 2, 1 sayfa taranmış) → bugünkü kapı 409 DELIVERY_NOTE_PAGES_MISSING", rm.status === 409 && rm.code === "DELIVERY_NOTE_PAGES_MISSING", `${rm.status} ${rm.code ?? ""}`);
}
