// Belirsiz müşteri barkodu (409 CUSTOMER_CODE_AMBIGUOUS) — DOĞRUDAN aday modalı (combobox yok, sessiz seçim yok, K12).
// Tek bileşen: Tambur + Paketleme. Seçim, okutmayı seçilen topun İÇ barkoduyla sürdürür (`onPick(barcode)`).
import React, { useCallback, useMemo, useState } from 'react';
import PickerModal, { type PickerOption } from '../PickerModal';
import { candidateMeters, parseAmbiguousScan, type AmbiguousScan } from './customerCodeLogic';

interface Props {
  scan: AmbiguousScan | null;
  onPick: (barcode: string) => void;
  onDismiss: () => void;
}

export function CustomerCodeCandidateModal({ scan, onPick, onDismiss }: Props) {
  const options = useMemo<PickerOption[]>(
    () =>
      (scan?.candidates ?? []).map((c) => ({
        value: c.barcode ?? c.rollId,
        label: c.barcode ?? '—',
        sublabel: `${c.customerName} · ${candidateMeters(c)}`,
        details: [`Müşteri kodu: ${c.code}`],
      })),
    [scan],
  );
  return (
    <PickerModal
      visible={scan !== null}
      title={`"${scan?.scannedCode ?? ''}" birden çok müşteride — hangi top?`}
      options={options}
      disableSort
      onSelect={(barcode) => {
        onDismiss();
        onPick(barcode);
      }}
      onDismiss={onDismiss}
    />
  );
}

/**
 * Okutma hatasını yakalar: belirsizse modalı açar ve `true` döner (çağıran hata toast'ı GÖSTERMEZ);
 * değilse `false` — bugünkü hata yolu aynen sürer.
 */
export function useAmbiguousScanPicker(onPick: (barcode: string) => void) {
  const [scan, setScan] = useState<AmbiguousScan | null>(null);
  const intercept = useCallback((e: unknown): boolean => {
    const parsed = parseAmbiguousScan(e);
    if (!parsed) return false;
    setScan(parsed);
    return true;
  }, []);
  const modal = <CustomerCodeCandidateModal scan={scan} onPick={onPick} onDismiss={() => setScan(null)} />;
  return { intercept, modal };
}
