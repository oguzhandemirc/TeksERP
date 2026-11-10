// Okutma ekranı hook'u: sunucu durumu (TEK veri), okutma kuyruğu, seçim, onay soruları, çuval aç / kg / sevk et.
// Bu ekranın yazmaları kuyruksuz (online-only): numara ve sınıflandırma sunucuda doğar, çevrimdışı karar verilemez.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { isAmbiguousFailure } from '../../../../offline/entryAttempt';
import { signalScan } from '../../../../services/scanFeedback';
import {
  handheldShipmentService as svc,
  type DispatchBody,
  type DispatchResult,
  type HandheldLoadState,
  type ScanBody,
} from '../../../../services/handheldShipment.service';
import { showScreenError } from '../../../../lib/screenToast';
import { HANDHELD_LIST_KEY } from './listQuery';
import { interpretOutcome, interpretScanError, type BannerTone, type ScanPrompt } from './scanOutcome';
import { reconcileSelection, toggleSelection } from './selection';

export const handheldKey = (id: string) => ['handheld', id] as const;
const BANNER_MS = 4000;
const HIGHLIGHT_MS = 600;

export type OpenPrompt = ScanPrompt & { target: string | null };
type Extra = Pick<ScanBody, 'confirmRemove' | 'confirmNotReady'>;

type Banner = { tone: BannerTone; text: string; id: number };

/** Seçili çuval: ref okutma ANINDAKİ hedefi verir; sunucu durumu değişince silinen çuval seçimden düşer. */
function useSelectedSack(state: HandheldLoadState | undefined) {
  const [selected, setSelectedState] = useState<string | null>(null);
  const ref = useRef<string | null>(null);
  const setSelected = useCallback((v: string | null) => {
    ref.current = v;
    setSelectedState(v);
  }, []);
  useEffect(() => {
    const next = reconcileSelection(ref.current, state);
    if (next !== ref.current) setSelected(next);
  }, [state, setSelected]);
  return { selected, ref, setSelected };
}

/** Olay satırı (4 sn) ve satır vurgusu (600 ms) zamanlayıcıları. */
function useScanSignals() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const timers = useRef<{ banner?: ReturnType<typeof setTimeout>; hl?: ReturnType<typeof setTimeout> }>({});
  useEffect(
    () => () => {
      clearTimeout(timers.current.banner);
      clearTimeout(timers.current.hl);
    },
    [],
  );
  const showBanner = useCallback((b: { tone: BannerTone; text: string }) => {
    clearTimeout(timers.current.banner);
    setBanner({ ...b, id: Date.now() });
    timers.current.banner = setTimeout(() => setBanner(null), BANNER_MS);
  }, []);
  const flash = useCallback((id: string) => {
    clearTimeout(timers.current.hl);
    setHighlight(id);
    timers.current.hl = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
  }, []);
  return { banner, highlight, showBanner, flash };
}

type Signals = ReturnType<typeof useScanSignals>;
type Selection = ReturnType<typeof useSelectedSack>;

interface SenderArgs {
  shipmentId: string;
  putState: (s: HandheldLoadState) => void;
  refetch: () => unknown;
  sig: Signals;
  sel: Selection;
}

/** Token barkod başına (`keyed`): belirsiz hatada aynı barkodun yeniden okutulması aynı token'ı taşır, başka barkod
 *  kendi token'ını alır. İlk belirsiz hatada AYNI token + isRetry ile tek otomatik tekrar (durum-idempotent uç). */
function useScanSender({ shipmentId, putState, refetch, sig, sel }: SenderArgs) {
  const [prompt, setPrompt] = useState<OpenPrompt | null>(null);
  const attempt = useAttemptToken();
  const { showBanner, flash } = sig;
  const { setSelected } = sel;
  const failed = useCallback(
    (e: unknown) => {
      attempt.onFailure(e);
      signalScan('reject');
      const r = interpretScanError(e);
      showBanner(r.banner);
      if (r.clearSelection) setSelected(null);
      if (r.refetch) void refetch();
    },
    [attempt, showBanner, setSelected, refetch],
  );
  const send = useCallback(
    async (barcode: string, target: string | null, extra: Extra) => {
      const body: ScanBody = { barcode, targetSackId: target, ...extra, clientToken: attempt.keyed(barcode) };
      let res: Awaited<ReturnType<typeof svc.scan>>;
      try {
        res = await svc.scan(shipmentId, body).catch((e: unknown) => {
          if (!isAmbiguousFailure(e)) throw e;
          return svc.scan(shipmentId, { ...body, isRetry: true });
        });
      } catch (e) {
        failed(e);
        return;
      }
      attempt.onSuccess();
      putState(res.state);
      const r = interpretOutcome(res.outcome);
      if (r.signal) signalScan(r.signal);
      if (r.banner) showBanner(r.banner);
      if (r.select !== undefined) setSelected(r.select);
      if (r.highlight) flash(r.highlight);
      if (r.prompt) setPrompt({ ...r.prompt, target });
    },
    [attempt, shipmentId, failed, putState, showBanner, setSelected, flash],
  );
  return { send, prompt, setPrompt };
}

/** Çuval aç (A4, kayıt yaratır: deneme başına token) ve elle kg (A5). */
function useSackOps({ shipmentId, putState, refetch, sig }: Omit<SenderArgs, 'sel'>) {
  const sackAttempt = useAttemptToken();
  const [openingSack, setOpeningSack] = useState(false);
  const { flash, showBanner } = sig;
  const openSack = useCallback(async () => {
    if (openingSack) return;
    setOpeningSack(true);
    try {
      const res = await svc.openSack(shipmentId, sackAttempt.token());
      sackAttempt.onSuccess();
      putState(res.state);
      flash(res.sack.id);
      showBanner({ tone: 'info', text: `${res.sack.sackNo} açıldı — seçmek için dokunun` });
    } catch (e) {
      sackAttempt.onFailure(e);
      showScreenError(e, 'Çuval açılamadı');
    } finally {
      setOpeningSack(false);
    }
  }, [openingSack, shipmentId, sackAttempt, putState, flash, showBanner]);
  const setSackWeight = useCallback(
    async (sackId: string, kg: number | null): Promise<boolean> => {
      try {
        putState((await svc.setSackWeight(shipmentId, sackId, kg)).state);
        return true;
      } catch (e) {
        showScreenError(e, 'Kg kaydedilemedi');
        void refetch();
        return false;
      }
    },
    [shipmentId, putState, refetch],
  );
  return { openSack, openingSack, setSackWeight };
}

export function useSevkOkut(shipmentId: string) {
  const qc = useQueryClient();
  const stateQ = useQuery({ queryKey: handheldKey(shipmentId), queryFn: () => svc.getState(shipmentId), staleTime: 5_000 });
  const state = stateQ.data;
  const planned = state?.shipment.status === 'PLANNED';
  const sel = useSelectedSack(state);
  const sig = useScanSignals();
  const putState = useCallback((s: HandheldLoadState) => qc.setQueryData(handheldKey(shipmentId), s), [qc, shipmentId]);
  const refetch = stateQ.refetch;
  const { send, prompt, setPrompt } = useScanSender({ shipmentId, putState, refetch, sig, sel });
  const sackOps = useSackOps({ shipmentId, putState, refetch, sig });

  // Tek uçuşlu kuyruk: art arda okutmalar sırayla gider; hedef okutma ANINDAKİ seçimdir.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((fn: () => Promise<void>) => {
    queue.current = queue.current.then(fn, fn);
  }, []);
  const scan = useCallback(
    (raw: string) => {
      const code = raw.trim();
      if (!code || !planned) return;
      const target = sel.ref.current;
      enqueue(() => send(code, target, {}));
    },
    [planned, enqueue, send, sel.ref],
  );
  const confirmPrompt = useCallback(() => {
    if (!prompt) return;
    setPrompt(null);
    enqueue(() => send(prompt.barcode, prompt.target, prompt.resend));
  }, [prompt, setPrompt, enqueue, send]);
  const { setSelected } = sel;
  const toggleSack = useCallback((sackId: string) => setSelected(toggleSelection(sel.ref.current, sackId)), [setSelected, sel.ref]);

  // Sevk et (A6): durum-tabanlı tekrar koruması sunucuda (K3); belirsiz hatada bir kez aynı gövdeyle tekrar.
  const dispatch = useCallback(
    async (body: DispatchBody): Promise<DispatchResult> => {
      const res = await svc.dispatch(shipmentId, body).catch((e: unknown) => {
        if (!isAmbiguousFailure(e)) throw e;
        return svc.dispatch(shipmentId, body);
      });
      putState(res.state);
      setSelected(null);
      void qc.invalidateQueries({ queryKey: HANDHELD_LIST_KEY });
      return res;
    },
    [shipmentId, putState, setSelected, qc],
  );

  return {
    stateQ,
    state,
    planned,
    selected: sel.selected,
    toggleSack,
    banner: sig.banner,
    highlight: sig.highlight,
    prompt,
    confirmPrompt,
    cancelPrompt: () => setPrompt(null),
    scan,
    ...sackOps,
    dispatch,
  };
}
