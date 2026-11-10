// Yeni Sevk: cari seçilince sunucuda boş PLANNED sevkiyat açılır (A1) ve okutma ekranına geçilir.
// Token mantıksal deneme başına: başka cari = yeni deneme; aynı cariye belirsiz hatadan sonra dönüş aynı token'ı taşır.
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { handheldShipmentService } from '../../../../services/handheldShipment.service';
import { showScreenError } from '../../../../lib/screenToast';
import { cariHoldBlockFromError, type CariHoldBlock } from '../CariHold';
import { HANDHELD_LIST_KEY } from './listQuery';
import { handheldKey } from './useSevkOkut';

export function useOpenShipment(onOpened: (p: { shipmentId: string; shipmentNo: string }) => void) {
  const qc = useQueryClient();
  const attempt = useAttemptToken();
  const busy = useRef(false);
  const lastCustomer = useRef<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [hold, setHold] = useState<CariHoldBlock | null>(null);

  const pick = async (customerId: string) => {
    if (busy.current) return;
    busy.current = true;
    if (lastCustomer.current !== customerId) attempt.renew();
    lastCustomer.current = customerId;
    setPendingId(customerId);
    try {
      const state = await handheldShipmentService.open({ customerId, clientToken: attempt.token() });
      attempt.onSuccess();
      lastCustomer.current = null;
      qc.setQueryData(handheldKey(state.shipment.id), state);
      void qc.invalidateQueries({ queryKey: HANDHELD_LIST_KEY });
      onOpened({ shipmentId: state.shipment.id, shipmentNo: state.shipment.shipmentNo });
    } catch (e) {
      attempt.onFailure(e);
      const block = cariHoldBlockFromError(e);
      if (block) setHold(block);
      else showScreenError(e, 'Sevkiyat açılamadı');
    } finally {
      busy.current = false;
      setPendingId(null);
    }
  };

  return { pick, pendingId, hold, closeHold: () => setHold(null) };
}
