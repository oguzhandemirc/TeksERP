// =============================================================================
// İE Belgeler → "Gelen belge (fotoğraf)" satırları (SAF; testli)
// =============================================================================
// Kaynak `GET /gelen-belge/is-emirleri/:id/belgeler` (panel İE "Geldiği belge" ile aynı uç); bayt
// `GET /gelen-belge/taramalar/:id/icerik` (yalnız id ile, dosya yolu yok). Silinmiş (PURGED) ve PDF
// taramalar listede görünür ama tabletin görüntüleyicisinde açılmaz — sebebi satırda yazar.
// =============================================================================

import type { SourceNote } from '../../../services/incomingScan.service';

export interface IncomingScanItem {
  scanId: string;
  title: string;
  subtitle: string;
  /** Görüntüleyicide açılabilir mi; değilse `blockedReason` satırda yazar. */
  viewable: boolean;
  blockedReason: string | null;
}

const PDF_MIME = 'application/pdf';

/** Belge sırası sunucudan (oluşma sırası), sayfalar `pageNo`/`regionNo` sırasıyla; her tarama bir satır. */
export function incomingScanItems(notes: readonly SourceNote[] | null | undefined): IncomingScanItem[] {
  const out: IncomingScanItem[] = [];
  for (const n of notes ?? []) {
    const doc = n.senderDocNo?.trim();
    const title = ['Gelen belge (fotoğraf)', n.noteNo, doc ? `Evrak ${doc}` : null].filter(Boolean).join(' · ');
    const multi = n.scans.length > 1;
    for (const s of n.scans) {
      const page = multi ? `Sayfa ${s.pageNo}${s.regionNo != null ? `.${s.regionNo}` : ''}` : 'Tek sayfa';
      const purged = s.contentState === 'PURGED';
      const pdf = s.mimeType === PDF_MIME;
      const blockedReason = purged ? 'Fotoğraf saklama ayarı gereği silindi' : pdf ? 'PDF — panelden açılır' : null;
      out.push({ scanId: s.id, title, subtitle: page, viewable: !blockedReason, blockedReason });
    }
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bayt → base64 (Hermes'te `Buffer` yok; ek paket yok). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`;
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`;
  }
  return out;
}

/** Görüntü `Image` kaynağı; sunucu başka tür derse jpeg varsayılmaz, gelen tür yazılır. */
export function scanDataUri(mimeType: string | null | undefined, bytes: Uint8Array): string {
  const mime = mimeType && /^image\//.test(mimeType) ? mimeType : 'image/jpeg';
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
