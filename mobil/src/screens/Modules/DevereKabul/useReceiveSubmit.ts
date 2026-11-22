// =============================================================================
// DEVERE DÖNÜŞ KABULÜ — gönderim: gövde okutma (resolve) · önizleme · kabul (clientToken denemesi)
// =============================================================================
// Token MANTIKSAL DENEME başına: aynı belge gövdesi + pencere içi + önceki deneme belirsiz hatayla
// düştüyse AYNI token; kesin 4xx ya da başarıdan sonra taze. Kabul sonrası etiketler kuyruğa — yalnız levent
// kartı ayarı OFF iken (ASK/ALWAYS'te A6 kart etiketin yerini alır).
// =============================================================================
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation } from '@tanstack/react-query';
import { devereKabulService, type ReceiveDocPreview, type ReceiveDocResult } from '../../../services/devereKabul.service';
import { signalScan } from '../../../services/scanFeedback';
import { useBeamLabelQueue } from '../Devere/beamLabelQueue';
import { onBeamFailed, tokenForBeam, type BeamAttempt } from '../Devere/devereAttempt';
import { bodyFromResolve, docFingerprint, draftsHaveBody, type BodyDraft, type DocBuild, type OrderDraft } from './receiveDocPayload';


export function failureText(e: unknown, fallback = 'Sunucuya ulaşılamadı ya da istek reddedildi.'): string {
  return ((e ?? {}) as { message?: string }).message?.trim() || fallback;
}

/** Gövde QR/no → resolve → satır sayfası. Dolu/terminal gövde eklenmez; son karar sunucuda (409 BEAM_BODY_*). */
export function useBodyScan(p: { hasOrder: boolean; orders: OrderDraft[]; onBody: (b: BodyDraft) => void }) {
  const [resolving, setResolving] = useState(false);
  const { hasOrder, orders, onBody } = p;
  const scanBody = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code || resolving) return;
    if (!hasOrder) {
      signalScan('reject');
      Toast.show({ type: 'error', text1: 'Önce siparişi seçin' });
      return;
    }
    setResolving(true);
    try {
      const v = bodyFromResolve(code, await devereKabulService.resolveBody(code));
      if (typeof v === 'string') {
        signalScan('reject');
        Toast.show({ type: 'error', text1: 'Bu gövde eklenemez', text2: v, visibilityTime: 6000 });
      } else if (draftsHaveBody(orders, v)) {
        signalScan('duplicate');
        Toast.show({ type: 'info', text1: `${v.bodyNo} bu kabulde zaten var` });
      } else {
        signalScan('accept');
        onBody(v);
      }
    } catch (e) {
      signalScan('reject');
      Toast.show({ type: 'error', text1: 'Gövde okunamadı', text2: failureText(e), visibilityTime: 6000 });
    } finally {
      setResolving(false);
    }
  }, [hasOrder, orders, onBody, resolving]);
  return { scanBody, resolving };
}

/** Kabul sonrası levent etiketleri: yalnız `autoLabels` (kart ayarı OFF) iken kuyruğa; kart açıksa kart yerini alır. */
export function queueReceiveLabels(res: ReceiveDocResult, autoLabels: boolean): number {
  if (!autoLabels) return 0;
  const q = useBeamLabelQueue.getState();
  let n = 0;
  for (const o of res.orders) for (const b of o.receipt.beams) { q.enqueue(b.id, b.beamNo); n++; }
  return n;
}

export function useReceiveSubmit(build: DocBuild, onAccepted: () => void, autoLabels = true) {
  const [preview, setPreview] = useState<ReceiveDocPreview | null>(null);
  const [result, setResult] = useState<ReceiveDocResult | null>(null);
  const attempt = useRef<BeamAttempt | null>(null);

  const previewMut = useMutation({
    mutationFn: async () => {
      if (!build.ok) throw new Error(build.error ?? 'Levent ekleyin.');
      return devereKabulService.preview(build.body);
    },
    onSuccess: (pv) => setPreview(pv),
    onError: (e) => Toast.show({ type: 'error', text1: 'Önizleme alınamadı', text2: failureText(e), visibilityTime: 7000 }),
  });

  const accept = useMutation({
    mutationFn: async () => {
      if (!build.ok) throw new Error(build.error ?? 'Levent ekleyin.');
      const fp = docFingerprint(build.body);
      const prev = attempt.current;
      const token = tokenForBeam(prev, fp);
      try {
        const res = await devereKabulService.create({ ...build.body, clientToken: token });
        attempt.current = null;
        return res;
      } catch (e) {
        attempt.current = onBeamFailed(token, fp, e);
        throw e;
      }
    },
    onSuccess: (res) => {
      queueReceiveLabels(res.data, autoLabels);
      setPreview(null);
      setResult(res.data);
      onAccepted();
      Toast.show({ type: 'success', text1: res.message ?? `Kabul kaydedildi — ${res.data.docNo}`, visibilityTime: 5000 });
      for (const w of res.warnings ?? []) Toast.show({ type: 'info', text1: w, visibilityTime: 8000 });
    },
    onError: (e) => Toast.show({ type: 'error', text1: 'Kabul kaydedilemedi', text2: failureText(e), visibilityTime: 8000 }),
  });

  return { preview, setPreview, result, setResult, previewMut, accept, busy: previewMut.isPending || accept.isPending };
}
