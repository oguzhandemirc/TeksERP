// =============================================================================
// İE metre özeti — görünüm modeli (SAF; testli). Kaynak backend `meter-comparison.service` (liste `meterSummary`,
// ayrıntı `GET /work-orders/:id/meter-comparison`); hesap sunucuda, burada yalnız biçim ve rozet kararı.
// "Giren" = beyan (declaredM), "Çıkan" = en büyük ölçüm (measuredMaxM); fazla rozeti yalnız `longerThanDeclared` iken.
// =============================================================================
import { fmtMeters } from '../../../utils/meters';
import type { WorkOrderMeterComparison, WorkOrderMeterSummary } from '../../../services/workOrder.service';

export type { MeterParty, WorkOrderMeterComparison, WorkOrderMeterSummary } from '../../../services/workOrder.service';

export type MeterTone = 'over' | 'short';
export interface MeterBadge { text: string; tone: MeterTone }

const m = (v: number | null | undefined): string => (v == null ? '—' : fmtMeters(Math.round(v)));

/** İşaretli fark: +259 m · −12 m · 0 m; bilinmiyorsa null. */
export function signedMeters(diff: number | null | undefined): string | null {
  if (diff == null) return null;
  const r = Math.round(diff);
  if (r > 0) return `+${fmtMeters(r)} m`;
  if (r < 0) return `−${fmtMeters(-r)} m`;
  return '0 m';
}

/** Rozet: tolerans dışı uzun → turuncu "+X m"; eksik → gri "−X m"; tolerans içi uzun / eşit / ölçümsüz → yok. */
function badgeOf(diff: number | null | undefined, longer: boolean): MeterBadge | null {
  if (diff == null) return null;
  const r = Math.round(diff);
  if (longer && r > 0) return { text: `+${fmtMeters(r)} m`, tone: 'over' };
  if (r < 0) return { text: `−${fmtMeters(-r)} m`, tone: 'short' };
  return null;
}

export interface MeterListView { text: string; badge: MeterBadge | null }

/** Liste satırı: "Giren 241 · Çıkan 500" + rozet. Özet yoksa (partisiz İE / eski sunucu) null → satır çizilmez. */
export function meterListView(s: WorkOrderMeterSummary | null | undefined): MeterListView | null {
  if (!s || (s.declaredM == null && s.measuredMaxM == null)) return null;
  return { text: `Giren ${m(s.declaredM)} · Çıkan ${m(s.measuredMaxM)}`, badge: badgeOf(s.diffM, s.longerThanDeclared) };
}

export interface MeterPartyRow { key: string; batch: string; declared: string; kursun: string; tambur: string; diff: string; tone: MeterTone | null }
export interface MeterDetailView {
  giren: string;
  cikan: string;
  fazla: string;
  fazlaTone: MeterTone | null;
  billed: string | null;
  /** Tek partide boş (üstteki toplam zaten o partidir). */
  parties: MeterPartyRow[];
}

/** Ayrıntı kartı. Parti yoksa ya da hiç metre yoksa null → kart gizli. */
export function meterDetailView(c: WorkOrderMeterComparison | null | undefined): MeterDetailView | null {
  if (!c || c.parties.length === 0) return null;
  const t = c.totals;
  if (t.declaredM == null && t.measuredMaxM == null) return null;
  const longer = c.parties.some((p) => p.longerThanDeclared);
  const top = badgeOf(t.diffM, longer);
  return {
    giren: `${m(t.declaredM)} m`,
    cikan: t.measuredMaxM == null ? '—' : `${m(t.measuredMaxM)} m`,
    fazla: signedMeters(t.diffM) ?? '—',
    fazlaTone: top?.tone ?? null,
    billed: t.billedM == null ? null : `Faturaya: ${m(t.billedM)} m`,
    parties: c.parties.length < 2 ? [] : c.parties.map((p) => ({
      key: p.partyKey,
      batch: p.batchNo ?? '—',
      declared: m(p.declaredM),
      kursun: m(p.kursunOutM),
      tambur: m(p.tamburCutM ?? p.tamburInM),
      diff: signedMeters(p.diffM) ?? '—',
      tone: badgeOf(p.diffM, p.longerThanDeclared)?.tone ?? null,
    })),
  };
}
