// =============================================================================
// GELEN BELGE — aynı gönderen belge no + aynı fotoğraf (Gülkesim K27, fabrika cevabı 2026-11-03)
// =============================================================================
// Boyahane belge no'yu yeniden kullanabilir; bizim görünmeyen kimliğimiz GB no'dur. Kural fabrika ayarıdır
// (`gelenBelge.duplicateDocNo`): BLOCK (varsayılan = bugünkü) (sahip, belge no) iptal dışı TEK belge · WARN işi süren eş
// varken onay 409 + operatör onayıyla geçer · ALLOW serbest. DB partial UNIQUE kalktı (WARN/ALLOW'da meşru eş olur):
// BLOCK tekilliği 8044 advisory kilidi (tx'in İLK ifadesi) + tx sonunda satırın GERÇEK çiftiyle kontrol.
// "Belgenin işi sürüyor mu" TEK tanımı `NOTE_WORK_ONGOING_WHERE` (onay kapısı · taslak şeridi · tarama yeniden kullanımı ·
// istasyon eşlemesi aynı parçayı okur). sha256 UNIQUE de kalktı: aynı bayt 8045 kilidi altında en yeni kayda bakar.
// Aynı (sahip, müşteri parti no) `gelenBelge.duplicateBatchNo` (ALLOW varsayılan = bugünkü · WARN · BLOCK): aynı kâğıdın
// farklı fotoğrafla yeniden okutulması (belge no boş okununca K27 görmez). Kapı onay claim tx'inde, 8046 kilidi altında koşar
// (özet/parti satırları aynı tx'te yazılır) → eşzamanlı iki onay aynı partiyi geçiremez.
// =============================================================================
import { DeliveryNoteStatus, type Prisma, WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { foldCodeForCompare } from "../../utils/code-format";
import { NO_LIVE_MATERIAL_STATUSES } from "../batch.service";
import { readDuplicateDocNoMode, type DuplicateBatchNoMode, type DuplicateDocNoMode } from "../system-setting.service";
import { whereWorkOrdersOfRolls } from "./workorder-rolls.helper";

/** (sahip, gönderen belge no) BLOCK tekilliği — anahtar `hashtext(senderDocNo)`. Envanter: `period-guard.helper.ts` — **8044**. */
export const DELIVERY_DOC_NO_LOCK_NS: number = 8044;
/** Aynı baytın (sha256) eşzamanlı yüklemesi tek kayıt doğurur — anahtar `hashtext(sha256)`. Envanter: **8045**. */
export const DOCUMENT_SCAN_SHA_LOCK_NS: number = 8045;
/** (sahip, katlı müşteri parti no) onay kapısı — anahtar `hashtext(sahip:anahtar)`. Envanter: **8046**. */
export const DELIVERY_BATCH_NO_LOCK_NS: number = 8046;

type Tx = Prisma.TransactionClient;
type Reader = Pick<typeof prisma, "customerDeliveryNote" | "workOrder">;

// Canlı top: "iş kaldı mı" kümesinin (NO_LIVE_MATERIAL_STATUSES = K18 + sevk + fire) dışında. Tambur/fason çocukları
// partiyi (batchId) kalıtır → belgenin topu tüketilmiş olsa da partisinde canlı top varsa iş sürer.
const LIVE_ROLL: Prisma.RollWhereInput = { status: { notIn: NO_LIVE_MATERIAL_STATUSES } };

/**
 * İşi süren belge — TEK tanım: iptal değil VE (onaylı değil YA DA topu/partisi canlı). Topsuz taslak = sürüyor;
 * bütün topları sevk/fire/tüketilmiş onaylı belge = bitti.
 */
export const NOTE_WORK_ONGOING_WHERE: Prisma.CustomerDeliveryNoteWhereInput = {
  OR: [
    { status: { notIn: [DeliveryNoteStatus.APPROVED, DeliveryNoteStatus.CANCELLED] } },
    { status: DeliveryNoteStatus.APPROVED, lines: { some: { roll: { OR: [LIVE_ROLL, { batch: { rolls: { some: LIVE_ROLL } } }] } } } },
  ],
};

const nonEmpty = (v: string | null | undefined): v is string => typeof v === "string" && v.length > 0;

/** 8044 kilidi — çağıran tx'in İLK ifadesi; yalnız BLOCK kipinde. Çok anahtar sıralı alınır (deadlock yok). */
export async function lockDocNosTx(tx: Tx, mode: DuplicateDocNoMode, docNos: ReadonlyArray<string | null | undefined>): Promise<void> {
  if (mode !== "BLOCK") return;
  for (const k of [...new Set(docNos.filter(nonEmpty))].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELIVERY_DOC_NO_LOCK_NS}::int, hashtext(${k}))`;
  }
}

export function duplicateDocNoError(): AppError {
  return AppError.conflict("Bu sahip için aynı gönderen belge numarasıyla açık bir taslak/belge zaten var.", { code: "DELIVERY_NOTE_DUPLICATE_DOC_NO" });
}

/**
 * BLOCK: yazımdan SONRA satırın gerçek (sahip, belge no) çifti iptal dışı tek mi. Kilit alınmamış anahtar (arada başka
 * yazar belge no'yu değiştirdi) → 409 DELIVERY_NOTE_CHANGED; kip BLOCK değilse no-op.
 */
export async function assertDocNoUniqueTx(tx: Tx, noteId: string, mode: DuplicateDocNoMode, lockedDocNos: ReadonlyArray<string | null | undefined>): Promise<void> {
  if (mode !== "BLOCK") return;
  const row = await tx.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { ownerCustomerId: true, senderDocNo: true, status: true } });
  if (!row?.ownerCustomerId || !row.senderDocNo || row.status === DeliveryNoteStatus.CANCELLED) return;
  if (!lockedDocNos.includes(row.senderDocNo)) {
    throw AppError.conflict("Belge bu arada değişti; yenileyip yeniden deneyin.", { code: "DELIVERY_NOTE_CHANGED" });
  }
  const other = await tx.customerDeliveryNote.findFirst({
    where: { id: { not: noteId }, ownerCustomerId: row.ownerCustomerId, senderDocNo: row.senderDocNo, status: { not: DeliveryNoteStatus.CANCELLED } },
    select: { id: true },
  });
  if (other) throw duplicateDocNoError();
}

export interface DocNoPeer {
  id: string;
  noteNo: string;
  status: DeliveryNoteStatus;
  /** Eşin toplarının iptal dışı iş emirleri (en çok 3). */
  workOrderNumbers: string[];
}

type PairNote = { id: string; ownerCustomerId: string | null; senderDocNo: string | null };

/** Aynı (sahip, belge no) ile İŞİ SÜREN diğer belgeler (en yeni önce, en çok 5). */
export async function activeDocNoPeers(note: PairNote, client: Reader = prisma): Promise<DocNoPeer[]> {
  if (!note.ownerCustomerId || !note.senderDocNo) return [];
  const rows = await client.customerDeliveryNote.findMany({
    where: { AND: [{ id: { not: note.id }, ownerCustomerId: note.ownerCustomerId, senderDocNo: note.senderDocNo }, NOTE_WORK_ONGOING_WHERE] },
    select: { id: true, noteNo: true, status: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 5,
  });
  const out: DocNoPeer[] = [];
  for (const r of rows) {
    const wos = await client.workOrder.findMany({
      where: { AND: [whereWorkOrdersOfRolls({ deliveryNoteLine: { noteId: r.id } }), { status: { not: WorkOrderStatus.CANCELLED } }] },
      select: { workOrderNumber: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 3,
    });
    out.push({ ...r, workOrderNumbers: wos.map((w) => w.workOrderNumber) });
  }
  return out;
}

/**
 * Onay kapısı (ön kontrol, DB yazmaz). BLOCK: iptal dışı eş → 409 DUPLICATE_DOC_NO (onay bayrağı yok sayılmaz);
 * WARN: işi süren eş + bayraksız → 409 DUPLICATE_DOC_NO_ACTIVE (details.peers), bayrakla uyarı satırı; ALLOW: hiçbir şey.
 */
export async function duplicateDocNoApprovalGate(note: PairNote & { noteNo: string }, confirmed: boolean | undefined): Promise<{ warnings: string[]; confirmedPeers: string[] }> {
  const none = { warnings: [], confirmedPeers: [] };
  if (!note.ownerCustomerId || !note.senderDocNo) return none;
  const mode = await readDuplicateDocNoMode();
  if (mode === "ALLOW") return none;
  if (mode === "BLOCK") {
    const other = await prisma.customerDeliveryNote.findFirst({
      where: { id: { not: note.id }, ownerCustomerId: note.ownerCustomerId, senderDocNo: note.senderDocNo, status: { not: DeliveryNoteStatus.CANCELLED } },
      select: { id: true },
    });
    if (other) throw duplicateDocNoError();
    return none;
  }
  const peers = await activeDocNoPeers(note);
  if (peers.length === 0) return none;
  const nos = peers.map((p) => p.noteNo).join(", ");
  if (!confirmed) {
    throw AppError.conflict(`Bu belge no ${nos} olarak zaten kayıtlı (iş sürüyor). Aynı kâğıdı ikinci kez mi okutuyorsunuz?`, {
      code: "DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE", senderDocNo: note.senderDocNo, peers,
    });
  }
  return { warnings: [`${note.noteNo}: aynı belge no (${note.senderDocNo}) işi süren ${nos} varken operatör onayıyla kaydedildi.`], confirmedPeers: peers.map((p) => p.noteNo) };
}

/** Taslak detayı bilgi şeridi: yalnız WARN kipinde, DRAFT belgede, işi süren eş varsa. Eski istemci alanı yok sayar. */
export async function duplicateDocNoNotice(note: PairNote & { status: DeliveryNoteStatus }): Promise<{ senderDocNo: string; peers: DocNoPeer[] } | null> {
  if (note.status !== DeliveryNoteStatus.DRAFT || !note.ownerCustomerId || !note.senderDocNo) return null;
  if ((await readDuplicateDocNoMode()) !== "WARN") return null;
  const peers = await activeDocNoPeers(note);
  return peers.length ? { senderDocNo: note.senderDocNo, peers } : null;
}

// ── Aynı müşteri parti no ────────────────────────────────────────────────────

/** Parti no karşılaştırma anahtarı: kod katlaması (i/İ, büyük harf) + bütün boşluklar atılır; boş → null. */
export function batchNoFoldKey(v: string | null | undefined): string | null {
  const k = v ? foldCodeForCompare(v).replace(/\s+/g, "") : "";
  return k.length > 0 ? k : null;
}

export interface BatchNoPeer {
  id: string;
  noteNo: string;
  status: DeliveryNoteStatus;
  /** Eşte yazılı biçimiyle (katlanmamış) parti no. */
  customerBatchNo: string;
  /** İlk iptal dışı iş emri (yoksa null) — tablet "parti → İE" satırı. */
  workOrderNumber: string | null;
  workOrderNumbers: string[];
}

/**
 * Aynı sahipte, verilen parti no'lardan birini başlıkta ya da özet/parti satırında taşıyan İŞİ SÜREN diğer belgeler
 * (en yeni önce, en çok 5). Belgenin kendisi (çok partinin kardeş satırları) sayılmaz; iptal belge sürmez.
 */
export async function activeBatchNoPeers(note: { id: string; ownerCustomerId: string | null }, batchNos: ReadonlyArray<string | null | undefined>, client: Reader = prisma): Promise<BatchNoPeer[]> {
  const keys = new Set(batchNos.map(batchNoFoldKey).filter((k): k is string => k !== null));
  if (!note.ownerCustomerId || keys.size === 0) return [];
  // Katlama ifadesi Prisma süzgecinde yazılamaz: sahibin işi süren, parti no taşıyan belgeleri okunur, eşleme bellekte.
  const rows = await client.customerDeliveryNote.findMany({
    where: { AND: [{ id: { not: note.id }, ownerCustomerId: note.ownerCustomerId }, NOTE_WORK_ONGOING_WHERE, { OR: [{ customerBatchNo: { not: null } }, { lines: { some: { customerBatchNo: { not: null } } } }] }] },
    select: { id: true, noteNo: true, status: true, customerBatchNo: true, lines: { where: { customerBatchNo: { not: null } }, select: { id: true, customerBatchNo: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
  const out: BatchNoPeer[] = [];
  for (const r of rows) {
    if (out.length >= 5) break;
    const headerHit = keys.has(batchNoFoldKey(r.customerBatchNo) ?? "");
    const lineHits = r.lines.filter((l) => keys.has(batchNoFoldKey(l.customerBatchNo) ?? ""));
    if (!headerHit && lineHits.length === 0) continue;
    // Başlık eşleşirse belgenin bütün topları, yalnız satır eşleşirse o satırların topları.
    const rollWhere: Prisma.RollWhereInput = headerHit ? { deliveryNoteLine: { noteId: r.id } } : { deliveryNoteLine: { id: { in: lineHits.map((l) => l.id) } } };
    const wos = await client.workOrder.findMany({
      where: { AND: [whereWorkOrdersOfRolls(rollWhere), { status: { not: WorkOrderStatus.CANCELLED } }] },
      select: { workOrderNumber: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 3,
    });
    const nos = wos.map((w) => w.workOrderNumber);
    const shown = (headerHit ? r.customerBatchNo : lineHits[0]!.customerBatchNo)!.trim();
    out.push({ id: r.id, noteNo: r.noteNo, status: r.status, customerBatchNo: shown, workOrderNumber: nos[0] ?? null, workOrderNumbers: nos });
  }
  return out;
}

const peerText = (peers: ReadonlyArray<BatchNoPeer>): string =>
  peers.map((p) => `${p.customerBatchNo} → ${p.workOrderNumber ?? p.noteNo}`).join(", ");

/** 8046 kilidi — onay claim tx'inin İLK ifadesi; anahtarlar katlı ve sıralı (çok parti deadlock'suz). */
async function lockBatchNosTx(tx: Tx, ownerCustomerId: string, batchNos: ReadonlyArray<string | null | undefined>): Promise<void> {
  for (const k of [...new Set(batchNos.map(batchNoFoldKey).filter(nonEmpty))].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DELIVERY_BATCH_NO_LOCK_NS}::int, hashtext(${`${ownerCustomerId}:${k}`}))`;
  }
}

/**
 * Onay kapısı — claim tx'inde (`mode` tx DIŞINDA okunur). ALLOW: kilit/sorgu yok (bugünkü). Diğerinde İLK ifade 8046 kilidi,
 * eşler aynı tx'te okunur. BLOCK: işi süren eş → 409 DUPLICATE_BATCH_NO (bayrak yok sayılır); WARN: bayraksız → 409 ..._ACTIVE.
 */
export async function duplicateBatchNoGateTx(tx: Tx, note: { id: string; noteNo: string; ownerCustomerId: string | null }, batchNos: ReadonlyArray<string | null | undefined>, { mode, confirmed }: { mode: DuplicateBatchNoMode; confirmed: boolean | undefined }): Promise<{ warnings: string[]; confirmedPeers: string[] }> {
  const none = { warnings: [], confirmedPeers: [] };
  if (!note.ownerCustomerId || mode === "ALLOW") return none;
  await lockBatchNosTx(tx, note.ownerCustomerId, batchNos);
  const peers = await activeBatchNoPeers(note, batchNos, tx);
  if (peers.length === 0) return none;
  const text = peerText(peers);
  if (mode === "BLOCK") {
    throw AppError.conflict(`Bu müşteri parti no işi süren başka kayıtta var (${text}). Aynı parti ikinci kez açılamaz.`, { code: "DELIVERY_NOTE_DUPLICATE_BATCH_NO", peers });
  }
  if (!confirmed) {
    throw AppError.conflict(`Bu müşteri parti no işi süren başka kayıtta var (${text}). Aynı kâğıdı ikinci kez mi okutuyorsunuz?`, { code: "DELIVERY_NOTE_DUPLICATE_BATCH_NO_ACTIVE", peers });
  }
  return { warnings: [`${note.noteNo}: aynı müşteri parti no işi süren kayıt varken (${text}) operatör onayıyla kaydedildi.`], confirmedPeers: peers.map((p) => p.noteNo) };
}

// ── Aynı fotoğraf (sha256) ───────────────────────────────────────────────────

/** 8045 kilidi — yükleme tx'inin İLK ifadesi. */
export async function lockScanShaTx(tx: Tx, sha256: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DOCUMENT_SCAN_SHA_LOCK_NS}::int, hashtext(${sha256}))`;
}

/** Aynı baytın EN YENİ taraması — `sha256` okuyan her yer buradan (UNIQUE kalktı; eşitlik bozucu id). */
export function latestScanBySha<S extends Prisma.DocumentScanSelect>(client: Pick<typeof prisma, "documentScan">, sha256: string, select: S) {
  return client.documentScan.findFirst({ where: { sha256 }, select, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

/**
 * Aynı bayt YENİ tarama mı doğurur: BLOCK'ta hiç (bugünkü: yeniden kullan / 409); WARN/ALLOW'da en yeni kaydın belgesi
 * bitmişse (iptal ya da onaylı + canlı top yok) evet — eski belge fotoğrafını korur. Serbest kayıt ya da işi süren belge → hayır.
 */
export async function scanNeedsFreshRecord(tx: Tx, scan: { noteId: string | null }, mode: DuplicateDocNoMode): Promise<boolean> {
  if (mode === "BLOCK" || !scan.noteId) return false;
  return (await tx.customerDeliveryNote.count({ where: { AND: [{ id: scan.noteId }, NOTE_WORK_ONGOING_WHERE] } })) === 0;
}
