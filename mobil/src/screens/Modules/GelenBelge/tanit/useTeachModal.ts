// Tablet tanıtma durumu (panel `useTeach` ikizi): sayfanın kelimeleri, işaretleme, önizleme (gövdeye bağlı tazelik), kayıt (yeni | sürümlü güncelle).
// ONLINE-ONLY: tanıtma sunucunun OCR kelimeleriyle çalışır; kuyruğa alınmaz.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import type { SuggestBody, SuggestResult, UserTemplateDetail } from '../../../../types/inboundDocTeach';
import { initialTeach, mergeForUpdate, suggestBody, teachProblems, templateKeywords, type TeachState } from './teachDraft';

export const teachWordsKey = (scanId: string | null) => ['gelen-belge', 'tanitma', 'kelimeler', scanId] as const;
export const userTemplateKey = (code: string | null) => ['gelen-belge', 'sablonlar', 'ozel', code] as const;

const errText = (e: unknown) => (e instanceof Error ? e.message : undefined);

export function useTeachModal(scanId: string | null, code: string | null, onSaved: () => void) {
  const attempt = useAttemptToken();
  const existing = useQuery({ queryKey: userTemplateKey(code), queryFn: () => inboundDocService.getUserTemplate(code!), enabled: !!code, retry: false, staleTime: Infinity });
  const ex: UserTemplateDetail | null = existing.data ?? null;
  // Güncelle kipinde şablon gelmeden işaretleme başlamaz (eski kimlik yazıları hazır seçili gelir).
  const wordsEnabled = !!scanId && (!code || !!ex);
  const words = useQuery({ queryKey: teachWordsKey(scanId), queryFn: () => inboundDocService.scanWords(scanId!), enabled: wordsEnabled, retry: false, staleTime: Infinity });
  const [state, setState] = useState<TeachState | null>(null);
  // Sayfa değişince işaretleme o sayfanın kelimeleriyle yeniden başlar (kutu indeksleri sayfaya özgü).
  useEffect(() => {
    setState(words.data ? initialTeach(words.data, ex?.name ?? '', templateKeywords(ex?.template)) : null);
  }, [words.data, ex]);
  const body = useMemo(() => (state && scanId && words.data ? suggestBody(state, words.data.words, scanId) : null), [state, scanId, words.data]);
  const [preview, setPreview] = useState<{ body: string; result: SuggestResult } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const bodyKey = body ? JSON.stringify(body) : '';
  const previewFresh = !!preview && preview.body === bodyKey;
  const problems = state ? teachProblems(state) : [];

  const runPreview = async () => {
    if (!body || problems.length > 0 || busy) return;
    const sent: SuggestBody = body;
    setBusy('preview');
    try {
      const result = await inboundDocService.suggestTemplate(sent);
      setPreview({ body: JSON.stringify(sent), result });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Önizlenemedi', text2: errText(e) });
    } finally {
      setBusy(null);
    }
  };

  const canSave = previewFresh && !!preview?.result.preview && preview.result.errors.length === 0 && problems.length === 0 && !busy;

  const save = async () => {
    if (!canSave || !state || !preview) return;
    setBusy('save');
    try {
      const name = state.name.trim();
      const v = ex
        ? await inboundDocService.updateUserTemplate(ex.code, { expectedVersion: ex.version, template: mergeForUpdate(ex.template, preview.result.template), name })
        : await inboundDocService.createUserTemplate({ name, template: preview.result.template, clientToken: attempt.token() });
      attempt.onSuccess();
      Toast.show({
        type: 'success',
        text1: ex ? `"${v.name}" şablonu güncellendi (sürüm ${v.version}).` : `"${v.name}" belge tipi kaydedildi.`,
        text2: ex ? undefined : 'Bundan sonra okunan bu tip belgeler bu şablonla okunur.',
      });
      onSaved();
    } catch (e) {
      attempt.onFailure(e);
      Toast.show({ type: 'error', text1: 'Kaydedilemedi', text2: errText(e) });
    } finally {
      setBusy(null);
    }
  };

  return {
    existing: ex,
    existingLoading: !!code && existing.isLoading,
    existingError: existing.isError,
    words,
    state,
    setState: (fn: (s: TeachState) => TeachState) => setState((s) => (s ? fn(s) : s)),
    problems,
    preview: preview?.result ?? null,
    previewFresh,
    runPreview,
    canSave,
    save,
    busy,
  };
}
export type TeachModalState = ReturnType<typeof useTeachModal>;
