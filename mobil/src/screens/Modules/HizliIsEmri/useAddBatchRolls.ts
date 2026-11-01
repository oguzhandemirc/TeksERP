import { useCallback, useRef, useState } from 'react';

import { useScanFeedback } from '../../../hooks/useScanFeedback';
import { rollService } from '../../../services/roll.service';
import { normalizeScanCode } from '../../../utils/scanCode';
import type { Roll } from '../../../types/models';
import { addBatchOutcome, type AddBatchRoll } from './addBatch';
import { useAmbiguousScanPicker } from '../../../components/customerCode/CustomerCodeCandidateModal';

/** Parti Ekle'nin top listesi: okutma + listeden seçme aynı kabul kuralından geçer (`addBatchOutcome`). */
export function useAddBatchRolls(lockedItemId: string | null) {
  const [rolls, setRolls] = useState<AddBatchRoll[]>([]);
  const rollsRef = useRef<AddBatchRoll[]>([]);
  const feedback = useScanFeedback();

  const take = useCallback((incoming: Roll[]) => {
    for (const roll of incoming) {
      const out = addBatchOutcome(rollsRef.current, roll, lockedItemId);
      if (out.kind === 'duplicate') feedback.flashDuplicate(roll.barcode ?? '');
      else if (out.kind === 'reject') feedback.pushRejects([{ barcode: roll.barcode ?? '', reason: out.reason }]);
      else rollsRef.current = [...rollsRef.current, out.roll];
    }
    setRolls(rollsRef.current);
  }, [feedback, lockedItemId]);

  // Belirsiz müşteri barkodu → aday modalı; seçilen topun İÇ barkodu aynı okutmadan geçer.
  const onScanRef = useRef<(raw: string) => Promise<void>>(async () => {});
  const ambiguous = useAmbiguousScanPicker((b) => void onScanRef.current(b));
  const interceptAmbiguous = ambiguous.intercept;

  const onScan = useCallback(async (raw: string) => {
    const barcode = normalizeScanCode(raw);
    if (!barcode) return;
    try {
      const res = await rollService.getByBarcode(barcode);
      if (res.data) take([res.data]);
      else feedback.pushRejects([{ barcode, reason: 'Bulunamadı' }]);
    } catch (e) {
      if (interceptAmbiguous(e)) return;
      feedback.pushRejects([{ barcode, reason: 'Okunamadı' }]);
    }
  }, [feedback, take, interceptAmbiguous]);
  onScanRef.current = onScan;

  const remove = useCallback((barcode: string) => {
    rollsRef.current = rollsRef.current.filter((r) => r.barcode !== barcode);
    setRolls(rollsRef.current);
  }, []);

  return { rolls, take, onScan, remove, feedback, ambiguousModal: ambiguous.modal };
}
