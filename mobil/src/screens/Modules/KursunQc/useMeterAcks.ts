// =============================================================================
// H3 metre sapma onayları — SUPERVISOR_PIN (yalnız çevrimiçi) + OFFICE bandı (§3-6)
// =============================================================================
// PIN yalnız bileşen durumunda ve tek POST gövdesinde yaşar: kuyruğa, kalıcı depoya,
// log'a girmez. Çevrimdışında okuma onaysız yazılır; yanıt gelince (bağlanınca) PIN sorulur.
// =============================================================================

import { useCallback, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { showScreenError } from '../../../lib/screenToast';
import { kursunQcService, type KursunMeterSummary } from '../../../services/kursunQc.service';
import type { PendingMeterAck } from './meterCapture';

export function useMeterAcks() {
  const [pinQueue, setPinQueue] = useState<PendingMeterAck[]>([]);
  const [officeIds, setOfficeIds] = useState<string[]>([]);
  const [pinOpen, setPinOpen] = useState(false);
  const [unacked, setUnacked] = useState<PendingMeterAck[] | null>(null);

  const enqueuePin = useCallback((items: PendingMeterAck[]) => {
    if (items.length === 0) return;
    setPinQueue((prev) => [...prev, ...items.filter((i) => !prev.some((p) => p.readingId === i.readingId))]);
    if (onlineManager.isOnline()) setPinOpen(true);
  }, []);

  /** completeQc2 yanıtındaki sapma özeti → bekleyen onay. true = PIN modalı açıldı/kuyrukta. */
  const onReading = useCallback(
    (meter: KursunMeterSummary | null | undefined, rollId: string): boolean => {
      if (!meter?.pendingAck) return false;
      if (meter.approvalMode === 'SUPERVISOR_PIN') {
        enqueuePin([{ readingId: meter.readingId, rollId, approvalMode: meter.approvalMode }]);
        return true;
      }
      if (meter.approvalMode === 'OFFICE') {
        setOfficeIds((prev) => (prev.includes(meter.readingId) ? prev : [...prev, meter.readingId]));
      }
      return false;
    },
    [enqueuePin],
  );

  /** finishStep 409 METER_DEVIATION_UNACKED listesi → modal + PIN kuyruğu. */
  const onUnacked = useCallback(
    (list: PendingMeterAck[]) => {
      setUnacked(list);
      const pins = list.filter((p) => p.approvalMode === 'SUPERVISOR_PIN');
      setPinQueue((prev) => [...prev, ...pins.filter((i) => !prev.some((p) => p.readingId === i.readingId))]);
    },
    [],
  );

  const submitPin = usePinSubmit(pinQueue, setPinQueue, setPinOpen);

  return {
    pinTarget: pinOpen ? (pinQueue[0] ?? null) : null,
    pinPendingCount: pinQueue.length,
    officePendingCount: officeIds.length,
    pinBusy: submitPin.pinBusy,
    unacked,
    onReading,
    onUnacked,
    submitPin: submitPin.submit,
    openPin: () => {
      if (!onlineManager.isOnline()) {
        Toast.show({ type: 'info', text1: 'PIN onayı yalnız çevrimiçi' });
        return;
      }
      setUnacked(null);
      if (pinQueue.length > 0) setPinOpen(true);
    },
    closePin: () => setPinOpen(false),
    closeUnacked: () => setUnacked(null),
  };
}


/** PIN gönderimi — PIN yalnız argümanda ve tek POST gövdesinde; saklanmaz. */
function usePinSubmit(
  pinQueue: PendingMeterAck[],
  setPinQueue: React.Dispatch<React.SetStateAction<PendingMeterAck[]>>,
  setPinOpen: (v: boolean) => void,
) {
  const [pinBusy, setPinBusy] = useState(false);
  const submit = useCallback(
    async (pin: string): Promise<boolean> => {
      const target = pinQueue[0];
      if (!target || pinBusy) return false;
      if (!onlineManager.isOnline()) {
        Toast.show({ type: 'info', text1: 'PIN onayı yalnız çevrimiçi', text2: 'Bağlantı gelince yeniden sorulur' });
        return false;
      }
      setPinBusy(true);
      try {
        await kursunQcService.pinAckMeterReading(target.readingId, pin);
        const rest = pinQueue.slice(1);
        setPinQueue(rest);
        if (rest.length === 0) setPinOpen(false);
        Toast.show({ type: 'success', text1: 'Metre sapması onaylandı' });
        return true;
      } catch (err) {
        const code = (err as { details?: { code?: string } } | null)?.details?.code;
        // Başkası onayladıysa ya da okuma düzeltildiyse kuyruktan düşer.
        if (code === 'METER_ALREADY_ACKED' || code === 'METER_NOT_DEVIATED' || code === 'METER_READING_REVOKED') {
          setPinQueue((q) => q.slice(1));
        }
        showScreenError(err, 'Onay kaydedilemedi');
        return false;
      } finally {
        setPinBusy(false);
      }
    },
    [pinQueue, pinBusy, setPinQueue, setPinOpen],
  );

  return { submit, pinBusy };
}

export type MeterAcksState = ReturnType<typeof useMeterAcks>;
