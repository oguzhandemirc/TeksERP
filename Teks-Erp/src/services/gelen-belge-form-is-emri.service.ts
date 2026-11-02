// =============================================================================
// GELEN BELGE → İŞ EMRİ TEK İSTEKTE (Gülkesim OIE, sözleşme 3) — `POST /api/gelen-belge/irsaliyeler/:id/is-emri`
// =============================================================================
// İş emri formundan okutulan belge: not alanları → SİSTEM onayı (PER_DOCUMENT, tek top = kurşun metresi) → `quickStart`
// (kaynak not, seçilen rota, hedef değerler, adım planı). Yalnız `gelenBelge.formApproval = WITH_WORK_ORDER` iken açılır;
// izin iş emri açma kümesidir (`gelen-belge:approve` ARANMAZ — ayar bu SoD'yi bilerek fabrikaya bırakır), ayak izine
// "WITH_WORK_ORDER: <kullanıcı>" düşer. Üç adım üç ayrı mevcut yazıcıdır (onay kendi claim/kurtarma döngüsüyle, quickStart
// kendi tx'iyle); tek tx yerine DEVAM EDİLEBİLİRLİK: onaylanmış not yeniden onaylanmaz, top belirlenimli token'la, iş emri
// `clientToken`la replay olur — yarıda kalan istek aynı token'la tekrarlanınca kaldığı yerden tamamlar, ikinci top/İE doğmaz.
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
import { readIncomingDocFormApproval } from "./system-setting.service";
import { WorkOrderService, type WorkOrderCreateInput } from "./workorder.service";

const IE = TERIM.terbiyeIsEmri;
const workOrders = new WorkOrderService();

/** Okuma bu durumlardaysa formdan kayıt yapılabilir (okunmamış/okunuyor belge 409). */
export const FORM_WORK_ORDER_READ_STATES: readonly ReadSummaryState[] = ["READ", "PARTIAL"];

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
}

export interface FormWorkOrderResult {
  workOrderId: string;
  workOrderNo: string;
  batchNumber: string | null;
  rollId: string;
  warnings: string[];
}

/** Ayar kapısı (403). Tek okuyucu: uç + bekçi. */
export async function assertFormApprovalEnabled(): Promise<void> {
  if ((await readIncomingDocFormApproval()) !== "WITH_WORK_ORDER") {
    throw AppError.forbidden(
      `Belge ${IE.tekilKucuk} formundan kaydedilemez: fabrika ayarı "ayrı onay". Belgeyi gelen belge ekranından onaylayın ya da ${settingScreenPath("gelen-belge")} ekranında "${IE.tekil} ile kaydet" seçin.`,
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

  const warnings: string[] = [];
  // Taslak: okuma bitmiş olmalı → not alanları → sistem onayı. Onaylanmış not (yarıda kalan/tekrar) bu adımı atlar.
  if (note.status === DeliveryNoteStatus.DRAFT) {
    const read = await getReadSummary(noteId);
    if (!FORM_WORK_ORDER_READ_STATES.includes(read.state)) {
      throw AppError.conflict(`${note.noteNo} henüz okunmadı (${read.state}); okuma bitince yeniden deneyin.`, { code: "DELIVERY_NOTE_NOT_READ", state: read.state });
    }
    await updateDeliveryNote(noteId, {
      ownerCustomerId: input.ownerCustomerId,
      ...(input.ourBatchNo !== undefined ? { ourBatchNo: input.ourBatchNo, ourBatchNoKey: input.ourBatchNo ? (input.ourBatchNoKey ?? null) : null } : {}),
      // Gövdedeki metre operatörün gördüğü değerdir → gözden geçirilmiş sayılır (MANUAL).
      kursunMeters: input.kursunMeters,
    }, actor.userId);
    const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { username: true } });
    const approved = await approveDeliveryNote(noteId, {}, actor.userId, { entryMode: "PER_DOCUMENT", via: `WITH_WORK_ORDER: ${user?.username ?? actor.userId}` });
    warnings.push(...approved.warnings);
  } else if (note.status !== DeliveryNoteStatus.APPROVED && note.status !== DeliveryNoteStatus.PARTIAL) {
    throw AppError.conflict(`${note.noteNo} şu an ${IE.tekilKucuk} için kaydedilemez (${note.status}).`, { code: "DELIVERY_NOTE_NOT_APPROVABLE", status: note.status });
  }

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
  if (!wo) throw AppError.internal(`${IE.tekil} açılamadı.`);
  if (res.warnings?.length) warnings.push(...res.warnings);
  return { workOrderId: wo.id, workOrderNo: wo.workOrderNumber, batchNumber: res.data?.batch?.batchNumber ?? null, rollId: line.rollId, warnings };
}
