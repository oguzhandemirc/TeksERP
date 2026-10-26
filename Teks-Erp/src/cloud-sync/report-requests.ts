// RAPOR İSTEĞİ İŞLEYİCİSİ (§7): bulutta hesap yapılmaz — bulut isteği yazar, zil `rapor`
// fabrikayı dürter, fabrika kendi rapor servisiyle ve KENDİ Zod şemasıyla (bulut
// doğrulaması yetmez) hesaplar, sonucu imzalı gönderir. Standart dönem görüntüleri
// (karne ailesi × bugün · bu ay · geçen ay) saatlik, istek beklemeden gider.
// Audit raporları (`audit/*`) ve kişi adı taşıyan raporlar buluta GİTMEZ ve istenemez.
// v2 temel raporlar sonucu `RaporSunumu` olarak gider (ana sayı, kıyas, anlatı FABRİKADA hesaplı);
// `kisiAdi` işaretli sunum gönderilmez (K-KISI) — bulut sunumu yalnız saklar ve uygulamaya iletir.
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { REPORT_BY_KEY, isReportSurfaced, type ReportKey } from "../constants/report-catalog";
import { factoryYmd, resolveRangeEnd, resolveRangeStart } from "../constants/time";
import {
  readDevereEnabled,
  readDokumaEnabled,
  readFinanceEnabled,
  readMaliyetEnabled,
  readProductionEnabled,
  readReportsClosedKeys,
} from "../services/system-setting.service";
import { dateRangeSchema, resolveDateRange, type CompareMode, type DateRange } from "../services/reports/_shared";
import { resolveCoreCompare, type CoreRangeQuery, type CoreReportResult } from "../services/reports/temel/_common";
import { resolveCoreDayRange, type CoreDayRangeQuery, type DayWindow } from "../services/reports/temel/_day-range";
import type { RaporSunumu } from "../services/reports/sunum/sunum.types";
import { buildOrderDemandReport } from "../services/reports/temel/siparis-talep.temel";
import { buildShippedReport } from "../services/reports/temel/sevkiyat.temel";
import { buildDeadlineReport } from "../services/reports/temel/termin.temel";
import { buildOpenOrderReport } from "../services/reports/temel/acik-siparisler.temel";
import { buildLostWorkReport } from "../services/reports/temel/vazgecilen-is.temel";
import { buildQualityReport } from "../services/reports/temel/kalite.temel";
import { buildLossReport } from "../services/reports/temel/kayip.temel";
import { buildWarehouseReport } from "../services/reports/temel/depo.temel";
import { buildSubcontractorsReport } from "../services/reports/temel/fasoncular.temel";
import { buildLoomEfficiencyReport } from "../services/reports/temel/tezgah-randimani.temel";
import { buildLoomStopsReport } from "../services/reports/temel/duruslar.temel";
import { buildBeamBalanceReport } from "../services/reports/temel/levent-dengesi.temel";
import { buildReceivablesReport } from "../services/reports/temel/alacaklar.temel";
// Parametre şemaları v2 uçlarının KENDİSİNDEN (tek kaynak): buluttan gelen istek panelin ucuyla aynı anahtarları kabul eder.
import {
  coreDeadlineQuerySchema,
  coreLostWorkQuerySchema,
  coreOpenOrderQuerySchema,
  coreOrderDemandQuerySchema,
  coreShippedQuerySchema,
} from "../routes/reports/temel-satis.routes";
import {
  coreLossQuerySchema,
  coreQualityQuerySchema,
  coreSubcontractorsQuerySchema,
  coreWarehouseQuerySchema,
} from "../routes/reports/temel-uretim.routes";
import {
  coreBeamBalanceQuerySchema,
  coreLoomEfficiencyQuerySchema,
  coreLoomStopsQuerySchema,
  coreReceivablesQuerySchema,
} from "../routes/reports/temel-dokuma-finans.routes";
import { getOrderIntake } from "../services/reports/order-intake.report.service";
import { getShipmentScorecard } from "../services/reports/shipment-scorecard.report.service";
import { getStockScorecard } from "../services/reports/stock-scorecard.report.service";
import { getQualityScorecard } from "../services/reports/quality-scorecard.report.service";
import { getSubcontractScorecard } from "../services/reports/subcontract-scorecard.report.service";
import { getCustomerScorecard } from "../services/reports/customer-scorecard.report.service";
import { getAgingReport } from "../services/reports/finance-aging.report";
import { chequeService } from "../services/cheque.service";
import { periodRange, type StandardPeriod } from "./periods";
import type { ModuleKey } from "./projections";
import { cloudPost, type CloudCallContext } from "./cloud-client";
import {
  SYNC_PATHS,
  MAX_COMPRESSED_BYTES,
  ReportClaimResponseSchema,
  ReportResultRequestSchema,
  toWireValue,
  type ReportResult,
  type WireValue,
} from "./wire";
import { snapshotDigest } from "./digest";

/** Rapor başına hesap tavanı (§7 "60 sn"); aşan istek `ZAMAN_ASIMI` ile kapanır. */
export const REPORT_TIMEOUT_MS = 60_000;
/** Bir `al` çağrısında en çok bu kadar istek üstlenilir. */
export const REPORT_CLAIM_BATCH = 3;

type ReportPeriod = Exclude<StandardPeriod, "son-30-gun">;
const REPORT_PERIODS: readonly ReportPeriod[] = ["bugun", "bu-ay", "gecen-ay"];

export interface RemoteReport {
  readonly key: ReportKey;
  /** Bulut okuma izni RAPOR BAŞINA — bulut kataloğunun `REPORT_KEY_PERMISSION`ıyla birebir (bekçi `test_bulut_tel_aynasi` §8). */
  readonly permission: string;
  readonly module?: ModuleKey;
  /** Projeksiyon modülü dışındaki kapı (dokuma/devere) — panel ucunun modül kapısıyla aynı okuyucu. */
  readonly gate?: () => Promise<boolean>;
  /** Standart görüntünün parametresi (varsayılan ISO `dateFrom`/`dateTo`; gün telli raporlar `from`/`to`). */
  readonly standardParams?: (range: DateRange) => Record<string, unknown>;
  /** Fabrikanın kendi parametre şeması (KATI — tanınmayan anahtar PARAMETRE_GECERSIZ). */
  readonly params: z.ZodType<Record<string, unknown>>;
  readonly paramNames: readonly string[];
  /** Saatlik standart görüntü: dönemli rapor üç dönemle, kesit rapor tek görüntüyle (`null`). */
  readonly standard: "DONEMLI" | "KESIT" | null;
  /**
   * Çıktıda kişi adı/iletişim alanı YOK (ölçüldü: rapor servisinin çıktı tipi). Kişi adı
   * taşıyan rapor (ör. `production/operator-performance`) bu listeye GİRMEZ (B1 kararı).
   */
  readonly personalData: "YOK";
  // Ad bilerek özgül: `test_levent_kalan_tek_okuyucu` ad bazlı kapanış kurar; genel `run` her `run()` çağrısını dolaylı okuyucu yapıyordu.
  readonly reportRunner: (params: Record<string, unknown>) => Promise<unknown>;
}

const rangeOf = (p: Record<string, unknown>) => resolveDateRange(p as z.infer<typeof dateRangeSchema>);
const AgingParams = z.strictObject({ asOf: z.string().datetime({ offset: true }).optional() });

type RangedBuild = (range: DateRange, compareRange: DateRange | null, compareMode: CompareMode) => Promise<CoreReportResult>;

/** v2 ISO aralıklı rapor: uçla AYNI çözüm (aralık → K-KIYAS varsayılanı) ve aynı temel servis; sonuç yalnız sunum. */
async function rangedPresentation(p: Record<string, unknown>, build: RangedBuild): Promise<RaporSunumu> {
  const q = p as CoreRangeQuery;
  const range = resolveDateRange({ dateFrom: q.dateFrom, dateTo: q.dateTo });
  const { mode, compareRange } = resolveCoreCompare(q, range);
  return (await build(range, compareRange, mode)).sunum;
}

/** v2 gün aralıklı (dokuma) rapor: pencere katalog `varsayilanGun`ünden — uçla aynı tek kaynak. */
function dayWindowOf(key: ReportKey, p: Record<string, unknown>): ReturnType<typeof resolveCoreDayRange> {
  const days = REPORT_BY_KEY.get(key)?.varsayilanGun;
  if (!days) throw new Error(`Varsayılan gün tanımsız: ${key}`);
  return resolveCoreDayRange(p as CoreDayRangeQuery, days);
}

const FACTORY_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Patron uygulaması özel aralığı fabrika GÜNÜ (`YYYY-MM-DD`) olarak yollar; gün sınırı yalnız fabrikada
 * (`constants/time`) ana çevrilir, sonra uç şeması AYNEN doğrular (anahtar kümesi değişmez).
 */
function acceptFactoryDays<T extends z.ZodTypeAny>(schema: T): z.ZodType<Record<string, unknown>> {
  return z.preprocess((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const o = { ...(v as Record<string, unknown>) };
    if (isFactoryDay(o.dateFrom)) o.dateFrom = resolveRangeStart(o.dateFrom).toISOString();
    if (isFactoryDay(o.dateTo)) o.dateTo = resolveRangeEnd(o.dateTo).toISOString();
    return o;
  }, schema) as unknown as z.ZodType<Record<string, unknown>>;
}

/** Geçerli takvim günü mü — `2026-13-45` gibi taşan gün çevrilmez, şema onu ham haliyle REDDEDER (sessiz taşma yok). */
function isFactoryDay(v: unknown): v is string {
  return typeof v === "string" && FACTORY_DAY.test(v) && factoryYmd(resolveRangeStart(v)) === v;
}

/** Kesit anı (`asOf`) için aynı kabul: fabrika günü → o günün SONU (`constants/time`); ISO aynen geçer. */
function acceptFactoryAsOf<T extends z.ZodTypeAny>(schema: T): z.ZodType<Record<string, unknown>> {
  return z.preprocess((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const o = { ...(v as Record<string, unknown>) };
    if (isFactoryDay(o.asOf)) o.asOf = resolveRangeEnd(o.asOf).toISOString();
    return o;
  }, schema) as unknown as z.ZodType<Record<string, unknown>>;
}

/**
 * Varyant (küçük çoklu) ve dönem kıyası PANEL özelliğidir (R1-VARYANT): bulut isteğinde bu anahtarlar 400 — sessizce
 * yutulmaz, kişi adlı kırılım (`operator`) buluta yol bulamaz. `allow`: anahtarın raporda başka anlamı varsa (kalite görünümü).
 */
export const PANEL_ONLY_PARAMS = ["varyant", "donemler"] as const;
function panelOnlyRejected<T extends z.ZodTypeAny>(schema: T, allow: readonly string[] = []): T {
  return schema.superRefine((v, ctx) => {
    if (!v || typeof v !== "object") return;
    for (const k of PANEL_ONLY_PARAMS) {
      if (!allow.includes(k) && (v as Record<string, unknown>)[k] !== undefined) ctx.addIssue({ code: "custom", path: [k], message: `"${k}" bulut isteğinde desteklenmez` });
    }
  }) as unknown as T;
}

const dayParams = (range: DateRange): Record<string, unknown> => ({ from: factoryYmd(range.from), to: factoryYmd(range.to) } satisfies Partial<DayWindow>);
const weavingOpen = (): Promise<boolean> => readDokumaEnabled();
const beamBalanceOpen = async (): Promise<boolean> => (await readDokumaEnabled()) && (await readDevereEnabled());

/** Sunum kişi adı taşıyor mu (K-KISI) — taşıyorsa sonuç buluta GİTMEZ (statik listeye ek savunma). */
export function carriesPersonName(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as { kisiAdi?: unknown }).kisiAdi === true;
}

/** Buluttan istenebilir raporlar — KATALOG ∩ bu liste; `audit/*` hiçbir zaman girmez (bekçi ölçer). Eski 8 rapor
 *  da uygulamanın fabrika günü (`YYYY-MM-DD`) aralığını kabul eder (R1-BULUT bulgusu; ISO aynen geçer). */
export const REMOTE_REPORTS: readonly RemoteReport[] = [
  { key: "sales/order-intake", permission: "bulut:siparis:oku", params: acceptFactoryDays(dateRangeSchema), paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => getOrderIntake(rangeOf(p)) },
  { key: "sales/shipment-scorecard", permission: "bulut:sevkiyat:oku", params: acceptFactoryDays(dateRangeSchema), paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => getShipmentScorecard(rangeOf(p)) },
  { key: "customer/scorecard", permission: "bulut:siparis:oku", params: acceptFactoryDays(dateRangeSchema), paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => getCustomerScorecard(rangeOf(p)) },
  { key: "quality/scorecard", permission: "bulut:uretim:oku", params: acceptFactoryDays(dateRangeSchema), paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => getQualityScorecard(rangeOf(p)) },
  { key: "subcontract/scorecard", permission: "bulut:uretim:oku", params: acceptFactoryDays(dateRangeSchema), paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => getSubcontractScorecard(rangeOf(p)) },
  { key: "inventory/scorecard", permission: "bulut:stok:oku", params: z.strictObject({}), paramNames: [], standard: "KESIT", personalData: "YOK",
    reportRunner: () => getStockScorecard() },
  { key: "finance/aging", permission: "bulut:cari-bakiye:oku", module: "finance.enabled", params: acceptFactoryAsOf(AgingParams), paramNames: ["asOf"], standard: "KESIT", personalData: "YOK",
    reportRunner: (p) => getAgingReport({ asOf: typeof p.asOf === "string" ? new Date(p.asOf) : new Date() }) },
  { key: "finance/cheque-due", permission: "bulut:cek:oku", module: "finance.enabled", params: acceptFactoryDays(dateRangeSchema), paramNames: ["dateFrom", "dateTo"], standard: "KESIT", personalData: "YOK",
    reportRunner: async (p) => {
      const q = p as z.infer<typeof dateRangeSchema>;
      return (await chequeService.dueSummary({ from: q.dateFrom ? new Date(q.dateFrom) : undefined, to: q.dateTo ? new Date(q.dateTo) : undefined })).data;
    } },
  // ---- Raporlar v2 temel raporları (sonuç `RaporSunumu`). HARİÇ: `production/uretim-akisi` (operatör adı, K-KISI).
  { key: "sales/siparis-talep", permission: "bulut:siparis:oku", params: acceptFactoryDays(panelOnlyRejected(coreOrderDemandQuerySchema)), paramNames: ["dateFrom", "dateTo", "kiyas", "customerId", "destination", "itemId"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => rangedPresentation(p, (range, compareRange, compareMode) => {
      const q = p as z.infer<typeof coreOrderDemandQuerySchema>;
      return buildOrderDemandReport({ range, compareRange, compareMode, filters: { customerId: q.customerId, destination: q.destination, itemId: q.itemId } });
    }) },
  { key: "sales/sevkiyat", permission: "bulut:sevkiyat:oku", params: acceptFactoryDays(panelOnlyRejected(coreShippedQuerySchema)), paramNames: ["dateFrom", "dateTo", "kiyas", "destination"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => rangedPresentation(p, (range, compareRange, compareMode) =>
      buildShippedReport({ range, compareRange, compareMode, filters: { destination: (p as z.infer<typeof coreShippedQuerySchema>).destination } })) },
  { key: "sales/termin", permission: "bulut:sevkiyat:oku", params: acceptFactoryDays(panelOnlyRejected(coreDeadlineQuerySchema)), paramNames: ["dateFrom", "dateTo", "kiyas", "destination"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => rangedPresentation(p, (range, compareRange, compareMode) =>
      buildDeadlineReport({ range, compareRange, compareMode, filters: { destination: (p as z.infer<typeof coreDeadlineQuerySchema>).destination } })) },
  { key: "sales/acik-siparisler", permission: "bulut:siparis:oku", params: panelOnlyRejected(coreOpenOrderQuerySchema), paramNames: ["itemId"], standard: "KESIT", personalData: "YOK",
    reportRunner: async (p) => (await buildOpenOrderReport({ filters: { itemId: (p as z.infer<typeof coreOpenOrderQuerySchema>).itemId } })).sunum },
  { key: "sales/vazgecilen-is", permission: "bulut:siparis:oku", params: acceptFactoryDays(panelOnlyRejected(coreLostWorkQuerySchema)), paramNames: ["dateFrom", "dateTo", "kiyas"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => rangedPresentation(p, (range, compareRange, compareMode) => buildLostWorkReport({ range, compareRange, compareMode })) },
  { key: "quality/kalite", permission: "bulut:uretim:oku", module: "production.enabled", params: acceptFactoryDays(panelOnlyRejected(coreQualityQuerySchema, ["varyant"])), paramNames: ["dateFrom", "dateTo", "kiyas", "warpBeamId", "lotNo", "varyant"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => rangedPresentation(p, (range, compareRange, compareMode) => {
      const q = p as z.infer<typeof coreQualityQuerySchema>;
      return buildQualityReport({ range, compareRange, compareMode, view: q.varyant, filters: { warpBeamId: q.warpBeamId, lotNo: q.lotNo } });
    }) },
  { key: "quality/kayip", permission: "bulut:uretim:oku", module: "production.enabled", params: acceptFactoryDays(panelOnlyRejected(coreLossQuerySchema)), paramNames: ["dateFrom", "dateTo", "kiyas"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => rangedPresentation(p, (range, compareRange, compareMode) => buildLossReport({ range, compareRange, compareMode })) },
  { key: "inventory/depo", permission: "bulut:stok:oku", params: panelOnlyRejected(coreWarehouseQuerySchema), paramNames: [], standard: "KESIT", personalData: "YOK",
    reportRunner: async () => (await buildWarehouseReport()).sunum },
  { key: "subcontract/fasoncular", permission: "bulut:uretim:oku", params: acceptFactoryDays(panelOnlyRejected(coreSubcontractorsQuerySchema)), paramNames: ["dateFrom", "dateTo", "kiyas", "subcontractorId", "itemId", "colorId"], standard: "DONEMLI", personalData: "YOK",
    reportRunner: (p) => rangedPresentation(p, (range, compareRange, compareMode) => {
      const q = p as z.infer<typeof coreSubcontractorsQuerySchema>;
      return buildSubcontractorsReport({ range, compareRange, compareMode, filters: { subcontractorId: q.subcontractorId, itemId: q.itemId, colorId: q.colorId } });
    }) },
  { key: "dokuma/tezgah-randimani", permission: "bulut:uretim:oku", gate: weavingOpen, params: panelOnlyRejected(coreLoomEfficiencyQuerySchema), paramNames: ["from", "to", "kiyas"], standard: "DONEMLI", standardParams: dayParams, personalData: "YOK",
    reportRunner: async (p) => (await buildLoomEfficiencyReport({ window: dayWindowOf("dokuma/tezgah-randimani", p) })).sunum },
  { key: "dokuma/duruslar", permission: "bulut:uretim:oku", gate: weavingOpen, params: panelOnlyRejected(coreLoomStopsQuerySchema), paramNames: ["from", "to", "kiyas", "shiftDefinitionId"], standard: "DONEMLI", standardParams: dayParams, personalData: "YOK",
    reportRunner: async (p) => (await buildLoomStopsReport({ window: dayWindowOf("dokuma/duruslar", p), shiftDefinitionId: (p as z.infer<typeof coreLoomStopsQuerySchema>).shiftDefinitionId })).sunum },
  { key: "dokuma/levent-dengesi", permission: "bulut:uretim:oku", gate: beamBalanceOpen, params: panelOnlyRejected(coreBeamBalanceQuerySchema), paramNames: ["from", "to", "kiyas"], standard: "DONEMLI", standardParams: dayParams, personalData: "YOK",
    reportRunner: async (p) => (await buildBeamBalanceReport({ window: dayWindowOf("dokuma/levent-dengesi", p) })).sunum },
  { key: "finance/alacaklar", permission: "bulut:cari-bakiye:oku", module: "finance.enabled", params: panelOnlyRejected(coreReceivablesQuerySchema), paramNames: ["asOf"], standard: "KESIT", personalData: "YOK",
    reportRunner: async (p) => (await buildReceivablesReport(typeof p.asOf === "string" ? new Date(p.asOf) : new Date())).sunum },
];

export function findRemoteReport(key: string): RemoteReport | undefined {
  return REMOTE_REPORTS.find((r) => r.key === key);
}

async function moduleOpen(m: ModuleKey | undefined): Promise<boolean> {
  if (m === "finance.enabled") return readFinanceEnabled();
  if (m === "production.enabled") return readProductionEnabled();
  if (m === "maliyet.enabled") return (await readProductionEnabled()) && (await readMaliyetEnabled());
  return true;
}

/** Rapor şu an sunulabilir mi — kapalı rapor ve kapalı modül buluta da kapalıdır (fail-closed). */
async function availability(r: RemoteReport): Promise<"ACIK" | "RAPOR_KAPALI" | "MODUL_KAPALI"> {
  if (!(await moduleOpen(r.module))) return "MODUL_KAPALI";
  if (r.gate && !(await r.gate())) return "MODUL_KAPALI";
  // Yüzeye çıkmamış v2 satırı (`hazir:false`) panelde de yoktur — buluta da kapalı (fail-closed).
  const entry = REPORT_BY_KEY.get(r.key);
  if (!entry || !isReportSurfaced(entry)) return "RAPOR_KAPALI";
  const vis = await readReportsClosedKeys();
  if (vis.durum === "olculemedi" || vis.kapali.includes(r.key)) return "RAPOR_KAPALI";
  return "ACIK";
}

/** `rapor-katalogu` ANLIK kaydının içeriği — bulut istenebilir listeyi buradan okur, elle yazmaz. */
export async function remoteReportCatalog(): Promise<
  Array<{ anahtar: string; baslik: string; soru: string; aile: string; izin: string; parametreler: string[]; standartDonemler: string[] }>
> {
  const out = [];
  for (const r of REMOTE_REPORTS) {
    const entry = REPORT_BY_KEY.get(r.key);
    if (!entry || r.key.startsWith("audit/")) continue;
    if ((await availability(r)) !== "ACIK") continue;
    out.push({
      anahtar: r.key,
      baslik: entry.baslik,
      soru: entry.soru,
      aile: r.key.split("/")[0]!,
      izin: r.permission,
      parametreler: [...r.paramNames],
      standartDonemler: r.standard === "DONEMLI" ? [...REPORT_PERIODS] : [],
    });
  }
  return out;
}

/** Filtre seçenek listeleri (`secenekler`) panel süzgecidir, rapor sonucu değildir — gönderilmez. */
function stripUiEnvelope(result: unknown): unknown {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const { secenekler: _s, dusenSatir: _d, ...rest } = result as Record<string, unknown>;
    return rest;
  }
  return result;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "ZAMAN_ASIMI"> {
  let timer: NodeJS.Timeout | null = null;
  const t = new Promise<"ZAMAN_ASIMI">((resolve) => {
    timer = setTimeout(() => resolve("ZAMAN_ASIMI"), ms);
    timer.unref();
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Bir raporu hesaplar ve tel sonucunu kurar (istek ya da standart görüntü). */
export async function computeReportResult(g: {
  readonly istekId: string | null;
  readonly key: string;
  readonly params: Record<string, unknown>;
  readonly donem: ReportPeriod | null;
  readonly nowMs: number;
  readonly timeoutMs?: number;
}): Promise<ReportResult> {
  const base = {
    v: 1 as const,
    istekId: g.istekId,
    raporAnahtari: g.key.slice(0, 80),
    parametreler: g.params,
    donem: g.donem,
    hesaplandi: new Date(g.nowMs).toISOString(),
    kaynakUfuk: new Date(g.nowMs).toISOString(),
  };
  const fail = (hataKodu: ReportResult["hataKodu"]): ReportResult => ReportResultRequestSchema.parse({ ...base, durum: "HATA", veri: null, hataKodu });
  const r = findRemoteReport(g.key);
  if (!r || g.key.startsWith("audit/")) return fail("RAPOR_BILINMIYOR");
  const avail = await availability(r);
  if (avail === "MODUL_KAPALI") return fail("MODUL_KAPALI");
  if (avail === "RAPOR_KAPALI") return fail("RAPOR_KAPALI");
  const parsed = r.params.safeParse(g.params);
  if (!parsed.success) return fail("PARAMETRE_GECERSIZ");
  let value: unknown;
  try {
    const out = await withTimeout(r.reportRunner(parsed.data), g.timeoutMs ?? REPORT_TIMEOUT_MS);
    if (out === "ZAMAN_ASIMI") return fail("ZAMAN_ASIMI");
    if (carriesPersonName(out)) return fail("RAPOR_KAPALI");
    value = stripUiEnvelope(out);
  } catch {
    // İş kuralı hatası (ör. aralık > 366 gün) kullanıcı parametresinin sonucudur.
    return fail("PARAMETRE_GECERSIZ");
  }
  // Tel kodlayıcısı sonlu olmayan sayıda fırlatır; burada yakalanmazsa döngüdeki sonraki raporlar da gitmez.
  try {
    return ReportResultRequestSchema.parse({ ...base, durum: "HAZIR", veri: toWireValue(value), hataKodu: null });
  } catch {
    return fail("PARAMETRE_GECERSIZ");
  }
}

export interface ReportRunOutcome {
  readonly claimed: number;
  readonly sent: number;
  readonly failedSend: number;
}

/** Bulutta bekleyen istekleri üstlenir, hesaplar, sonucu gönderir (her sonuç ayrı imzalı istek). */
export async function claimAndRunReportRequests(ctx: CloudCallContext, nowMs: () => number = Date.now): Promise<ReportRunOutcome> {
  const res = await cloudPost(ctx, SYNC_PATHS.REPORT_CLAIM, { v: 1, enFazla: REPORT_CLAIM_BATCH }, { gzip: false });
  if (!res.ok) return { claimed: 0, sent: 0, failedSend: 0 };
  const parsed = ReportClaimResponseSchema.safeParse(res.json);
  if (!parsed.success) return { claimed: 0, sent: 0, failedSend: 0 };
  let sent = 0;
  let failedSend = 0;
  for (const req of parsed.data.istekler) {
    const result = await computeReportResult({ istekId: req.istekId, key: req.raporAnahtari, params: req.parametreler, donem: null, nowMs: nowMs() });
    const ok = await sendReportResult(ctx, result);
    if (ok) sent++;
    else failedSend++;
  }
  return { claimed: parsed.data.istekler.length, sent, failedSend };
}

/** Sonuç 4 MB (sıkıştırılmış) tavanını aşarsa veri yerine `SONUC_BUYUK` hatası gider. */
export async function sendReportResult(ctx: CloudCallContext, result: ReportResult): Promise<boolean> {
  let body: ReportResult = result;
  if (gzipSync(Buffer.from(JSON.stringify(body))).length > MAX_COMPRESSED_BYTES) {
    body = ReportResultRequestSchema.parse({ ...result, durum: "HATA", veri: null, hataKodu: "SONUC_BUYUK" });
  }
  const r = await cloudPost(ctx, SYNC_PATHS.REPORT_RESULT, body, { gzip: true });
  return r.ok;
}

export interface StandardReportPlan {
  readonly key: string;
  readonly donem: ReportPeriod | null;
  readonly params: Record<string, unknown>;
}

/** Saatlik standart görüntüler: dönemli rapor × üç dönem + kesit rapor × bir. */
export function standardReportPlan(now: Date): StandardReportPlan[] {
  const out: StandardReportPlan[] = [];
  for (const r of REMOTE_REPORTS) {
    const entry = REPORT_BY_KEY.get(r.key);
    if (!entry || !isReportSurfaced(entry)) continue;
    if (r.standard === "DONEMLI") {
      for (const d of REPORT_PERIODS) {
        const range = periodRange(d, now);
        const params = r.standardParams ? r.standardParams(range) : { dateFrom: range.from.toISOString(), dateTo: range.to.toISOString() };
        out.push({ key: r.key, donem: d, params });
      }
    } else if (r.standard === "KESIT") {
      out.push({ key: r.key, donem: null, params: {} });
    }
  }
  return out;
}

/** İçerik özeti (sonucun `veri`si) — aynı sonuç ikinci kez gönderilmez. */
export function reportDigest(result: ReportResult): string {
  return snapshotDigest((result.veri ?? null) as WireValue);
}
