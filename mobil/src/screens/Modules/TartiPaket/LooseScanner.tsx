import React from 'react';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import ScannerRollStrip from '../../../components/ScannerRollStrip';
import { totalMeters } from './looseLoad';
import type { CuvalsizSevkState } from './useCuvalsizSevk';

/** Çok top okutan ekran: trigger="tap" (komşu top istemeden girmesin); kabul/ret sinyali signalScan'den. */
export function LooseScanner({ visible, onDismiss, state: s }: { visible: boolean; onDismiss: () => void; state: CuvalsizSevkState }) {
  return (
    <BarcodeScannerModal
      visible={visible}
      onDismiss={onDismiss}
      continuous
      trigger="tap"
      captureHaptic={false}
      onScan={s.scan}
      title={s.mode === 'CART' && s.activeCart ? `Araba ${s.activeCart} — top okut` : 'Dökme — top okut'}
      flash={s.scanFb.flash}
      footer={
        <ScannerRollStrip
          rolls={s.rolls.map((r) => ({ barcode: r.barcode, qty: r.qty, width: r.width }))}
          totalQty={totalMeters(s.rolls)}
          onRemove={s.removeRoll}
          rejects={s.scanFb.rejects}
          onDismissReject={s.scanFb.dismissReject}
          duplicateBarcode={s.scanFb.duplicateBarcode}
        />
      }
    />
  );
}
