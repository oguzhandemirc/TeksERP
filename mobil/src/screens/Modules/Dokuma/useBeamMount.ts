// =============================================================================
// TEZGAH EKRANINDA LEVENT TAK (S3c) — oturum makinesine barkodla: levent okut → (yuva) → TAK
// =============================================================================
// Takma ucu `mobile:devere` ister (tezgah ekranı izni `mobile:dokuma` yetmez) — yetkisizde
// düğme hiç çizilmez, kapı yine sunucuda. Levent sunucuda `search` ile bulunur (liste tavanı
// yok); çözüm + ret metni `Devere/beamScan.ts`, form/mutasyon `Devere/useMountForm.ts` (tek kaynak).
// =============================================================================
import { useCallback, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useQuery } from '@tanstack/react-query';
import { warpBeamService } from '../../../services/warpBeam.service';
import { usePermissions } from '../../../hooks/usePermission';
import { signalScan } from '../../../services/scanFeedback';
import { normalizeScanCode } from '../../../utils/scanCode';
import { CONTEXT_KEY } from '../Devere/useBeamMutations';
import { useMountForm } from '../Devere/useMountForm';

export function useBeamMount({ machineId, enabled, onDone }: { machineId: string | null; enabled: boolean; onDone: () => void }) {
  const canMount = usePermissions().has('mobile:devere') && enabled && machineId != null;
  const ctx = useQuery({ queryKey: CONTEXT_KEY, queryFn: warpBeamService.tabletContext, enabled: canMount, staleTime: 60_000 });
  const loomMachines = ctx.data?.loomMachines ?? [];
  const methodRequired = ctx.data?.mountTrackingRequired === true;
  const form = useMountForm({ loomMachines, methodRequired, onDone, presetMachineId: machineId });
  const [lookup, setLookup] = useState(false);

  const scan = useCallback(
    async (raw: string) => {
      const code = normalizeScanCode(raw);
      if (!code) return;
      setLookup(true);
      try {
        form.scanBeam(code, await warpBeamService.list(['READY', 'MOUNTED'], 10, code));
      } catch (e) {
        signalScan('reject');
        Toast.show({ type: 'error', text1: 'Levent aranamadı', text2: (e as Error).message, visibilityTime: 5000 });
      } finally {
        setLookup(false);
      }
    },
    [form]
  );

  return { canMount, form, scan, lookup, loomMachines, methodRequired };
}

export type BeamMountState = ReturnType<typeof useBeamMount>;
