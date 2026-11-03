// =============================================================================
// GELEN BELGE — cihazda OCR (S16c): tablet fotoğrafı ML Kit ile okur, yüklemeye `clientOcr` ekler; sunucu okuma servisini
// ATLAR ve aynı motor/taslak yolunu (`processClaimedScan`) yükleme isteği içinde koşar — okuma servisi yokken de taslak doğar.
// Her başarısızlıkta tarama PENDING'e döner ve sunucu okumasına düşer (yanıt yine 201). Ham OCR metni audit/log'a girmez.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { uyari } from "../lib/logger";
import { ClientOcrSchema, clientOcrToResult } from "../lib/gelen-belge/istemci-ocr";
import type { OcrResult } from "../lib/gelen-belge/motor";
import { processClaimedScan } from "./gelen-belge-okuma.service";
import { PDF_MIME, SCAN_SELECT, uploadDocumentScan, type DocumentScanInput } from "./gelen-belge-scan.service";

/** `READ`: cihaz okuması taslağa işlendi · `FALLBACK`: sunucu okumasına bırakıldı · `null`: cihaz okuması yok/kullanılmadı. */
export type DeviceReadOutcome = "READ" | "FALLBACK" | null;
/** Bekçi düşme yolunu bu parametreyle sınar (işlemci hata atar); üretimde hep `processClaimedScan`. */
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
  return clientOcrToResult(parsed.data);
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
async function readOnDevice(id: string, attempts: number, result: OcrResult, process: ProcessFn, userId: string): Promise<DeviceReadOutcome> {
  const durationMs = Math.round(result.durationMs ?? 0);
  const outcome = await process(id, "", async () => ({ ok: true, result, engine: "mlkit", version: null, durationMs }))
    .catch((err: unknown) => {
      uyari("gelen-belge", `cihaz okuması işlenemedi (${err instanceof Error ? err.name : "?"}) — sunucu okumasına bırakıldı`);
      return "ERROR" as const;
    });
  if (outcome === "READ") return "READ";
  const back = await prisma.documentScan.updateMany({ where: { id, status: "READING", attempts }, data: { status: "PENDING", attempts: attempts - 1 } });
  // Düşme bir durum geçişidir (READING → PENDING) — ayak izi; READ yolu kendi audit'ini `processClaimedScan`te basar.
  if (back.count === 1) await AuditService.log({ userId, action: "UPDATE", tableName: SCAN_TABLE, recordId: id, oldData: { status: "READING" }, newData: { status: "PENDING", deviceOcr: "FALLBACK" } });
  return "FALLBACK";
}

/**
 * Yükleme ucu gövdesi: `clientOcr` yoksa bugünkü yükleme. Varsa yeni fotoğraf READING doğar ve hemen cihaz okumasıyla
 * işlenir; yeniden kullanılan PENDING kayıt claim'lenip aynı yoldan okunur; okunmuş/başarısız/PDF kayıt cihaz okumasını yok sayar.
 */
export async function uploadScanWithDeviceRead(input: DocumentScanInput & { clientOcr?: unknown }, userId: string, process: ProcessFn = processClaimedScan) {
  const { clientOcr, ...rest } = input;
  const device = clientOcr === undefined || clientOcr === null ? null : parseClientOcr(clientOcr);
  const r = await uploadDocumentScan(rest, userId, { bornReading: device !== null });
  if (!device || r.scan.mimeType === PDF_MIME) return { ...r, deviceOcr: null as DeviceReadOutcome };
  const attempts = !r.duplicate && r.scan.status === "READING" ? r.scan.attempts : r.scan.status === "PENDING" ? await claimPendingForDevice(r.scan.id) : null;
  if (attempts === null) return { ...r, deviceOcr: null as DeviceReadOutcome };
  const deviceOcr = await readOnDevice(r.scan.id, attempts, device, process, userId);
  const scan = await prisma.documentScan.findUniqueOrThrow({ where: { id: r.scan.id }, select: SCAN_SELECT });
  return { ...r, scan, deviceOcr };
}
