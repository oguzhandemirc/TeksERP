// =============================================================================
// GELEN BELGE — tablet OKUMA ÖZETİ: "okundu mu, kaç satır, toplam tutuyor mu" (salt okunur)
// =============================================================================
// Tablet (Belge Tara, `gelen-belge:write`) taslağı doğurup sayfaları yükler ama `gelen-belge:read` taşımaz; okumanın
// bittiğini bu özetten izler. Durum + Türkçe neden SUNUCUDA türetilir (istemci kural yazmaz); toplam kapısı onayın
// AYNI saf helper'ından (`totalsCheck`, aynı belge geneli kipiyle) — ikinci toplam mantığı yok. Yazmaz, audit'e düşmez.
// =============================================================================
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { serverReaderState } from "./gelen-belge-sunucu-okuyucu.service";
import { PDF_MIME } from "./gelen-belge-scan.service";
import { READ_MAX_ATTEMPTS } from "./gelen-belge-okuma.service";
import { hasDocumentDeclared, isSummaryLine, totalsCheck } from "./gelen-belge-kontrol.service";
import { readDocumentTotalCheck } from "./system-setting.service";
import { noteNotices } from "../lib/gelen-belge/uyari";
import { noteBatchAndMeters } from "./gelen-belge-parti-metre.service";
import { readOwnerForNote } from "./gelen-belge-sahip-onerisi.service";
import { noteFormFields } from "./gelen-belge-form-alanlari.service";
import { noteTanitim } from "./gelen-belge-tanitim-guveni.service";
import { noteTanima } from "./gelen-belge-tanima-ozeti.service";
import { noteTemplateFields } from "./gelen-belge-alan-raporu.service";
import { noteIncomingKg } from "./gelen-belge-gelen-kg.service";
import { KG_FROM_METER_CELL_TEXT } from "../lib/gelen-belge/kg-koruma";

export type ReadSummaryState = "NO_PAGES" | "READING" | "NO_SERVICE" | "READ" | "PARTIAL" | "FAILED";
/** Sunucu okuyucusu: kullanılabilir · adres yok · "Bilgisayarda ikinci okuma" kapalı (yalnız cihaz okur). Eski bekçiler boolean geçer. */
export type ReaderAvailability = boolean | "SERVER_OCR_OFF";

/** Okuma özeti için okuyucu durumu — TEK boğazdan (`serverReaderState`). */
export async function readerAvailability(): Promise<ReaderAvailability> {
  const r = await serverReaderState();
  return r.enabled ? r.url !== null : "SERVER_OCR_OFF";
}

export interface ReadSummaryScan {
  status: "PENDING" | "READING" | "READ" | "READ_FAILED";
  attempts: number;
  mimeType: string;
}

export interface ReadSummaryPages {
  total: number;
  waiting: number;
  read: number;
  failed: number;
}

/**
 * Taramaların toplu okuma durumu + Türkçe neden — saf (bekçi doğrudan sınar). PDF okunmaz (K6), sayaca girmez.
 * Bekleyen sayfa varken servis adresi yoksa NO_SERVICE (sonsuza dek "okunuyor" denmez); bekleyen sayfa önceki denemede
 * düştüyse (PENDING + deneme > 0) neden "yeniden deneniyor" olur. Hepsi düştüyse FAILED, bir kısmı düştüyse PARTIAL.
 */
export function readSummaryState(
  scans: ReadonlyArray<ReadSummaryScan>,
  reader: ReaderAvailability,
  lineCount: number,
): { state: ReadSummaryState; reason: string | null; pages: ReadSummaryPages } {
  const photos = scans.filter((s) => s.mimeType !== PDF_MIME);
  const waitingScans = photos.filter((s) => s.status === "PENDING" || s.status === "READING");
  const pages: ReadSummaryPages = {
    total: photos.length,
    waiting: waitingScans.length,
    read: photos.filter((s) => s.status === "READ").length,
    failed: photos.filter((s) => s.status === "READ_FAILED").length,
  };
  if (!photos.length) {
    const reason = scans.length ? "PDF sayfa otomatik okunmaz; satırlar panelde girilir." : "Taslakta okunacak sayfa fotoğrafı yok.";
    return { state: "NO_PAGES", reason, pages };
  }
  const serverOff = reader === "SERVER_OCR_OFF";
  if (pages.waiting) {
    if (serverOff) return { state: "NO_SERVICE", reason: "Bilgisayarda ikinci okuma kapalı; bekleyen sayfa okunmaz. Fotoğrafı yeniden çekin ya da bilgileri elle girin.", pages };
    if (!reader) return { state: "NO_SERVICE", reason: "Bu kurulumda okuma servisi yok; satırlar panelde elle girilir.", pages };
    const retry = waitingScans.filter((s) => s.status === "PENDING" && s.attempts > 0).reduce((m, s) => Math.max(m, s.attempts), 0);
    const reason = retry ? `Okuma servisi yanıt vermedi; yeniden deneniyor (deneme ${Math.min(retry + 1, READ_MAX_ATTEMPTS)}/${READ_MAX_ATTEMPTS}).` : null;
    return { state: "READING", reason, pages };
  }
  if (pages.failed === pages.total) {
    if (serverOff) return { state: "FAILED", reason: `Tablet ${pages.failed === 1 ? "sayfayı" : `${pages.failed} sayfayı`} okuyamadı (bilgisayarda ikinci okuma kapalı). Fotoğrafı yeniden çekin ya da bilgileri elle girin.`, pages };
    return { state: "FAILED", reason: `Okuma servisi ${pages.failed === 1 ? "sayfayı" : `${pages.failed} sayfayı`} okuyamadı. Panelden yeniden okutun ya da satırları elle girin.`, pages };
  }
  if (pages.failed) return { state: "PARTIAL", reason: serverOff ? `${pages.failed} sayfa okunamadı; o sayfaları yeniden çekin.` : `${pages.failed} sayfa okunamadı; panelden yeniden okutun.`, pages };
  if (lineCount === 0) return { state: "READ", reason: "Sayfa okundu ama satır çıkmadı; panelden yeniden okutun ya da satırları elle girin.", pages };
  return { state: "READ", reason: null, pages };
}

/** Tablet okuma özeti (`GET /irsaliyeler/:id/okuma-ozeti`). Satır sayıları canlı satırdır (SKIPPED hariç; onay kapısıyla aynı küme). */
export async function getReadSummary(noteId: string) {
  const note = await prisma.customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: {
      id: true, noteNo: true, status: true, ownerCustomerId: true, declaredTopCount: true, totalsDeclared: true, warnings: true,
      customerBatchNo: true, ourBatchNo: true, ourBatchNoKey: true, kursunMeters: true, kursunMetersSource: true, kursunMetersReview: true,
      lines: { select: { id: true, lineNo: true, blockNo: true, lineKind: true, senderRollNo: true, meters: true, weightKg: true, status: true, needsReview: true }, orderBy: [{ blockNo: "asc" }, { lineNo: "asc" }] },
      scans: { select: { status: true, attempts: true, mimeType: true } },
    },
  });
  if (!note) throw AppError.notFound("Gelen belge taslağı bulunamadı.", { code: "DELIVERY_NOTE_NOT_FOUND" });
  const live = note.lines.filter((l) => l.status !== "SKIPPED");
  const { state, reason, pages } = readSummaryState(note.scans, await readerAvailability(), live.length);
  const decl = note.totalsDeclared as { blocks?: unknown[]; document?: unknown } | null;
  // Belge geneli başlık beyanı (ör. "Müşteri MT") da beyandır — kapı onu da kıyaslar.
  const declared = (Array.isArray(decl?.blocks) && decl.blocks.length > 0) || !!decl?.document;
  // Kip onayla AYNI: INFO'da belge geneli fark `warnings`e düşer, `ok`u bozmaz.
  // K30-B: tanıtım durumu + güven kipi (SOR'da NORMAL = bugünkü çıktı; `tanitim` yalnız bilgi).
  const { tanitim, trust } = await noteTanitim(note.id);
  const incoming = await noteIncomingKg(note.id, trust);
  const tc = totalsCheck(note, note.lines, { documentMode: hasDocumentDeclared(note.totalsDeclared) ? await readDocumentTotalCheck() : "INFO" });
  return {
    noteId: note.id,
    noteNo: note.noteNo,
    noteStatus: note.status,
    state,
    reason,
    pages,
    lineCount: live.length,
    reviewCount: live.filter((l) => l.needsReview).length,
    // ok: null = belgede toplam beyanı yok (kıyas yapılamaz); true/false onay kapısının cevabı.
    totals: { declared, ok: declared ? tc.mismatches.length === 0 : null, mismatches: declared ? tc.mismatches : [] },
    warnings: tc.warnings,
    // Okuma uyarıları — panel detayıyla AYNI helper (`noteNotices`); eski tablet alanı yok sayar.
    // Metre hücresinden okunan kg canlı uyarıdır (şablon düzeltilince kendiliğinden düşer).
    notices: noteNotices(incoming.kgFromMeterCell ? [...(Array.isArray(note.warnings) ? note.warnings : []), KG_FROM_METER_CELL_TEXT] : note.warnings),
    // Gelen kg (2026-11-09): şablon alanı → beyan → Σ satır (`pickIncomingKg`); hedef kg DEĞİL. Eski tablet yok sayar.
    incomingKg: incoming.kg,
    incomingKgSource: incoming.source,
    // Parti no + kurşun metresi (Gülkesim): kayıtlı başlık değeri + canlı adaylar; eski tablet alanları yok sayar.
    // Müşterinin parti no'su (belgeden okunan başlık); SORMA + tanıtılmamış (BLIND) tahmin forma dolmaz. Eski tablet yok sayar.
    customerBatchNo: trust === "BLIND" ? null : note.customerBatchNo,
    ourBatchNo: note.ourBatchNo,
    ourBatchNoKey: note.ourBatchNoKey,
    kursunMeters: note.kursunMeters,
    kursunMetersSource: note.kursunMetersSource,
    kursunMetersReview: note.kursunMetersReview,
    ...(await noteBatchAndMeters(note.id, note.totalsDeclared, live.filter((l) => l.status !== "INFO").map((l) => l.meters), trust)),
    // Taslağın sahibi + müşteri önerisi (OIE) — detayla AYNI helper; tablet `gelen-belge:read` taşımayabilir, satır formu
    // buradan kurulur (`detailFromSummary`). Eski tablet alanları yok sayar.
    ownerCustomerId: note.ownerCustomerId,
    // `ownerUnmatched`: okunan müşteri adı kayıtlı cariye çözülemedi → tablet "kayıtlı değil / bunu mu demek istediniz?" sorar.
    ...(await ownerFields({ id: note.id, status: note.status, ownerCustomerId: note.ownerCustomerId }, trust)),
    // "Toplar ayrı geldi" ön dolumu: belgenin TOP satırları (özet satırı hariç; blok, satır sırası). Eski tablet yok sayar.
    docRolls: live.filter((l) => l.lineKind === "TOP" && !isSummaryLine(note.id, l)).map((l) => ({
      lineNo: l.lineNo, meters: Number(l.meters), weightKg: l.weightKg == null ? null : Number(l.weightKg), senderRollNo: l.senderRollNo,
    })),
    // K30 S16a iş emri tek formu: tanıtılmış alanlar (`formFields`) + `desenRenkEslesme=ONER`de kayıt önerisi (`suggestions`).
    ...(await noteFormFields(note.id, trust)),
    // K30-B tel sözleşmesi madde 1: TANITILDI | TANITILMAMIS; sistem şablonunda alan yok. Eski tablet yok sayar.
    ...(tanitim ? { tanitim } : {}),
    // Tanıma özeti (2026-11-09): ① tip + sürüm · ② alan → İE · ③ kurallar; sunucuda kurulur, istemci türetmez. Eski tablet yok sayar.
    ...(await noteTanima(note.id, trust).then((t) => (t ? { tanima: t } : {}))),
    // Tablet İş Emirleri okutma önizlemesi: şablon alanları bulundu/bulunamadı; GENEL/BLIND'da yok. Eski tablet yok sayar.
    ...(await noteTemplateFields(note.id, trust).then((r) => (r ? { templateFields: r } : {}))),
  };
}

/** Sahip önerisi + çözülemeyen okuma tek geçişte; `ownerUnmatched` yalnız doluysa (eski tablet yok sayar). */
async function ownerFields(note: { id: string; status: string; ownerCustomerId: string | null }, trust: Parameters<typeof readOwnerForNote>[1]) {
  const r = await readOwnerForNote(note, trust);
  return { ownerSuggestion: r.suggestion, ...(r.unmatched ? { ownerUnmatched: r.unmatched } : {}) };
}
