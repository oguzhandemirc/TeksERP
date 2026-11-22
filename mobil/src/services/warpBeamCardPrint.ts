import { apiClient } from './api';
import { printHtmlReported } from './printHtml';
import { isPrintCancel } from './printJob.service';
import { mergeLabelHtml } from '../screens/Modules/Sevkiyat/elSevk/bulkLabel';

// =============================================================================
// A6 LEVENT KARTI basımı (devere S5t) — backend'in TEK KAYNAK HTML'inden (panel `beamCardPrint.ts` ile aynı uç).
// Kartlar sırayla alınır (ilk okuma v1 dondurur; paralel istek sunucuda gereksiz yarış), tek sistem penceresinde
// basılır. Alınamayan kart sessiz düşmez: sonuçta levent no + sebep döner. İptal edilen pencere hata sayılmaz.
// =============================================================================

export interface BeamCardTarget {
  id: string;
  beamNo: string;
}

export interface BeamCardOutcome {
  /** Pencereye giden kart sayısı (0 → hiçbiri alınamadı ya da pencere iptal edildi). */
  printed: number;
  cancelled: boolean;
  failed: { beamNo: string; reason: string }[];
}

const reasonOf = (e: unknown): string => ((e ?? {}) as { message?: string }).message?.trim() || 'alınamadı';

export async function printWarpBeamCards(beams: BeamCardTarget[]): Promise<BeamCardOutcome> {
  const htmls: string[] = [];
  const ok: BeamCardTarget[] = [];
  const failed: BeamCardOutcome['failed'] = [];
  for (const b of beams) {
    try {
      const res = await apiClient.get<string>(`/printed-documents/WARP_BEAM_CARD/${b.id}/html`, {
        responseType: 'text',
        headers: { Accept: 'text/html' },
      });
      htmls.push(typeof res.data === 'string' ? res.data : String(res.data));
      ok.push(b);
    } catch (e) {
      failed.push({ beamNo: b.beamNo, reason: reasonOf(e) });
    }
  }
  if (htmls.length === 0) return { printed: 0, cancelled: false, failed };
  const first = ok[0]!;
  try {
    await printHtmlReported(
      { html: mergeLabelHtml(htmls) },
      {
        subjectKind: 'BELGE',
        docType: 'WARP_BEAM_CARD',
        subjectTable: 'warp_beams',
        subjectId: first.id,
        subjectNo: (ok.length > 1 ? `${first.beamNo} +${ok.length - 1}` : first.beamNo).slice(0, 64),
      },
    );
  } catch (e) {
    if (isPrintCancel(String((e as Error)?.message ?? ''))) return { printed: 0, cancelled: true, failed };
    throw e;
  }
  return { printed: htmls.length, cancelled: false, failed };
}
