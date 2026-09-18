// =============================================================================
// TEZGAH EKRANI HOOK'U — bileşim: form · sayaç · listeler · kaydet · geri al
// =============================================================================
// Oturum: WEAVING istasyonu + makine (`SessionGate`); makine ve hat ekrandan
// SEÇTİRİLMEZ (§3.7/3) — hat yalnız çok hatlı makinede seçilir. Kuyruk YOK:
// mutation online-only, çevrimdışıyken buton kilitli, kalıcı düşüş anlık toast.
// `clientToken` mantıksal deneme başına bir kez (`doffAttempt.ts`).
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useSessionStore } from '../../../store/sessionStore';
import { usePermissions } from '../../../hooks/usePermission';
import { useIsOnline, useOfflineReason } from '../../../offline/hooks';
import { doffFingerprint, tokenForDoff } from './doffAttempt';
import { EMPTY_DOFF_FORM, preselectMachineRunId, validateDoffForm, type DoffFormState } from './doffPayload';
import { useDoffLists } from './useDoffLists';
import { useDoffMeter } from './useDoffMeter';
import { useDoffRevoke, useDoffSave } from './useDoffMutations';
import type { DoffEvent, DoffListRow, OpenMachineRun } from '../../../services/doff.service';

/**
 * Koşum ön-seçimi: TEK açık koşum varsa kendiliğinden seçili (operatör dokunmadan İndir'e basar);
 * operatör "Koşumsuz"u ya da başka koşumu seçince (`selectRun`) DOKUNULMUŞ sayılır ve ön-seçim tekrar
 * ETMEZ. Hat değişince `resetPreselect` ile sıfırlanır. Effect (useFoldValues dersi) yalnız
 * `runTouched` false iken ve KARARLI `openRuns` referansı değişince yazar.
 */
function useRunPreselect(openRuns: readonly OpenMachineRun[], lineNo: number, patch: (p: Partial<DoffFormState>) => void) {
  const runTouched = useRef(false);
  const prevLine = useRef(lineNo);
  const selectRun = useCallback(
    (id: string | null) => {
      runTouched.current = true;
      patch({ machineRunId: id });
    },
    [patch]
  );
  useEffect(() => {
    // Hat değişince ön-seçim sıfırlanır (yeni hattın tek koşumu seçilebilsin).
    if (prevLine.current !== lineNo) {
      prevLine.current = lineNo;
      runTouched.current = false;
    }
    if (runTouched.current) return;
    const soleId = preselectMachineRunId(openRuns);
    if (soleId) patch({ machineRunId: soleId });
  }, [openRuns, lineNo, patch]);
  return selectRun;
}

export function useDoffEntry() {
  const active = useSessionStore((s) => s.active);
  const machine = active?.machine ?? null;
  const machineId = machine?.id ?? null;
  const lineCount = Math.max(1, machine?.productionLineCount ?? 1);
  const canRevoke = usePermissions().has('mobile:dokuma-geri-al');
  const isOnline = useIsOnline();
  const offlineReason = useOfflineReason();

  const [lineNo, setLineNo] = useState(1);
  const [form, setForm] = useState<DoffFormState>(EMPTY_DOFF_FORM);
  const patch = useCallback((p: Partial<DoffFormState>) => setForm((f) => ({ ...f, ...p })), []);

  const lists = useDoffLists(machineId, lineNo);
  const selectRun = useRunPreselect(lists.openRuns, lineNo, patch);
  const meter = useDoffMeter();
  const readMeterIntoForm = useCallback(async () => {
    const r = await meter.readMeter();
    if (r) patch({ counter: String(r.value), counterSource: r.source });
  }, [meter, patch]);

  const save = useDoffSave({
    machineId,
    lineNo,
    form,
    // Parça sayısı SIFIRLANIR (§3.7/5); sayaç ve koşum bir sonraki indirme için durur.
    // Bir sonraki indirme için parça sayısı yine VARSAYILAN 1 (boş değil) — art arda tek parça indirmede dokunuş yok.
    onSaved: () => patch({ pieceCount: '1', notes: '' }),
    onRunsStale: () => {
      lists.refetchRuns();
      patch({ machineRunId: null });
    },
  });
  const revokeMutation = useDoffRevoke(save.invalidate, save.setFailure);

  const submit = useCallback(() => {
    if (!machineId || save.mutation.isPending) return;
    if (!isOnline) {
      Toast.show({ type: 'error', text1: 'Çevrimdışı — indirme kaydedilemez', text2: offlineReason === 'server' ? 'Sunucuya ulaşılamıyor (IT).' : 'Ağ bağlantısı yok.', visibilityTime: 5000 });
      return;
    }
    const v = validateDoffForm(form);
    if (!v.ok) {
      Toast.show({ type: 'error', text1: v.message, visibilityTime: 4000 });
      return;
    }
    const fingerprint = doffFingerprint({ machineId, productionLineNo: lineNo, pieceCount: Number(form.pieceCount) });
    save.mutation.mutate({ token: tokenForDoff(save.attemptRef.current, fingerprint), fingerprint });
  }, [machineId, save, isOnline, offlineReason, form, lineNo]);

  /** Token çakışması modalı: "yeni indirme" → yapışkan token atılır, taze token'la gönderilir. */
  const resendAsNew = useCallback(() => {
    save.attemptRef.current = null;
    save.setFailure(null);
    submit();
  }, [save, submit]);

  const canSubmit = machineId != null && isOnline && validateDoffForm(form).ok && !save.mutation.isPending && !meter.reading;

  return {
    machine,
    lineCount,
    lineNo,
    setLineNo,
    form,
    patch,
    selectRun,
    openRuns: lists.openRuns,
    runsLoading: lists.runsLoading,
    reading: meter.reading,
    readMeterIntoForm,
    canSubmit,
    submitting: save.mutation.isPending,
    submit,
    result: save.result,
    dismissResult: () => save.setResult(null),
    failure: save.failure,
    dismissFailure: () => save.setFailure(null),
    resendAsNew,
    isOnline,
    canRevoke,
    todayRows: lists.todayRows,
    todayLoading: lists.todayLoading,
    todayError: lists.todayError,
    refreshToday: lists.refreshToday,
    revoke: (id: string, reason: string) => revokeMutation.mutate({ id, reason }),
    revoking: revokeMutation.isPending,
  };
}

export type DoffEntry = ReturnType<typeof useDoffEntry>;
export type { DoffEvent, DoffListRow, OpenMachineRun };
