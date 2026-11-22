// =============================================================================
// GÖVDE SAYIMI — ekran durumu: kapsam · okunan kodlar · sunucu önizlemesi · satır düzeltmesi
// =============================================================================
// Online-only, kuyruk YOK. Okunan kodlar yalnız tablette (sayım belgesi yok); her değişimde önizleme yeniden
// sorulur (salt okuma). Düzeltme panelle aynı elle geçiş: önce önizleme (onay kartı), sonra yazım.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import Toast from 'react-native-toast-message';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { beamBodyCountService, type CountLine, type TransitionPlan } from '../../../services/beamBodyCount.service';
import { signalScan } from '../../../services/scanFeedback';
import { useIsOnline, useOfflineReason } from '../../../offline/hooks';
import { addCode, ALL_STOCK, firstTab, fixBody, scopeFromKey, type CountTab } from './beamBodyCount';

const KEY = ['govde-sayim'] as const;

export interface FixDraft { line: CountLine; plan: TransitionPlan }

const errText = (e: unknown) => ((e ?? {}) as { message?: string }).message?.trim() || 'Sunucuya ulaşılamadı ya da istek reddedildi.';

/** Satır düzeltmesi: öneri → elle geçiş önizlemesi (onay kartı) → yazım → önizleme tazelenir. */
function useCountFix(onDone: () => void) {
  const [fix, setFix] = useState<FixDraft | null>(null);
  const previewFix = useMutation({
    mutationFn: async (line: CountLine) => {
      const body = fixBody(line);
      if (!body) throw new Error('Bu satır için önerilen hareket yok — panelde Levent Gövdeleri ekranından bakın.');
      return { line, plan: await beamBodyCountService.transitionPreview(line.id, body) };
    },
    onSuccess: (d) => setFix(d),
    onError: (e) => Toast.show({ type: 'error', text1: 'Düzeltme hazırlanamadı', text2: errText(e), visibilityTime: 6000 }),
  });
  const applyFix = useMutation({
    mutationFn: async (d: FixDraft) => {
      const body = fixBody(d.line);
      if (!body) throw new Error('Önerilen hareket yok');
      return beamBodyCountService.transition(d.line.id, body);
    },
    onSuccess: (res) => {
      setFix(null);
      Toast.show({ type: 'success', text1: res.message ?? 'Kaydedildi' });
      onDone();
    },
    onError: (e) => Toast.show({ type: 'error', text1: 'Düzeltme kaydedilemedi', text2: errText(e), visibilityTime: 6000 }),
  });
  return { fix, setFix, previewFix, applyFix };
}

export function useBeamBodyCount() {
  const qc = useQueryClient();
  const isOnline = useIsOnline();
  const offlineReason = useOfflineReason();
  const [scopeKey, setScopeKey] = useState<string>(ALL_STOCK);
  const [codes, setCodes] = useState<string[]>([]);
  const [tab, setTab] = useState<CountTab>('missing');
  const [tabTouched, setTabTouched] = useState(false);
  const context = useQuery({ queryKey: [...KEY, 'context'], queryFn: beamBodyCountService.context, staleTime: 30_000 });
  const preview = useQuery({
    queryKey: [...KEY, 'preview', scopeKey, codes],
    queryFn: () => beamBodyCountService.preview(scopeFromKey(scopeKey), codes),
    placeholderData: keepPreviousData,
    enabled: isOnline,
  });
  const data = preview.data;
  // Kullanıcı sekme seçmediyse en önemli fark sekmesi kendiliğinden açılır (okut → ilerle).
  useEffect(() => {
    if (!tabTouched && data) setTab(firstTab(data));
  }, [data, tabTouched]);
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: KEY }), [qc]);
  const fixState = useCountFix(refresh);
  const scan = useCallback((raw: string) => {
    if (!raw.trim()) return;
    const r = addCode(codes, raw);
    signalScan(r.added ? 'accept' : 'duplicate');
    if (r.added) setCodes(r.codes);
    else Toast.show({ type: 'info', text1: `${raw.trim()} zaten okundu` });
  }, [codes]);
  const removeCode = useCallback((code: string) => setCodes((prev) => prev.filter((c) => c !== code)), []);
  const reset = useCallback(() => { setCodes([]); setTabTouched(false); }, []);
  const pickTab = useCallback((t: CountTab) => { setTab(t); setTabTouched(true); }, []);
  return {
    isOnline, offlineReason, context, preview, data, scopeKey, setScopeKey, codes, scan, removeCode, reset, tab, pickTab, refresh, ...fixState,
  };
}

export type BeamBodyCountState = ReturnType<typeof useBeamBodyCount>;
