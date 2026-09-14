// =============================================================================
// TAK formu + mutasyonu (Faz 3 E3) — devere ekranı "Tezgahta" sekmesi; token deneme başına bir kez
// =============================================================================
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { warpBeamService, type WarpBeam } from '../../../services/warpBeam.service';
import { onBeamFailed, onBeamSucceeded, tokenForBeam, type BeamAttempt } from './devereAttempt';
import { classifyBeamFailure } from './beamPayload';
import { BEAMS_KEY, CONTEXT_KEY } from './useBeamMutations';
import { EMPTY_MOUNT, buildMountPayload, mountFingerprint, validateMount, type MountForm } from './tezgahPayload';

interface Deps {
  loomMachines: { id: string; warpBeamSlots: number }[];
  methodRequired: boolean;
  onDone: () => void;
}

export function useMountForm({ loomMachines, methodRequired, onDone }: Deps) {
  const qc = useQueryClient();
  const attemptRef = useRef<BeamAttempt | null>(null);
  const [beam, setBeam] = useState<WarpBeam | null>(null);
  const [form, setForm] = useState<MountForm>(EMPTY_MOUNT);
  const [error, setError] = useState<string | null>(null);
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

  const open = useCallback((b: WarpBeam) => {
    setForm(EMPTY_MOUNT);
    setError(null);
    setBeam(b);
  }, []);
  const close = useCallback(() => setBeam(null), []);
  const submit = useCallback(() => {
    if (!beam) return;
    const v = validateMount(form, slots, methodRequired);
    if (v) return setError(v);
    setError(null);
    const fingerprint = mountFingerprint({ beamId: beam.id, machineId: form.machineId ?? '', position: Number(form.position) });
    mount.mutate({ beamId: beam.id, form, token: tokenForBeam(attemptRef.current, fingerprint), fingerprint });
  }, [beam, form, slots, methodRequired, mount]);

  return { beam, form, setForm, error, slots, open, close, submit, pending: mount.isPending };
}

export type MountFormState = ReturnType<typeof useMountForm>;
