import { useRef, useState } from 'react';
import Toast from 'react-native-toast-message';

import { signalScan } from '../../../../services/scanFeedback';
import { consignmentService, type YarnCandidate } from '../../../../services/consignment.service';
import { beamKey, beamLine, lineBlock, matchScan } from './emanetCikisLogic';
import { useCandidates } from './EmanetCikisPickers';
import type { EmanetCikisState } from './useEmanetCikis';

// =============================================================================
// Emanet çıkış kartının açılır katmanları (sahip · levent/lot seçici · kg · okutucu) ve okutma eşlemesi.
// Okutulan kod önce sahibin ilk aday sayfasında aranır; yoksa (satır tavanı) sunucuya kodla sorulur.
// =============================================================================

export function useEmanetPanels(s: EmanetCikisState, visible: boolean) {
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [picker, setPicker] = useState<'beam' | 'yarn' | null>(null);
  const [yarnSubset, setYarnSubset] = useState<YarnCandidate[] | null>(null);
  const [kgLot, setKgLot] = useState<YarnCandidate | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const pendingScan = useRef<string | null>(null);
  const taken = new Set(s.lines.map((l) => l.key));
  const candidates = useCandidates(s.owner?.id ?? null, '', visible && !!s.owner);

  const reject = (text1: string, text2: string) => {
    signalScan('reject');
    Toast.show({ type: 'error', text1, text2 });
  };

  const handleScan = async (code: string) => {
    if (!s.owner) return;
    let m = candidates.data ? matchScan(code, candidates.data) : { kind: 'none' as const };
    if (m.kind === 'none') {
      try {
        m = matchScan(code, await consignmentService.candidates(s.owner.id, code));
      } catch {
        return reject('Okutulan kod sorgulanamadı', 'Bağlantıyı kontrol edip yeniden okutun.');
      }
    }
    if (m.kind === 'none') return reject(`${code} çıkışa uygun değil`, `${s.owner.name} müşterisinin hazır leventi ya da bakiyeli lotu değil.`);
    if (m.kind === 'beam') {
      const why = lineBlock(beamKey(m.beam), m.beam.blockedReason, taken);
      if (why) {
        signalScan(taken.has(beamKey(m.beam)) ? 'duplicate' : 'reject');
        Toast.show({ type: 'error', text1: `Levent ${m.beam.beamNo}`, text2: why });
        return;
      }
      signalScan('accept');
      s.addLine(beamLine(m.beam));
      return;
    }
    signalScan('accept');
    if (m.yarns.length === 1) setKgLot(m.yarns[0]!);
    else {
      setYarnSubset(m.yarns);
      setPicker('yarn');
    }
  };

  /** Okutucu kapanma animasyonu bitince işlenir (modal üstüne modal açılmaz). */
  const onScannerHidden = () => {
    const d = pendingScan.current;
    pendingScan.current = null;
    if (d) void handleScan(d);
  };

  return {
    taken, ownerOpen, setOwnerOpen, picker, setPicker, yarnSubset, setYarnSubset, kgLot, setKgLot,
    scanOpen, setScanOpen, pendingScan, handleScan, onScannerHidden,
  };
}

export type EmanetPanels = ReturnType<typeof useEmanetPanels>;
