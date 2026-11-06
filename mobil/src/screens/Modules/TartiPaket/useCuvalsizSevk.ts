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

/** Okutma: sıralı kuyruk + ön kontrol + geri bildirim. Liste `rollsRef` üzerinden okunur (yarışsız). */
function useLooseScan(opts: {
  mode: LoadMode;
  activeCart: string | null;
  rollsRef: React.MutableRefObject<LooseRoll[]>;
  commit: (next: LooseRoll[]) => void;
}) {
  const scanFb = useScanFeedback();
  // Okumalar SIRAYLA işlenir — art arda iki okuma aynı topu iki kez eklemesin.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const handleScan = async (barcode: string): Promise<void> => {
    if (opts.mode === 'CART' && !opts.activeCart) {
      scanFb.pushRejects([{ barcode, reason: 'Önce araba no girin' }]);
      return;
    }
    try {
      const r = (await packingService.locateRoll(barcode)).data;
      const verdict = checkScannedRoll(r, opts.rollsRef.current.map((x) => x.id));
      if (!verdict.ok) {
        if (verdict.duplicate) scanFb.flashDuplicate(r.barcode);
        else scanFb.pushRejects([{ barcode: r.barcode, reason: verdict.reason }]);
        return;
      }
      signalScan('accept');
      const cartLabel = opts.mode === 'CART' ? opts.activeCart : null;
      const item = { id: r.id, barcode: r.barcode, itemName: r.item?.name ?? '—', colorName: r.color?.name ?? null };
      opts.commit([...opts.rollsRef.current, { ...item, width: r.width, qty: Number(r.currentQty), cartLabel }]);
    } catch (e) {
      if (ambiguous.intercept(e)) return;
      scanFb.pushRejects([{ barcode, reason: (e as { message?: string })?.message ?? 'Top bulunamadı' }]);
    }
  };
  const scan = (code: string) => {
    const barcode = code.trim();
    if (barcode) queue.current = queue.current.then(() => handleScan(barcode));
  };
  const ambiguous = useAmbiguousScanPicker(scan);
  return { scan, scanFb, ambiguousModal: ambiguous.modal };
}

/** Gönderim: tek `from-rolls` çağrısı; yük açıklaması irsaliye notuna ("Dökme – 12 top"). */
function useLooseSubmit(opts: {
  customerId: string;
  onDone: () => void;
  build: () => Omit<Parameters<typeof packingService.createShipmentFromRolls>[0], 'clientToken'>;
}) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const [holdBlock, setHoldBlock] = useState<CariHoldBlock | null>(null);
  const mut = useMutation({
    mutationFn: async () => {
      const created = await packingService.createShipmentFromRolls({ ...opts.build(), clientToken: attempt.token() });
      return { ...created.data, warnings: created.warnings ?? [] };
    },
    onSuccess: (data) => {
      attempt.onSuccess();
      invalidateAfterShipment(qc, opts.customerId);
      Toast.show({
        type: 'success',
        text1: data.dispatched ? 'Sevk edildi' : 'Sevkiyat kuruldu — Sevk Çıkışı’ndan onaylayın',
        text2: data.shipmentNo,
      });
      if (data.warnings.length > 0) {
        Toast.show({ type: 'info', text1: 'Dikkat', text2: data.warnings.join(' · '), visibilityTime: 8000 });
      }
      opts.onDone();
    },
    onError: (e: Error) => {
      attempt.onFailure(e);
      if (openCariHoldBlock(e, setHoldBlock)) return;
      showScreenError(e, 'Sevk edilemedi');
    },
  });
  // İçerik değişince yeni mantıksal deneme (sonuç yolunda değil).
  const renew = () => attempt.renew();
  return { submit: () => mut.mutate(), submitting: mut.isPending, holdBlock, closeHold: () => setHoldBlock(null), renew };
}

/** Çuvalsız sevk ekranının durumu (ekran yalnız çizer). */
export function useCuvalsizSevk(customerId: string, branchId: string | null, onDone: () => void) {
  const [mode, setModeState] = useState<LoadMode>('BULK');
  const [activeCart, setActiveCart] = useState<string | null>(null);
  const [rolls, setRolls] = useState<LooseRoll[]>([]);
  const rollsRef = useRef<LooseRoll[]>([]);
  const [plateNumber, setPlateNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [picked, setPicked] = useState<ShipmentDestination | null>(null);
  const lockQ = useQuery({
    queryKey: destinationLockQueryKey(customerId, branchId),
    queryFn: () => packingService.getDestinationLock(customerId, branchId),
    staleTime: 10_000,
  });
  const dest = resolveDestination({ lock: lockQ.data, picked });

  const groups = groupByCart(rolls);
  const sub = useLooseSubmit({
    customerId,
    onDone,
    build: () => ({
      rollIds: rolls.map((r) => r.id),
      customerId,
      branchId,
      destination: dest.destination ?? undefined,
      ...(dest.chosen ? { destinationChosen: true as const } : {}),
      plateNumber: plateNumber.trim() || null,
      driverName: driverName.trim() || null,
      dispatchNote: (mode === 'BULK' ? [loadLine('BULK', null, rolls.length)] : groups.map((g) => loadLine('CART', g.label, g.rolls.length))).join(' · '),
    }),
  });
  const commit = (next: LooseRoll[]) => {
    rollsRef.current = next;
    setRolls(next);
    sub.renew(); // içerik değişti → yeni mantıksal deneme
  };
  const scanner = useLooseScan({ mode, activeCart, rollsRef, commit });

  const blockReason =
    validateLoad(mode, rolls) ??
    (lockQ.data?.quickShipBlockedReason || null) ??
    (dest.needsPick ? 'Sevk yönünü seçin (Yurtiçi / Yurtdışı)' : null);

  return {
    mode,
    setMode: (m: LoadMode) => {
      setModeState(m);
      commit(applyMode(rollsRef.current, m, activeCart));
    },
    activeCart,
    chooseCart: (raw: string): boolean => {
      const label = normalizeCartLabel(raw);
      if (label) setActiveCart(label);
      return !!label;
    },
    rolls,
    groups,
    ...scanner,
    removeRoll: (barcode: string) => commit(rollsRef.current.filter((r) => r.barcode !== barcode)),
    moveRollToActiveCart: (id: string) =>
      activeCart && commit(rollsRef.current.map((r) => (r.id === id ? { ...r, cartLabel: activeCart } : r))),
    plateNumber,
    setPlateNumber,
    driverName,
    setDriverName,
    lock: lockQ.data,
    picked,
    setPicked,
    blockReason,
    ...sub,
  };
}

export type CuvalsizSevkState = ReturnType<typeof useCuvalsizSevk>;
