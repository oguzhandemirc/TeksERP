// =============================================================================
// DOKUMA DURUŞ PANELİ — ortak `components/machine-stop/StopPanel` ince sarmalayıcısı
// =============================================================================
// D4-A2: panel Kurşun/Tambur ile ortaklaştı; Dokuma ekranı bayt-aynı (`StopPanel.parity.test.tsx`).
// =============================================================================
import React from 'react';
import MachineStopPanel from '../../../components/machine-stop/StopPanel';
import type { DoffEntry } from './useDoffEntry';

export default function StopPanel({ entry }: { entry: DoffEntry }) {
  return <MachineStopPanel machineId={entry.machine?.id ?? null} isOnline={entry.isOnline} canRevoke={entry.canRevoke} />;
}
