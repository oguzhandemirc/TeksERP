// Kesim öncesi otomatik okumalar (2026-11-10, kullanıcı kararı): Metre ve Kg kipleri ayrı. Önce okumalar, sonra TEK
// kesim isteği; herhangi bir okuma başarısızsa kesim ÇAĞRILMAZ (fail-closed). Tartı yolu tamburun "Tart"ıyla aynı.
import type { DevicePeripheral as Peripheral } from '../../../services/peripheral.service';
import { readScaleOnce, type ReadScaleDeps, type ScaleMessage } from '../../../services/hal/readScale';
import type { KgStamp } from './finalLabel';

export type EntryMode = 'manual' | 'auto';

/** Ölçüm kartında hangi kutular var: yalnız MANUEL alan; ikisi de otomatikse kart çizilmez. */
export function measureVisibility(meter: EntryMode, kg: EntryMode, kgFieldVisible: boolean) {
  const meterBox = meter === 'manual';
  const kgBox = kgFieldVisible && kg === 'manual';
  return { meterBox, kgBox, card: meterBox || kgBox };
}

/** Kg Otomatik yalnız kg alanı varken anlamlıdır (şablon kg basmıyor ve zorunlu değilse kg yok). */
export function kgAutoActive(kg: EntryMode, kgFieldVisible: boolean): boolean {
  return kg === 'auto' && kgFieldVisible;
}

type Toast = (t: { type: 'error' | 'info'; text1: string; text2?: string; visibilityTime?: number }) => void;

/** Kes anında tartıdan TEK okuma. Tartı yok / okunamadı / ≤0 → Türkçe toast + null. */
export async function readKgForCut(scale: Peripheral | null | undefined, toast: Toast, deps: ReadScaleDeps = {}): Promise<KgStamp | null> {
  const show = (type: 'error' | 'info', m: ScaleMessage, ms = 6000) => toast({ type, text1: m.title, text2: m.detail, visibilityTime: ms });
  const read = await readScaleOnce(scale, { onPairing: (m) => show('info', m, 8000), ...deps });
  if (!read.ok) {
    show('error', read.error);
    return null;
  }
  if (!(read.kg > 0)) {
    show('error', { title: 'Tartı okunamadı', detail: 'Geçerli kg gelmedi — kesim yapılmadı.' });
    return null;
  }
  if (read.notice) show('info', read.notice);
  return { kg: read.kg, source: read.source };
}

/** Otomatik kiplerin okumalarını sırayla yapar; biri düşerse null (kesim yok). Metre manuelse capture null. */
export async function collectCutReadings<C>(i: {
  meterAuto: boolean;
  kgAuto: boolean;
  readMeter: () => Promise<C | null>;
  readKg: () => Promise<KgStamp | null>;
  stampKg: (k: KgStamp) => void;
}): Promise<{ capture: C | null } | null> {
  let capture: C | null = null;
  if (i.meterAuto) {
    capture = await i.readMeter();
    if (capture == null) return null;
  }
  if (i.kgAuto) {
    const kg = await i.readKg();
    if (!kg) return null;
    i.stampKg(kg);
  }
  return { capture };
}
