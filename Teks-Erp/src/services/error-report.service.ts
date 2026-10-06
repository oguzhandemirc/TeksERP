// HATA RAPORLARI (müşteri onaylı, kişisel verisiz) — onay · toplama · kuyruk · gönderim · budama TEK dosyada.
// Varsayılan KAPALI: onay satırı yoksa hiçbir şey toplanmaz, yazılmaz, gönderilmez (bugünkü davranış). Toplama
// FAIL-SILENT'tir: hiçbir yol fırlatmaz, istek/iş akışını bekletmez. Gönderim ayrı kurulum imzalı kanaldır
// (`POST /v1/hata-raporu`, amaç `hata-raporu`) — yoklamaya karışmaz. Satırlar TELEMETRİdir (audit muaf, budanır).
import { randomUUID } from "node:crypto";
import type { ErrorReportEntry as QueueRow } from "@prisma/client";
import prisma from "../lib/prisma";
import { APP_VERSION } from "../lib/app-version";
import { getLicenseSnapshot } from "../lib/license/runtime";
import { isVerificationMode } from "../lib/dogrulama-kipi";
import {
  ENDPOINTS,
  ERROR_REPORT_BATCH_MAX,
  ERROR_REPORT_COUNT_MAX,
  ErrorReportEntrySchema,
  ErrorReportRequestSchema,
  ErrorReportResponseSchema,
  VersionTextSchema,
  errorReportGroupKey,
  isPlainObject,
  type ErrorReportEntry,
  type ErrorReportSource,
} from "../lib/license/protocol";
import {
  componentFromRoute,
  toComponent,
  toErrorClass,
  toErrorCode,
  toRouteTemplate,
  toStackFrames,
} from "../lib/error-report/sanitize";
import { AppError } from "../utils/app-error";
import { ERROR_REPORT_CONSENT_SETTING_KEY } from "../constants/reserved-settings";
import { systemSettingService } from "./system-setting.service";
import { egressTransport, vendorPost, type VendorTransport } from "./helpers/license-wire.helper";

export const ERROR_REPORT_CONSENT_KEY = ERROR_REPORT_CONSENT_SETTING_KEY;
/** Bellekte birikebilecek en çok grup (akış başına); dolunca yeni grup sayılır ama tutulmaz. */
export const ERROR_BUFFER_MAX_GROUPS = 200;
/** DB'de gönderilmemiş en çok grup (çevrimdışı birikimin üst sınırı). */
export const ERROR_QUEUE_MAX_GROUPS = 500;
/** Gönderilmiş satır bu kadar gün panelde görünür, sonra budanır; gönderilemeyen satır daha kısa yaşar. */
export const ERROR_SENT_KEEP_DAYS = 30;
export const ERROR_UNSENT_KEEP_DAYS = 7;
const DAY_MS = 86_400_000;
const INT_MAX = 2_147_483_647;

// ── Onay ────────────────────────────────────────────────────────────────────
let consentCache: boolean | null = null;

function readConsentValue(value: unknown): boolean {
  return isPlainObject(value) && value["enabled"] === true;
}

/** DB'den okur ve önbelleği tazeler; okunamazsa KAPALI sayılır. */
export async function loadErrorReportConsent(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: ERROR_REPORT_CONSENT_KEY }, select: { value: true } });
    consentCache = readConsentValue(row?.value);
  } catch {
    consentCache = false;
  }
  return consentCache;
}

/** Toplayıcının kapısı — önbellek hiç dolmadıysa KAPALI. */
export function errorReportConsentGiven(): boolean {
  return consentCache === true;
}

export interface ErrorReportConsentView {
  readonly acik: boolean;
  readonly degistiren: { readonly id: string; readonly fullName: string } | null;
  readonly degisimZamani: string | null;
}

export async function getErrorReportConsent(): Promise<ErrorReportConsentView> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: ERROR_REPORT_CONSENT_KEY },
    select: { value: true, updatedAt: true, updatedBy: { select: { id: true, fullName: true } } },
  });
  return { acik: readConsentValue(row?.value), degistiren: row?.updatedBy ?? null, degisimZamani: row?.updatedAt.toISOString() ?? null };
}

/** Onay verir/geri alır (audit `systemSettingService.set` içinde: kim + ne zaman). Geri alınca bekleyen hiçbir şey gitmez. */
export async function setErrorReportConsent(enabled: boolean, userId: string | undefined): Promise<ErrorReportConsentView> {
  await systemSettingService.set(ERROR_REPORT_CONSENT_KEY, { enabled }, "Hata raporlarının satıcıya gönderilmesine yönetici onayı", userId);
  consentCache = enabled;
  if (!enabled) {
    buffer.clear();
    droppedSinceSent = 0;
    await serialized(() => prisma.errorReportEntry.deleteMany({ where: { sentAt: null } }));
  }
  return getErrorReportConsent();
}

// ── Toplama (bellek) ────────────────────────────────────────────────────────
interface Buffered {
  entry: Omit<ErrorReportEntry, "ilk" | "son" | "sayi">;
  firstAt: Date;
  lastAt: Date;
  count: number;
}
const buffer = new Map<string, Buffered>();
let droppedSinceSent = 0;

export interface RawErrorInput {
  readonly source: ErrorReportSource;
  readonly version?: string | null;
  readonly code?: unknown;
  readonly errorClass?: unknown;
  readonly component?: unknown;
  /** Ham yol ya da şablon — şablona çevrilir, parametre/sorgu atılır. */
  readonly route?: string | null;
  /** Ham yığın metni — yalnız dosya:satır çıkarılır, metin TUTULMAZ. */
  readonly stack?: unknown;
}

function versionOf(raw: string | null | undefined): string {
  if (typeof raw === "string" && VersionTextSchema.safeParse(raw).success) return raw;
  return VersionTextSchema.safeParse(APP_VERSION).success ? APP_VERSION : "0.0.0";
}

/** Ham girdi → allowlist kaydı (sayı/zaman hariç) ya da null. Saf; dışa açık (bekçi ölçer). */
export function buildErrorReportEntry(input: RawErrorInput): Buffered["entry"] | null {
  const route = toRouteTemplate(input.route ?? null);
  const entry = {
    kaynak: input.source,
    surum: versionOf(input.version),
    kod: toErrorCode(input.code),
    sinif: toErrorClass(input.errorClass),
    bilesen: input.component === undefined ? componentFromRoute(route) : toComponent(input.component),
    yol: route,
    yigin: toStackFrames(input.stack),
  };
  const iso = new Date(0).toISOString();
  return ErrorReportEntrySchema.safeParse({ ...entry, ilk: iso, son: iso, sayi: 1 }).success ? entry : null;
}

/** Hata kaydı — onay yoksa HİÇBİR ŞEY yapmaz; asla fırlatmaz. */
export function recordError(input: RawErrorInput, now: Date = new Date()): void {
  try {
    if (!errorReportConsentGiven()) return;
    const entry = buildErrorReportEntry(input);
    if (!entry) return;
    const key = errorReportGroupKey(entry);
    const prev = buffer.get(key);
    if (prev) {
      prev.count = Math.min(prev.count + 1, ERROR_REPORT_COUNT_MAX);
      prev.lastAt = now;
      return;
    }
    if (buffer.size >= ERROR_BUFFER_MAX_GROUPS) {
      droppedSinceSent = Math.min(droppedSinceSent + 1, ERROR_REPORT_COUNT_MAX);
      return;
    }
    buffer.set(key, { entry, firstAt: now, lastAt: now, count: 1 });
  } catch {
    /* fail-silent: rapor toplanamazsa fabrika etkilenmez */
  }
}

/** Sunucu hatası (5xx ara katmanı · süreç düzeyi) — `err` yalnız ad/kod/yığın için okunur, mesajı okunmaz. */
export function recordServerError(err: unknown, g: { route?: string | null; component?: string; code?: string } = {}): void {
  const e = err as { name?: unknown; code?: unknown; stack?: unknown; details?: { code?: unknown } } | null;
  const code = g.code ?? (err instanceof AppError ? e?.details?.code : e?.code);
  recordError({ source: "sunucu", code, errorClass: e?.name, component: g.component, route: g.route ?? null, stack: e?.stack });
}

// ── Kuyruk (DB) ─────────────────────────────────────────────────────────────
let chain: Promise<unknown> = Promise.resolve();
/** Boşaltma ve gönderim talebi süreç içinde sıraya girer (aynı satıra yarışarak sayaç kaybolmasın). */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Bellekteki grupları kuyruğa yazar: bekleyen aynı grup sayaç artırır; kuyruk tavanında yeni grup düşer. */
export function flushErrorReports(): Promise<number> {
  return serialized(async () => {
    if (buffer.size === 0) return 0;
    const items = [...buffer.entries()];
    buffer.clear();
    if (!errorReportConsentGiven()) return 0;
    let room = Math.max(0, ERROR_QUEUE_MAX_GROUPS - (await prisma.errorReportEntry.count({ where: { sentAt: null } })));
    let written = 0;
    for (const [key, b] of items) {
      const bumped = await prisma.errorReportEntry.updateMany({
        where: { pendingKey: key, count: { lte: INT_MAX - b.count } },
        data: { count: { increment: b.count }, lastAt: b.lastAt },
      });
      if (bumped.count > 0) {
        written++;
        continue;
      }
      if (room === 0) {
        droppedSinceSent = Math.min(droppedSinceSent + b.count, ERROR_REPORT_COUNT_MAX);
        continue;
      }
      room--;
      await prisma.errorReportEntry.create({
        data: {
          pendingKey: key,
          groupKey: key,
          source: b.entry.kaynak,
          version: b.entry.surum,
          code: b.entry.kod,
          errorClass: b.entry.sinif,
          component: b.entry.bilesen,
          routeTemplate: b.entry.yol,
          stackFrames: b.entry.yigin,
          count: b.count,
          firstAt: b.firstAt,
          lastAt: b.lastAt,
        },
      });
      written++;
    }
    return written;
  });
}

function toWireEntry(r: QueueRow): ErrorReportEntry {
  return {
    kaynak: r.source as ErrorReportSource,
    surum: r.version,
    kod: r.code,
    sinif: r.errorClass,
    bilesen: r.component,
    yol: r.routeTemplate,
    yigin: r.stackFrames,
    ilk: r.firstAt.toISOString(),
    son: r.lastAt.toISOString(),
    sayi: Math.min(r.count, ERROR_REPORT_COUNT_MAX),
  };
}

/** Gönderilecek parti: önce yarım kalmış parti (aynı `partiId` ile tekrar), yoksa bekleyenlerden yeni parti (atomik claim). */
async function claimBatch(): Promise<string | null> {
  const open = await prisma.errorReportEntry.findFirst({ where: { sentAt: null, batchId: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { batchId: true } });
  if (open?.batchId) return open.batchId;
  const ids = (
    await prisma.errorReportEntry.findMany({ where: { pendingKey: { not: null } }, orderBy: [{ firstAt: "asc" }, { id: "asc" }], take: ERROR_REPORT_BATCH_MAX, select: { id: true } })
  ).map((r) => r.id);
  if (ids.length === 0) return null;
  const batchId = randomUUID();
  const claim = await prisma.errorReportEntry.updateMany({ where: { id: { in: ids }, pendingKey: { not: null }, batchId: null }, data: { batchId, pendingKey: null } });
  return claim.count > 0 ? batchId : null;
}

export type ErrorReportSendOutcome = "GONDERILDI" | "BOS" | "ONAY_YOK" | "LISANS_ETKIN_DEGIL" | "DOGRULAMA_KIPI" | "BEKLIYOR";

/** Bir parti gönderir. Onay her gönderimde DB'den TAZE okunur; hata fabrikayı etkilemez (sonuç döner, fırlatmaz). */
export async function sendErrorReports(transport: VendorTransport = egressTransport): Promise<ErrorReportSendOutcome> {
  try {
    if (!(await loadErrorReportConsent())) return "ONAY_YOK";
    if (isVerificationMode()) return "DOGRULAMA_KIPI";
    const snap = getLicenseSnapshot();
    if (!snap.activated || !snap.licenseId) return "LISANS_ETKIN_DEGIL";
    await flushErrorReports();
    return await serialized(async () => {
      const batchId = await claimBatch();
      if (!batchId) return "BOS" as const;
      const rows = await prisma.errorReportEntry.findMany({ where: { batchId, sentAt: null }, orderBy: [{ firstAt: "asc" }, { id: "asc" }] });
      if (rows.length === 0) return "BOS" as const;
      const dropped = droppedSinceSent;
      const body = ErrorReportRequestSchema.safeParse({ v: 1, partiId: batchId, kayitlar: rows.map(toWireEntry), dusurulen: dropped });
      if (!body.success) {
        // Allowlist'ten geçemeyen satır gönderilmez ve yeniden denenmez (telemetri; içerik dışarı çıkmaz).
        await prisma.errorReportEntry.deleteMany({ where: { batchId, sentAt: null } });
        return "BEKLIYOR" as const;
      }
      let code: string | null = null;
      let json: unknown = null;
      try {
        const r = await vendorPost(ENDPOINTS.ERROR_REPORT, "hata-raporu", body.data, transport);
        if (r.ok) json = r.json;
        else code = r.code;
      } catch (err) {
        code = err instanceof AppError ? String(err.details?.code ?? "GONDERILEMEDI") : "GONDERILEMEDI";
      }
      const parsed = code === null ? ErrorReportResponseSchema.safeParse(json) : null;
      if (!parsed?.success || parsed.data.partiId !== batchId) {
        await prisma.errorReportEntry.updateMany({
          where: { batchId, sentAt: null },
          data: { sendAttempts: { increment: 1 }, lastErrorCode: (code ?? "YANIT_GECERSIZ").slice(0, 60) },
        });
        return "BEKLIYOR" as const;
      }
      await prisma.errorReportEntry.updateMany({ where: { batchId, sentAt: null }, data: { sentAt: new Date(), sendAttempts: { increment: 1 }, lastErrorCode: null } });
      droppedSinceSent = Math.max(0, droppedSinceSent - dropped);
      return "GONDERILDI" as const;
    });
  } catch {
    return "BEKLIYOR";
  }
}

/** Budama (TELEMETRİ, yaşa göre): gönderilmiş satır 30, gönderilemeyen 7 gün sonra silinir. */
export async function pruneErrorReports(nowMs: number = Date.now()): Promise<number> {
  const sent = await prisma.errorReportEntry.deleteMany({ where: { sentAt: { lt: new Date(nowMs - ERROR_SENT_KEEP_DAYS * DAY_MS) } } });
  const stale = await prisma.errorReportEntry.deleteMany({ where: { sentAt: null, createdAt: { lt: new Date(nowMs - ERROR_UNSENT_KEEP_DAYS * DAY_MS) } } });
  return sent.count + stale.count;
}

// ── Panel görünümü (şeffaflık: ne gidiyor, ne gitti) ─────────────────────────
export async function getErrorReportOverview() {
  const [onay, bekleyen, gonderilen, kayitlar] = [
    await getErrorReportConsent(),
    await prisma.errorReportEntry.count({ where: { sentAt: null } }),
    await prisma.errorReportEntry.count({ where: { sentAt: { not: null } } }),
    await prisma.errorReportEntry.findMany({
      orderBy: [{ lastAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true, source: true, version: true, code: true, errorClass: true, component: true, routeTemplate: true,
        stackFrames: true, count: true, firstAt: true, lastAt: true, sentAt: true, lastErrorCode: true,
      },
    }),
  ];
  return { onay, bekleyen, gonderilen, kayitlar };
}

/** Bekçi düzeneği: bellek durumunu sıfırlar (yalnız testlerde). */
export function resetErrorReportStateForTest(): void {
  buffer.clear();
  droppedSinceSent = 0;
  consentCache = null;
}
