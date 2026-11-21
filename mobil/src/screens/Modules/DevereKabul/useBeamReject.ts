// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — kusurlu levent reddi durumu (ek-2 r): okut → ret sayfası → önizleme → gönder
// =============================================================================
// Online-only (kuyruk YOK). Önizleme sunucudan (reddedilebilirlik, dönen iplik, foto zorunluluğu); taslak
// değiştikçe yeniden çekilir. Gönderim clientToken'ı MANTIKSAL DENEME başına (`devereAttempt`): yalnız
// belirsiz hatada (ağ/zaman aşımı/5xx) aynı token; kesin 4xx ya da başarıdan sonra taze.
// =============================================================================
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation, useQuery } from '@tanstack/react-query';
import { devereKabulService, type RejectLookup, type RejectResult } from '../../../services/devereKabul.service';
import { signalScan } from '../../../services/scanFeedback';
import { onBeamFailed, tokenForBeam, type BeamAttempt } from '../Devere/devereAttempt';
import { failureText } from './useReceiveSubmit';
import { newRejectDraft, rejectFields, rejectFingerprint, rejectPhotosBody, type RejectDraft } from './rejectPayload';

export function useBeamReject(p: { isOnline: boolean; onRejected: () => void }) {
  const [draft, setDraft] = useState<RejectDraft | null>(null);
  const [looking, setLooking] = useState(false);
  const attempt = useRef<BeamAttempt | null>(null);
  const { isOnline, onRejected } = p;

  const open = useCallback((target: RejectLookup) => { attempt.current = null; setDraft(newRejectDraft(target)); }, []);
  const close = useCallback(() => setDraft(null), []);

  /** Levent etiketi / gövde QR / gövde no → sarım + sipariş → doğrudan ret sayfası. */
  const lookup = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code || looking) return;
    setLooking(true);
    try {
      const t = await devereKabulService.rejectLookup(code);
      signalScan('accept');
      open(t);
    } catch (e) {
      signalScan('reject');
      Toast.show({ type: 'error', text1: 'Levent bulunamadı', text2: failureText(e), visibilityTime: 6000 });
    } finally {
      setLooking(false);
    }
  }, [looking, open]);

  const fields = draft ? rejectFields(draft) : null;
  const photoCount = draft?.photos.length ?? 0;
  const preview = useQuery({
    queryKey: ['devere-kabul', 'reject-preview', fields, photoCount],
    queryFn: () => devereKabulService.rejectPreview({ ...fields!, photoCount }),
    enabled: !!fields && isOnline,
    staleTime: 10_000,
    retry: false,
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('Ret sayfası kapalı.');
      const f = rejectFields(draft);
      const fp = rejectFingerprint(f);
      const token = tokenForBeam(attempt.current, fp);
      try {
        const res = await devereKabulService.reject({ ...f, clientToken: token, photos: rejectPhotosBody(draft) });
        attempt.current = null;
        return res;
      } catch (e) {
        attempt.current = onBeamFailed(token, fp, e);
        throw e;
      }
    },
    onSuccess: (res) => {
      const d: RejectResult = res.data;
      setDraft(null);
      onRejected();
      Toast.show({ type: 'success', text1: res.message ?? `Levent devereciye geri gönderildi — ${d.docNo}`, text2: d.mode === 'REWORK' ? 'Yeniden sarılınca kabulde "yeniden sarım" seçin.' : undefined, visibilityTime: 6000 });
      for (const w of res.warnings ?? []) Toast.show({ type: 'info', text1: w, visibilityTime: 8000 });
    },
    onError: (e) => Toast.show({ type: 'error', text1: 'Ret kaydedilemedi', text2: failureText(e), visibilityTime: 8000 }),
  });

  return { rejectDraft: draft, setRejectDraft: setDraft, openReject: open, closeReject: close, rejectLookup: lookup, rejectLooking: looking, rejectPreview: preview, rejectSubmit: submit };
}

export type BeamRejectState = ReturnType<typeof useBeamReject>;
