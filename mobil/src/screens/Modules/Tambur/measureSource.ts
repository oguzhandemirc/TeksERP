// =============================================================================
// D4-B3 Tambur ölçüm kaynağı beyanı — saf yardımcılar (DALGA4 §3.1, §3.5-1/2, §3.8)
// =============================================================================
// Kesim metresinin NEREDEN geldiği gövdeye `measure` olarak yazılır: makine (MACHINE),
// simülasyon (SIMULATED), elle (OPERATOR). Sunucu `meterSourceSchema` (strictObject) aynası;
// eski backend alanı eler (non-strict gövde) → kesim sürer. Kurşun ekranı kendi akışında.
// =============================================================================

import type { DevicePeripheral } from '../../../services/peripheral.service';
import type { MeterReadResult } from '../../../hooks/usePeripheralIO';
import type { TamburMeasureBody } from '../../../types/models';

export type TamburMeasureSource = TamburMeasureBody['source'];

/** Gövdedeki `measure` — sunucu `meterSourceSchema` aynası (cardSampleId model gelene dek gönderilmez). */
export type TamburMeasure = TamburMeasureBody;

/** Makineden (ya da simülasyondan) alınan ölçüm — gönderimde uzunlukla karşılaştırılır. */
export interface MeterCapture {
  value: number;
  source: 'MACHINE' | 'SIMULATED';
  peripheralId: string;
  rawCounter: number | null;
}

type ToastInput = { type: 'error' | 'info' | 'success'; text1: string; text2?: string; visibilityTime?: number };
export type ToastFn = (t: ToastInput) => void;

export const SIMULATION_TOAST: ToastInput = {
  type: 'error',
  text1: 'SİMÜLASYON',
  text2: 'Metre simüle — gerçek ölçüm değil',
  visibilityTime: 6000,
};

/** Simülasyon değeri: [min(5,kalan), min(80,kalan)] aralığında, 0,1 m çözünürlük. */
export function simulatedMeters(remaining: number, random: () => number = Math.random): number {
  const lo = Math.min(5, remaining);
  const hi = Math.min(80, remaining);
  return Math.round((lo + random() * (hi - lo)) * 10) / 10;
}

export interface MeasureDeps {
  peripheral: DevicePeripheral | null;
  /** Ekrandaki kat kodu (ör. 4-KAT); yoksa 'Kat'. */
  katLabel: string;
  remaining: number;
  read: (p: DevicePeripheral) => Promise<MeterReadResult>;
  toast: ToastFn;
  random?: () => number;
}

/**
 * Seçili kata ait metreden ölç. Cihaz yok / okunamadı → null (hata gösterilir, kesim YAPILMAZ).
 * Cihazın simülasyon bayrağı açıksa sahte değer SESSİZ DEĞİL: kırmızı SİMÜLASYON toastu + SIMULATED.
 */
export async function measureTamburCut(d: MeasureDeps): Promise<MeterCapture | null> {
  const p = d.peripheral;
  if (!p) {
    d.toast({
      type: 'error',
      text1: `${d.katLabel} metresi tanımlı değil`,
      // Başka kata ait metreye SAPILMAZ (yanlış ölçüm) — elle girişe düşülür.
      text2: `Metrajı elle girin. Kalıcı çözüm: Admin → Cihaz Kaydı'ndan bu makineye "${d.katLabel}" rollü METER cihazı ekleyin.`,
      visibilityTime: 6000,
    });
    return null;
  }
  if (p.simulate) {
    d.toast(SIMULATION_TOAST);
    return { value: simulatedMeters(d.remaining, d.random), source: 'SIMULATED', peripheralId: p.id, rawCounter: null };
  }
  const r = await d.read(p);
  if (r.ok) return { value: r.value, source: 'MACHINE', peripheralId: p.id, rawCounter: r.value };
  if (r.reason === 'UNSUPPORTED') {
    d.toast({
      type: 'error',
      text1: `${d.katLabel} metresi okunamıyor`,
      text2: 'Bu derlemede/bağlantı türünde desteklenmiyor (native build / connectionType).',
      visibilityTime: 6000,
    });
    return null;
  }
  d.toast({ type: 'error', text1: `${d.katLabel} makinesi okunamadı`, text2: r.message, visibilityTime: 6000 });
  return null;
}

/**
 * Gönderilen uzunluğun kaynağı: ölçüm değişmeden gidiyorsa ölçümün kaynağı (+ cihaz); ölçüm yoksa
 * ya da değer elle değiştirildiyse OPERATOR (cihaz kimliği YOK — elle beyan makineye yazılmaz).
 */
export function resolveMeasure(capture: MeterCapture | null | undefined, submitted: number): TamburMeasure {
  if (capture && Math.abs(capture.value - submitted) < 0.0005) {
    return { source: capture.source, peripheralId: capture.peripheralId, rawCounter: capture.rawCounter };
  }
  return { source: 'OPERATOR' };
}

/** Gövdeye `measure`u YALNIZ tanımlıysa ekler — ölçümsüz (eski kuyruk) gövde bayt-aynı kalır. */
export function withMeasure<T extends object>(body: T, measure: TamburMeasure | null | undefined): T & { measure?: TamburMeasure } {
  return measure ? { ...body, measure } : body;
}

/** Şerit / rozet rengi: yeşil = makine, amber = elle, kırmızı = SİMÜLASYON. */
export function measureToneOf(source: TamburMeasureSource | null | undefined): 'GREEN' | 'AMBER' | 'RED' | 'NONE' {
  if (source === 'MACHINE') return 'GREEN';
  if (source === 'SIMULATED') return 'RED';
  if (source === 'OPERATOR') return 'AMBER';
  return 'NONE';
}

export const MEASURE_LABEL: Record<TamburMeasureSource, string> = {
  MACHINE: 'MAKİNE',
  OPERATOR: 'ELLE',
  SIMULATED: 'SİMÜLASYON',
};

/** Ölçüm kapısı 400'leri → anlaşılır Türkçe mesaj; tanınmayan hata null (genel yol sürer). */
export function measureErrorMessage(err: unknown): { text1: string; text2: string } | null {
  const code = (err as { details?: { code?: unknown } } | null)?.details?.code;
  switch (code) {
    case 'SIMULATED_METER_DISABLED':
      return {
        text1: 'Simüle ölçüm kabul edilmiyor',
        text2: 'Fabrika ayarı simülasyonu kapattı — kesim kaydedilmedi. "Elle" moduna geçip metreyi yazın.',
      };
    case 'MEASURE_SOURCE_REQUIRED':
      return {
        text1: 'Ölçüm kaynağı zorunlu',
        text2: 'Bu fabrikada metrenin nereden geldiği (makine/elle) bildirilmeli — kesim kaydedilmedi. Uygulamayı güncelleyin.',
      };
    case 'METER_PERIPHERAL_NOT_FOUND':
      return {
        text1: 'Metre cihazı bulunamadı',
        text2: 'Cihaz kaydı silinmiş ya da değişmiş — kesim kaydedilmedi. "Elle" moduna geçin ya da Cihaz Kaydı\'nı kontrol edin.',
      };
    case 'CARD_SAMPLE_UNSUPPORTED':
      return { text1: 'Kart ölçümü desteklenmiyor', text2: 'Kesim kaydedilmedi — metreyi elle girin.' };
    default:
      return null;
  }
}
