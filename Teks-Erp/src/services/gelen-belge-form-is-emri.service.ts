// =============================================================================
// GELEN BELGE → İŞ EMRİ TEK İSTEKTE (Gülkesim OIE, sözleşme 3) — `POST /api/gelen-belge/irsaliyeler/:id/is-emri`
// =============================================================================
// İş emri formundan okutulan belge: not alanları → SİSTEM onayı (PER_DOCUMENT, tek top = kurşun metresi) → `quickStart`
// (kaynak not, seçilen rota, hedef değerler, adım planı). Yalnız `gelenBelge.formApproval = WITH_WORK_ORDER` iken açılır;
// izin iş emri açma kümesidir (`gelen-belge:approve` ARANMAZ — ayar bu SoD'yi bilerek fabrikaya bırakır), ayak izine
// "WITH_WORK_ORDER: <kullanıcı>" düşer. Üç adım üç ayrı mevcut yazıcıdır (onay kendi claim/kurtarma döngüsüyle, quickStart
// kendi tx'iyle); tek tx yerine DEVAM EDİLEBİLİRLİK: onay "özet satırının topu var mı"ya bağlıdır (başlık durumuna değil) —
// yarım kalan onay (PARTIAL, bayat APPROVING) aynı token'la yeniden koşar, top belirlenimli token'la, iş emri `clientToken`la
// replay olur; ikinci top/İE doğmaz. Okuma kapısı yalnız SÜREN okumadır: düşen/okuyucusuz belgede operatörün elle girdiği
// değerlerle kayıt yapılır (uyarıyla).
// =============================================================================
import { DeliveryNoteStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import type { JwtPayload } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { TERIM } from "../constants/terim";
import { settingScreenPath } from "../constants/panel-ayar-yolu";
import { approveDeliveryNote } from "./gelen-belge-onay.service";
import { summaryLineId } from "./gelen-belge-kontrol.service";
import { updateDeliveryNote } from "./gelen-belge-note.service";
import { getReadSummary, type ReadSummaryState } from "./gelen-belge-okuma-ozeti.service";
import { assertRouteOverride } from "./gelen-belge-oto-is-emri.service";
import { WorkOrderService, type WorkOrderCreateInput } from "./workorder.service";
import { allPartiesEntered, assertPartiesShape, openPartyWorkOrders, partyRolls, type PartyInput, type PartyWorkOrder } from "./gelen-belge-cok-parti.service";
import { readIncomingDocFormApproval, readMultiPartyWorkOrder, type MultiPartyWorkOrderMode } from "./system-setting.service";

const workOrders = new WorkOrderService();

/** Yalnız okuma SÜRERKEN kayıt 409; diğer her durumda gövdedeki (operatörün gördüğü) değerle kayıt yapılır. */
export const FORM_WORK_ORDER_BLOCKING_READ_STATES: readonly ReadSummaryState[] = ["READING"];
/** Okumanın değer üretmediği durumlar → kayıt yapılır ama "elle girildi" uyarısı düşer. */
const MANUAL_READ_STATES: readonly ReadSummaryState[] = ["FAILED", "NO_PAGES", "NO_SERVICE"];
/** Onayın (yeniden) koşabileceği başlık durumları; taze APPROVING'i onay claim'i kendisi 409'la reddeder. */
const APPROVAL_RESUMABLE: readonly DeliveryNoteStatus[] = [DeliveryNoteStatus.DRAFT, DeliveryNoteStatus.PARTIAL, DeliveryNoteStatus.APPROVING];

export interface FormWorkOrderInput {
  clientToken: string;
  ownerCustomerId: string;
  ourBatchNo?: string | null;
  ourBatchNoKey?: string | null;
  kursunMeters: number;
  routeTemplateId: string;
  /** `plannedMachineId` D dilimiyle quickStart'a akar; burada olduğu gibi geçirilir. */
  stepPlanning?: Array<{ sequence: number; plannedMachineId?: string | null }>;
  targetValues?: Array<{ propertyId: string; valueId: string }>;
  notes?: string | null;
  /** S1 çok partili belge (≥2): parti başına top; verilmezse tek top = kursunMeters (bugünkü). */
  parties?: PartyInput[];
  /** Verilmezse fabrika ayarı `gelenBelge.multiPartyWorkOrder` (varsayılan SINGLE). Yalnız `parties` ile anlamlı. */
  mode?: MultiPartyWorkOrderMode;
}

export interface FormWorkOrderResult {
  workOrderId: string;
  workOrderNo: string;
  batchNumber: string | null;
  rollId: string;
  warnings: string[];
  /** Çok partili kayıtta açılan iş emirleri (ilki üstteki alanlardır; eski istemci yalnız onları okur). */
  workOrders?: PartyWorkOrder[];
  mode?: MultiPartyWorkOrderMode;
}

/** Ayar kapısı (403). Tek okuyucu: uç + bekçi. */
export async function assertFormApprovalEnabled(): Promise<void> {
  if ((await readIncomingDocFormApproval()) !== "WITH_WORK_ORDER") {
    throw AppError.forbidden(
      `Belge ${TERIM.terbiyeIsEmri.tekilKucuk} formundan kaydedilemez: fabrika ayarı "ayrı onay". Belgeyi gelen belge ekranından onaylayın ya da ${settingScreenPath("gelen-belge")} ekranında "${TERIM.terbiyeIsEmri.tekil} ile kaydet" seçin.`,
      { code: "GELEN_BELGE_FORM_APPROVAL_DISABLED" },
    );
  }
}

/** Hedef değerlerin bayrak özellikleri (otomatik iş emri emsali: `targetPropertyIds` = çeşidin üst özelliği). */
async function flagPropertyIds(targets: ReadonlyArray<{ propertyId: string }>): Promise<string[]> {
  if (targets.length === 0) return [];
  const rows = await prisma.fabricProperty.findMany({ where: { id: { in: targets.map((t) => t.propertyId) } }, select: { variantOfPropertyId: true } });
  return [...new Set(rows.map((r) => r.variantOfPropertyId).filter((x): x is string => !!x))];
}

export async function createWorkOrderFromNote(noteId: string, input: FormWorkOrderInput, actor: Pick<JwtPayload, "userId" | "permissions">): Promise<FormWorkOrderResult> {
  await assertFormApprovalEnabled();
  // İzin + üretim modülü (lisans sorusu önce) + rota — onaydan ÖNCE (fail-closed; P3 emsali tek kapı).
  await assertRouteOverride(input.routeTemplateId, actor);
  const note = await prisma.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { id: true, status: true, noteNo: true } });
  if (!note) throw AppError.notFound("Gelen belge bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });

  const parties = input.parties && input.parties.length > 1 ? input.parties : null;
  if (parties) assertPartiesShape(parties);
  // Çok partide kurşun metresi = partilerin toplamı (onay kapısı bu değeri okur; gövdenin tek metresi yerine).
  const kursunMeters = parties ? Math.round(parties.reduce((s, p) => s + p.meters, 0) * 1000) / 1000 : input.kursunMeters;
  const warnings: string[] = [];
  // Taslak: okuma sürmüyor olmalı → not alanları (yalnız DRAFT'ta yazılır).
  if (note.status === DeliveryNoteStatus.DRAFT) {
    const read = await getReadSummary(noteId);
    if (FORM_WORK_ORDER_BLOCKING_READ_STATES.includes(read.state)) {
      throw AppError.conflict(`${note.noteNo} henüz okunuyor; okuma bitince yeniden deneyin.`, { code: "DELIVERY_NOTE_NOT_READ", state: read.state });
    }
    if (MANUAL_READ_STATES.includes(read.state)) warnings.push(`${note.noteNo}: sayfa okunamadı; müşteri ve metre elle girilen değerlerle kaydedildi.`);
    await updateDeliveryNote(noteId, {
      ownerCustomerId: input.ownerCustomerId,
      ...(input.ourBatchNo !== undefined ? { ourBatchNo: input.ourBatchNo, ourBatchNoKey: input.ourBatchNo ? (input.ourBatchNoKey ?? null) : null } : {}),
      // Gövdedeki metre operatörün gördüğü değerdir → gözden geçirilmiş sayılır (MANUAL).
      kursunMeters,
    }, actor.userId);
  }
  // Onay "özet satırının topu var mı"ya bağlı: yarım kalan onay (PARTIAL / bayat APPROVING) aynı token'la yeniden koşar.
  const entered = parties
    ? await allPartiesEntered(noteId, parties)
    : !!(await prisma.customerDeliveryNoteLine.findUnique({ where: { id: summaryLineId(noteId) }, select: { rollId: true } }))?.rollId;
  if (!entered) {
    if (!APPROVAL_RESUMABLE.includes(note.status)) {
      throw AppError.conflict(`${note.noteNo} şu an ${TERIM.terbiyeIsEmri.tekilKucuk} için kaydedilemez (${note.status}).`, { code: "DELIVERY_NOTE_NOT_APPROVABLE", status: note.status });
    }
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { username: true } });
    const approved = await approveDeliveryNote(noteId, {}, actor.userId, {
      entryMode: "PER_DOCUMENT",
      via: `WITH_WORK_ORDER: ${user?.username ?? actor.userId}`,
      ...(parties ? { parties: parties.map((p) => ({ blockNo: p.blockNo, meters: p.meters })) } : {}),
    });
    warnings.push(...approved.warnings);
  }
  if (parties) return finishParties({ note, parties, input, userId: actor.userId, warnings });

  const line = await prisma.customerDeliveryNoteLine.findUnique({ where: { id: summaryLineId(noteId) }, select: { rollId: true, failReason: true, roll: { select: { barcode: true } } } });
  if (!line?.rollId || !line.roll?.barcode) {
    throw AppError.conflict(`${note.noteNo} için tek kayıt topu doğmadı${line?.failReason ? `: ${line.failReason}` : ""}.`, { code: "DELIVERY_NOTE_ROLL_MISSING" });
  }
  const targetValues = input.targetValues ?? [];
  // Fazla alan (plannedMachineId) bilerek geçer: adım planı overlay'i D dilimiyle okur.
  const stepPlanning = input.stepPlanning as WorkOrderCreateInput["stepPlanning"];
  const res = await workOrders.quickStart({
    clientToken: input.clientToken,
    rollBarcodes: [line.roll.barcode],
    routeTemplateId: input.routeTemplateId,
    targetValues,
    targetPropertyIds: await flagPropertyIds(targetValues),
    ...(stepPlanning?.length ? { stepPlanning } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    sourceNoteId: noteId,
  }, actor.userId);
  const wo = res.data?.workOrder;
  if (!wo) throw AppError.internal(`${TERIM.terbiyeIsEmri.tekil} açılamadı.`);
  if (res.warnings?.length) warnings.push(...res.warnings);
  return { workOrderId: wo.id, workOrderNo: wo.workOrderNumber, batchNumber: res.data?.batch?.batchNumber ?? null, rollId: line.rollId, warnings };
}

/** Çok partili kayıt: parti topları → mod (gövde > fabrika ayarı) → iş emirleri. Yanıtın üst alanları ilk iş emridir. */
async function finishParties({ note, parties, input, userId, warnings }: { note: { id: string; noteNo: string }; parties: PartyInput[]; input: FormWorkOrderInput; userId: string; warnings: string[] }): Promise<FormWorkOrderResult> {
  const rolls = await partyRolls(note.id, note.noteNo, parties);
  const mode = input.mode ?? (await readMultiPartyWorkOrder());
  const res = await openPartyWorkOrders({
    noteId: note.id, clientToken: input.clientToken, routeTemplateId: input.routeTemplateId, mode, parties, rolls,
    targetValues: input.targetValues ?? [], stepPlanning: input.stepPlanning, notes: input.notes, flagPropertyIds,
  }, userId);
  warnings.push(...res.warnings);
  const first = res.workOrders[0]!;
  return { workOrderId: first.workOrderId, workOrderNo: first.workOrderNo, batchNumber: first.batchNumber, rollId: first.rollIds[0]!, warnings, workOrders: res.workOrders, mode };
}
