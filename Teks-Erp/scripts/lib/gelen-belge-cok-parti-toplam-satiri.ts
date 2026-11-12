// test_gelen_belge_cok_parti §16 (Gülkesim çok parti, 2026-11-10): yan çekilmiş ML Kit taraması (fikstür 0248, anonim) gerçek okuma
// yolundan (kullanıcı şablonu DB'de → buildDraft → bağlı taslak → /partiler) iki partinin gelen metre/kg/adedini BASILI toplam
// satırından verir: 5 top · 586 m · 141,7 kg ve 16 top · 3935 m · 819,2 kg; tablo Σ teyit, uyarısız. Toplam satırı etiketi şablonda
// tanıtmadaki gibi adetle ("T.Adet 5") kayıtlıdır. Negatif sonda: `findTotals` boş dönünce §16a–b kırmızı (motor bekçisi §19 ile aynı).
import prisma from "../../src/lib/prisma";
import { buildDraft, fillBoundDraftTx } from "../../src/services/gelen-belge-taslak-doldur.service";
import type { OcrResult } from "../../src/lib/gelen-belge/motor";
import { mlkitSablon } from "./gelen-belge-motor-toplam-satiri";

type Check = (label: string, ok: boolean, detay?: string) => void;
type Resp = { status: number; code?: string; data?: Record<string, unknown>; warnings?: string[] };
type PartyView = { blockNo: number; batchNo: string | null; lineCount: number; suggestedMeters: number | null; suggestedMetersSource: string | null; suggestedKg: number | null; kgSource: string | null; warnings: string[] };

export interface ToplamCtx {
  check: Check;
  tag: string;
  ocr: OcrResult;
  createTemplate: (name: string, template: unknown) => Promise<Resp>;
  deactivate: (code: string) => Promise<Resp>;
  emptyNote: () => Promise<string>;
  addScan: (noteId: string | null, ocrResult: unknown, pageNo?: number) => Promise<string>;
  parties: (id: string) => Promise<Resp>;
}

export async function cokPartiToplamSatiri(c: ToplamCtx): Promise<void> {
  console.log("§16 basılı toplam satırı birincil (0248 ML Kit yan tarama)");
  const { id: _id, ...tpl } = mlkitSablon(true) as unknown as Record<string, unknown>;
  const cr = await c.createTemplate(`${c.tag} ML Kit çeki`, tpl);
  const code = String(cr.data?.code ?? "");
  c.check("§16 kullanıcı şablonu (toplam satırı 'T.Adet 5') 201", cr.status === 201 && code.startsWith("u-"), `${cr.status} ${cr.code ?? ""}`);
  try {
    const built = await buildDraft(c.ocr, undefined, { bumpHit: false });
    const id = await c.emptyNote();
    const scan = await c.addScan(id, { ocr: c.ocr }, 1);
    await prisma.$transaction((tx) => fillBoundDraftTx(tx, id, { id: scan, pageNo: 1 }, built));
    const r = await c.parties(id);
    const ps = ((r.data?.parties ?? []) as PartyView[]).map((p) => `${p.batchNo}:${p.lineCount}:${p.suggestedMeters}/${p.suggestedMetersSource}:${p.suggestedKg}/${p.kgSource}`);
    c.check("§16a ⭐ /partiler: P9918733 = 5 top · 586 m · 141,7 kg; P9918734 = 16 top · 3935 m · 819,2 kg (kaynak basılı TOPLAM)",
      built.firstTemplate === code && ps.join(" | ") === "P9918733:5:586/TOTAL:141.7/TOTAL | P9918734:16:3935/TOTAL:819.2/TOTAL", JSON.stringify({ t: built.firstTemplate, ps }));
    const w = [...((built.warnings ?? []) as string[]), ...((r.data?.parties ?? []) as PartyView[]).flatMap((p) => p.warnings)];
    c.check("§16b teyit tutar: okuma/parti uyarısı yok (TOTAL_/PARTİ TOPLAMI/TABLE_TOTALS/TABLE_ROWS_SKIPPED)",
      !w.some((x) => /^(TOTAL_|SECTION_SUBTOTAL|TABLE_TOTALS|TABLE_ROWS_SKIPPED)/.test(x)) && w.every((x) => !/ara toplam/.test(x)), JSON.stringify(w));
  } finally {
    // Sonraki bölümlerin sınıflandırmasına karışmasın
    if (code) await c.deactivate(code);
  }
}
