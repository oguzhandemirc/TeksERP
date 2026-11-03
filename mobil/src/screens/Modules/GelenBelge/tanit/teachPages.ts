// Tablette tanıtılabilir sayfa = sunucuda OKUNMUŞ fotoğraf (PDF değil) + bu tabletteki yerel kopyası (aynı sha256).
// Tanınmadı = okunmuş sayfa var ama şablon bağı yok (GENEL yedek sözlükle okundu). Eski sunucu `templateId`/`scans` göndermez → hiçbiri.
import type { InboundNoteDetail } from '../../../../services/inboundDoc.service';
import type { ScanWords } from '../../../../types/inboundDocTeach';

export interface TeachPage {
  scanId: string;
  pageNo: number;
  uri: string;
}

const PDF_MIME = 'application/pdf';

export function teachPages(detail: Pick<InboundNoteDetail, 'scans'> | null | undefined, local: readonly { sha256: string; uri: string }[]): TeachPage[] {
  const out: TeachPage[] = [];
  for (const s of detail?.scans ?? []) {
    if (s.status !== 'READ' || s.mimeType === PDF_MIME) continue;
    const page = local.find((p) => p.sha256 === s.sha256);
    if (page) out.push({ scanId: s.id, pageNo: s.pageNo, uri: page.uri });
  }
  return out.sort((a, b) => a.pageNo - b.pageNo);
}

export function isUnrecognized(detail: Pick<InboundNoteDetail, 'templateId'> | null | undefined, pages: readonly TeachPage[]): boolean {
  return detail?.templateId === null && pages.length > 0;
}

/** Saklanan fotoğrafın boyutu: kelime yanıtı OCR (dik) çerçevesindedir; 90/270 dönükse en/boy yer değiştirir. */
export function photoSize(scan: Pick<ScanWords, 'imageWidth' | 'imageHeight' | 'rotation'>): { width: number; height: number } {
  const turned = scan.rotation === 90 || scan.rotation === 270;
  return turned ? { width: scan.imageHeight, height: scan.imageWidth } : { width: scan.imageWidth, height: scan.imageHeight };
}
