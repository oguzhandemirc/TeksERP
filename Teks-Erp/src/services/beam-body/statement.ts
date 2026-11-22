// =============================================================================
// LEVENT GÖVDESİ — devereci mutabakatı ("sizdeki gövdelerimiz", devere S6)
// =============================================================================
// İki liste: deverecideki gövdeler (AT_SUBCONTRACTOR + FULL_OUT, sahibiyle, bu durumda kaç gün) ve son N günün
// giden/dönen hareketleri. Hepsi defterden türetilir: geri alınmış çift (ileri + `_CANCEL`) hareket sayılmaz, yer
// zinciri her satırın SONUÇ yerinden yürür. Basılı belge kaynağı Subcontractor; "Mutabakat bas" içerik değiştiyse
// yeni sürüm dondurur (sürüm geçmişi = gönderilen mutabakatlar). Gövde kipi OFF → 403 BEAM_BODY_MODE_OFF.
// =============================================================================
import { BeamBodyStatus, Prisma, PrintedDocStatus, PrintedDocType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { BEAM_BODY_EVENT_LABELS, BEAM_BODY_OWNER_LABELS, type BeamBodyForwardKind } from "../../constants/beam-body";
import { assertBeamBodyEnabled } from "../helpers/beam-body.helper";
import { factoryYmd } from "../../constants/time";
import { fasonDayThreshold } from "../helpers/order-where.helper";
import { beamBodyStatusAges, toStatusAge } from "../helpers/status-age.helper";
import {
  renderBeamBodyStatementHtml, renderBeamBodyStatementTables,
  type BeamBodyStatementBody, type BeamBodyStatementDoc, type BeamBodyStatementMove,
} from "../document-render/beam-body-statement.html";
import { jsonEqual, printedDocumentService, registerPrintedDocBuilder, type BuiltDocContent, type PrintedDocDb } from "../printed-document.service";

/** Hareket dönemi (fabrika günü, bugün dahil). */
export const BEAM_BODY_STATEMENT_PERIOD_DAYS = 30;
/** Deverecide sayılan durumlar — boş/sarılıyor ya da dolu (ret dönüşü). */
export const BEAM_BODY_AT_SUBCONTRACTOR_STATUSES = [BeamBodyStatus.AT_SUBCONTRACTOR, BeamBodyStatus.FULL_OUT] as const;
const AUTO_REISSUE_REASON = "Mutabakat güncellendi";
const DOC_TYPE = PrintedDocType.BEAM_BODY_STATEMENT;

const isEffective = (e: { kind: string; reversal: { id: string } | null }) => !e.kind.endsWith("_CANCEL") && e.reversal === null;

async function collectMoves(db: PrintedDocDb, subcontractorId: string, from: Date): Promise<BeamBodyStatementMove[]> {
  // Adaylar: bu deverecide hiç bulunmuş VE dönemde olayı olan gövdeler; zincir için bütün geçmişleri okunur.
  const bodies = await db.beamBody.findMany({
    where: { AND: [{ events: { some: { subcontractorId } } }, { events: { some: { createdAt: { gte: from } } } }] },
    select: { id: true },
  });
  if (bodies.length === 0) return [];
  const events = await db.beamBodyEvent.findMany({
    where: { bodyId: { in: bodies.map((b) => b.id) } },
    orderBy: [{ bodyId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      bodyId: true, kind: true, createdAt: true, subcontractorId: true, reversal: { select: { id: true } },
      body: { select: { bodyNo: true } },
      subcontractorDispatch: { select: { dispatchNo: true } },
      returnItem: { select: { beamReturn: { select: { docNo: true } } } },
      warpBeam: { select: { beamNo: true } },
    },
  });
  const out: Omit<BeamBodyStatementMove, "seq">[] = [];
  let body: string | null = null;
  let prevSub: string | null = null;
  for (const e of events) {
    if (e.bodyId !== body) {
      body = e.bodyId;
      prevSub = null;
    }
    const here = e.subcontractorId === subcontractorId;
    const before = prevSub === subcontractorId;
    if (e.createdAt >= from && isEffective(e) && e.kind !== "REGISTER" && here !== before) {
      out.push({
        at: e.createdAt.toISOString(), bodyNo: e.body.bodyNo, direction: here ? "SENT" : "RETURNED",
        kindLabel: BEAM_BODY_EVENT_LABELS[e.kind as BeamBodyForwardKind] ?? e.kind,
        documentNo: e.subcontractorDispatch?.dispatchNo ?? e.returnItem?.beamReturn.docNo ?? e.warpBeam?.beamNo ?? null,
      });
    }
    prevSub = e.subcontractorId;
  }
  out.sort((a, b) => a.at.localeCompare(b.at) || a.bodyNo.localeCompare(b.bodyNo));
  return out.map((m, i) => ({ seq: i + 1, ...m }));
}

/** Mutabakat içeriği — JSON ucu ve basılı belge AYNI fonksiyondan (tek kaynak). */
export async function buildBeamBodyStatement(db: PrintedDocDb, subcontractorId: string, now: Date = new Date()): Promise<BeamBodyStatementDoc> {
  await assertBeamBodyEnabled(db);
  const sub = await db.subcontractor.findUnique({ where: { id: subcontractorId }, select: { code: true, name: true } });
  if (!sub) throw AppError.notFound("Fason firma bulunamadı.", { code: "SUBCONTRACTOR_NOT_FOUND" });
  const rows = await db.beamBody.findMany({
    where: { subcontractorId, status: { in: [...BEAM_BODY_AT_SUBCONTRACTOR_STATUSES] } },
    orderBy: [{ bodyNo: "asc" }],
    select: {
      id: true, bodyNo: true, status: true, ownerRole: true, notes: true, createdAt: true,
      ownerCustomer: { select: { name: true } }, currentWarpBeam: { select: { beamNo: true } },
    },
  });
  // "Kaç gündür orada" — liste yaşıyla aynı tek kaynak (status-age helper, S4).
  const ages = await beamBodyStatusAges(db, rows, now);
  const bodies: BeamBodyStatementBody[] = rows.map((r, i) => {
    const age = ages.get(r.id) ?? toStatusAge(r.createdAt, now);
    const full = r.status === BeamBodyStatus.FULL_OUT;
    return {
      seq: i + 1, bodyNo: r.bodyNo,
      stateText: full ? `Dolu${r.currentWarpBeam ? ` — ${r.currentWarpBeam.beamNo}` : ""}` : "Boş",
      ownerText: r.ownerCustomer?.name ?? BEAM_BODY_OWNER_LABELS.OURS,
      sinceAt: age.statusSince.toISOString(), ageDays: age.statusAgeDays, notes: r.notes,
    };
  });
  const from = fasonDayThreshold(BEAM_BODY_STATEMENT_PERIOD_DAYS - 1, now);
  const moves = await collectMoves(db, subcontractorId, from);
  const ours = rows.filter((r) => r.ownerCustomer === null).length;
  return {
    header: {
      documentNo: sub.code, subcontractorName: sub.name, subcontractorCode: sub.code,
      asOf: now.toISOString(), periodFrom: from.toISOString(), periodDays: BEAM_BODY_STATEMENT_PERIOD_DAYS,
    },
    bodies,
    moves,
    totals: {
      bodies: rows.length, ours, others: rows.length - ours, full: rows.filter((r) => r.status === BeamBodyStatus.FULL_OUT).length,
      sent: moves.filter((m) => m.direction === "SENT").length, returned: moves.filter((m) => m.direction === "RETURNED").length,
    },
  };
}

/** JSON ucu (`GET /api/beam-bodies/statement`) — yazmaz. */
export function getBeamBodyStatement(subcontractorId: string): Promise<BeamBodyStatementDoc> {
  return buildBeamBodyStatement(prisma, subcontractorId);
}

async function statementContent(db: PrintedDocDb, subcontractorId: string): Promise<BuiltDocContent> {
  const doc = await buildBeamBodyStatement(db, subcontractorId);
  return { documentNo: doc.header.documentNo, doc: doc as unknown as Record<string, unknown> };
}

registerPrintedDocBuilder(DOC_TYPE, {
  fresh: statementContent,
  freeze: statementContent,
  buildPreview: statementContent,
  renderHtml: renderBeamBodyStatementHtml,
  renderTables: renderBeamBodyStatementTables,
});

/** Karşılaştırmada an damgası düşer: aynı gün, aynı içerik = aynı mutabakat (gereksiz sürüm doğmaz). */
const comparable = (doc: unknown) => {
  const d = doc as BeamBodyStatementDoc;
  return { ...d, header: { ...d.header, asOf: factoryYmd(new Date(d.header.asOf)) } };
};

/**
 * "Mutabakat bas": güncel içerik son sürümden farklıysa yeni sürüm dondurur (ilk basımda v1), aynıysa son sürümü
 * döndürür. Belge hiçbir deftere yazmaz; sürüm geçmişi devereciye ne gönderildiğinin izidir.
 */
export async function printBeamBodyStatement(subcontractorId: string, userId: string): Promise<{ version: number; documentNo: string; created: boolean }> {
  const fresh = await buildBeamBodyStatement(prisma, subcontractorId);
  const latest = await prisma.printedDocument.findFirst({
    where: { docType: DOC_TYPE, sourceId: subcontractorId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, documentNo: true, snapshot: true },
  });
  const latestDoc = (latest?.snapshot as { doc?: unknown } | null)?.doc;
  if (latest && latest.status === PrintedDocStatus.ACTIVE && latestDoc && jsonEqual(comparable(latestDoc), comparable(fresh))) {
    return { version: latest.version, documentNo: latest.documentNo, created: false };
  }
  let created: { id: string; version: number; documentNo: string } | null;
  try {
    created = await prisma.$transaction(async (tx) => {
      const reissued = latest ? await printedDocumentService.reissueForSourceTx(tx, DOC_TYPE, subcontractorId, AUTO_REISSUE_REASON, userId) : false;
      if (!reissued) await printedDocumentService.freezeForSource(tx, DOC_TYPE, subcontractorId, userId);
      return tx.printedDocument.findFirst({ where: { docType: DOC_TYPE, sourceId: subcontractorId }, orderBy: { version: "desc" }, select: { id: true, version: true, documentNo: true } });
    });
  } catch (err) {
    // Eşzamanlı iki basım aynı sürümü dondurmaya çalışırsa unique (docType, sourceId, version) ikincisini düşürür.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw AppError.conflict("Mutabakat aynı anda başka biri tarafından basıldı — tekrar deneyin.", { code: "BEAM_BODY_STATEMENT_RACE" });
    throw err;
  }
  if (!created) throw AppError.internal("Mutabakat dondurulamadı.");
  await AuditService.log({
    userId, action: "CREATE", tableName: "PRINTED_DOCUMENT", recordId: created.id,
    newData: { docType: DOC_TYPE, sourceId: subcontractorId, documentNo: created.documentNo, version: created.version,
      // Olay literal yazılır: anlatı kapsama taraması (`test_audit_anlati` §5) çifti böyle görür.
      ...(latest ? { event: "REISSUE", reason: AUTO_REISSUE_REASON } : { event: "FREEZE", reason: null }) },
  });
  return { version: created.version, documentNo: created.documentNo, created: true };
}
