// =============================================================================
// KK1 — DOKUMA BAĞI (saf kural): "Bu top dokuma mı?" → "hangi indirmeden?"
// =============================================================================
// Ham/dokuma ayrımı KK1'de ÇIKARILMAZ, SORULUR (DOKUMA-IS-EMRI §3.5): dokuma açık
// fabrikada gelen top ya dokunmuş ya satın alınmıştır ve ikisi aynı gün olur.
// Bayrak kapalıyken iki soru HİÇ çizilmez, payload bugünküyle birebir (§3.7/12).
// Bağ AÇIK LİSTE seçimidir (hüküm (a)); cevap yoksa `doffEventId: null` → rapor
// "doff'suz top" kovası. Yarı mamulle birlikte verilemez (backend 400 + burada).
// =============================================================================
import type { DoffListRow } from '../../../services/doff.service';

export interface DoffLinkState {
  /** Operatörün cevabı: bu top tezgahtan mı indi? Mod SEÇİLİ KALIR (yarı mamul kalıbı). */
  weaving: boolean;
  /** Seçilen indirme; kayıttan sonra SIFIRLANIR (bir indirme bir kez bağlanır). */
  doffEventId: string | null;
}

export const EMPTY_DOFF_LINK: DoffLinkState = { weaving: false, doffEventId: null };

/** İki soru yalnız dokuma modülü açıkken ve yarı mamul modu DIŞINDA çizilir. */
export function isDoffLinkVisible(dokumaEnabled: boolean, semiMode: boolean): boolean {
  return dokumaEnabled && !semiMode;
}

export type DoffLinkValidation = { ok: true } | { ok: false; message: string };

export function validateDoffLink(state: DoffLinkState, dokumaEnabled: boolean, semiMode: boolean): DoffLinkValidation {
  if (!isDoffLinkVisible(dokumaEnabled, semiMode)) return { ok: true };
  if (semiMode && state.doffEventId) {
    return { ok: false, message: 'Yarı mamul girişine indirme bağı verilemez — top ya dışarıdan gelir ya tezgahtan iner.' };
  }
  return { ok: true };
}

/** Payload parçası: görünmüyorsa BOŞ nesne (bugünkü payload birebir); dokuma değilse boş; seçim yoksa null. */
export function doffLinkPayload(state: DoffLinkState, dokumaEnabled: boolean, semiMode: boolean): { doffEventId?: string | null } {
  if (!isDoffLinkVisible(dokumaEnabled, semiMode) || !state.weaving) return {};
  return { doffEventId: state.doffEventId };
}

/** Listede okunan satır: kod · saat · parça · makine. */
export function doffRowLabel(row: Pick<DoffListRow, 'code' | 'doffedAt' | 'pieceCount' | 'productionLineNo'>, machineName?: string | null): string {
  const d = new Date(row.doffedAt);
  const saat = Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const makine = machineName ? ` · ${machineName}` : '';
  return `${row.code} · ${saat} · ${row.pieceCount} parça · hat ${row.productionLineNo}${makine}`;
}
