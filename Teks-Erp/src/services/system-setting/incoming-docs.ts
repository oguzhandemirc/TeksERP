// =============================================================================
// TeksERP - System Setting / incoming-docs
// =============================================================================
// Gelen belge okuyucuları.
// `system-setting.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../system-setting.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { clampOutlierFactor } from "../../lib/gelen-belge/taslak";
import { applyModuleCeiling } from "../../lib/license/module-ceiling";
import { asBoolean, asNumber } from "./core";
import { readFinanceYarnOutOnInvoiceEnabled } from "./cost-purchase";
import { readFinanceEnabled } from "./finance";
import { SETTING_KEYS } from "./keys";
import { readEmanetEnabled, readGelenBelgeEnabledRaw, readIplikEnabled, readTicaretEnabled } from "./modules";


/** Gelen belge varsayılan ürünü (E3). Kayıt yok / boş / UUID değil → null (bugünkü davranış: ürünsüz satır reddedilir). */
export async function readIncomingDocDefaultItemId(tx?: Pick<typeof prisma, "systemSetting">): Promise<string | null> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_DEFAULT_ITEM_ID },
    select: { value: true },
  });
  const v = typeof setting?.value === "string" ? setting.value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

/** İE varsayılan stok kartı. Kayıt yok / boş / UUID değil → null (bugünkü davranış: hedefsiz stoğa üretim 400). */
export async function readWorkOrderDefaultTargetItemId(tx?: Pick<typeof prisma, "systemSetting">): Promise<string | null> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.WORKORDER_DEFAULT_TARGET_ITEM_ID },
    select: { value: true },
  });
  const v = typeof setting?.value === "string" ? setting.value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

/** WARN uyarıyla geçer · BLOCK_SUSPECT yalnız şüpheli değerli (SUSPECT_VALUE) satır engeller · BLOCK her gözden geçirilmemiş satır engeller. */
export type UnreviewedApprovalMode = "WARN" | "BLOCK_SUSPECT" | "BLOCK";
export const UNREVIEWED_APPROVAL_VALUES: readonly UnreviewedApprovalMode[] = ["WARN", "BLOCK_SUSPECT", "BLOCK"];
/** Varsayılan WARN = bugünkü davranış (needsReview satır onayı durdurmaz). */
export const DEFAULT_UNREVIEWED_APPROVAL: UnreviewedApprovalMode = "WARN";

/** Gözden geçirilmemiş hücre varken onay kipi; çöp değer varsayılana düşer (`includes` sigortası). */
export async function readUnreviewedApprovalMode(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<UnreviewedApprovalMode> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_UNREVIEWED_APPROVAL },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && (UNREVIEWED_APPROVAL_VALUES as readonly string[]).includes(v)
    ? (v as UnreviewedApprovalMode)
    : DEFAULT_UNREVIEWED_APPROVAL;
}

/** Onay sonrası otomatik iş emri; kayıt yok / bozuk → false (bugünkü davranış: iş emri elle açılır). */
export async function readIncomingDocAutoWorkOrder(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

/** İstasyonda belgeden iş emri bulma (K17); kayıt yok / bozuk → false (bugünkü: istasyonda "Belge okut" yok). */
export async function readIncomingDocStationLookup(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_STATION_DOC_LOOKUP },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

export const DEFAULT_STATION_VERIFY_THRESHOLD = 80;
/** İstasyon okutma doğrulama eşiği; kayıt yok / sayı değil / aralık dışı → varsayılan 80 (0 geçerli: kapalı). */
export async function readStationVerifyThreshold(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_STATION_VERIFY_THRESHOLD },
    select: { value: true },
  });
  const n = asNumber(setting?.value);
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 100 ? n : DEFAULT_STATION_VERIFY_THRESHOLD;
}

/** Okunan şablonun gönderen carisiyle boş gönderen alanını doldur; kayıt yok / bozuk → false (bugünkü: OCR gönderen doldurmaz). */
export async function readIncomingDocAutoSender(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_AUTO_SENDER },
    select: { value: true },
  });
  return asBoolean(setting?.value);
}

export type HeaderLineMeterSource = "OUTPUT" | "INPUT";
export const HEADER_LINE_METER_SOURCE_VALUES: readonly HeaderLineMeterSource[] = ["OUTPUT", "INPUT"];
/** Varsayılan OUTPUT = bugünkü davranış (ürün sevk fişinde çıkış toplamı, yoksa giriş). */
export const DEFAULT_HEADER_LINE_METER_SOURCE: HeaderLineMeterSource = "OUTPUT";

/** Tablosuz belgede satır metresi kaynağı; çöp değer varsayılana düşer (`includes` sigortası). */
export async function readHeaderLineMeterSource(tx?: Pick<typeof prisma, "systemSetting">): Promise<HeaderLineMeterSource> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_HEADER_LINE_SOURCE },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && (HEADER_LINE_METER_SOURCE_VALUES as readonly string[]).includes(v)
    ? (v as HeaderLineMeterSource)
    : DEFAULT_HEADER_LINE_METER_SOURCE;
}

export type DocumentTotalCheckMode = "INFO" | "REQUIRE_REASON";
export const DOCUMENT_TOTAL_CHECK_VALUES: readonly DocumentTotalCheckMode[] = ["INFO", "REQUIRE_REASON"];
/** Varsayılan INFO = bugünkü davranış (belge geneli fark onayı engellemez). */
export const DEFAULT_DOCUMENT_TOTAL_CHECK: DocumentTotalCheckMode = "INFO";

/** Belge geneli beyan farkının kipi; çöp değer varsayılana düşer (`includes` sigortası). */
export async function readDocumentTotalCheck(tx?: Pick<typeof prisma, "systemSetting">): Promise<DocumentTotalCheckMode> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_DOCUMENT_TOTAL_CHECK },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && (DOCUMENT_TOTAL_CHECK_VALUES as readonly string[]).includes(v)
    ? (v as DocumentTotalCheckMode)
    : DEFAULT_DOCUMENT_TOTAL_CHECK;
}

/** Kapalı kümeli gelen belge ayarı okuyucusu — kayıt yok / çöp değer varsayılana düşer (`includes` sigortası). */
async function readClosedSetting<T extends string>(key: string, values: readonly T[], fallback: T, tx?: Pick<typeof prisma, "systemSetting">): Promise<T> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const v = setting?.value;
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : fallback;
}

export type BatchNumberSourceMode = "SERIES" | "DOCUMENT";
export const BATCH_NUMBER_SOURCE_VALUES: readonly BatchNumberSourceMode[] = ["SERIES", "DOCUMENT"];
/** Varsayılan SERIES = bugünkü davranış (parti numarası seriden doğar). */
export const DEFAULT_BATCH_NUMBER_SOURCE: BatchNumberSourceMode = "SERIES";
export const readBatchNumberSource = (tx?: Pick<typeof prisma, "systemSetting">): Promise<BatchNumberSourceMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_BATCH_NUMBER_SOURCE, BATCH_NUMBER_SOURCE_VALUES, DEFAULT_BATCH_NUMBER_SOURCE, tx);

export type IncomingDocEntryMode = "PER_LINE" | "PER_DOCUMENT";
export const ENTRY_MODE_VALUES: readonly IncomingDocEntryMode[] = ["PER_LINE", "PER_DOCUMENT"];
/** Varsayılan PER_LINE = bugünkü davranış (her satır bir top). */
export const DEFAULT_ENTRY_MODE: IncomingDocEntryMode = "PER_LINE";
export const readIncomingDocEntryMode = (tx?: Pick<typeof prisma, "systemSetting">): Promise<IncomingDocEntryMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_ENTRY_MODE, ENTRY_MODE_VALUES, DEFAULT_ENTRY_MODE, tx);

export type AutoWorkOrderPatternlessMode = "SKIP" | "OPEN";
export const AUTO_WORK_ORDER_PATTERNLESS_VALUES: readonly AutoWorkOrderPatternlessMode[] = ["SKIP", "OPEN"];
/** Varsayılan SKIP = bugünkü davranış (işlem değeri çözülemeyen grup oto iş emrinde atlanır). */
export const DEFAULT_AUTO_WORK_ORDER_PATTERNLESS: AutoWorkOrderPatternlessMode = "SKIP";
export const readAutoWorkOrderPatternless = (tx?: Pick<typeof prisma, "systemSetting">): Promise<AutoWorkOrderPatternlessMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_AUTO_WORK_ORDER_PATTERNLESS, AUTO_WORK_ORDER_PATTERNLESS_VALUES, DEFAULT_AUTO_WORK_ORDER_PATTERNLESS, tx);

export type IncomingDocFormApprovalMode = "SEPARATE" | "WITH_WORK_ORDER";
export const FORM_APPROVAL_VALUES: readonly IncomingDocFormApprovalMode[] = ["SEPARATE", "WITH_WORK_ORDER"];
/** Varsayılan SEPARATE = bugünkü davranış (belge ayrı onaylanır, `gelen-belge:approve`). */
export const DEFAULT_FORM_APPROVAL: IncomingDocFormApprovalMode = "SEPARATE";
export const readIncomingDocFormApproval = (tx?: Pick<typeof prisma, "systemSetting">): Promise<IncomingDocFormApprovalMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_FORM_APPROVAL, FORM_APPROVAL_VALUES, DEFAULT_FORM_APPROVAL, tx);

/** S1 çok partili belge → iş emri: her parti ayrı iş emri (PER_PARTY) ya da tek iş emri, partiler ayrı top (SINGLE). */
export type MultiPartyWorkOrderMode = "SINGLE" | "PER_PARTY";
export const MULTI_PARTY_WORK_ORDER_VALUES: readonly MultiPartyWorkOrderMode[] = ["SINGLE", "PER_PARTY"];
/** Varsayılan SINGLE = bugünkü davranış (belgeden tek iş emri). */
export const DEFAULT_MULTI_PARTY_WORK_ORDER: MultiPartyWorkOrderMode = "SINGLE";
export const readMultiPartyWorkOrder = (tx?: Pick<typeof prisma, "systemSetting">): Promise<MultiPartyWorkOrderMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_MULTI_PARTY_WORK_ORDER, MULTI_PARTY_WORK_ORDER_VALUES, DEFAULT_MULTI_PARTY_WORK_ORDER, tx);
/** K27 mükerrer gönderen belge no kipi. */
export type DuplicateDocNoMode = "BLOCK" | "WARN" | "ALLOW";
export const DUPLICATE_DOC_NO_VALUES: readonly DuplicateDocNoMode[] = ["BLOCK", "WARN", "ALLOW"];
/** Varsayılan BLOCK = bugünkü davranış (sahip + belge no iptal dışı tek belge). */
export const DEFAULT_DUPLICATE_DOC_NO: DuplicateDocNoMode = "BLOCK";
export const readDuplicateDocNoMode = (tx?: Pick<typeof prisma, "systemSetting">): Promise<DuplicateDocNoMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_DUPLICATE_DOC_NO, DUPLICATE_DOC_NO_VALUES, DEFAULT_DUPLICATE_DOC_NO, tx);

/** K28 belge fotoğrafı saklama — onaydan/sevkten sonra bayt küçültülür ya da silinir; satır (sha256, okuma, künye) kalır. */
export type PhotoRetentionMode = "FULL" | "SHRINK_ON_APPROVAL" | "DELETE_ON_APPROVAL" | "DELETE_ON_DISPATCH";
export const PHOTO_RETENTION_VALUES: readonly PhotoRetentionMode[] = ["FULL", "SHRINK_ON_APPROVAL", "DELETE_ON_APPROVAL", "DELETE_ON_DISPATCH"];
/** Varsayılan FULL = bugünkü davranış (fotoğraf olduğu gibi saklanır). */
export const DEFAULT_PHOTO_RETENTION: PhotoRetentionMode = "FULL";
export const readPhotoRetention = (tx?: Pick<typeof prisma, "systemSetting">): Promise<PhotoRetentionMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_PHOTO_RETENTION, PHOTO_RETENTION_VALUES, DEFAULT_PHOTO_RETENTION, tx);

/** K30 S16a okunan desen/renk yazısının ele alınışı. */
export type DesenRenkEslesmeMode = "KAPALI" | "ONER" | "NOT";
export const DESEN_RENK_ESLESME_VALUES: readonly DesenRenkEslesmeMode[] = ["KAPALI", "ONER", "NOT"];
/** Varsayılan KAPALI = bugünkü davranış (öneri yok, nota eklenmez). */
export const DEFAULT_DESEN_RENK_ESLESME: DesenRenkEslesmeMode = "ONER";
export const readDesenRenkEslesme = (tx?: Pick<typeof prisma, "systemSetting">): Promise<DesenRenkEslesmeMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_DESEN_RENK_ESLESME, DESEN_RENK_ESLESME_VALUES, DEFAULT_DESEN_RENK_ESLESME, tx);
/** K30 S16a tablet iş emri formunun giriş yolu. */
export type TabletIeGirisiMode = "IKISI" | "BELGE" | "TOP";
export const TABLET_IE_GIRISI_VALUES: readonly TabletIeGirisiMode[] = ["IKISI", "BELGE", "TOP"];
/** Varsayılan IKISI = bugünkü davranış (belge okutma da top okutma da açık). */
export const DEFAULT_TABLET_IE_GIRISI: TabletIeGirisiMode = "IKISI";
export const readTabletIeGirisi = (tx?: Pick<typeof prisma, "systemSetting">): Promise<TabletIeGirisiMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_TABLET_IE_GIRISI, TABLET_IE_GIRISI_VALUES, DEFAULT_TABLET_IE_GIRISI, tx);
/** K30-B tanıtılan belgeye güven (okuma özeti sorusuz mu hazırlanır). */
export type TanitimGuveniMode = "SOR" | "SORMA";
export const TANITIM_GUVENI_VALUES: readonly TanitimGuveniMode[] = ["SOR", "SORMA"];
/** Varsayılan SOR = bugünkü davranış (müşteri/parti/metre önerisi onaylatılır). */
export const DEFAULT_TANITIM_GUVENI: TanitimGuveniMode = "SOR";
export const readTanitimGuveni = (tx?: Pick<typeof prisma, "systemSetting">): Promise<TanitimGuveniMode> =>
  readClosedSetting(SETTING_KEYS.GELEN_BELGE_TANITIM_GUVENI, TANITIM_GUVENI_VALUES, DEFAULT_TANITIM_GUVENI, tx);

/** Bilgisayarda ikinci okuma (sunucu OCR). Kayıt yok / çöp = true (bugünkü: okuma servisi adresi varsa kullanılır);
 *  yalnız açık `false` kapatır. Önbellek yok — her soruda DB'den (ayar anında geçerli). */
export const DEFAULT_SERVER_OCR_ENABLED = true;
export async function readServerOcrEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.GELEN_BELGE_SERVER_OCR_ENABLED }, select: { value: true } });
  const v = setting?.value;
  return !(v === false || v === "false");
}

/** İş emri açılınca refakat kartı kendiliğinden yazdırılsın mı (kayıt yok/çöp = false, bugünkü). */
export async function readRefakatAutoPrint(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({ where: { key: SETTING_KEYS.PRODUCTION_REFAKAT_AUTO_PRINT }, select: { value: true } });
  return asBoolean(setting?.value);
}

/** Rota önerisinin fabrika varsayılanı; kayıt yok / boş / UUID değil → null (bugünkü: fabrika kaynağı yok). */
export async function readIncomingDocDefaultRouteId(tx?: Pick<typeof prisma, "systemSetting">): Promise<string | null> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_DEFAULT_ROUTE_ID },
    select: { value: true },
  });
  const v = typeof setting?.value === "string" ? setting.value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

export type RouteSuggestionPriority = "CUSTOMER_FIRST" | "FACTORY_FIRST";
export const ROUTE_SUGGESTION_PRIORITY_VALUES: readonly RouteSuggestionPriority[] = ["CUSTOMER_FIRST", "FACTORY_FIRST"];
/** Varsayılan CUSTOMER_FIRST = bugünkü davranış (önce müşterinin önceki iş emri). */
export const DEFAULT_ROUTE_SUGGESTION_PRIORITY: RouteSuggestionPriority = "CUSTOMER_FIRST";

/** Rota önerisi önceliği; çöp değer varsayılana düşer (`includes` sigortası). */
export async function readRouteSuggestionPriority(tx?: Pick<typeof prisma, "systemSetting">): Promise<RouteSuggestionPriority> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_ROUTE_PRIORITY },
    select: { value: true },
  });
  const v = setting?.value;
  return typeof v === "string" && (ROUTE_SUGGESTION_PRIORITY_VALUES as readonly string[]).includes(v)
    ? (v as RouteSuggestionPriority)
    : DEFAULT_ROUTE_SUGGESTION_PRIORITY;
}

/** El yazısı şüpheli değer oranı; kayıt yok / aralık dışı / çöp → varsayılan (`clampOutlierFactor`). */
export async function readHandwritingOutlierFactor(tx?: Pick<typeof prisma, "systemSetting">): Promise<number> {
  const client = tx ?? prisma;
  const setting = await client.systemSetting.findUnique({
    where: { key: SETTING_KEYS.GELEN_BELGE_OUTLIER_FACTOR },
    select: { value: true },
  });
  return clampOutlierFactor(asNumber(setting?.value) ?? undefined);
}

/** Enforcement okuyucusu: ham değer ∧ lisans modül tavanı. `readGelenBelgeEnabledRaw` yalnız panel geri-okuması ve
 *  bağımlılık doğrulaması içindir (`test_lisans_modul_tavani` her çağıranı varyantına eşler). */
export async function readGelenBelgeEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return applyModuleCeiling(SETTING_KEYS.GELEN_BELGE_ENABLED, await readGelenBelgeEnabledRaw(tx));
}

/** Gelen belge modülü ETKİN mi — ön koşul emanet ∧ kendi bayrağı, ikisi de lisans tavanlı. Adı `resolve*` DEĞİL:
 *  modül-altı davranış bayrağı değil modül zinciridir (§8b tablosu `test_module_flags` yalnız alt bayrakları taşır).
 *  Kapı dışı her tüketici (okuma işi, İE gramaj önerisi) bunu çağırır; `requireGelenBelgeEnabled` aynı iki okumayı
 *  aynı sırayla kendisi yapar (403 eksik olanı söylemeli; `test_module_flag_off` §1c). Bekçi: `test_lisans_modul_tavani` §2g. */
export async function effectiveIncomingDocsEnabled(tx?: Pick<typeof prisma, "systemSetting">): Promise<boolean> {
  return (await readEmanetEnabled(tx)) && (await readGelenBelgeEnabled(tx));
}

/**
 * KÖPRÜ BAYRAĞI — "satış faturası onayında iplik stoktan düşülsün mü" sorusunun
 * TEK karar noktası: `finance && ticaret && iplik && altBayrak`.
 *
 * NEDEN TEK RESOLVER: alt bayrak İKİ modülün kesişiminde yaşıyor (fatura
 * finansta, kg defteri iplikte). Tüketici alt bayrağı doğrudan okusaydı, iplik
 * modülü KAPALI bir kurulumda satış faturası `YarnMovement` yazmaya devam
 * ederdi — "modül kapalıyken alt bayrak OKUNMAZ" kuralının bilinen tek somut
 * ihlali buydu. Bekçi `readFinanceYarnOutOnInvoiceEnabled` çağrısının YALNIZ
 * burada geçtiğini kilitler; ikinci bir çağrı yerine bu fonksiyonu çağır.
 *
 * ⚠️ Sıra ucuzdan pahalıya değil, ANLAMLIDIR: en dıştaki modül şalterinden
 * içeri doğru — kapalı bir modülde alt bayrağın değeri hiç sorulmaz.
 */
export async function resolveYarnOutOnInvoiceEnabled(
  tx?: Pick<typeof prisma, "systemSetting">,
): Promise<boolean> {
  if (!(await readFinanceEnabled(tx))) return false;
  if (!(await readTicaretEnabled(tx))) return false;
  if (!(await readIplikEnabled(tx))) return false;
  return readFinanceYarnOutOnInvoiceEnabled(tx);
}
