// =============================================================================
// BELGE BASIMI — ana süreç gizli pencere + `webContents.print` sözleşmesi (izlenebilirlik A2)
// =============================================================================
// Renderer'ın iframe `print()`i sonucu SÖYLEMEZ (iptal mi, hata mı, gitti mi). Ana süreç
// basımı gizli, script'siz pencerede yapar ve Chromium'un geri çağrısını sınıflı sonuca
// çevirir. Kanal yalnız HTML + sessiz/yazıcı/kopya taşır; başka her şekil reddedilir.
// =============================================================================

export const DOC_PRINT_CHANNEL = "doc-print:print";
export const DOC_PRINT_PRINTERS_CHANNEL = "doc-print:printers";

/** Belge HTML tavanı — PDF penceresiyle aynı mertebe (bellek; büyük toplu belge). */
export const DOC_PRINT_MAX_HTML_BYTES = 64 * 1024 * 1024;
export const DOC_PRINT_DEVICE_NAME_MAX = 200;
export const DOC_PRINT_COPIES_MAX = 99;

export interface DocPrintRequest {
  html: string;
  /** true → diyalogsuz; yalnız `deviceName` doluyken anlamlıdır. */
  silent: boolean;
  deviceName?: string;
  copies?: number;
}

/** Ana sürecin ölçtüğü sonuç: ILETILDI = spooler kabul etti; kâğıdı hiçbir yol göremez. */
export type DocPrintResult =
  | { status: "ILETILDI"; durationMs: number }
  | { status: "IPTAL"; durationMs: number }
  | { status: "HATA"; errorCode: DocPrintErrorCode; durationMs: number };

/** Ana sürecin hata sınıfları (ham Chromium metni renderer'a GİTMEZ). */
export type DocPrintErrorCode = "SURUCU_YOK" | "YAZICI_BULUNAMADI" | "BELGE_COK_BUYUK" | "ZAMAN_ASIMI" | "BILINMEYEN";

export interface DocPrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
}

export interface DocPrintApi {
  print: (req: DocPrintRequest) => Promise<DocPrintResult>;
  /** İşletim sisteminin yazıcı listesi (`getPrintersAsync`). */
  printers: () => Promise<DocPrinterInfo[]>;
}

const REQUEST_KEYS = new Set(["html", "silent", "deviceName", "copies"]);

/** Yalnız bilinen alanlar; tür/sınır dışı → null (RED). Sessiz basım yazıcı adı olmadan geçmez. */
export function parseDocPrintRequest(raw: unknown): DocPrintRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !REQUEST_KEYS.has(k))) return null;
  if (typeof r.html !== "string" || r.html.length === 0) return null;
  if (typeof r.silent !== "boolean") return null;
  let deviceName: string | undefined;
  if (r.deviceName !== undefined) {
    if (typeof r.deviceName !== "string" || r.deviceName.length > DOC_PRINT_DEVICE_NAME_MAX) return null;
    deviceName = r.deviceName.trim() || undefined;
  }
  if (r.silent && !deviceName) return null;
  let copies: number | undefined;
  if (r.copies !== undefined) {
    if (typeof r.copies !== "number" || !Number.isInteger(r.copies) || r.copies < 1 || r.copies > DOC_PRINT_COPIES_MAX) return null;
    copies = r.copies;
  }
  return { html: r.html, silent: r.silent, ...(deviceName ? { deviceName } : {}), ...(copies ? { copies } : {}) };
}

/**
 * Chromium `failureReason` → sonuç. "cancelled" kullanıcının penceresi kapattığı tek durumdur;
 * yazıcı yok/ad geçersiz sınıflanır, gerisi BILINMEYEN (metin taşınmaz — yol/ad sızmasın).
 */
export function classifyPrintFailure(reason: string | undefined): { status: "IPTAL" } | { status: "HATA"; errorCode: DocPrintErrorCode } {
  const r = (reason ?? "").toLowerCase();
  if (r === "cancelled" || r === "canceled") return { status: "IPTAL" };
  if (r.includes("invalid devicename") || r.includes("invalid printer")) return { status: "HATA", errorCode: "YAZICI_BULUNAMADI" };
  if (r.includes("no printers available")) return { status: "HATA", errorCode: "SURUCU_YOK" };
  return { status: "HATA", errorCode: "BILINMEYEN" };
}
