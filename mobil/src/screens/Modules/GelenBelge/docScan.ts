// =============================================================================
// Belge Tara (Gülkesim D7) — saf kurallar: çekim boyu, sayfa özeti, barkod, gönderim sırası
// =============================================================================
// Ekran bu dosyayı çağırır; test React'siz koşar. Gönderim online-only (çevrimdışı kuyruk YOK):
// önce DRAFT başlık (`clientToken` mantıksal deneme başına), sonra her sayfa `noteId` + `pageNo` ile.
// Aynı fotoğraf iki kez eklenmez (sha256 istemcide); sunucu da aynı özeti tek kayda indirir.
// =============================================================================
import { sha256Bytes } from '../../../lib/qr-parca';
import type { AttemptToken } from '../../../offline/attemptToken';
import type { InboundDocApi } from '../../../services/inboundDoc.service';

/** Ölçüm bu boyda yapıldı (karar belgesi §2a): uzun kenar ≈ 2600 px, JPEG kalite 0,8. */
export const TARGET_LONG_EDGE_PX = 2600;
export const CAPTURE_QUALITY = 0.8;
/** Sunucu tavanı 5 MB (DOCUMENT_SCAN_TOO_LARGE); belge başına sayfa sınırı sunucuyla aynı (99). */
export const MAX_SCAN_BYTES = 5 * 1024 * 1024;
export const MAX_PAGES = 20;
const DOC_NO_MAX = 64;

export interface ScanPage {
  /** JPEG baytlarının base64'ü (önek yok). */
  base64: string;
  sha256: string;
  uri: string;
  width: number;
  height: number;
}

/**
 * Kameranın sunduğu boylardan uzun kenarı 2600'e en yakın OLAN-ÜSTÜ boy; yoksa en büyüğü.
 * Tanınmayan biçim ("High" vb.) elenir; hiç uygun yoksa `undefined` (kamera varsayılanı).
 */
export function pickPictureSize(sizes: readonly string[], target = TARGET_LONG_EDGE_PX): string | undefined {
  const parsed = sizes
    .map((s) => {
      const m = /^(\d+)x(\d+)$/.exec(s.trim());
      return m ? { s, long: Math.max(Number(m[1]), Number(m[2])) } : null;
    })
    .filter((x): x is { s: string; long: number } => x !== null);
  if (!parsed.length) return undefined;
  const above = parsed.filter((p) => p.long >= target).sort((a, b) => a.long - b.long);
  if (above.length) return above[0]!.s;
  return parsed.sort((a, b) => b.long - a.long)[0]!.s;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** Base64 → bayt (Hermes'te `Buffer` yok; `atob` ikili dizgede pahalı). Geçersiz karakter → hata. */
export function base64ToBytes(b64: string): number[] {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '').replace(/=+$/, '');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64_INDEX[ch];
    if (v === undefined) throw new Error('Fotoğraf verisi okunamadı (base64 bozuk).');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return out;
}

/** Fotoğrafın sha256'sı (onaltılık) — sunucunun `document_scans.sha256` hesabıyla aynı girdi (ham bayt). */
export function photoSha256(b64: string): string {
  return sha256Bytes(base64ToBytes(b64))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Base64 uzunluğundan bayt tahmini (decode etmeden boy kapısı). */
export function estimateBytes(b64: string): number {
  const clean = b64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - pad;
}

export type AddPageOutcome =
  | { kind: 'added'; pages: ScanPage[] }
  | { kind: 'duplicate'; pages: ScanPage[]; pageNo: number }
  | { kind: 'too-large'; pages: ScanPage[] }
  | { kind: 'full'; pages: ScanPage[] };

/** Sayfa ekle: aynı özet zaten listedeyse EKLENMEZ (aynı fotoğraf iki kez → tek tarama). */
export function addPage(pages: readonly ScanPage[], page: ScanPage): AddPageOutcome {
  const at = pages.findIndex((p) => p.sha256 === page.sha256);
  if (at >= 0) return { kind: 'duplicate', pages: [...pages], pageNo: at + 1 };
  if (estimateBytes(page.base64) > MAX_SCAN_BYTES) return { kind: 'too-large', pages: [...pages] };
  if (pages.length >= MAX_PAGES) return { kind: 'full', pages: [...pages] };
  return { kind: 'added', pages: [...pages, page] };
}

export function removePage(pages: readonly ScanPage[], index: number): ScanPage[] {
  return pages.filter((_, i) => i !== index);
}

/** Barkod → gönderen belge no: kırpılır, kontrol karakteri atılır, 64'e kısaltılır; boş → null. */
export function barcodeToDocNo(raw: string | null | undefined): string | null {
  // GS1 ayırıcısı (0x1D) vb. barkod denetim baytları atılır.
  const text = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text ? text.slice(0, DOC_NO_MAX) : null;
}

export interface SubmitInput {
  pages: readonly ScanPage[];
  ownerCustomerId: string | null;
  senderDocNo: string | null;
  /** Barkodun ham metni (tarama künyesine; senderDocNo'dan ayrı alan). */
  barcodeText: string | null;
}

/** Yarıda kalan gönderimin kaldığı yer: taslak doğduysa id'si + yüklenen sayfa özetleri. */
export interface SubmitProgress {
  note: { id: string; noteNo: string } | null;
  uploaded: ReadonlySet<string>;
}

export const EMPTY_PROGRESS: SubmitProgress = { note: null, uploaded: new Set() };

export class SubmitError extends Error {
  constructor(
    readonly original: unknown,
    readonly progress: SubmitProgress,
  ) {
    super(original instanceof Error ? original.message : 'Gönderim başarısız');
  }
}

export interface SubmitResult {
  note: { id: string; noteNo: string };
  uploaded: number;
  duplicates: number;
}

/**
 * Gönder: (1) taslak yoksa DRAFT başlık — token `attempt.token()`, ÜRETİLMEZ; (2) yüklenmemiş her sayfa.
 * Hata → `SubmitError` (ilerleme taşır; yeniden denemede taslak İKİNCİ KEZ açılmaz, yüklenen sayfa atlanır).
 * Belirsiz hatada başlık token'ı yapışır (aynı deneme), kesin 4xx'te düşer (`attempt.onFailure`).
 */
export async function submitDocScan(
  api: InboundDocApi,
  input: SubmitInput,
  attempt: Pick<AttemptToken, 'token' | 'onFailure' | 'onSuccess'>,
  prior: SubmitProgress = EMPTY_PROGRESS,
): Promise<SubmitResult> {
  if (!input.pages.length) throw new Error('En az bir sayfa fotoğrafı çekin.');
  let note = prior.note;
  const uploaded = new Set(prior.uploaded);
  if (!note) {
    try {
      const created = await api.createDraftNote({
        clientToken: attempt.token(),
        sourceKind: 'MANUAL',
        ownerCustomerId: input.ownerCustomerId,
        senderDocNo: input.senderDocNo,
        pageCount: input.pages.length,
      });
      note = { id: created.id, noteNo: created.noteNo };
    } catch (e) {
      attempt.onFailure(e);
      throw new SubmitError(e, { note: null, uploaded });
    }
  }
  let duplicates = 0;
  for (let i = 0; i < input.pages.length; i++) {
    const page = input.pages[i]!;
    if (uploaded.has(page.sha256)) continue;
    try {
      const r = await api.uploadScan({
        contentBase64: page.base64,
        noteId: note.id,
        pageNo: i + 1,
        barcodeText: input.barcodeText,
        sha256: page.sha256,
      });
      if (r.duplicate) duplicates++;
      uploaded.add(page.sha256);
    } catch (e) {
      throw new SubmitError(e, { note, uploaded });
    }
  }
  attempt.onSuccess();
  return { note, uploaded: uploaded.size, duplicates };
}
