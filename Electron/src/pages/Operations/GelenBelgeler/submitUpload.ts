// =============================================================================
// Panel yükleme gönderimi — tablet `mobil/.../GelenBelge/docScan.ts` `submitDocScan` emsali
// =============================================================================
// (1) Taslak yoksa DRAFT başlık: `clientToken` çağıranın denemesinden (`attempt.token()`), burada ÜRETİLMEZ.
// (2) Yüklenmemiş her sayfa `noteId` + `pageNo` ile. Hata → `UploadError` ilerleme taşır: yeniden deneme
// taslağı İKİNCİ KEZ açmaz, yüklenen sayfayı atlar. "Sayfa ekle"de taslak hazırdır (başlık çağrısı yok).
// =============================================================================
import type { UploadPage } from "./uploadPrep";

export interface UploadApi {
  createDraftNote(body: { clientToken: string; sourceKind: "MANUAL"; ownerCustomerId: string | null; senderDocNo: string | null }): Promise<{ id: string; noteNo: string }>;
  uploadScan(body: { contentBase64: string; noteId: string; pageNo: number; sha256: string }): Promise<{ duplicate: boolean }>;
}

export interface UploadInput {
  pages: readonly UploadPage[];
  ownerCustomerId: string | null;
  senderDocNo: string | null;
  /** İlk sayfanın numarası (yeni taslakta 1; "Sayfa ekle"de mevcut en büyük + 1). */
  firstPageNo: number;
}

export interface UploadProgress {
  note: { id: string; noteNo: string } | null;
  uploaded: ReadonlySet<string>;
}

export const EMPTY_UPLOAD_PROGRESS: UploadProgress = { note: null, uploaded: new Set() };

export class UploadError extends Error {
  constructor(
    readonly original: unknown,
    readonly progress: UploadProgress,
  ) {
    super(original instanceof Error ? original.message : "Gönderim başarısız");
  }
}

export interface UploadResult {
  note: { id: string; noteNo: string };
  uploaded: number;
  duplicates: number;
}

/** Belirsiz hatada başlık token'ı yapışır (aynı deneme), kesin 4xx'te düşer (`attempt.onFailure`). */
export async function submitUpload(
  api: UploadApi,
  input: UploadInput,
  attempt: { token(): string; onFailure(e: unknown): void; onSuccess(): void },
  prior: UploadProgress = EMPTY_UPLOAD_PROGRESS,
): Promise<UploadResult> {
  if (!input.pages.length) throw new Error("En az bir dosya seçin.");
  let note = prior.note;
  const uploaded = new Set(prior.uploaded);
  if (!note) {
    try {
      const created = await api.createDraftNote({
        clientToken: attempt.token(),
        sourceKind: "MANUAL",
        ownerCustomerId: input.ownerCustomerId,
        senderDocNo: input.senderDocNo,
      });
      note = { id: created.id, noteNo: created.noteNo };
    } catch (e) {
      attempt.onFailure(e);
      throw new UploadError(e, { note: null, uploaded });
    }
  }
  let duplicates = 0;
  for (let i = 0; i < input.pages.length; i++) {
    const page = input.pages[i]!;
    if (uploaded.has(page.sha256)) continue;
    try {
      const r = await api.uploadScan({ contentBase64: page.base64, noteId: note.id, pageNo: input.firstPageNo + i, sha256: page.sha256 });
      if (r.duplicate) duplicates++;
      uploaded.add(page.sha256);
    } catch (e) {
      throw new UploadError(e, { note, uploaded });
    }
  }
  attempt.onSuccess();
  return { note, uploaded: uploaded.size, duplicates };
}

/** "Sayfa ekle": sıradaki sayfa numarası (mevcut en büyük + 1; tarama yoksa 1). */
/** Sunucu `ScanBody.pageNo` tavanı (`.max(99)`) ikizi. */
export const MAX_PAGE_NO = 99;

/** Gönderilecek son sayfa numarası tavanı aşıyorsa Türkçe uyarı; aşmıyorsa null. */
export function pageLimitError(firstPageNo: number, count: number): string | null {
  const last = firstPageNo + count - 1;
  return last > MAX_PAGE_NO ? `Bir belgeye en çok ${MAX_PAGE_NO} sayfa eklenebilir (son sayfa ${last} olurdu). Sayfa sayısını azaltın.` : null;
}

export function nextPageNo(scans: ReadonlyArray<{ pageNo: number }>): number {
  return scans.reduce((m, s) => Math.max(m, s.pageNo), 0) + 1;
}
