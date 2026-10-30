// =============================================================================
// Tek dokunuş gramaj düzeni (KQ-D5) — saf yardımcılar
// =============================================================================
// Ekran ve render testi aynı kuralı kullanır: istek gövdesi, hedef eşleşmesi,
// sapma ve son işlem şeridi metni. Saat fabrika diliminden (factory-time).
// =============================================================================

import { fmtFactoryTime } from '../../../lib/factory-time';
import type { TapValueConfig } from './stationPanels';

export interface TapSelection {
  propertyId: string;
  valueCode?: string;
}

export interface GramajValue {
  code: string;
  label: string;
}

/** Dokunuş gövdesi: çeşit değeri + bayrak AUTO değilse işaret (backend AUTO'yu kendi yazar). */
export function buildTapSelections(cfg: TapValueConfig, valueCode: string): TapSelection[] {
  const out: TapSelection[] = [{ propertyId: cfg.variantPropertyId, valueCode }];
  if (cfg.flagPropertyId && cfg.flagMode && cfg.flagMode !== 'AUTO') {
    out.push({ propertyId: cfg.flagPropertyId });
  }
  return out;
}

/** "Kurşunsuz geç": bayrak OPTIONAL iken; gramaj ZORUNLUYSA kurşunsuz gövde
 *  backend'de 400 olurdu → düğme çizilmez. */
export function canSkipFlag(cfg: TapValueConfig): boolean {
  return cfg.flagMode === 'OPTIONAL' && cfg.variantMode !== 'REQUIRED';
}

/** İş emrinin bu çeşit için hedef değeri (yoksa null → vurgu yok). */
export function findTarget(
  targets: readonly { propertyId: string; valueCode: string }[] | undefined,
  variantPropertyId: string,
  values: readonly GramajValue[],
): GramajValue | null {
  const t = (targets ?? []).find((x) => x.propertyId === variantPropertyId);
  if (!t) return null;
  return values.find((v) => v.code === t.valueCode) ?? { code: t.valueCode, label: t.valueCode };
}

export function deviationText(target: GramajValue | null, picked: GramajValue | null): string | null {
  if (!target || !picked || target.code === picked.code) return null;
  return `Hedef ${target.label}, ${picked.label} işlendi`;
}

export interface LastTap {
  rollId: string;
  stepId: string;
  barcode: string | null;
  value: GramajValue | null; // null = kurşunsuz geçildi
  operator: string;
  at: Date;
  queued: boolean;
}

export function lastTapText(t: LastTap): string {
  const tail = t.barcode ? t.barcode.slice(-4) : '—';
  const what = t.value ? t.value.label : 'kurşunsuz';
  return `Son: ${tail} · ${what} · ${t.operator} · ${fmtFactoryTime(t.at)}`;
}

/** Eşzamanlı düzeltme (D4 yolu) çakışması mı? */
export function isCorrectionConflict(err: unknown): boolean {
  return (err as { status?: number } | null)?.status === 409;
}

/**
 * Açık duruşta gramaj dokunuşu (K2, DALGA4 §2.5/5): UYARI metni döner, ret DEĞİL — duruş ile metre
 * yazımda bağlanmaz; dokunuş her durumda gönderilir. Duruş yoksa null.
 */
export function stopOpenTapWarning(stopOpen: boolean): { title: string; detail: string } | null {
  if (!stopOpen) return null;
  return { title: 'Makine duruşta görünüyor — kayıt yine gönderildi', detail: 'Makine çalışıyorsa üstteki bantta "Çalıştı" ile duruşu kapatın.' };
}
