// Sevk Et akışı: onay sayfası → A6 → sonuç sayfası; sonuçtan irsaliye ve toplu çuval etiketi.
// "Yük değişti" (LOAD_CHANGED) sayfada kalır ve güncel durum çekilir; cari blokajı kendi ekranını açar.
import { useState } from 'react';
import type { DispatchBody, DispatchResult, HandheldLoadState } from '../../../../services/handheldShipment.service';
import { errorCode } from '../../../../services/handheldShipment.service';
import { cariHoldBlockFromError, type CariHoldBlock } from '../CariHold';
import { labelButtonText, labelTargets } from './bulkLabel';
import { useBulkSackLabels, usePrintDispatchNote } from './useBulkSackLabels';

const DISPATCH_ERROR: Record<string, string> = {
  LOAD_CHANGED: 'Yük bu arada değişti; güncel özeti kontrol edip yeniden onaylayın.',
  SHIPMENT_EMPTY: 'Sevkiyatta top yok.',
  SHIPMENT_NOT_PLANNED: 'Bu sevkiyat artık açık değil.',
};

interface Args {
  shipmentId: string;
  state: HandheldLoadState | undefined;
  dispatch: (body: DispatchBody) => Promise<DispatchResult>;
  refetch: () => unknown;
}

export function useDispatchFlow({ shipmentId, state, dispatch, refetch }: Args) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DispatchResult | null>(null);
  const [hold, setHold] = useState<CariHoldBlock | null>(null);
  const labels = useBulkSackLabels();
  const note = usePrintDispatchNote(shipmentId);

  const open = () => {
    setError(null);
    setConfirmOpen(true);
  };
  const confirm = async (p: { plateNumber?: string; driverName?: string }) => {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Onaylanan özet sunucudakiyle aynı mı: beklenen top sayısı (K3, yarış koruması).
      const res = await dispatch({ ...p, expectedRollCount: state.summary.rollCount });
      setConfirmOpen(false);
      setResult(res);
    } catch (e) {
      const block = cariHoldBlockFromError(e);
      if (block) {
        setConfirmOpen(false);
        setHold(block);
        return;
      }
      const code = errorCode(e);
      if (code === 'LOAD_CHANGED' || code === 'SHIPMENT_NOT_PLANNED') void refetch();
      setError((code && DISPATCH_ERROR[code]) || (e as Error)?.message || 'Sevk edilemedi');
    } finally {
      setBusy(false);
    }
  };

  // Etiketler sonuç cevabının durumundan (boş çuvallar düşmüş hâli); salt-okunur ekranda güncel durumdan.
  const targets = labelTargets(result?.state ?? state);
  const retry = labels.failed.length > 0 && !labels.running;
  const printLabels = () => void labels.run(retry ? labels.failed : targets);

  return {
    confirmOpen,
    open,
    cancel: () => setConfirmOpen(false),
    confirm,
    busy,
    error,
    result,
    closeResult: () => setResult(null),
    hold,
    closeHold: () => setHold(null),
    printNote: () => void note.print(),
    printingNote: note.printing,
    labelCount: targets.length,
    labelText: labelButtonText({ running: labels.running, done: labels.done, total: labels.total, failed: labels.failed.length }),
    labelBusy: labels.running,
    printLabels,
  };
}
