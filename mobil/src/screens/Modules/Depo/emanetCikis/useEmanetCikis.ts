import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import {
  consignmentService,
  type CreatedConsignmentDispatch,
} from '../../../../services/consignment.service';
import {
  IDLE_ATTEMPT,
  isAmbiguousFailure,
  isRetrying,
  onAttemptFailed,
  onAttemptSucceeded,
  tokenForSubmit,
  type EntryAttemptState,
} from '../../../../offline/entryAttempt';
import { useIsOnline } from '../../../../offline/hooks';
import { showScreenError } from '../../../../lib/screenToast';
import { buildBody, createErrorText, submitBlock, type DraftLine } from './emanetCikisLogic';

// =============================================================================
// Emanet çıkış (tablet T1) — sahip + kalemler + sunucu önizlemesi + kaydet.
//
// ⚠️ ÇEVRİMİÇİ-ONLY: belge numarasını SUNUCU doğurur; offline kuyruğa girmez (sipariş emsali).
// İdempotency: token "bu belge denemesinin" kimliğidir — yalnız SONUCU BELİRSİZ hatada (ağ/zaman aşımı/5xx)
// yapışır, kesin 4xx'te tazelenir. Yük (sahip/kalem) değişirse YENİ deneme: eski token farklı gövdeyle
// gitseydi sunucu 409 CLIENT_TOKEN_COLLISION verirdi.
// =============================================================================

export function useEmanetCikis(visible: boolean) {
  const qc = useQueryClient();
  const online = useIsOnline();
  const [owner, setOwner] = useState<{ id: string; name: string } | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [attempt, setAttempt] = useState<EntryAttemptState>(IDLE_ATTEMPT);
  const [result, setResult] = useState<CreatedConsignmentDispatch | null>(null);

  const body = useMemo(() => (owner ? buildBody(owner.id, lines) : null), [owner, lines]);
  const bodyKey = JSON.stringify(body);
  useEffect(() => setAttempt(IDLE_ATTEMPT), [bodyKey]);

  const previewQ = useQuery({
    queryKey: ['consignment-preview', bodyKey],
    queryFn: () => consignmentService.preview(body!),
    enabled: visible && online && !!body && body.items.length > 0 && !result,
    staleTime: 0,
    retry: false,
  });

  const selectOwner = useCallback(
    (id: string, name: string) => {
      // Sahip değişince kalemler geçersiz (başkasının malı belgeye giremez).
      if (owner?.id !== id) setLines([]);
      setOwner({ id, name });
    },
    [owner?.id],
  );

  const addLine = useCallback((l: DraftLine) => {
    setLines((prev) => (prev.some((x) => x.key === l.key) ? prev : [...prev, l]));
  }, []);
  const removeLine = useCallback((key: string) => setLines((prev) => prev.filter((l) => l.key !== key)), []);

  const mutation = useMutation({
    mutationFn: (payload: NonNullable<typeof body> & { clientToken: string }) => consignmentService.create(payload),
    onSuccess: (res, vars) => {
      setAttempt((s) => onAttemptSucceeded(s, vars.clientToken));
      setResult(res);
      void qc.invalidateQueries({ queryKey: ['consignment-candidates'] });
      Toast.show({ type: 'success', text1: `Emanet çıkışı kaydedildi: ${res.dispatchNo}` });
    },
    onError: (err: Error, vars) => {
      setAttempt((s) => (isAmbiguousFailure(err) ? onAttemptFailed(s, vars.clientToken) : IDLE_ATTEMPT));
      showScreenError(err, 'Emanet çıkışı kaydedilemedi', createErrorText(err) ?? undefined);
      // Kesin ret (409 bakiye/durum) sonrası engeller yeniden ölçülür.
      if (!isAmbiguousFailure(err)) void previewQ.refetch();
    },
  });

  const blockedReason = submitBlock({ online, hasOwner: !!owner, lineCount: lines.length, previewError: previewQ.isError, canCreate: previewQ.data?.canCreate });
  const canSubmit = blockedReason === null && !!previewQ.data && !previewQ.isFetching && !mutation.isPending;

  const submit = useCallback(() => {
    if (!canSubmit || !body) return;
    mutation.mutate({ ...body, clientToken: tokenForSubmit(attempt) });
  }, [canSubmit, body, attempt, mutation]);

  /** Kayıttan sonra yeni belge — sahip KORUNUR (aynı müşteriye peş peşe çıkış olağan). */
  const startNext = useCallback(() => {
    setLines([]);
    setResult(null);
    setAttempt(IDLE_ATTEMPT);
  }, []);

  const reset = useCallback(() => {
    setOwner(null);
    startNext();
  }, [startNext]);
  const retryPreview = useCallback(() => void previewQ.refetch(), [previewQ]);

  return {
    online,
    owner,
    lines,
    selectOwner,
    addLine,
    removeLine,
    preview: previewQ.data,
    previewLoading: previewQ.isFetching,
    previewError: previewQ.isError,
    retryPreview,
    blockedReason,
    canSubmit,
    submit,
    submitting: mutation.isPending,
    retrying: isRetrying(attempt),
    result,
    startNext,
    reset,
  };
}

export type EmanetCikisState = ReturnType<typeof useEmanetCikis>;
