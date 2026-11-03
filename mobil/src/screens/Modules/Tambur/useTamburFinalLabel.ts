// Tambur final etiket ayarları (Gülkesim S5): müşteri tartım/bölme/en + fabrika basım zamanı.
// Uç yoksa ya da hata verirse bugünkü davranış (DEFAULT_LABEL_SETTINGS) — kesim asla kilitlenmez.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tamburService, type TamburLabelSettings } from '../../../services/tambur.service';
import { DEFAULT_LABEL_SETTINGS, parseKg, weightError } from './finalLabel';

export interface TamburFinalLabelState {
  settings: TamburLabelSettings;
  kgText: string;
  setKgText: (t: string) => void;
  /** Gövdeye giden kg (boş/bozuk → undefined; bozuk metni `error()` yakalar). */
  weightKg: () => number | undefined;
  /** Gönderim öncesi denetim: hata metni ya da null. */
  error: () => string | null;
}

export function useTamburFinalLabel(rollId: string | null | undefined, customerId: string | null | undefined): TamburFinalLabelState {
  const q = useQuery({
    queryKey: ['tambur', 'label-settings', rollId ?? null, customerId ?? null],
    queryFn: () => tamburService.labelSettings({ rollId, customerId }),
    enabled: !!rollId,
    staleTime: 60_000,
    retry: false,
  });
  const settings = q.data ?? DEFAULT_LABEL_SETTINGS;
  const [kgText, setKgText] = useState('');
  // Yeni top = yeni tartım; önceki topun kg'si sızmasın.
  useEffect(() => setKgText(''), [rollId]);
  return {
    settings,
    kgText,
    setKgText,
    weightKg: () => {
      const kg = parseKg(kgText);
      return kg == null || Number.isNaN(kg) ? undefined : kg;
    },
    error: () => weightError(settings, kgText),
  };
}

/**
 * Fabrika basım zamanı (tambur.labelPrintTiming) — topa bağlı değil; ekran açılınca okunur ki
 * ilk kesimde ve iş bittiğinde (seçili top yokken) de doğru karar verilsin.
 */
export function useTamburPrintTiming(): TamburLabelSettings['printTiming'] {
  const q = useQuery({
    queryKey: ['tambur', 'label-settings', null, null],
    queryFn: () => tamburService.labelSettings({}),
    staleTime: 60_000,
    retry: false,
  });
  return q.data?.printTiming ?? DEFAULT_LABEL_SETTINGS.printTiming;
}
