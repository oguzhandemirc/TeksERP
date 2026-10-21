// =============================================================================
// TAK formu + mutasyonu (Faz 3 E3) — devere ekranı "Tezgahta" sekmesi; token deneme başına bir kez
// =============================================================================
// S3c barkodla: ① levent etiketi okut (`scanBeam` → form açılır) ② tezgah etiketi okut (`scanMachine`;
// oturum makinesi `presetMachineId` verilmişse atlanır) ③ yuva (tek yuvalı → 1) → TAK. Çözücü `beamScan.ts`.
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signalScan } from '../../../services/scanFeedback';
import { mountScanOutcome, resolveMountScan, type ScanMachine } from './beamScan';
import { warpBeamService, type WarpBeam } from '../../../services/warpBeam.service';
import { onBeamFailed, onBeamSucceeded, tokenForBeam, type BeamAttempt } from './devereAttempt';
import { classifyBeamFailure } from './beamPayload';
import { BEAMS_KEY, CONTEXT_KEY } from './useBeamMutations';
import { EMPTY_MOUNT, buildMountPayload, mountFingerprint, validateMount, type MountForm } from './tezgahPayload';

interface Deps {
  loomMachines: (ScanMachine & { warpBeamSlots: number })[];
  methodRequired: boolean;
  onDone: () => void;
  /** Tezgah ekranı: oturum makinesi — tezgah adımı atlanır. */
  presetMachineId?: string | null;
}

export function useMountForm({ loomMachines, methodRequired, onDone, presetMachineId = null }: Deps) {
  const qc = useQueryClient();
  const attemptRef = useRef<BeamAttempt | null>(null);
  const [beam, setBeam] = useState<WarpBeam | null>(null);
  const [form, setForm] = useState<MountForm>(EMPTY_MOUNT);
  const [error, setError] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const slots = loomMachines.find((m) => m.id === form.machineId)?.warpBeamSlots ?? null;

  const mount = useMutation({
    networkMode: 'always',
    mutationFn: (args: { beamId: string; form: MountForm; token: string; fingerprint: string }) => warpBeamService.mount(args.beamId, buildMountPayload(args.form, methodRequired, args.token)),
    onSuccess: (res) => {
      attemptRef.current = onBeamSucceeded();
      Toast.show({ type: 'success', text1: res.message ?? 'Levent takıldı', text2: res.warnings?.[0], visibilityTime: 6000 });
      setBeam(null);
      onDone();
      void qc.invalidateQueries({ queryKey: BEAMS_KEY });
    },
    onError: (e, args) => {
      attemptRef.current = onBeamFailed(args.token, args.fingerprint, e);
      const a = classifyBeamFailure(e, 'Levent takılamadı');
      if (a.kind === 'refresh-list') void qc.invalidateQueries({ queryKey: BEAMS_KEY });
      if (a.kind === 'refresh-context') void qc.invalidateQueries({ queryKey: CONTEXT_KEY });
      Toast.show({ type: 'error', text1: 'Levent takılamadı', text2: a.message, visibilityTime: 6000 });
    },
  });

  const open = useCallback(
    (b: WarpBeam) => {
      setForm({ ...EMPTY_MOUNT, machineId: presetMachineId });
      setError(null);
      setScanMessage(null);
      setBeam(b);
    },
    [presetMachineId]
  );
  /** ① Levent etiketi: listede HAZIR levent → TAK formu açılır; değilse ret + sebep. */
  const scanBeam = useCallback(
    (raw: string, beams: readonly WarpBeam[]): boolean => {
      const scan = resolveMountScan(raw, beams, loomMachines);
      const out = mountScanOutcome(scan, 'beam');
      signalScan(out.ok ? 'accept' : 'reject');
      if (!out.ok || scan.kind !== 'beam') {
        setScanMessage(out.ok ? null : out.message);
        return false;
      }
      open(scan.beam);
      return true;
    },
    [loomMachines, open]
  );
  /** ② Tezgah etiketi: makine kodu → seçili makine (yuva 1'e döner). */
  const scanMachine = useCallback(
    (raw: string) => {
      // Formdaki levent de tanınır: tezgah yerine onun etiketi okutulursa "şimdi tezgahı okutun" denir.
      const scan = resolveMountScan(raw, beam ? [beam] : [], loomMachines);
      const out = mountScanOutcome(scan, 'machine');
      signalScan(out.ok ? 'accept' : 'reject');
      if (!out.ok || scan.kind !== 'machine') return setError(out.ok ? null : out.message);
      setError(null);
      setForm((f) => ({ ...f, machineId: scan.machine.id, position: '1' }));
    },
    [beam, loomMachines]
  );
  const close = useCallback(() => setBeam(null), []);
  const submit = useCallback(() => {
    if (!beam) return;
    const v = validateMount(form, slots, methodRequired);
    if (v) return setError(v);
    setError(null);
    const fingerprint = mountFingerprint({ beamId: beam.id, machineId: form.machineId ?? '', position: Number(form.position) });
    mount.mutate({ beamId: beam.id, form, token: tokenForBeam(attemptRef.current, fingerprint), fingerprint });
  }, [beam, form, slots, methodRequired, mount]);

  return { beam, form, setForm, error, slots, open, close, submit, pending: mount.isPending, scanBeam, scanMachine, scanMessage, presetMachineId };
}

export type MountFormState = ReturnType<typeof useMountForm>;
