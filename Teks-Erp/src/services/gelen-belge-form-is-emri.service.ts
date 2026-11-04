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
import type { FormRollInput, FormRollMode } from "../lib/gelen-belge/form-toplar";
import { TERIM } from "../constants/terim";
import { settingScreenPath } from "../constants/panel-ayar-yolu";
import { approveDeliveryNote } from "./gelen-belge-onay.service";
import { summaryLineId } from "./gelen-belge-kontrol.service";
import { updateDeliveryNote } from "./gelen-belge-note.service";
import { getReadSummary, type ReadSummaryState } from "./gelen-belge-okuma-ozeti.service";
import { resolveFormWorkOrderRoute, routeInput, type FormWorkOrderRoute } from "./gelen-belge-oto-is-emri.service";
import { WorkOrderService, assertRouteRefsActive, type WorkOrderCreateInput } from "./workorder.service";
import { assertPlannedMachines } from "./helpers/planned-machine.helper";
import { mergeRouteDefaults, resolveStationDefaultTargets } from "./helpers/station-default-targets.helper";
import { FOLD_PROPERTY_CODE } from "./helpers/fold-type";
import { allPartiesEntered, assertPartiesShape, openPartyWorkOrders, partyRolls, type PartyInput, type PartyWorkOrder } from "./gelen-belge-cok-parti.service";
import { readIncomingDocFormApproval, readMultiPartyWorkOrder, readTargetQuantityEnabled, type MultiPartyWorkOrderMode } from "./system-setting.service";
import { itemProblem } from "./gelen-belge-ayar.service";

const workOrders = new WorkOrderService();

/** Yalnız okuma SÜRERKEN kayıt 409; diğer her durumda gövdedeki (operatörün gördüğü) değerle kayıt yapılır. */
export const FORM_WORK_ORDER_BLOCKING_READ_STATES: readonly ReadSummaryState[] = ["READING"];
/** Okumanın değer üretmediği durumlar → kayıt yapılır ama "elle girildi" uyarısı düşer. */
const MANUAL_READ_STATES: readonly ReadSummaryState[] = ["FAILED", "NO_PAGES", "NO_SERVICE"];
/** Onayın (yeniden) koşabileceği başlık durumları; taze APPROVING'i onay claim'i kendisi 409'la reddeder. */
const APPROVAL_RESUMABLE: readonly DeliveryNoteStatus[] = [DeliveryNoteStatus.DRAFT, DeliveryNoteStatus.PARTIAL, DeliveryNoteStatus.APPROVING];

export { formModeFieldShape } from "../lib/gelen-belge/form-toplar";

/**
 * TEK KAYNAK: ayrı toplar parti yoluna çevrilir (blok = sıra + 1) — ikinci giriş motoru yok. Gövde kombinasyonu
 * onaydan ÖNCE doğrulanır (fail-closed): SEPARATE top ister, top SEPARATE ister, partiyle birlikte gelmez.
 */
export function rollsAsParties(input: Pick<FormWorkOrderInput, "rollMode" | "rolls" | "parties">): PartyInput[] | null {
  const rolls = input.rolls?.length ? input.rolls : null;
  if (input.rollMode === "SEPARATE" && !rolls) throw AppError.badRequest("Toplar ayrı seçildi ama top listesi yok.", { code: "GELEN_BELGE_FORM_ROLLS_REQUIRED" });
  if (rolls && input.rollMode !== "SEPARATE") throw AppError.badRequest("Top listesi yalnız \"Toplar ayrı geldi\" seçiliyken gönderilir.", { code: "GELEN_BELGE_FORM_ROLLS_NEED_SEPARATE" });
  if (rolls && input.parties?.length) throw AppError.badRequest("Toplar ayrı seçeneği çok partili belgeyle birlikte kullanılamaz.", { code: "GELEN_BELGE_FORM_ROLLS_WITH_PARTIES" });
  return rolls ? rolls.map((r, i) => ({ blockNo: i + 1, meters: r.meters, weightKg: r.weightKg ?? null, senderRollNo: r.senderRollNo ?? null })) : null;
}

export interface FormWorkOrderInput {
  clientToken: string;
  ownerCustomerId: string;
  ourBatchNo?: string | null;
  ourBatchNoKey?: string | null;
  /** Müşterinin parti no'su (belge başlığı); yalnız gönderildiyse taslağa yazılır. */
  customerBatchNo?: string | null;
  kursunMeters: number;
  /** Yoksa yalnız "Rota uygulaması: Okutmayla" iken rotasız iş emri (K29 S14b); SIRALI'da onaydan önce 400. */
  routeTemplateId?: string;
  /** `plannedMachineId` D dilimiyle quickStart'a akar; burada olduğu gibi geçirilir. */
  stepPlanning?: Array<{ sequence: number; plannedMachineId?: string | null }>;
  /** Anahtar YOKSA istasyon varsayılanları (K22) uygulanır; varsa (boş dizi dahil) istemcinin kararı, dokunulmaz. */
  targetValues?: Array<{ propertyId: string; valueId: string }>;
  notes?: string | null;
  /** S1 çok partili belge (≥2): parti başına top; verilmezse tek top = kursunMeters (bugünkü). */
  parties?: PartyInput[];
  /** Verilmezse fabrika ayarı `gelenBelge.multiPartyWorkOrder` (varsayılan SINGLE). Yalnız `parties` ile anlamlı. */
  mode?: MultiPartyWorkOrderMode;
  /** "Toplar ayrı geldi": SEPARATE + `rolls` → tek İE, her top ayrı top (parti yoluyla, kip SINGLE). Verilmezse tek parça (bugünkü). */
  rollMode?: FormRollMode;
  rolls?: FormRollInput[];
  /** K27 WARN: işi süren aynı belge no'lu eşe rağmen kaydet (onaya geçer). */
  confirmDuplicateDocNo?: boolean;
  /** K30 S16a form alanları: verilen değer türetileni EZER, verilmeyen (undefined/null) bugünkü davranış. `targetItemId`
   *  belge onayında topların ürünü olur; `targetQuantity`/`targetWeight` belge toplamıdır → PER_PARTY'de 400. */
  targetItemId?: string | null;
  targetColorId?: string | null;
  width?: number | null;
  targetQuantity?: number | null;
  targetWeight?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  foldType?: string | null;
  orderLineIds?: string[] | null;
  /** K30-D: anahtar VARSA istemcinin hedef özellik kümesi (istasyon bayrakları eklenmez; kullanıcı kaldırabilir), yoksa bugünkü. */
  targetPropertyIds?: string[];
  /** K30-D: yoksa quickStart sipariş bağından türetir (bugünkü). */
  type?: "ORDER_PRODUCTION" | "STOCK_PRODUCTION";
  /** K30-D: düzenlenmiş rota adımları (sıra = dizi sırası); routeTemplateId ile birlikte, şablonun yerine geçer. */
  steps?: FormWorkOrderStep[];
}

export interface FormWorkOrderStep {
  stationId: string;
  sequence?: number;
  notes?: string | null;
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
  plannedMachineId?: string | null;
  dispatchWithoutColor?: boolean;
}

/**
 * K30-D: düzenlenmiş adımlar onaydan ÖNCE klasik İE doğrulamasından geçer (tek kaynak: `assertRouteRefsActive` +
 * `assertPlannedMachines`) — geçersiz adımla belge onaylanıp iş emirsiz kalmaz. Döner: quickStart `steps` şekli.
 */
export async function assertFormSteps(input: FormWorkOrderInput): Promise<WorkOrderCreateInput["steps"] | undefined> {
  const steps = input.steps;
  if (!steps) return undefined;
  if (!input.routeTemplateId) {
    throw AppError.badRequest("Rota adımları yalnız bir rota seçiliyken düzenlenebilir.", { code: "GELEN_BELGE_FORM_STEPS_NEED_ROUTE" });
  }
  if (input.stepPlanning?.length || input.parties?.some((p) => p.stepPlanning?.length)) {
    throw AppError.badRequest("Rota adımları düzenlendiğinde adım planı ayrıca gönderilemez (makine adımın içinde gider).", { code: "GELEN_BELGE_FORM_STEPS_WITH_PLANNING" });
  }
  if (steps.some((s, i) => s.sequence != null && s.sequence !== i + 1)) {
    throw AppError.badRequest("Rota adımlarının sırası listedeki sırayla aynı olmalı.", { code: "GELEN_BELGE_FORM_STEPS_ORDER" });
  }
  const out = steps.map(({ sequence: _seq, ...s }) => s);
  await assertPlannedMachines(prisma, out);
  await assertRouteRefsActive(out);
  return out;
}

/** quickStart'a geçen form alanları — yalnız verilenler (yoksa quickStart bugünkü gibi türetir). */
export type FormWorkOrderFields = Pick<WorkOrderCreateInput, "targetItemId" | "targetColorId" | "width" | "targetQuantity" | "targetWeight" | "plannedStartDate" | "plannedEndDate" | "orderLineIds" | "type">;
export function formWorkOrderFields(input: FormWorkOrderInput): FormWorkOrderFields {
  const keys = ["targetItemId", "targetColorId", "width", "targetQuantity", "targetWeight", "plannedStartDate", "plannedEndDate", "type"] as const;
  const out: FormWorkOrderFields = {};
  for (const k of keys) if (input[k] != null) Object.assign(out, { [k]: input[k] });
  if (input.orderLineIds?.length) out.orderLineIds = input.orderLineIds;
  return out;
}

/** Formda seçilen hedef ürün top doğurabilir mi (varsayılan ürünün TEK kapısı `itemProblem`) — onaydan ÖNCE, fail-closed. */
async function resolveFormTargetItem(targetItemId: string | null | undefined): Promise<{ id: string; name: string } | undefined> {
  if (!targetItemId) return undefined;
  const { row, problem } = await itemProblem(targetItemId);
  if (problem || !row) throw AppError.badRequest(`Hedef kumaş kullanılamıyor: ${problem ?? "Ürün bulunamadı."}`, { code: "GELEN_BELGE_TARGET_ITEM_INVALID" });
  return { id: targetItemId, name: row.name };
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

/**
 * K22: rotanın istasyon varsayılanları (TEK çözücü). Bayraklar her zaman birleşir (gövdede bayrak alanı yok);
 * KAT kolon-projeksiyonu → `foldType`. Değerler YALNIZ istemcidendir: anahtar yok = değer yok (eski istemci/"Hedef yok";
 * yeni istemci çözücü ucunu okuyup gördüğünü gönderir) — sunucu kullanıcının ekranda görmediği değeri yazmaz.
 */
export async function resolveFormWorkOrderTargets(
  route: string | undefined | { stationIds: readonly string[] },
  customerId: string,
  clientValues: FormWorkOrderInput["targetValues"],
  clientPropertyIds?: readonly string[],
): Promise<{ targetValues: Array<{ propertyId: string; valueId: string }>; targetPropertyIds: string[]; foldType: string | null }> {
  // Rotasız (K29): istasyon yok → varsayılan yok; S10 çözücüsü adım sahada eklenirken uygular. K30-D: düzenlenmiş adımlar.
  const stationIds = typeof route === "object" ? [...route.stationIds]
    : route ? (await prisma.routeStep.findMany({ where: { routeId: route }, select: { stationId: true }, orderBy: { sequence: "asc" } })).map((s) => s.stationId) : [];
  const merged = mergeRouteDefaults(await resolveStationDefaultTargets(stationIds, customerId));
  const fold = merged.find((t) => t.propertyCode === FOLD_PROPERTY_CODE && t.valueCode);
  const targetValues = clientValues ?? [];
  // K30-D: istemci kümesi verdiyse bayrak tohumu onun kararıdır (panel kuralı: kullanıcı bayrağı kaldırabilir).
  const flags = clientPropertyIds ? [...clientPropertyIds] : merged.filter((t) => t.valueType === "FLAG").map((t) => t.propertyId);
  return { targetValues, targetPropertyIds: [...new Set([...flags, ...(await flagPropertyIds(targetValues))])], foldType: fold?.valueCode ?? null };
}

/** Varsayılan hedeflerin istasyonları: düzenlenmiş adımlar varsa onlardan (şablon yerine geçtiler), yoksa şablon. */
const targetRoute = (route: FormWorkOrderRoute, steps: WorkOrderCreateInput["steps"] | undefined) =>
  (steps ? { stationIds: steps.map((s) => s.stationId) } : route.routeTemplateId);

/** Hedef değerlerin bayrak özellikleri (otomatik iş emri emsali: `targetPropertyIds` = çeşidin üst özelliği). */
async function flagPropertyIds(targets: ReadonlyArray<{ propertyId: string }>): Promise<string[]> {
  if (targets.length === 0) return [];
  const rows = await prisma.fabricProperty.findMany({ where: { id: { in: targets.map((t) => t.propertyId) } }, select: { variantOfPropertyId: true } });
  return [...new Set(rows.map((r) => r.variantOfPropertyId).filter((x): x is string => !!x))];
}

export async function createWorkOrderFromNote(noteId: string, input: FormWorkOrderInput, actor: Pick<JwtPayload, "userId" | "permissions">): Promise<FormWorkOrderResult> {
  await assertFormApprovalEnabled();
  // İzin + üretim modülü (lisans sorusu önce) + rota/rotasız — onaydan ÖNCE (fail-closed; tek kapı, SIRALI'da rota zorunlu).
  const route = await resolveFormWorkOrderRoute(input.routeTemplateId, actor);
  const steps = await assertFormSteps(input);
  // quickStart'ın "siparişe özel = kalem şart" kuralı onaydan SONRA patlardı → belge iş emirsiz onaylı kalırdı.
  if (input.type === "ORDER_PRODUCTION" && !input.orderLineIds?.length) {
    throw AppError.badRequest(`Siparişe özel ${TERIM.terbiyeIsEmri.tekilKucuk} için sipariş kalemi seçin.`, { code: "GELEN_BELGE_FORM_TYPE_NEEDS_ORDER" });
  }
  const note = await prisma.customerDeliveryNote.findUnique({ where: { id: noteId }, select: { id: true, status: true, noteNo: true } });
  if (!note) throw AppError.notFound("Gelen belge bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });

  const rollParties = rollsAsParties(input);
  const parties = rollParties ?? (input.parties && input.parties.length > 1 ? input.parties : null);
  if (parties) assertPartiesShape(parties);
  // K30: kip onaydan ÖNCE çözülür; parti başına İE'de hedef metraj/kg belge toplamı olduğundan her İE'ye yazılamaz.
  // Ayrı toplar her zaman tek İE (SINGLE); gövdenin `mode`u yalnız partiler içindir.
  const mode = rollParties ? "SINGLE" : parties ? (input.mode ?? (await readMultiPartyWorkOrder())) : undefined;
  if (mode === "PER_PARTY" && (input.targetQuantity != null || input.targetWeight != null)) {
    throw AppError.badRequest(`Her parti ayrı ${TERIM.terbiyeIsEmri.tekilKucuk} kipinde hedef metraj ve hedef kg verilemez (belge toplamıdır).`, { code: "GELEN_BELGE_FORM_TARGET_PER_PARTY" });
  }
  const item = await resolveFormTargetItem(input.targetItemId);
  // Çok partide / ayrı toplarda kurşun metresi = partilerin (topların) toplamı (onay kapısı bu değeri okur; gövdenin tek metresi yerine).
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
      ...(input.customerBatchNo !== undefined ? { customerBatchNo: input.customerBatchNo } : {}),
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
    const approved = await approveDeliveryNote(noteId, input.confirmDuplicateDocNo ? { confirmDuplicateDocNo: true } : {}, actor.userId, {
      entryMode: "PER_DOCUMENT",
      via: `WITH_WORK_ORDER: ${user?.username ?? actor.userId}`,
      ...(parties ? { parties: parties.map((p) => ({ blockNo: p.blockNo, meters: p.meters, ...(rollParties ? { weightKg: p.weightKg ?? null, senderRollNo: p.senderRollNo ?? null, lineKind: "TOP" as const } : {}) })) } : {}),
      ...(rollParties ? { separateRolls: true } : {}),
      ...(item ? { item } : {}),
    });
    warnings.push(...approved.warnings);
  }
  // Hedef metraj alanı açık fabrikada boş hedef = gelen metre (kapalıysa bugünkü gibi türetilmez).
  const deriveTarget = input.targetQuantity == null && (await readTargetQuantityEnabled());
  if (parties) return finishParties({ note, parties, mode: mode!, input, route, steps, userId: actor.userId, warnings, deriveTarget });

  const line = await prisma.customerDeliveryNoteLine.findUnique({ where: { id: summaryLineId(noteId) }, select: { rollId: true, failReason: true, roll: { select: { barcode: true } } } });
  if (!line?.rollId || !line.roll?.barcode) {
    throw AppError.conflict(`${note.noteNo} için tek kayıt topu doğmadı${line?.failReason ? `: ${line.failReason}` : ""}.`, { code: "DELIVERY_NOTE_ROLL_MISSING" });
  }
  const targets = await resolveFormWorkOrderTargets(targetRoute(route, steps), input.ownerCustomerId, input.targetValues, input.targetPropertyIds);
  // Fazla alan (plannedMachineId) bilerek geçer: adım planı overlay'i D dilimiyle okur.
  const stepPlanning = input.stepPlanning as WorkOrderCreateInput["stepPlanning"];
  const res = await workOrders.quickStart({
    clientToken: input.clientToken,
    rollBarcodes: [line.roll.barcode],
    ...(steps ? { steps } : routeInput(route)),
    targetValues: targets.targetValues,
    targetPropertyIds: targets.targetPropertyIds,
    ...(input.foldType ?? targets.foldType ? { foldType: input.foldType ?? targets.foldType } : {}),
    ...(stepPlanning?.length ? { stepPlanning } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...formWorkOrderFields(input),
    ...(deriveTarget ? { targetQuantity: round3(kursunMeters) } : {}),
    sourceNoteId: noteId,
  }, actor.userId);
  const wo = res.data?.workOrder;
  if (!wo) throw AppError.internal(`${TERIM.terbiyeIsEmri.tekil} açılamadı.`);
  if (res.warnings?.length) warnings.push(...res.warnings);
  return { workOrderId: wo.id, workOrderNo: wo.workOrderNumber, batchNumber: res.data?.batch?.batchNumber ?? null, rollId: line.rollId, warnings };
}

/** Çok partili kayıt: parti topları → mod (gövde > fabrika ayarı) → iş emirleri. Yanıtın üst alanları ilk iş emridir. */
async function finishParties({ note, parties, mode, input, route, steps, userId, warnings, deriveTarget }: { note: { id: string; noteNo: string }; parties: PartyInput[]; mode: MultiPartyWorkOrderMode; input: FormWorkOrderInput; route: FormWorkOrderRoute; steps: WorkOrderCreateInput["steps"] | undefined; userId: string; warnings: string[]; deriveTarget: boolean }): Promise<FormWorkOrderResult> {
  const rolls = await partyRolls(note.id, note.noteNo, parties);
  // K22: değerler gövdeden; çözücünün bayrakları ve KAT'ı her iş emrine (tek parti yoluyla aynı).
  const defaults = await resolveFormWorkOrderTargets(targetRoute(route, steps), input.ownerCustomerId, input.targetValues, input.targetPropertyIds);
  const withDefaultFlags = async (targets: ReadonlyArray<{ propertyId: string }>) => [...new Set([...defaults.targetPropertyIds, ...(await flagPropertyIds(targets))])];
  const res = await openPartyWorkOrders({
    noteId: note.id, clientToken: input.clientToken, route, mode, parties, rolls,
    targetValues: defaults.targetValues, foldType: input.foldType ?? defaults.foldType, stepPlanning: input.stepPlanning, notes: input.notes, flagPropertyIds: withDefaultFlags,
    fields: formWorkOrderFields(input), steps, deriveTargetQuantity: deriveTarget,
  }, userId);
  warnings.push(...res.warnings);
  const first = res.workOrders[0]!;
  return { workOrderId: first.workOrderId, workOrderNo: first.workOrderNo, batchNumber: first.batchNumber, rollId: first.rollIds[0]!, warnings, workOrders: res.workOrders, mode };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
