// =============================================================================
// YAZDIRMA GEÇMİŞİ RAPORU — panelin `POST /api/print-jobs` istemcisi (izlenebilirlik A2)
// =============================================================================
// Basım fabrikayı DURDURMAZ: rapor basımdan SONRA, beklenmeden gider; hiçbir hata fırlatmaz,
// genel hata toast'ı basmaz (`suppressErrorToast`). Eski backend (uç yok → 404) sessizce
// yutulur. Token rapor (= mantıksal deneme) başına doğar; yalnız belirsiz hatada aynı token'la
// yeniden denenir — sunucu ilk denemeyi yazmışsa ikinci satır doğmaz.
// =============================================================================
import apiClient from "@/services/apiClient";
import { isAmbiguousFailure } from "@/lib/attemptToken";
import { knownClientVersion } from "@/lib/client-info";
import { IS_ELECTRON } from "@/lib/runtime-env";

/** A1 kataloğunun panel aynası (`Teks-Erp/src/constants/print-subject-catalog.ts`). */
export type PrintSubjectKind =
  | "ETIKET_TOP"
  | "ETIKET_CUVAL"
  | "ETIKET_NUMUNE"
  | "ETIKET_TEZGAH"
  | "ETIKET_LEVENT"
  | "ETIKET_SERBEST"
  | "ETIKET_TOPLU"
  | "BELGE"
  | "REFAKAT_KARTI"
  | "CEKI_LISTESI"
  | "FASON_CEKI"
  | "SERBEST_BELGE"
  | "RAPOR"
  | "LISTE"
  | "KIMLIK_KARTI"
  | "TEST";
export type PrintSubjectTable =
  | "rolls"
  | "sacks"
  | "swatches"
  | "machines"
  | "warp_beams"
  | "traveler_cards"
  | "printed_documents"
  | "shipments"
  | "manifests"
  | "work_orders"
  | "users"
  | "label_templates"
  | "subcontractor_dispatches";
export type PrintStatus = "ILETILDI" | "HATA" | "IPTAL" | "BELIRSIZ" | "SIMULE";
export type PrintTransport =
  | "SISTEM_PENCERESI"
  | "SESSIZ_OS"
  | "SERI"
  | "TCP_9100"
  | "CUPS"
  | "WINSPOOL"
  | "BLUETOOTH"
  | "SUNUCU_TCP"
  | "PDF_DOSYA";
export type PrintOutputKind = "PRINTER" | "PDF";
export type PrintSource = "PANEL_MASAUSTU" | "PANEL_WEB";

/** İş ucunun gövdesine eklenen basım künyesi — backend `printJobAttachmentSchema` ikizi (iki uç). */
export interface PrintJobAttachment {
  transport?: PrintTransport;
  printerName?: string;
  printerAddress?: string;
  peripheralId?: string;
  durationMs?: number;
  copies?: number;
  appVersion?: string;
}

/** `POST /api/print-jobs` gövdesi — backend `printJobReportSchema` ikizi. İçerik (HTML/PIN) ALANI YOK. */
export interface PrintJobReport extends PrintJobAttachment {
  subjectKind: PrintSubjectKind;
  status: PrintStatus;
  source?: PrintSource;
  outputKind?: PrintOutputKind;
  docType?: string;
  subjectTable?: PrintSubjectTable;
  subjectId?: string;
  subjectIds?: string[];
  subjectNo?: string;
  printedDocumentId?: string;
  docVersion?: number;
  itemCount?: number;
  errorCode?: string;
  errorMessage?: string;
  bytes?: number;
}

const REPORT_KEYS: ReadonlySet<string> = new Set([
  "transport", "printerName", "printerAddress", "peripheralId", "durationMs", "copies", "appVersion",
  "subjectKind", "status", "source", "outputKind", "docType", "subjectTable", "subjectId", "subjectIds",
  "subjectNo", "printedDocumentId", "docVersion", "itemCount", "errorCode", "errorMessage", "bytes",
]);

const clip = (v: string | undefined, max: number) => (v && v.length > max ? v.slice(0, max) : v);

/** Kaynak etiketi: masaüstü kabuğu mu, tarayıcı mı (yalnız gösterim; güvenlik sınırı değil). */
export function printSource(): PrintSource {
  return IS_ELECTRON ? "PANEL_MASAUSTU" : "PANEL_WEB";
}

export function appVersion(): string | undefined {
  return clip(knownClientVersion() ?? undefined, 32);
}

/**
 * Gövdeyi beyaz listeye indirger: bilinmeyen anahtar (ör. yanlışlıkla geçen `html`) DÜŞER, boş alan
 * gönderilmez. Kimlik kartı yükünün içerik taşımadığının ikinci hattı burasıdır (birincisi tip).
 */
export function buildReportBody(report: PrintJobReport, clientToken: string): Record<string, unknown> {
  const out: Record<string, unknown> = { clientToken };
  for (const [k, v] of Object.entries(report)) {
    if (!REPORT_KEYS.has(k) || v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  if (typeof out.errorMessage === "string") out.errorMessage = clip(out.errorMessage, 300);
  if (typeof out.printerName === "string") out.printerName = clip(out.printerName, 120);
  if (typeof out.printerAddress === "string") out.printerAddress = clip(out.printerAddress, 128);
  if (typeof out.subjectNo === "string") out.subjectNo = clip(out.subjectNo, 64);
  if (Array.isArray(out.subjectIds)) out.subjectIds = (out.subjectIds as string[]).slice(0, 200);
  out.source ??= printSource();
  const ver = appVersion();
  if (ver) out.appVersion ??= ver;
  return out;
}

// ─── Yetenek: bu backend yazdırma geçmişini biliyor mu ─────────────────────────
// Katı şemalı iş ucu (çeki listesi `.strict()`) eski backend'de `printJob` alanıyla 400 döner;
// alan YALNIZ yetenek doğrulanınca eklenir. Uç varsa her cevap (200/400/403) "var" demektir.
type Capability = { value: boolean; at: number };
let capability: Capability | null = null;
let probe: Promise<boolean> | null = null;
/** "Yok" cevabı backend güncellemesinden sonra tazelensin diye kısa ömürlüdür. */
export const CAPABILITY_NEGATIVE_TTL_MS = 10 * 60 * 1000;

function remember(value: boolean): void {
  capability = { value, at: Date.now() };
}

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status;
}

export async function supportsPrintJobs(): Promise<boolean> {
  if (capability && (capability.value || Date.now() - capability.at < CAPABILITY_NEGATIVE_TTL_MS)) return capability.value;
  probe ??= apiClient
    .get("/api/print-jobs", { params: { limit: 1 }, suppressErrorToast: true, timeout: 4000 })
    .then(() => {
      remember(true);
      return true;
    })
    .catch((err: unknown) => {
      const s = statusOf(err);
      if (s === undefined) return false; // ağ hatası: bilinmiyor → gönderme, hatırlama
      remember(s !== 404);
      return s !== 404;
    })
    .finally(() => {
      probe = null;
    });
  return probe;
}

/** Yalnız testler. */
export function resetPrintJobCapabilityForTest(): void {
  capability = null;
  probe = null;
}

/** Belirsiz hatada yeniden deneme aralıkları (aynı token). */
export const REPORT_RETRY_DELAYS_MS = [1500, 5000] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Basım sonucunu bildirir. ASLA fırlatmaz; dönen söz yalnız testler ve sıralama içindir —
 * çağıranlar beklemeden bırakır (`void`). 404 → eski backend, yetenek "yok" olarak hatırlanır.
 */
export async function reportPrintJob(
  report: PrintJobReport,
  newToken: () => string = () => crypto.randomUUID(),
): Promise<"YAZILDI" | "DESTEKLENMIYOR" | "REDDEDILDI" | "DUSTU"> {
  if (capability && !capability.value && Date.now() - capability.at < CAPABILITY_NEGATIVE_TTL_MS) return "DESTEKLENMIYOR";
  // Rapor = tek mantıksal deneme: token burada bir kez doğar, yalnız belirsiz hatada aynı token'la yeniden gider.
  const clientToken = newToken();
  const body = buildReportBody(report, clientToken);
  for (let attempt = 0; ; attempt++) {
    try {
      await apiClient.post("/api/print-jobs", body, { suppressErrorToast: true });
      remember(true);
      return "YAZILDI";
    } catch (err) {
      if (statusOf(err) === 404) {
        remember(false);
        return "DESTEKLENMIYOR";
      }
      if (!isAmbiguousFailure(err)) return "REDDEDILDI";
      const delay = REPORT_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) return "DUSTU";
      await sleep(delay);
    }
  }
}

export const printJobService = {
  report: (report: PrintJobReport): void => {
    void reportPrintJob(report).catch(() => undefined);
  },
  supportsPrintJobs,
};
