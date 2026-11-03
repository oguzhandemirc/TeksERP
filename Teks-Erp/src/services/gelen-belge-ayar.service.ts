// =============================================================================
// TeksERP — Gelen belge AYARLARI (hizmet ekseni E3; TASARIM-KARARI §8 HİZMET EKSENİ (1))
// =============================================================================
// On iki fabrika ayarı, TEK yazar `PUT /api/gelen-belge/ayarlar` (ham `PUT /api/admin/settings/:key` bu anahtarları
// REDDEDER — doğrulamasız düz metin yazıp ürün kapısını dolanmasın):
//   · `gelenBelge.defaultItemId` — ürünü seçilmemiş satır onayda bu ürünle doğar (boş = bugünkü: 400 UNRESOLVED)
//   · `gelenBelge.unreviewedApproval` — needsReview satır varken onay: WARN (varsayılan, geçer) | BLOCK_SUSPECT (yalnız
//     şüpheli değerli satır 409) | BLOCK (409)
//   · `gelenBelge.autoWorkOrder` — onaydan sonra net gruplara iş emri kendiliğinden (boş/false = bugünkü: elle)
//   · `gelenBelge.defaultRouteTemplateId` — rota önerisinin fabrika varsayılanı (boş = bugünkü: yalnız müşteri kaynakları)
//   · `gelenBelge.routeSuggestionPriority` — CUSTOMER_FIRST (varsayılan, bugünkü) | FACTORY_FIRST
//   · `gelenBelge.handwritingOutlierFactor` — el yazısı şüpheli metre oranı K (2–20; boş = 4)
//   · `gelenBelge.headerLineMeterSource` — tablosuz belgede satır metresi: OUTPUT çıkış (varsayılan, bugünkü) | INPUT giriş
//   · `gelenBelge.autoSenderFromTemplate` — okunan şablonun gönderen carisi boş gönderene yazılır (varsayılan kapalı)
//   · `gelenBelge.documentTotalCheck` — belge geneli beyan farkı: INFO (varsayılan, bilgi + uyarı) | REQUIRE_REASON (gerekçesiz 409)
//   · `gelenBelge.batchNumberSource` — SERIES (varsayılan) | DOCUMENT (parti no belgeden) — Gülkesim parti/metre §2.1
//   · `gelenBelge.entryMode` — PER_LINE (varsayılan) | PER_DOCUMENT (belge başına tek kayıt; fabrika varsayılan ürünü ŞART)
//   · `gelenBelge.autoWorkOrderPatternless` — SKIP (varsayılan) | OPEN (işlem değeri çözülemeyen grupta hedefsiz iş emri)
//   · `gelenBelge.formApproval` — SEPARATE (varsayılan, ayrı onay) | WITH_WORK_ORDER (iş emri formundan okutulan belgeyi iş emri açan kaydeder)
//   · `gelenBelge.multiPartyWorkOrder` — SINGLE (varsayılan, tek iş emri) | PER_PARTY (çok partili belgede her parti ayrı iş emri)
//   · `gelenBelge.duplicateDocNo` — BLOCK (varsayılan, sahip + belge no tek) | WARN (işi süren eşte onay 409 + onay bayrağı) | ALLOW (K27)
//   · `production.refakatAutoPrint` — iş emri açılınca refakat kartı istemcide kendiliğinden yazdırılır (varsayılan false)
//   · `gelenBelge.stationDocLookup` — istasyon tabletinde "Belge okut" ile iş emri bulma (K17; varsayılan false)
// Ürün kapısı tek karar: yaşam döngüsü `assertItemUsable(NEW_STOCK)` + top doğurabilen tür ALLOWLIST'i
// (`ROLL_BEARING_ITEM_TYPES`; yeni tür — ör. SERVICE — eklendiği gün kendiliğinden dışarıda kalır).
// =============================================================================
import { ItemType } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { settingScreenPath } from "../constants/panel-ayar-yolu";
import { TERIM } from "../constants/terim";
import { assertItemUsable } from "./helpers/item-usage.helper";
import { factoryRouteProblem } from "./gelen-belge-rota-onerisi.service";
import { DEFAULT_OUTLIER_FACTOR, OUTLIER_FACTOR_MAX, OUTLIER_FACTOR_MIN } from "../lib/gelen-belge/taslak";
import {
  DEFAULT_UNREVIEWED_APPROVAL,
  UNREVIEWED_APPROVAL_VALUES,
  SETTING_KEYS,
  readIncomingDocAutoWorkOrder,
  readIncomingDocDefaultRouteId,
  readRouteSuggestionPriority,
  DEFAULT_ROUTE_SUGGESTION_PRIORITY,
  ROUTE_SUGGESTION_PRIORITY_VALUES,
  type RouteSuggestionPriority,
  readIncomingDocDefaultItemId,
  readHandwritingOutlierFactor,
  readHeaderLineMeterSource,
  readIncomingDocAutoSender,
  DEFAULT_HEADER_LINE_METER_SOURCE,
  HEADER_LINE_METER_SOURCE_VALUES,
  type HeaderLineMeterSource,
  readDocumentTotalCheck,
  DEFAULT_DOCUMENT_TOTAL_CHECK,
  DOCUMENT_TOTAL_CHECK_VALUES,
  type DocumentTotalCheckMode,
  readUnreviewedApprovalMode,
  systemSettingService,
  type UnreviewedApprovalMode,
  readBatchNumberSource,
  DEFAULT_BATCH_NUMBER_SOURCE,
  BATCH_NUMBER_SOURCE_VALUES,
  type BatchNumberSourceMode,
  readIncomingDocEntryMode,
  DEFAULT_ENTRY_MODE,
  ENTRY_MODE_VALUES,
  type IncomingDocEntryMode,
  readAutoWorkOrderPatternless,
  DEFAULT_AUTO_WORK_ORDER_PATTERNLESS,
  AUTO_WORK_ORDER_PATTERNLESS_VALUES,
  type AutoWorkOrderPatternlessMode,
  readIncomingDocFormApproval,
  DEFAULT_FORM_APPROVAL,
  FORM_APPROVAL_VALUES,
  type IncomingDocFormApprovalMode,
  readMultiPartyWorkOrder,
  DEFAULT_MULTI_PARTY_WORK_ORDER,
  MULTI_PARTY_WORK_ORDER_VALUES,
  type MultiPartyWorkOrderMode,
  readDuplicateDocNoMode,
  DEFAULT_DUPLICATE_DOC_NO,
  DUPLICATE_DOC_NO_VALUES,
  type DuplicateDocNoMode,
  readRefakatAutoPrint,
  readIncomingDocStationLookup,
} from "./system-setting.service";

/** Top doğurabilen ürün türleri — `InventoryService.createInitialEntry` kapısıyla aynı küme (yalnız kumaş). */
export const ROLL_BEARING_ITEM_TYPES: readonly ItemType[] = [ItemType.FABRIC];

/** Ham ayar ucunun yazamadığı anahtarlar (kendi doğrulamalı ucu var). */
export const INCOMING_DOC_DEDICATED_SETTING_KEYS: ReadonlySet<string> = new Set([
  SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID,
  SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL,
  SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_DEFAULT_ROUTE_ID,
  SETTING_KEYS.GELEN_BELGE_ROUTE_PRIORITY,
  SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR,
  SETTING_KEYS.GELEN_BELGE_HEADER_LINE_SOURCE,
  SETTING_KEYS.GELEN_BELGE_AUTO_SENDER,
  SETTING_KEYS.GELEN_BELGE_DOCUMENT_TOTAL_CHECK,
  SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE,
  SETTING_KEYS.GELEN_BELGE_ENTRY_MODE,
  SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER_PATTERNLESS,
  SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL,
  SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER,
  SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO,
  SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT,
  SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP,
]);

export interface DefaultItemView {
  id: string;
  code: string;
  name: string;
  /** null = top doğurabilir; dolu = neden doğuramaz (pasif, birleşmiş, tür …). */
  problem: string | null;
}

export interface IncomingDocSettings {
  defaultItem: DefaultItemView | null;
  unreviewedApproval: UnreviewedApprovalMode;
  defaultUnreviewedApproval: UnreviewedApprovalMode;
  /** Onaydan sonra net desen gruplarına iş emri kendiliğinden açılır mı (varsayılan false). */
  autoWorkOrder: boolean;
  /** Rota önerisinin fabrika varsayılanı; null = ayar boş. `problem` dolu = onay anında kullanılmaz (atlanır + neden). */
  defaultRoute: { id: string; name: string; problem: string | null } | null;
  routeSuggestionPriority: RouteSuggestionPriority;
  defaultRouteSuggestionPriority: RouteSuggestionPriority;
  /** El yazısı şüpheli metre oranı K (medyanın 1/K altı ya da K katı üstü); yeni okumaya uygulanır. */
  handwritingOutlierFactor: number;
  defaultHandwritingOutlierFactor: number;
  handwritingOutlierFactorRange: { min: number; max: number };
  /** Tablosuz belgede (ürün sevk fişi) satır metresi/kg kaynağı; yeni okumaya uygulanır. */
  headerLineMeterSource: HeaderLineMeterSource;
  defaultHeaderLineMeterSource: HeaderLineMeterSource;
  /** Okunan şablonun gönderen carisi boş gönderen alanına yazılır mı (varsayılan false). */
  autoSenderFromTemplate: boolean;
  /** Belge geneli beyan (Müşteri MT) farkı: INFO bilgi (onay geçer) | REQUIRE_REASON gerekçe ister. */
  documentTotalCheck: DocumentTotalCheckMode;
  defaultDocumentTotalCheck: DocumentTotalCheckMode;
  /** Gelen belgeden doğan partinin numarası: SERIES seriden (varsayılan) | DOCUMENT taslağın parti no'su (boşsa seri). */
  batchNumberSource: BatchNumberSourceMode;
  defaultBatchNumberSource: BatchNumberSourceMode;
  /** Onay kipi: PER_LINE her satır bir top (varsayılan) | PER_DOCUMENT belge başına tek top. */
  entryMode: IncomingDocEntryMode;
  defaultEntryMode: IncomingDocEntryMode;
  /** İşlem değeri çözülemeyen grupta oto iş emri: SKIP atla (varsayılan) | OPEN hedef değersiz aç. */
  autoWorkOrderPatternless: AutoWorkOrderPatternlessMode;
  defaultAutoWorkOrderPatternless: AutoWorkOrderPatternlessMode;
  /** İş emri formundan okutulan belge: SEPARATE ayrı onay (varsayılan) | WITH_WORK_ORDER iş emri açan kaydeder. */
  formApproval: IncomingDocFormApprovalMode;
  defaultFormApproval: IncomingDocFormApprovalMode;
  multiPartyWorkOrder: MultiPartyWorkOrderMode;
  defaultMultiPartyWorkOrder: MultiPartyWorkOrderMode;
  /** K27 aynı gönderen belge no: BLOCK engelle (varsayılan) | WARN işi süren eşte uyar | ALLOW serbest. */
  duplicateDocNo: DuplicateDocNoMode;
  defaultDuplicateDocNo: DuplicateDocNoMode;
  /** İş emri açılınca refakat kartı kendiliğinden yazdırılır mı (varsayılan false). */
  refakatAutoPrint: boolean;
  /** İstasyon tabletinde "Belge okut" ile iş emri bulma (varsayılan false). */
  stationDocLookup: boolean;
}

/**
 * Ürün top doğurabilir mi — null = evet, metin = Türkçe sebep. Bulunamayan ürün de sebeptir. Fabrika ve müşteri
 * varsayılanının (E4) TEK kapısı: yazımda 400, onay anında 409.
 */
export async function itemProblem(itemId: string): Promise<{ row: { code: string; name: string } | null; problem: string | null }> {
  const row = await prisma.item.findUnique({ where: { id: itemId }, select: { code: true, name: true, itemType: true } });
  if (!row) return { row: null, problem: "Ürün bulunamadı." };
  if (!ROLL_BEARING_ITEM_TYPES.includes(row.itemType)) {
    return { row, problem: `"${row.name}" top olarak girilemez; yalnız kumaş ürünü seçilebilir.` };
  }
  try {
    await assertItemUsable(prisma, itemId, "NEW_STOCK");
  } catch (err) {
    if (err instanceof AppError) return { row, problem: err.message };
    throw err;
  }
  return { row, problem: null };
}

async function defaultRouteView(): Promise<IncomingDocSettings["defaultRoute"]> {
  const id = await readIncomingDocDefaultRouteId();
  if (!id) return null;
  const { name, problem } = await factoryRouteProblem(id);
  return { id, name: name ?? "(silinmiş rota)", problem };
}

export async function getIncomingDocSettings(): Promise<IncomingDocSettings> {
  const id = await readIncomingDocDefaultItemId();
  let defaultItem: DefaultItemView | null = null;
  if (id) {
    const { row, problem } = await itemProblem(id);
    defaultItem = { id, code: row?.code ?? "", name: row?.name ?? "(silinmiş ürün)", problem };
  }
  return {
    defaultItem,
    unreviewedApproval: await readUnreviewedApprovalMode(),
    defaultUnreviewedApproval: DEFAULT_UNREVIEWED_APPROVAL,
    autoWorkOrder: await readIncomingDocAutoWorkOrder(),
    defaultRoute: await defaultRouteView(),
    routeSuggestionPriority: await readRouteSuggestionPriority(),
    defaultRouteSuggestionPriority: DEFAULT_ROUTE_SUGGESTION_PRIORITY,
    handwritingOutlierFactor: await readHandwritingOutlierFactor(),
    defaultHandwritingOutlierFactor: DEFAULT_OUTLIER_FACTOR,
    handwritingOutlierFactorRange: { min: OUTLIER_FACTOR_MIN, max: OUTLIER_FACTOR_MAX },
    headerLineMeterSource: await readHeaderLineMeterSource(),
    defaultHeaderLineMeterSource: DEFAULT_HEADER_LINE_METER_SOURCE,
    autoSenderFromTemplate: await readIncomingDocAutoSender(),
    documentTotalCheck: await readDocumentTotalCheck(),
    defaultDocumentTotalCheck: DEFAULT_DOCUMENT_TOTAL_CHECK,
    batchNumberSource: await readBatchNumberSource(),
    defaultBatchNumberSource: DEFAULT_BATCH_NUMBER_SOURCE,
    entryMode: await readIncomingDocEntryMode(),
    defaultEntryMode: DEFAULT_ENTRY_MODE,
    autoWorkOrderPatternless: await readAutoWorkOrderPatternless(),
    defaultAutoWorkOrderPatternless: DEFAULT_AUTO_WORK_ORDER_PATTERNLESS,
    formApproval: await readIncomingDocFormApproval(),
    defaultFormApproval: DEFAULT_FORM_APPROVAL,
    multiPartyWorkOrder: await readMultiPartyWorkOrder(),
    defaultMultiPartyWorkOrder: DEFAULT_MULTI_PARTY_WORK_ORDER,
    duplicateDocNo: await readDuplicateDocNoMode(),
    defaultDuplicateDocNo: DEFAULT_DUPLICATE_DOC_NO,
    refakatAutoPrint: await readRefakatAutoPrint(),
    stationDocLookup: await readIncomingDocStationLookup(),
  };
}

export interface IncomingDocSettingsInput {
  /** null = temizle (bugünkü davranışa dön). */
  defaultItemId?: string | null;
  unreviewedApproval?: UnreviewedApprovalMode;
  autoWorkOrder?: boolean;
  /** null = temizle (bugünkü davranış). */
  defaultRouteTemplateId?: string | null;
  routeSuggestionPriority?: RouteSuggestionPriority;
  /** null = temizle (varsayılan oran). */
  handwritingOutlierFactor?: number | null;
  headerLineMeterSource?: HeaderLineMeterSource;
  autoSenderFromTemplate?: boolean;
  documentTotalCheck?: DocumentTotalCheckMode;
  batchNumberSource?: BatchNumberSourceMode;
  entryMode?: IncomingDocEntryMode;
  autoWorkOrderPatternless?: AutoWorkOrderPatternlessMode;
  formApproval?: IncomingDocFormApprovalMode;
  multiPartyWorkOrder?: MultiPartyWorkOrderMode;
  duplicateDocNo?: DuplicateDocNoMode;
  refakatAutoPrint?: boolean;
  stationDocLookup?: boolean;
}

/**
 * PER_DOCUMENT ön koşulu — etkin kip PER_DOCUMENT iken etkin fabrika varsayılan ürünü boş/kullanılamaz olamaz (özet satırı
 * ürünsüz doğar; varsayılansız kip çıkışsız kapıdır). Yalnız kip ya da varsayılan ürün yazılırken, HER yazımdan ÖNCE koşar.
 */
async function assertEntryModePrecondition(input: IncomingDocSettingsInput): Promise<void> {
  if (input.entryMode === undefined && input.defaultItemId === undefined) return;
  if ((input.entryMode ?? (await readIncomingDocEntryMode())) !== "PER_DOCUMENT") return;
  const itemId = input.defaultItemId !== undefined ? input.defaultItemId : await readIncomingDocDefaultItemId();
  // Gövdedeki ürünün kendi doğrulaması (DEFAULT_ITEM_INVALID) aşağıda; burada yalnız kayıtlı ürünün bugünkü hâli.
  const problem = itemId === null ? "varsayılan ürün seçilmemiş." : input.defaultItemId === undefined ? (await itemProblem(itemId)).problem : null;
  if (problem) {
    throw AppError.badRequest(`Belge başına tek kayıt kipi fabrika varsayılan ürünü ister: ${problem} Önce top doğurabilen bir varsayılan ürün seçin.`, { code: "GELEN_BELGE_PER_DOCUMENT_NEEDS_DEFAULT_ITEM" });
  }
}

/** Yazım: ürün doğrulaması 400 `GELEN_BELGE_DEFAULT_ITEM_INVALID`; audit `systemSettingService.set` içinde. */
export async function updateIncomingDocSettings(input: IncomingDocSettingsInput, userId: string): Promise<IncomingDocSettings> {
  await assertEntryModePrecondition(input);
  if (input.defaultItemId !== undefined) {
    if (input.defaultItemId !== null) {
      const { problem } = await itemProblem(input.defaultItemId);
      if (problem) {
        throw AppError.badRequest(`Varsayılan ürün olarak kaydedilemez: ${problem}`, { code: "GELEN_BELGE_DEFAULT_ITEM_INVALID" });
      }
    }
    // Temizleme boş metin yazar (okuyucu UUID olmayanı null okur); satır silinmez — ayar geçmişi audit'te kalır.
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID, input.defaultItemId ?? "", "Gelen belge varsayılan ürünü (ürünü seçilmemiş satır bu ürünle girer)", userId);
  }
  if (input.unreviewedApproval !== undefined) {
    if (!UNREVIEWED_APPROVAL_VALUES.includes(input.unreviewedApproval)) {
      throw AppError.badRequest("Geçersiz seçenek: WARN, BLOCK_SUSPECT ya da BLOCK olmalı.", { code: "VALIDATION_ERROR" });
    }
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL, input.unreviewedApproval, "Gelen belge: gözden geçirilmemiş hücre varken onay (WARN/BLOCK_SUSPECT/BLOCK)", userId);
  }
  if (input.autoWorkOrder !== undefined) {
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER, input.autoWorkOrder, `Gelen belge: onaydan sonra net desen gruplarına ${TERIM.terbiyeIsEmri.tekilKucuk} kendiliğinden açılır`, userId);
  }
  if (input.defaultRouteTemplateId !== undefined) {
    if (input.defaultRouteTemplateId !== null) {
      const { problem } = await factoryRouteProblem(input.defaultRouteTemplateId);
      if (problem) {
        throw AppError.badRequest(`Fabrika varsayılan rotası olarak kaydedilemez: ${problem}.`, { code: "GELEN_BELGE_DEFAULT_ROUTE_INVALID" });
      }
    }
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_DEFAULT_ROUTE_ID, input.defaultRouteTemplateId ?? "", `Gelen belge: ${TERIM.terbiyeIsEmri.tekilKucuk} rota önerisinin fabrika varsayılanı`, userId);
  }
  if (input.routeSuggestionPriority !== undefined) {
    if (!ROUTE_SUGGESTION_PRIORITY_VALUES.includes(input.routeSuggestionPriority)) {
      throw AppError.badRequest("Geçersiz seçenek: CUSTOMER_FIRST ya da FACTORY_FIRST olmalı.", { code: "VALIDATION_ERROR" });
    }
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_ROUTE_PRIORITY, input.routeSuggestionPriority, "Gelen belge: rota önerisi önceliği (CUSTOMER_FIRST/FACTORY_FIRST)", userId);
  }
  if (input.handwritingOutlierFactor !== undefined) {
    const k = input.handwritingOutlierFactor;
    if (k !== null && !(Number.isFinite(k) && k >= OUTLIER_FACTOR_MIN && k <= OUTLIER_FACTOR_MAX)) {
      throw AppError.badRequest(`Şüpheli değer oranı ${OUTLIER_FACTOR_MIN} ile ${OUTLIER_FACTOR_MAX} arasında olmalı.`, { code: "VALIDATION_ERROR" });
    }
    // Temizleme boş metin yazar (okuyucu sayı olmayanı varsayılana düşürür).
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR, k ?? "", "Gelen belge: el yazısı şüpheli metre oranı (medyanın 1/K altı ya da K katı üstü)", userId);
  }
  await updateReadOptions(input, userId);
  await updateEntryOptions(input, userId);
  return getIncomingDocSettings();
}

/** Kapalı kümeli seçenek yazımı: küme dışı değer 400 (Zod'un ikinci seddi), audit `systemSettingService.set` içinde. */
async function setClosed<T extends string>(key: string, value: T | undefined, spec: { values: readonly T[]; label: string }, userId: string): Promise<void> {
  if (value === undefined) return;
  const { values, label } = spec;
  if (!values.includes(value)) throw AppError.badRequest(`Geçersiz seçenek: ${values.join(", ")} olmalı.`, { code: "VALIDATION_ERROR" });
  await systemSettingService.set(key, value, label, userId);
}

/** Parti no / onay kipi / gramajsız oto iş emri (Gülkesim parti/metre S0) · çok parti · aynı belge no (K27). */
async function updateEntryOptions(input: IncomingDocSettingsInput, userId: string): Promise<void> {
  const ie = TERIM.terbiyeIsEmri.tekilKucuk;
  await setClosed(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, input.batchNumberSource, { values: BATCH_NUMBER_SOURCE_VALUES, label: "Gelen belge: parti numarası kaynağı (SERIES seri / DOCUMENT belgeden)" }, userId);
  await setClosed(SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, input.entryMode, { values: ENTRY_MODE_VALUES, label: "Gelen belge: onay kipi (PER_LINE satır başına top / PER_DOCUMENT belge başına tek kayıt)" }, userId);
  await setClosed(SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER_PATTERNLESS, input.autoWorkOrderPatternless, { values: AUTO_WORK_ORDER_PATTERNLESS_VALUES, label: `Gelen belge: işlem değeri çözülemeyen grupta ${ie} (SKIP atla / OPEN hedefsiz aç)` }, userId);
  await setClosed(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, input.formApproval, { values: FORM_APPROVAL_VALUES, label: `Gelen belge: ${ie} formundan okutulan belgenin kaydı (SEPARATE ayrı onay / WITH_WORK_ORDER ${ie} açan kaydeder)` }, userId);
  await setClosed(SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, input.multiPartyWorkOrder, { values: MULTI_PARTY_WORK_ORDER_VALUES, label: `Gelen belge: çok partili belgeden ${ie} (SINGLE tek / PER_PARTY her parti ayrı)` }, userId);
  await setClosed(SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO, input.duplicateDocNo, { values: DUPLICATE_DOC_NO_VALUES, label: "Gelen belge: aynı gönderen belge no tekrar gelirse (BLOCK engelle / WARN işi sürüyorsa uyar / ALLOW serbest)" }, userId);
  if (input.refakatAutoPrint !== undefined) {
    await systemSettingService.set(SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT, input.refakatAutoPrint, `${TERIM.terbiyeIsEmri.tekil} açılınca refakat kartı kendiliğinden yazdırılır`, userId);
  }
}

/** Okuma seçenekleri (S5 metre kaynağı · S3b şablondan gönderen · belge geneli beyan kipi) — yeni okumaya uygulanır, taslağı geriye dönük değiştirmez. */
async function updateReadOptions(input: IncomingDocSettingsInput, userId: string): Promise<void> {
  if (input.headerLineMeterSource !== undefined) {
    if (!HEADER_LINE_METER_SOURCE_VALUES.includes(input.headerLineMeterSource)) {
      throw AppError.badRequest("Geçersiz seçenek: OUTPUT ya da INPUT olmalı.", { code: "VALIDATION_ERROR" });
    }
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_HEADER_LINE_SOURCE, input.headerLineMeterSource, "Gelen belge: tablosuz belgede satır metresi kaynağı (OUTPUT çıkış / INPUT giriş)", userId);
  }
  if (input.stationDocLookup !== undefined) {
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP, input.stationDocLookup, `Gelen belge: istasyon tabletinde belge okutarak ${TERIM.terbiyeIsEmri.tekilKucuk} bulma`, userId);
  }
  if (input.autoSenderFromTemplate !== undefined) {
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_AUTO_SENDER, input.autoSenderFromTemplate, "Gelen belge: okunan şablonun gönderen carisi boş gönderen alanına yazılır", userId);
  }
  if (input.documentTotalCheck !== undefined) {
    if (!DOCUMENT_TOTAL_CHECK_VALUES.includes(input.documentTotalCheck)) {
      throw AppError.badRequest("Geçersiz seçenek: INFO ya da REQUIRE_REASON olmalı.", { code: "VALIDATION_ERROR" });
    }
    await systemSettingService.set(SETTING_KEYS.GELEN_BELGE_DOCUMENT_TOTAL_CHECK, input.documentTotalCheck, "Gelen belge: belge geneli beyan (Müşteri MT) farkı (INFO bilgi / REQUIRE_REASON gerekçe ister)", userId);
  }
}

/** Ürünü kaynağıyla etkin varsayılan sayan çözücü (E4) için: fabrika ayarındaki ürün kimliği, boşsa null. */
export const readFactoryDefaultItemId = readIncomingDocDefaultItemId;

/** Onay anı FAIL-CLOSED hatası — kaynak (`CUSTOMER` sahibin varsayılanı · `FACTORY` fabrika ayarı) details'te. */
export function defaultItemUnusable(source: "CUSTOMER" | "FACTORY", itemId: string, problem: string | null): AppError {
  const fix = source === "CUSTOMER" ? "Müşteri Varsayılan Ürünleri ekranından sahibin varsayılan ürününü düzeltin" : `${settingScreenPath("gelen-belge")} ekranından varsayılan ürünü düzeltin`;
  return AppError.conflict(`Gelen belge varsayılan ürünü kullanılamıyor: ${problem ?? "Ürün bulunamadı."} Satırlarda ürün seçin ya da ${fix}.`, { code: "GELEN_BELGE_DEFAULT_ITEM_UNUSABLE", itemId, source });
}
