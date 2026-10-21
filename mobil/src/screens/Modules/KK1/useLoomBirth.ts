// =============================================================================
// KK1 tezgah etiketi okutma — ekran hook'u (S3a): okut → kk1-context → ön-dolgu
// =============================================================================
// Kurallar `loomBirth.ts`te; burada yalnız ağ + durum + geri bildirim. Okutma 4xx'te
// RET (tezgah yok / tezgah değil / açık iş yok — kaydetmeden önce görülür); ağ/5xx'te
// KABUL ve şerit "bağlanınca doğrulanır" (çevrimdışı kuyruk: `machineCode` gövdeyle
// gider, bağlam replay'de sunucuda çözülür). Ön-dolgu öneridir: kumaş forma yazılır,
// operatör değiştirebilir (D17). Sonuç sesi/titreşimi `signalScan`.
// =============================================================================
import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { doffService } from '../../../services/doff.service';
import { weavingOrderService, type WeavingOrderSummary } from '../../../services/weavingOrder.service';
import type { DokumaRollBirth } from '../../../services/featureFlag.service';
import { FLAGS_KEY } from '../../../hooks/useFeatureFlags';
import { signalScan } from '../../../services/scanFeedback';
import { isAmbiguousFailure } from '../../../offline/entryAttempt';
import { normalizeScanCode } from '../../../utils/scanCode';
import {
  EMPTY_LOOM_BIRTH, afterSave, applyScanResult, classifyLoomBirthFailure, loomFailureText, orderPickAllowed, selectOrder,
  type LoomBirthState, type LoomFailureKind,
} from './loomBirth';

export const KK1_OPEN_ORDERS_KEY = ['weaving-orders', 'open', 'kk1'] as const;

type ApiError = { status?: number; message?: string; details?: Record<string, unknown> };

interface Deps {
  visible: boolean;
  rollBirth: DokumaRollBirth;
  isOnline: boolean;
  /** Ön-dolgu: kumaş SOL forma (kilitsiz). */
  onPrefillItem: (item: { id: string; name: string }) => void;
}

export interface LoomFailureModal {
  title: string;
  hint: string;
  message: string | null;
}

type SetLoom = React.Dispatch<React.SetStateAction<LoomBirthState>>;

/** Okutma: kk1-context → kabul/ret + ön-dolgu. Ardışık okutmada geç gelen eski cevap yenisini ezmez (`seq`). */
function useLoomScan(setState: SetLoom, isOnline: boolean, onPrefillItem: Deps['onPrefillItem']) {
  const qc = useQueryClient();
  const [scanValue, setScanValue] = useState('');
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const seq = useRef(0);

  const scan = useCallback(
    async (raw: string, lineNo: number | null = null) => {
      const code = normalizeScanCode(raw);
      setScanValue('');
      if (!code) return;
      const my = ++seq.current;
      if (!isOnline) {
        signalScan('accept');
        setScanMessage(null);
        setState((s) => applyScanResult(s, code, { ok: false, ambiguous: true }, lineNo).state);
        return;
      }
      setState((s) => ({ ...EMPTY_LOOM_BIRTH, lastMachineCode: s.lastMachineCode, machineCode: code, lineNo, verify: 'pending' }));
      try {
        const res = await doffService.kk1Context(code, lineNo);
        if (my !== seq.current || !res.data) return;
        const context = res.data;
        signalScan('accept');
        setScanMessage(null);
        setState((s) => applyScanResult(s, code, { ok: true, context }, lineNo).state);
        if (context.run.item) onPrefillItem({ id: context.run.item.id, name: context.run.item.name });
      } catch (e) {
        if (my !== seq.current) return;
        const ambiguous = isAmbiguousFailure(e);
        signalScan(ambiguous ? 'accept' : 'reject');
        const reset = (s: LoomBirthState): LoomBirthState => ({ ...EMPTY_LOOM_BIRTH, lastMachineCode: s.lastMachineCode });
        setState((s) => (ambiguous ? applyScanResult(reset(s), code, { ok: false, ambiguous }, lineNo).state : reset(s)));
        if (ambiguous) return setScanMessage(null);
        const err = e as ApiError;
        const kind = classifyLoomBirthFailure(err.details?.code);
        if (kind === 'mode-changed') void qc.invalidateQueries({ queryKey: FLAGS_KEY });
        const t = loomFailureText(kind, code);
        setScanMessage(kind === 'plain' ? (err.message ?? 'Etiket okunamadı') : `${t.title} — ${t.hint}`);
      }
    },
    [isOnline, onPrefillItem, qc, setState]
  );
  return { scan, scanValue, setScanValue, scanMessage, setScanMessage, seq };
}

/**
 * Kayıt reddinin ekran eylemi. `true` → hata burada konuştu (genel toast basılmaz).
 * Hepsi kesin 4xx: hiçbir şey yazılmadı, token zaten yenilenir (KK1 onError).
 */
function useLoomFailure(setState: SetLoom, clear: () => void) {
  const qc = useQueryClient();
  const [failureModal, setFailureModal] = useState<LoomFailureModal | null>(null);
  const handleFailure = useCallback(
    (e: unknown, where: string | null): boolean => {
      const err = e as ApiError;
      const kind: LoomFailureKind = classifyLoomBirthFailure(err.details?.code);
      if (kind === 'plain') return false;
      const t = loomFailureText(kind, where);
      if (kind === 'beam-not-recent') setState((s) => ({ ...s, beamChoice: 'new', beamChipsDismissed: true }));
      else clear();
      if (kind === 'mode-changed') void qc.invalidateQueries({ queryKey: FLAGS_KEY });
      if (kind === 'order-closed') void qc.invalidateQueries({ queryKey: KK1_OPEN_ORDERS_KEY });
      if (kind === 'no-open-run') setFailureModal({ title: t.title, hint: t.hint, message: err.message ?? null });
      else Toast.show({ type: 'error', text1: t.title, text2: [t.hint, err.message].filter(Boolean).join(' · '), visibilityTime: 6000 });
      return true;
    },
    [clear, qc, setState]
  );
  return { handleFailure, failureModal, dismissFailure: () => setFailureModal(null) };
}

export function useLoomBirth({ visible, rollBirth, isOnline, onPrefillItem }: Deps) {
  const [state, setState] = useState<LoomBirthState>(EMPTY_LOOM_BIRTH);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const sc = useLoomScan(setState, isOnline, onPrefillItem);
  const { seq, setScanMessage } = sc;
  const orders = useQuery({
    queryKey: KK1_OPEN_ORDERS_KEY,
    queryFn: weavingOrderService.listOpen,
    enabled: visible && ordersOpen && orderPickAllowed(rollBirth),
    staleTime: 30_000,
  });

  const pickOrder = useCallback(
    (o: WeavingOrderSummary) => {
      seq.current += 1;
      setState((s) => selectOrder(s, { id: o.id, weavingOrderNumber: o.weavingOrderNumber, itemName: o.item?.name ?? null }));
      setScanMessage(null);
      setOrdersOpen(false);
      if (o.item) onPrefillItem({ id: o.item.id, name: o.item.name });
    },
    [onPrefillItem, seq, setScanMessage]
  );
  const clear = useCallback(() => {
    seq.current += 1;
    setScanMessage(null);
    setState((s) => ({ ...EMPTY_LOOM_BIRTH, lastMachineCode: s.lastMachineCode }));
  }, [seq, setScanMessage]);
  const failure = useLoomFailure(setState, clear);

  return {
    state,
    scanValue: sc.scanValue,
    setScanValue: sc.setScanValue,
    scanMessage: sc.scanMessage,
    scan: sc.scan,
    setLine: (n: number) => (state.machineCode ? void sc.scan(state.machineCode, n) : undefined),
    chooseBeam: (c: 'new' | 'old') => setState((s) => ({ ...s, beamChoice: c })),
    sameLoom: () => (state.lastMachineCode ? void sc.scan(state.lastMachineCode) : undefined),
    clear,
    ordersOpen,
    setOrdersOpen,
    orders: orders.data ?? [],
    ordersLoading: orders.isLoading,
    ordersError: orders.isError,
    refetchOrders: () => void orders.refetch(),
    pickOrder,
    /** Kayıt gönderildi (kuyruğa da olabilir): şerit temizlenir; geri yükleme için önceki durum döner. */
    afterSubmit: (): LoomBirthState => {
      setState(afterSave(state));
      return state;
    },
    restore: (prev: LoomBirthState) => setState(prev),
    ...failure,
  };
}

export type LoomBirthApi = ReturnType<typeof useLoomBirth>;
