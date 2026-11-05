import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { packingService, type ShipmentDestination } from '../../../services/packing.service';
import { signalScan } from '../../../services/scanFeedback';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import { useAttemptToken } from '../../../offline/attemptToken';
import { showScreenError } from '../../../lib/screenToast';
import { useAmbiguousScanPicker } from '../../../components/customerCode/CustomerCodeCandidateModal';
import { openCariHoldBlock, type CariHoldBlock } from '../Sevkiyat/CariHold';
import { destinationLockQueryKey, invalidateAfterShipment, resolveDestination } from './destinationDefault';
import {
  applyMode,
  checkScannedRoll,
  groupByCart,
  loadLine,
  normalizeCartLabel,
  validateLoad,
  type LoadMode,
  type LooseRoll,
} from './looseLoad';

/** Çuvalsız sevk ekranının durumu + okutma + gönderim (ekran yalnız çizer). */
export function useCuvalsizSevk(customerId: string, branchId: string | null, onDone: () => void) {
  const qc = useQueryClient();
  const [mode, setModeState] = useState<LoadMode>('BULK');
  const [activeCart, setActiveCart] = useState<string | null>(null);
  const [rolls, setRolls] = useState<LooseRoll[]>([]);
  const rollsRef = useRef<LooseRoll[]>([]);
  const [plateNumber, setPlateNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [picked, setPicked] = useState<ShipmentDestination | null>(null);
  const [holdBlock, setHoldBlock] = useState<CariHoldBlock | null>(null);
  const scanFb = useScanFeedback();
  const attempt = useAttemptToken();

  const lockQ = useQuery({
    queryKey: destinationLockQueryKey(customerId, branchId),
    queryFn: () => packingService.getDestinationLock(customerId, branchId),
    staleTime: 10_000,
  });
  const dest = resolveDestination({ lock: lockQ.data, picked });

  const commit = (next: LooseRoll[]) => {
    rollsRef.current = next;
    setRolls(next);
    attempt.renew(); // içerik değişti → yeni mantıksal deneme
  };

  const setMode = (m: LoadMode) => {
    setModeState(m);
    commit(applyMode(rollsRef.current, m, activeCart));
  };

  const chooseCart = (raw: string): boolean => {
    const label = normalizeCartLabel(raw);
    if (!label) return false;
    setActiveCart(label);
    return true;
  };

  // Okumalar SIRAYLA işlenir — art arda iki okuma aynı topu iki kez eklemesin.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const scan = (code: string) => {
    const barcode = code.trim();
    if (!barcode) return;
    queue.current = queue.current.then(() => handleScan(barcode));
  };

  const handleScan = async (barcode: string): Promise<void> => {
    if (mode === 'CART' && !activeCart) {
      scanFb.pushRejects([{ barcode, reason: 'Önce araba no girin' }]);
      return;
    }
    try {
      const res = await packingService.locateRoll(barcode);
      const r = res.data;
      const verdict = checkScannedRoll(r, rollsRef.current.map((x) => x.id));
      if (!verdict.ok) {
        if (verdict.duplicate) scanFb.flashDuplicate(r.barcode);
        else scanFb.pushRejects([{ barcode: r.barcode, reason: verdict.reason }]);
        return;
      }
      signalScan('accept');
      commit([
        ...rollsRef.current,
        {
          id: r.id,
          barcode: r.barcode,
          itemName: r.item?.name ?? '—',
          colorName: r.color?.name ?? null,
          width: r.width,
          qty: Number(r.currentQty),
          cartLabel: mode === 'CART' ? activeCart : null,
        },
      ]);
    } catch (e) {
      if (ambiguous.intercept(e)) return;
      const msg = (e as { message?: string })?.message ?? 'Top bulunamadı';
      scanFb.pushRejects([{ barcode, reason: msg }]);
    }
  };
  const ambiguous = useAmbiguousScanPicker(scan);

  const removeRoll = (barcode: string) => commit(rollsRef.current.filter((r) => r.barcode !== barcode));
  const moveRollToActiveCart = (id: string) =>
    activeCart && commit(rollsRef.current.map((r) => (r.id === id ? { ...r, cartLabel: activeCart } : r)));

  const blockReason =
    validateLoad(mode, rolls) ??
    (lockQ.data?.quickShipBlockedReason || null) ??
    (dest.needsPick ? 'Sevk yönünü seçin (Yurtiçi / Yurtdışı)' : null);

  const submitMut = useMutation({
    mutationFn: async () => {
      const groups = mode === 'BULK' ? [{ label: null, n: rolls.length }] : groupByCart(rolls).map((g) => ({ label: g.label, n: g.rolls.length }));
      const created = await packingService.createShipmentFromRolls({
        rollIds: rolls.map((r) => r.id),
        customerId,
        branchId,
        destination: dest.destination ?? undefined,
        ...(dest.chosen ? { destinationChosen: true as const } : {}),
        plateNumber: plateNumber.trim() || null,
        driverName: driverName.trim() || null,
        dispatchNote: groups.map((g) => loadLine(mode, g.label, g.n)).join(' · '),
        clientToken: attempt.token(),
      });
      return { ...created.data, warnings: created.warnings ?? [] };
    },
    onSuccess: (data) => {
      attempt.onSuccess();
      signalScan('accept');
      invalidateAfterShipment(qc, customerId);
      Toast.show({
        type: 'success',
        text1: data.dispatched ? 'Sevk edildi' : 'Sevkiyat kuruldu — Sevk Çıkışı’ndan onaylayın',
        text2: data.shipmentNo,
      });
      if (data.warnings.length > 0) {
        Toast.show({ type: 'info', text1: 'Dikkat', text2: data.warnings.join(' · '), visibilityTime: 8000 });
      }
      onDone();
    },
    onError: (e: Error) => {
      attempt.onFailure(e);
      if (openCariHoldBlock(e, setHoldBlock)) return;
      showScreenError(e, 'Sevk edilemedi');
    },
  });

  return {
    mode,
    setMode,
    activeCart,
    chooseCart,
    rolls,
    groups: groupByCart(rolls),
    scan,
    scanFb,
    removeRoll,
    moveRollToActiveCart,
    plateNumber,
    setPlateNumber,
    driverName,
    setDriverName,
    lock: lockQ.data,
    picked,
    setPicked,
    blockReason,
    submit: () => submitMut.mutate(),
    submitting: submitMut.isPending,
    holdBlock,
    closeHold: () => setHoldBlock(null),
    ambiguousModal: ambiguous.modal,
  };
}

export type CuvalsizSevkState = ReturnType<typeof useCuvalsizSevk>;
