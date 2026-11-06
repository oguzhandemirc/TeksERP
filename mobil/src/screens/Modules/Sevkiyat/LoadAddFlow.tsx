// PLANLI sevkiyata okutarak yük ekleme (9.2) — Sevk Kapısı kartındaki "Yük Ekle". Sevkiyat listesi zaten Sevk
// Kapısı board'u (cursor + sonsuz kaydırma); burada yalnız seçilen sevkiyata okutma. Yük türü sevkiyatın içeriğinden:
// dökme → dökmeye, araba → (no seçilir) arabaya, çuval → çuval kodu. Aynı sevkiyatta tek tür (sunucu 409 korur).
import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import ScannerRollStrip, { type ScanStripRoll } from '../../../components/ScannerRollStrip';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import { signalScan } from '../../../services/scanFeedback';
import { useAttemptToken } from '../../../offline/attemptToken';
import { shipmentLoadService } from '../../../services/shipmentLoad.service';
import { packingService, type SackStoreShipmentLite } from '../../../services/packing.service';
import { showScreenError } from '../../../lib/screenToast';
import { CartLabelModal } from '../TartiPaket/CuvalsizSevkView';
import { normalizeCartLabel } from '../TartiPaket/looseLoad';
import { READY_WORKS_KEY } from './ReadyWorks';
import { addKindOf, addScanTitle } from './loadEdit';

/** Okutma kuyruğu + sunucu çağrısı + şeritten geri alma (bileşen yalnız çizer). */
function useLoadAdd(shipment: SackStoreShipmentLite | null) {
  const qc = useQueryClient();
  const kind = shipment ? addKindOf(shipment) : 'SACK';
  const [cart, setCart] = useState<string | null>(null);
  const [added, setAdded] = useState<ScanStripRoll[]>([]);
  const fb = useScanFeedback();
  const attempt = useAttemptToken();
  const queue = useRef<Promise<void>>(Promise.resolve());
  // Şeritten geri alma: barkod → eklenen kayıt (top ya da çuval) — sunucuda gerçekten çıkarılır.
  const ids = useRef(new Map<string, { rollId?: string; sackId?: string }>());

  const reset = () => {
    setCart(null);
    setAdded([]);
    ids.current.clear();
    void qc.invalidateQueries({ queryKey: ['sack-store'] });
    void qc.invalidateQueries({ queryKey: ['sack-contents'] });
    void qc.invalidateQueries({ queryKey: READY_WORKS_KEY });
  };
  const handle = async (barcode: string) => {
    if (!shipment) return;
    try {
      const res = await shipmentLoadService.addByScan(shipment.id, {
        barcode,
        unitKind: kind === 'SACK' ? null : kind,
        unitLabel: kind === 'CART' ? cart : null,
        clientToken: attempt.token(),
      });
      attempt.onSuccess();
      const d = res.data;
      const code = d.kind === 'SACK' ? (d.sackNo ?? barcode) : (d.barcode ?? barcode);
      if (d.added === 0) {
        fb.flashDuplicate(code);
        return;
      }
      signalScan('accept');
      ids.current.set(code, { rollId: d.rollId, sackId: d.sackId });
      setAdded((xs) => [...xs, { barcode: code, qty: d.rollMeters ?? 0 }]);
    } catch (e) {
      attempt.onFailure(e);
      fb.pushRejects([{ barcode, reason: (e as { message?: string })?.message ?? 'Eklenemedi' }]);
    }
  };
  const scan = (raw: string) => {
    const code = raw.trim();
    if (code) queue.current = queue.current.then(() => handle(code));
  };

  const undo = async (code: string) => {
    const ref = ids.current.get(code);
    if (!shipment || !ref) return;
    try {
      if (ref.rollId) await shipmentLoadService.removeRoll(shipment.id, ref.rollId);
      else if (ref.sackId) await packingService.removeSackFromShipment(shipment.id, ref.sackId);
      ids.current.delete(code);
      setAdded((xs) => xs.filter((r) => r.barcode !== code));
    } catch (e) {
      showScreenError(e as Error, 'Geri alınamadı');
    }
  };

  return { kind, cart, setCart, added, fb, scan, undo, reset };
}

export function LoadAddFlow({ shipment, onDismiss }: { shipment: SackStoreShipmentLite | null; onDismiss: () => void }) {
  const { kind, cart, setCart, added, fb, scan, undo, reset } = useLoadAdd(shipment);
  const close = () => {
    reset();
    onDismiss();
  };
  const needCart = shipment !== null && kind === 'CART' && cart === null;
  return (
    <>
      <CartLabelModal
        visible={needCart}
        onDismiss={close}
        recent={shipment?.cartLabels ?? []}
        onChoose={(raw) => {
          const label = normalizeCartLabel(raw);
          if (label) setCart(label);
          return !!label;
        }}
      />
      <BarcodeScannerModal
        visible={shipment !== null && !needCart}
        onDismiss={close}
        continuous
        trigger="tap"
        captureHaptic={false}
        onScan={scan}
        title={`${shipment?.shipmentNo ?? ''} · ${addScanTitle(kind, cart)}`}
        flash={fb.flash}
        footer={
          <ScannerRollStrip
            rolls={added}
            totalQty={added.reduce((t, r) => t + r.qty, 0)}
            onRemove={(code) => void undo(code)}
            rejects={fb.rejects}
            onDismissReject={fb.dismissReject}
            duplicateBarcode={fb.duplicateBarcode}
          />
        }
      />
    </>
  );
}
