// =============================================================================
// İSTASYONDA BELGE OKUT — doğrulama uygulaması (2026-11-06): aday İE'ler puanlanır, eşiği geçemeyen OTOMATİK AÇILMAZ
// =============================================================================
// `workOrders` YALNIZ eşiği geçenleri taşır — eski tablet (alanı bilmeyen) düşük puanlı İE'yi asla kendiliğinden
// açamaz; geçemeyenler `unverifiedWorkOrders`ta (yeni tablet "Emin değilim" listesi + görevli onayı). Puan saf
// `station-scan-score.helper`dan; karşılaştırılan kayıt: İE'ye top vermiş canlı belgelerin TÜM top satırları + başlığı.
// =============================================================================
import { DeliveryNoteLineKind } from "@prisma/client";
import prisma from "../../lib/prisma";
import { TERIM } from "../../constants/terim";
import type { DraftHeader, DraftLine } from "../../lib/gelen-belge/taslak";
import { readStationVerifyThreshold } from "../system-setting.service";
import { recordStationScanCheck, type ScanCheckDecision } from "../station-scan-check.service";
import { whereRollsOfWorkOrder } from "./workorder-rolls.helper";
import { LOOKUP_NOTE_STATUSES } from "./workorder-doc-search.helper";
import type { StationLookupWorkOrder } from "./station-lookup-rows.helper";
import {
  isScanVerified, scoreScan, type ScanEvidence, type TargetRecord, type VerifyComponentKey, type WorkOrderVerification,
} from "./station-scan-score.helper";

/** Fotoğraf yolunun doldurduğu kanıt; `key` adayı bulduran alan (parti no ile bulunan aday parti no'yla doğrulanmaz). */
export interface ScanVerifySink {
  evidence?: ScanEvidence;
  key?: "DOC_NO" | "BATCH_NO";
  readDocNo?: string | null;
}

/** Doğrulamanın taşıyacağı sonuç alanları (servis sonucuna yayılır). */
export interface VerifiedLookup {
  workOrders: StationLookupWorkOrder[];
  unverifiedWorkOrders: StationLookupWorkOrder[];
  /** `bestStrong`: en yüksek puanlı adayda top listesi karşılaştırılabildi mi (değilse "doğrulanamadı" denir). */
  verification: { threshold: number; bestScore: number | null; bestStrong: boolean };
  checkId: string | null;
}

const DAY = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const meter = (v: string | number | { toString(): string }): number => Number(String(v).replace(",", "."));

/** Okunan başlık + satırlar → kanıt (yalnız TOP satırları; araba satırı top değildir). */
export function scanEvidenceOf(header: DraftHeader, lines: DraftLine[], batchNos: string[]): ScanEvidence {
  const tops = lines.filter((l) => l.lineKind === "TOP");
  return {
    rollNos: tops.map((l) => l.senderRollNo?.trim() ?? "").filter(Boolean),
    meters: tops.map((l) => meter(l.meters)).filter((m) => Number.isFinite(m) && m > 0),
    rollCount: header.declaredTopCount ?? (tops.length > 0 ? tops.length : null),
    batchNos,
    orderNo: header.customerOrderNo?.trim() || null,
    ownerText: header.ownerText?.trim() || null,
    senderText: header.senderText?.trim() || null,
    docDay: DAY(header.senderDocDate),
  };
}

const NOTE_TARGET_SELECT = {
  id: true, customerBatchNo: true, ourBatchNo: true, customerOrderNo: true, ownerText: true, senderText: true, senderDocDate: true,
  ownerCustomer: { select: { name: true } }, senderCustomer: { select: { name: true } },
  lines: { where: { lineKind: DeliveryNoteLineKind.TOP }, select: { senderRollNo: true, meters: true }, take: 1000 },
} as const;

/** İE'nin karşılaştırma kaydı: top vermiş canlı belgeler (eşleşen belge kümesiyle kesişim varsa yalnız o) + İE partileri. */
async function targetOf(w: StationLookupWorkOrder, noteIds: string[]): Promise<{ record: TargetRecord; key: string }> {
  const all = await prisma.customerDeliveryNote.findMany({
    where: { status: { in: [...LOOKUP_NOTE_STATUSES] }, lines: { some: { roll: whereRollsOfWorkOrder(w.id) } } },
    select: NOTE_TARGET_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 20,
  });
  const narrowed = all.filter((n) => noteIds.includes(n.id));
  const notes = narrowed.length > 0 ? narrowed : all;
  const names = (a: Array<string | null | undefined>) => a.filter((v): v is string => !!v && v.trim().length > 0);
  const record: TargetRecord = {
    rollNos: notes.flatMap((n) => n.lines.map((l) => l.senderRollNo ?? "")).filter(Boolean),
    meters: notes.flatMap((n) => n.lines.map((l) => meter(l.meters))),
    batchNos: names([...w.batchNumbers, ...notes.flatMap((n) => [n.customerBatchNo, n.ourBatchNo])]),
    orderNos: names(notes.map((n) => n.customerOrderNo)),
    ownerNames: names(notes.flatMap((n) => [n.ownerText, n.ownerCustomer?.name])),
    senderNames: names(notes.flatMap((n) => [n.senderText, n.senderCustomer?.name])),
    docDays: names(notes.map((n) => DAY(n.senderDocDate))),
  };
  return { record, key: notes.length > 0 ? notes.map((n) => n.id).sort().join(",") : `wo:${w.id}` };
}

/** Her adayı puanla; `passed` TEK yüklemden (`isScanVerified`). */
async function scoreWorkOrders(wos: StationLookupWorkOrder[], sink: ScanVerifySink, noteIds: string[], threshold: number): Promise<StationLookupWorkOrder[]> {
  const exclude: VerifyComponentKey[] = sink.key === "BATCH_NO" ? ["BATCH_NO"] : [];
  const out: StationLookupWorkOrder[] = [];
  for (const w of wos) {
    const t = await targetOf(w, noteIds);
    const s = scoreScan(sink.evidence!, t.record, exclude);
    const verification: WorkOrderVerification = { ...s, threshold, passed: isScanVerified(s, threshold), targetKey: t.key };
    out.push({ ...w, verification });
  }
  return out;
}

function decisionOf(threshold: number, candidates: number, verified: number): ScanCheckDecision {
  if (threshold <= 0) return "OFF";
  if (candidates === 0) return "NONE";
  return verified > 0 ? "VERIFIED" : "UNSURE";
}

/** Eşik altı sonuç cümlesi — sade Türkçe; puan yoksa nedenini söyler. */
export function unverifiedMessage(best: number | null, strong: boolean): string {
  if (best === null || !strong) return "Belge doğrulanamadı (top listesi okunamadı) — listeden seçin ya da fiş no ile elle arayın.";
  return `Belge tam eşleşmedi (%${best}) — listeden seçin ya da fiş no ile elle arayın.`;
}

/** Eşiği geçen adaylarla sonuç cümlesi; iki farklı belge geçtiyse seçtirir. */
export function verifiedMessage(verified: StationLookupWorkOrder[]): string | null {
  const targets = new Set(verified.map((w) => w.verification?.targetKey ?? w.id));
  if (targets.size > 1) return `${targets.size} farklı belge eşleşti; açılacak ${TERIM.terbiyeIsEmri.tekilKucuk} seçin.`;
  return null;
}

/**
 * Fotoğraf okutmasının adaylarını doğrular ve izini yazar. Kanıt yoksa (okunamadı / aynı fotoğraf) yalnız iz yazılır;
 * aynı fotoğraf (`SAME_PHOTO`) kimliktir, puanlanmaz.
 */
export async function verifyScanCandidates(
  input: { workOrders: StationLookupWorkOrder[]; noteIds: string[]; source: string; screen: string | null },
  sink: ScanVerifySink,
): Promise<VerifiedLookup> {
  const threshold = await readStationVerifyThreshold();
  const scored = sink.evidence && input.workOrders.length > 0 ? await scoreWorkOrders(input.workOrders, sink, input.noteIds, threshold) : input.workOrders;
  const verified = scored.filter((w) => !w.verification || w.verification.passed);
  const unverified = scored.filter((w) => w.verification && !w.verification.passed);
  const best = scored.reduce<StationLookupWorkOrder | null>((b, w) => ((w.verification?.score ?? -1) > (b?.verification?.score ?? -1) ? w : b), null);
  const bestScore = best?.verification?.score ?? null;
  const checkId = await recordStationScanCheck({
    screen: input.screen, source: input.source, readDocNo: sink.readDocNo ?? null, readBatchNo: sink.evidence?.batchNos[0] ?? null,
    threshold, bestScore, candidateCount: scored.length, verifiedCount: verified.length,
    decision: sink.evidence ? decisionOf(threshold, scored.length, verified.length) : scored.length > 0 ? "SAME_PHOTO" : "NONE",
    components: best?.verification?.components ?? null, bestWorkOrderNumber: best?.workOrderNumber ?? null,
  });
  const bestStrong = best?.verification?.strongEvidence ?? false;
  return { workOrders: verified, unverifiedWorkOrders: unverified, verification: { threshold, bestScore, bestStrong }, checkId };
}
