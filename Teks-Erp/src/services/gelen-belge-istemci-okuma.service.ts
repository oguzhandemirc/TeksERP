// =============================================================================
// GELEN BELGE — cihazda OCR (S16c): tablet fotoğrafı ML Kit ile okur, yüklemeye `clientOcr` ekler; sunucu okuma servisini
// ATLAR ve aynı motor/taslak yolunu (`processClaimedScan`) yükleme isteği içinde koşar — okuma servisi yokken de taslak doğar.
// Her başarısızlıkta tarama PENDING'e döner ve sunucu okumasına düşer (yanıt yine 201); "Bilgisayarda ikinci okuma" kapalıysa
// devralacak okuyucu yok → READ_FAILED (tablet "Okunamadı", sayfa yeniden çekilir). Ham OCR metni audit/log'a girmez.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { uyari } from "../lib/logger";
import { ClientOcrSchema, clientOcrToResult } from "../lib/gelen-belge/istemci-ocr";
import { uprightClientOcr } from "../lib/gelen-belge/sayfa-yonu";
import type { OcrResult } from "../lib/gelen-belge/motor";
import { normalizeBarcodes } from "../lib/gelen-belge/barkod";
import { processClaimedScan, type CompleteFn } from "./gelen-belge-okuma.service";
import { serverCompleter } from "./gelen-belge-sunucu-tamamlama.service";
import { serverReaderState } from "./gelen-belge-sunucu-okuyucu.service";
import { PDF_MIME, SCAN_SELECT, uploadDocumentScan, type DocumentScanInput } from "./gelen-belge-scan.service";

/** `READ`: cihaz okuması taslağa işlendi · `FALLBACK`: sunucu okumasına bırakıldı · `FAILED`: okunamadı, sunucu okuması
 *  kapalı (READ_FAILED) · `null`: cihaz okuması yok/kullanılmadı. */
export type DeviceReadOutcome = "READ" | "FALLBACK" | "FAILED" | null;
/** Ayar kapalıyken düşen/okunmayan taramanın künye neden kodu (audit). */
const SERVER_OCR_DISABLED = "SERVER_OCR_DISABLED";
/** Bekçi düşme yolunu bu parametreyle sınar (işlemci hata atar); üretimde hep `processClaimedScan` (+ `serverCompleter()`). */
type ProcessFn = typeof processClaimedScan;
const SCAN_TABLE = "DOCUMENT_SCAN";

/** Katı ayrıştırma — yazımdan ÖNCE; ihlal 400 `CLIENT_OCR_INVALID` (tablet aynı sayfayı `clientOcr`'sız bir kez yeniden gönderir). */
export function parseClientOcr(raw: unknown): OcrResult {
  const parsed = ClientOcrSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw AppError.badRequest(`Cihaz okuması geçersiz${where}; fotoğraf sunucuda okunacak biçimde yeniden gönderilmeli.`, { code: "CLIENT_OCR_INVALID" });
  }
  // Yan/ters dönük sayfa çeyrek adımla dikleştirilir (`rotation` sözleşmesi saklanan fotoğraf kutularını geri çevirir).
  return clientOcrToResult(uprightClientOcr(parsed.data, "QUARTER").ocr);
}

/** Yeniden kullanılan PENDING kayıt (ağ kopması tekrarı): PENDING → READING atomik claim; kaybeden cihaz okumasını bırakır. */
async function claimPendingForDevice(id: string): Promise<number | null> {
  const c = await prisma.documentScan.updateMany({
    where: { id, status: "PENDING", mimeType: { not: PDF_MIME }, contentState: { not: "PURGED" } },
    data: { status: "READING", attempts: { increment: 1 } },
  });
  if (c.count === 0) return null;
  const row = await prisma.documentScan.findUnique({ where: { id }, select: { status: true, attempts: true } });
  return row?.status === "READING" ? row.attempts : null;
}

/** Cihaz okumasını işler; atılan hata ya da kaybedilen sahiplik → READING'i (yalnız bu denemenin damgasıyla) PENDING'e bırakır. */
async function readOnDevice(c: { id: string; attempts: number; result: OcrResult; userId: string }, process: ProcessFn, complete: CompleteFn): Promise<DeviceReadOutcome> {
  const { id, attempts, result, userId } = c;
  const durationMs = Math.round(result.durationMs ?? 0);
  // Boş başlık alanı kalırsa aynı fotoğraf sunucuda bir kez okunur, yalnız boş alanlar dolar (`gelen-belge-sunucu-tamamlama`).
  const outcome = await process(id, "", async () => ({ ok: true, result, engine: "mlkit", version: null, durationMs }), { complete })
    .catch((err: unknown) => {
      uyari("gelen-belge", `cihaz okuması işlenemedi (${err instanceof Error ? err.name : "?"})`);
      return "ERROR" as const;
    });
  if (outcome === "READ") return "READ";
  // Sunucu okuması kapalıysa PENDING'e bırakmak sonsuz "okunuyor" olur → READ_FAILED/0 (panel "Yeniden okut" ayar açılınca).
  const serverOff = !(await serverReaderState()).enabled;
  const next = serverOff ? { status: "READ_FAILED" as const, attempts: 0 } : { status: "PENDING" as const, attempts: attempts - 1 };
  const back = await prisma.documentScan.updateMany({ where: { id, status: "READING", attempts }, data: next });
  // Düşme bir durum geçişidir (READING → PENDING|READ_FAILED) — ayak izi; READ yolu kendi audit'ini `processClaimedScan`te basar.
  const newData = serverOff ? { status: next.status, deviceOcr: "FAILED", reason: SERVER_OCR_DISABLED } : { status: next.status, deviceOcr: "FALLBACK" };
  if (back.count === 1) await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READING" }, newData });
  return serverOff ? "FAILED" : "FALLBACK";
}

/**
 * Yükleme ucu gövdesi: `clientOcr` yoksa bugünkü yükleme. Varsa yeni fotoğraf READING doğar ve hemen cihaz okumasıyla
 * işlenir; yeniden kullanılan PENDING kayıt claim'lenip aynı yoldan okunur; okunmuş/başarısız/PDF kayıt cihaz okumasını yok sayar.
 */
export async function uploadScanWithDeviceRead(input: DocumentScanInput & { clientOcr?: unknown; barcodes?: { format: string; value: string }[] }, userId: string, process: ProcessFn = processClaimedScan, complete: CompleteFn = serverCompleter()) {
  const { clientOcr, barcodes: rawBarcodes, ...rest } = input;
  const parsed = clientOcr === undefined || clientOcr === null ? null : parseClientOcr(clientOcr);
  // Fotoğraftaki barkodlar cihaz okumasına eklenir (motor `fromBarcode` alanına yazar); cihaz okuması yoksa kullanılmaz.
  const barcodes = normalizeBarcodes(rawBarcodes);
  const device = parsed && barcodes.length ? { ...parsed, barcodes } : parsed;
  // Cihaz okuması gelmedi + sunucu okuması kapalı: okuyacak kimse yok → kayıt READ_FAILED doğar (PDF zaten öyle).
  const bornUnread = device === null && !(await serverReaderState()).enabled ? SERVER_OCR_DISABLED : undefined;
  const r = await uploadDocumentScan(rest, userId, { bornReading: device !== null, bornUnread });
  if (!device || r.scan.mimeType === PDF_MIME) return { ...r, deviceOcr: null as DeviceReadOutcome };
  const attempts = !r.duplicate && r.scan.status === "READING" ? r.scan.attempts : r.scan.status === "PENDING" ? await claimPendingForDevice(r.scan.id) : null;
  if (attempts === null) return { ...r, deviceOcr: null as DeviceReadOutcome };
  const deviceOcr = await readOnDevice({ id: r.scan.id, attempts, result: device, userId }, process, complete);
  const scan = await prisma.documentScan.findUniqueOrThrow({ where: { id: r.scan.id }, select: SCAN_SELECT });
  return { ...r, scan, deviceOcr };
}
