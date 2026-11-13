// =============================================================================
// Patron rapor koşumunun DOSYASI (2026-11-13) — `GET /api/patron/v1/raporlar/:id/dosya?bicim=xlsx|html`
// =============================================================================
// Sahiplik ve izin `getPatronReportRun` boğazından (başkasının/silinmiş koşum 404). Dosya SAKLI sonuçtan üretilir,
// rapor yeniden hesaplanmaz. XLSX ve HTML aynı spec'ten (PDF = Excel); HTML'i telefon PDF'e çevirir.
// Zarfsız/HATA'lı koşum 409 (fail-closed); tanınmayan biçim 400. Okuma ucu: audit yok.
// =============================================================================
import { factoryDateTimeTr, factoryYmd } from "../../../constants/time";
import { AppError } from "../../../utils/app-error";
import { getPatronReportRun, type PatronReportUser } from "../kosum.service";
import { buildReportHtml, toSheets } from "./cikti";
import { buildExportSpec, isRaporSunumu, PATRON_REPORT_FILE_FORMATS, type PatronReportFileFormat } from "./spec";
import { buildWorkbook, XLSX_MIME } from "./xlsx";

export interface PatronReportFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly body: Buffer;
}

const SLUG_MAP: Record<string, string> = { ş: "s", Ş: "S", ı: "i", İ: "I", ğ: "g", Ğ: "G", ü: "u", Ü: "U", ö: "o", Ö: "O", ç: "c", Ç: "C" };

/** Dosya adı gövdesi (panel `slugifyFileName`): Türkçe harf ASCII'ye, gerisi tire — başlıkta tırnak/yol ayırıcı kalmaz. */
export function slugifyFileName(s: string): string {
  return s
    .replace(/[şŞıİğĞüÜöÖçÇ]/g, (m) => SLUG_MAP[m] ?? m)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function isPatronReportFileFormat(v: unknown): v is PatronReportFileFormat {
  return typeof v === "string" && (PATRON_REPORT_FILE_FORMATS as readonly string[]).includes(v);
}

export async function patronReportFile(user: PatronReportUser, id: string, format: unknown, now: Date = new Date()): Promise<PatronReportFile> {
  if (!isPatronReportFileFormat(format)) {
    throw AppError.badRequest("Dosya biçimi geçersiz; xlsx ya da html olmalı.", { code: "PATRON_RAPOR_BICIM" });
  }
  const run = await getPatronReportRun(user, id);
  const veri = run.sonuc?.veri;
  if (run.durum !== "HAZIR" || !run.sonuc || !isRaporSunumu(veri)) {
    throw AppError.conflict("Bu rapor dosya olarak indirilemiyor.", { code: "DISA_AKTARILAMAZ" });
  }
  const spec = { ...buildExportSpec(veri), meta: [`Oluşturuldu: ${factoryDateTimeTr(new Date(run.sonuc.hesaplandi))}`], basimAni: now };
  const base = `${slugifyFileName(run.baslik) || "rapor"}-${factoryYmd(new Date(run.olusturulma))}`;
  if (format === "xlsx") return { fileName: `${base}.xlsx`, contentType: XLSX_MIME, body: await buildWorkbook(toSheets(spec)) };
  return { fileName: `${base}.html`, contentType: "text/html; charset=utf-8", body: Buffer.from(buildReportHtml(spec), "utf8") };
}
