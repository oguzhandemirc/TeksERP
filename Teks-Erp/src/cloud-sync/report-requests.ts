// RAPOR İSTEĞİ İŞLEYİCİSİ (§7): bulutta hesap yapılmaz — bulut isteği yazar, zil `rapor`
// fabrikayı dürter, fabrika kendi rapor servisiyle ve KENDİ Zod şemasıyla (bulut
// doğrulaması yetmez) hesaplar, sonucu imzalı gönderir. Standart dönem görüntüleri
// (karne ailesi × bugün · bu ay · geçen ay) saatlik, istek beklemeden gider.
// Audit raporları (`audit/*`) ve kişi adı taşıyan raporlar buluta GİTMEZ ve istenemez.
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { REPORT_BY_KEY, type ReportKey } from "../constants/report-catalog";
import { readFinanceEnabled, readProductionEnabled, readReportsClosedKeys } from "../services/system-setting.service";
import { dateRangeSchema, resolveDateRange } from "../services/reports/_shared";
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
  /** Bulut okuma izni — raporun AİLESİNE düşen projeksiyon izni (§10). */
  readonly permission: string;
  readonly module?: ModuleKey;
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
  readonly run: (params: Record<string, unknown>) => Promise<unknown>;
}

const rangeOf = (p: Record<string, unknown>) => resolveDateRange(p as z.infer<typeof dateRangeSchema>);
const AgingParams = z.strictObject({ asOf: z.string().datetime({ offset: true }).optional() });

/** Buluttan istenebilir raporlar — KATALOG ∩ bu liste; `audit/*` hiçbir zaman girmez (bekçi ölçer). */
export const REMOTE_REPORTS: readonly RemoteReport[] = [
  { key: "sales/order-intake", permission: "bulut:siparis:oku", params: dateRangeSchema, paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    run: (p) => getOrderIntake(rangeOf(p)) },
  { key: "sales/shipment-scorecard", permission: "bulut:sevkiyat:oku", params: dateRangeSchema, paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    run: (p) => getShipmentScorecard(rangeOf(p)) },
  { key: "customer/scorecard", permission: "bulut:siparis:oku", params: dateRangeSchema, paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    run: (p) => getCustomerScorecard(rangeOf(p)) },
  { key: "quality/scorecard", permission: "bulut:uretim:oku", params: dateRangeSchema, paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    run: (p) => getQualityScorecard(rangeOf(p)) },
  { key: "subcontract/scorecard", permission: "bulut:uretim:oku", params: dateRangeSchema, paramNames: ["dateFrom", "dateTo"], standard: "DONEMLI", personalData: "YOK",
    run: (p) => getSubcontractScorecard(rangeOf(p)) },
  { key: "inventory/scorecard", permission: "bulut:stok:oku", params: z.strictObject({}), paramNames: [], standard: "KESIT", personalData: "YOK",
    run: () => getStockScorecard() },
  { key: "finance/aging", permission: "bulut:cari-bakiye:oku", module: "finance.enabled", params: AgingParams, paramNames: ["asOf"], standard: "KESIT", personalData: "YOK",
    run: (p) => getAgingReport({ asOf: typeof p.asOf === "string" ? new Date(p.asOf) : new Date() }) },
  { key: "finance/cheque-due", permission: "bulut:cek:oku", module: "finance.enabled", params: dateRangeSchema, paramNames: ["dateFrom", "dateTo"], standard: "KESIT", personalData: "YOK",
    run: async (p) => {
      const q = p as z.infer<typeof dateRangeSchema>;
      return (await chequeService.dueSummary({ from: q.dateFrom ? new Date(q.dateFrom) : undefined, to: q.dateTo ? new Date(q.dateTo) : undefined })).data;
    } },
];

export function findRemoteReport(key: string): RemoteReport | undefined {
  return REMOTE_REPORTS.find((r) => r.key === key);
}

async function moduleOpen(m: ModuleKey | undefined): Promise<boolean> {
  if (m === "finance.enabled") return readFinanceEnabled();
  if (m === "production.enabled") return readProductionEnabled();
  return true;
}

/** Rapor şu an sunulabilir mi — kapalı rapor ve kapalı modül buluta da kapalıdır (fail-closed). */
async function availability(r: RemoteReport): Promise<"ACIK" | "RAPOR_KAPALI" | "MODUL_KAPALI"> {
  if (!(await moduleOpen(r.module))) return "MODUL_KAPALI";
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
    const out = await withTimeout(r.run(parsed.data), g.timeoutMs ?? REPORT_TIMEOUT_MS);
    if (out === "ZAMAN_ASIMI") return fail("ZAMAN_ASIMI");
    value = stripUiEnvelope(out);
  } catch {
    // İş kuralı hatası (ör. aralık > 366 gün) kullanıcı parametresinin sonucudur.
    return fail("PARAMETRE_GECERSIZ");
  }
  return ReportResultRequestSchema.parse({ ...base, durum: "HAZIR", veri: toWireValue(value), hataKodu: null });
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
    if (r.standard === "DONEMLI") {
      for (const d of REPORT_PERIODS) {
        const range = periodRange(d, now);
        out.push({ key: r.key, donem: d, params: { dateFrom: range.from.toISOString(), dateTo: range.to.toISOString() } });
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
