// Tambur metre şeridi — saf katman (beyan · önceki ölçüm · kesilen · kalan + aşım uyarısı).
// Uç şekli `GET /rolls/:id/meter-trail` sözleşmesidir; alan adları backend ile birebir.
// Aşım ENGEL DEĞİLDİR: kesim kaydedilir, fazlası faturaya girer (kullanıcı kararı 2026-11-10).

import type { RollMeterTrail } from '../../../services/roll.service';

export type { RollMeterTrail };

// Metre aşımı yuvarlama gürültüsü sayılmasın (Decimal kesim + 0,1 m gösterim).
const OVER_EPS = 0.05;

/** 500 → "500", 547.95 → "548", 12.25 → "12,3" (Türkçe ondalık). */
export function fmtM(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',');
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Şerit parçaları; gösterecek ölçü yoksa (beyan da önceki ölçüm de yok) null. */
export function meterTrailParts(trail: RollMeterTrail | null | undefined): string[] | null {
  if (!trail) return null;
  const prior = trail.prior && finite(trail.prior.meters) ? trail.prior : null;
  if (!finite(trail.declaredM) && !prior) return null;
  const parts: string[] = [];
  if (finite(trail.declaredM)) parts.push(`Beyan ${fmtM(trail.declaredM)} m`);
  if (prior) {
    const label = prior.kind === 'KURSUN_OUT' ? 'Kurşun' : prior.stationName?.trim() || 'Önceki ölçüm';
    parts.push(`${label} ${fmtM(prior.meters)} m`);
  }
  parts.push(`Kesilen ${fmtM(finite(trail.cutSoFarM) ? trail.cutSoFarM : 0)} m`);
  if (finite(trail.remainingM)) {
    parts.push(trail.remainingM < -OVER_EPS ? `Aşım +${fmtM(-trail.remainingM)} m` : `Kalan ≈ ${fmtM(Math.max(0, trail.remainingM))} m`);
  }
  return parts;
}

export function meterTrailText(trail: RollMeterTrail | null | undefined): string | null {
  return meterTrailParts(trail)?.join(' · ') ?? null;
}

/** Formdaki elle metre: boş / sayı değil / ≤0 → 0 (otomatik modda çağıran 0 verir). Virgül kabul. */
export function parseCutInput(input: string | null | undefined): number {
  const v = parseFloat((input ?? '').trim().replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** (kesilen + girilen) − referans; aşım yoksa ya da referans yoksa null. */
export function cutOverage(trail: RollMeterTrail | null | undefined, pendingM: number): number | null {
  if (!trail || !finite(trail.referenceM)) return null;
  const cut = finite(trail.cutSoFarM) ? trail.cutSoFarM : 0;
  const over = cut + Math.max(0, pendingM) - trail.referenceM;
  return over > OVER_EPS ? over : null;
}

export function overageWarningText(overM: number): string {
  return `Önceki ölçümü aşıyor (+${fmtM(overM)} m) — kesim kaydedilir, fazlası faturaya girer`;
}
