// S1 (2026-11-03): bölümlü (çok partili) belgenin taslak eşlemesi — satır → bölüm (blok no), bölüm beyanı + parti kimliği
// `totalsDeclared.blocks`a, sayfa damgası ve "devam sayfası" başlığa. `taslak.ts` max-lines tavanında olduğu için ayrı dosya.
import { rowKey, type RegionExtraction } from "./motor";

/** Bölümün kalıcı künyesi (`totalsDeclared.blocks[]` ek alanları; parti listesi ve canlı denetim buradan okur). */
export interface SectionIdentity {
  batchNo: string | null;
  orderNo: string | null;
  /** Bölümde yazan top adedi (canlı denetim satır sayısıyla kıyaslar). */
  topCount: number | null;
}

/** Bölgenin satır anahtarı → bölüm no eşlemesi; bölümsüz şablonda null (tablo blok no'su sürer — bugünkü davranış). */
export function sectionOfRow(reg: RegionExtraction): ((blockNo: number, index: number) => number) | null {
  const s = reg.sections;
  if (!s || s.sections.length === 0) return null;
  const map = new Map<string, number>();
  for (const sec of s.sections) for (const k of sec.rowKeys) map.set(k, sec.sectionNo);
  return (blockNo, index) => map.get(rowKey(blockNo, index)) ?? blockNo;
}

const count = (v: string | null): number | null => (v && /^\d{1,4}$/.test(v) ? Number(v) : null);

/** Bölümlü bölgenin beyan blokları (bölüm no'suyla): T.Adet beyanı + parti/sipariş/yazan top. */
export function sectionDeclaredBlocks(reg: RegionExtraction, blockOffset: number): Array<{ blockNo: number; count: string | null; kg: string | null; m: string | null } & SectionIdentity> | null {
  const s = reg.sections;
  if (!s) return null;
  return s.sections.map((x) => ({
    blockNo: blockOffset + x.sectionNo,
    count: x.declared?.count ?? null, kg: x.declared?.kg ?? null, m: x.declared?.m ?? null,
    batchNo: x.batchNo, orderNo: x.orderNo, topCount: count(x.declaredCount),
  }));
}

/** İlk bölgenin sayfa damgası ve sayfanın başlıksız devamla başlayıp başlamadığı. */
export function pageInfo(reg: RegionExtraction | undefined): { page: { no: number; of: number } | null; continuesPrevious: boolean } {
  const s = reg?.sections;
  return { page: s?.page ?? null, continuesPrevious: !!s?.sections[0]?.continued };
}
