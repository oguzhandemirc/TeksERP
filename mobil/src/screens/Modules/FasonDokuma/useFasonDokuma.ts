// =============================================================================
// FASON DOKUMA KABUL — ekran durumu: bağlam · seçili iş · iki mutasyon (kuyruk YOK)
// =============================================================================
import { useCallback, useMemo, useRef, useState, type MutableRefObject } from 'react';
import Toast from 'react-native-toast-message';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fasonDokumaService, type FasonTabletOrder } from '../../../services/fasonDokuma.service';
import { useIsOnline, useOfflineReason } from '../../../offline/hooks';
import { generateClientUuid } from '../../../offline/barcode';
import { INFLIGHT_REUSE_WINDOW_MS, isAmbiguousFailure } from '../../../offline/entryAttempt';
import { EMPTY_RECEIPT_ROW, buildReceiptRequest, receiptFingerprint, rowsAfterReceipt, type ReceiptRowForm } from './receiptPayload';

export const FASON_CTX_KEY = ['fason-dokuma', 'context'] as const;
type Attempt = { token: string; fingerprint: string; at: number };

function tokenFor(prev: Attempt | null, fingerprint: string, gen: () => string = generateClientUuid): string {
  if (prev && prev.fingerprint === fingerprint && Date.now() - prev.at <= INFLIGHT_REUSE_WINDOW_MS) return prev.token;
  return gen();
}

/** Tek deneme: belirsiz hata → token yapışır (aynı deneme), kesin 4xx ya da başarı → sonraki gönderim taze token. */
async function sendAttempt<T>(ref: MutableRefObject<Attempt | null>, fingerprint: string, send: (token: string) => Promise<T>): Promise<T> {
  const token = tokenFor(ref.current, fingerprint);
  try {
    const res = await send(token);
    ref.current = null;
    return res;
  } catch (e) {
    ref.current = isAmbiguousFailure(e) ? { token, fingerprint, at: Date.now() } : null;
    throw e;
  }
}

function failureText(e: unknown): string {
  const err = (e ?? {}) as { message?: string };
  return err.message?.trim() || 'Kayıt gitmedi — sunucuya ulaşılamadı ya da istek reddedildi.';
}

export function useFasonDokuma() {
  const qc = useQueryClient();
  const isOnline = useIsOnline();
  const offlineReason = useOfflineReason();
  const context = useQuery({ queryKey: FASON_CTX_KEY, queryFn: fasonDokumaService.tabletContext, staleTime: 30_000 });
  const [orderId, setOrderId] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'receive' | 'return'>(null);
  const [rows, setRows] = useState<ReceiptRowForm[]>([{ ...EMPTY_RECEIPT_ROW }]);
  const [manifestNo, setManifestNo] = useState('');
  const [failedMessages, setFailedMessages] = useState<string[]>([]);
  const receiveAttempt = useRef<Attempt | null>(null);
  const returnAttempt = useRef<Attempt | null>(null);
  const order: FasonTabletOrder | null = useMemo(() => context.data?.weavingOrders.find((o) => o.id === orderId) ?? null, [context.data, orderId]);
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: FASON_CTX_KEY }), [qc]);

  const receive = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('İş seçilmedi');
      return sendAttempt(receiveAttempt, receiptFingerprint(order.id, rows), (clientToken) =>
        fasonDokumaService.receive(buildReceiptRequest(rows, { weavingOrderId: order.id, manifestNo, notes: '', clientToken })),
      );
    },
    onSuccess: (res) => {
      const after = rowsAfterReceipt(rows, res.data);
      setFailedMessages(after.messages);
      setRows(after.rows.length ? after.rows : [{ ...EMPTY_RECEIPT_ROW }]);
      if (after.rows.length === 0) setModal(null);
      Toast.show({ type: after.rows.length ? 'info' : 'success', text1: res.message ?? 'Kabul kaydedildi', text2: after.messages[0], visibilityTime: 6000 });
      for (const w of res.warnings ?? []) Toast.show({ type: 'info', text1: w, visibilityTime: 8000 });
      refresh();
    },
    onError: (e) => Toast.show({ type: 'error', text1: 'Kabul kaydedilemedi', text2: failureText(e), visibilityTime: 6000 }),
  });

  const returnBeam = useMutation({
    mutationFn: (p: { dispatchId: string; warpBeamId: string; lengthM: number }) =>
      sendAttempt(returnAttempt, `${p.dispatchId}|${p.warpBeamId}|${p.lengthM}`, (clientToken) =>
        fasonDokumaService.returnBeam(p.dispatchId, p.warpBeamId, { lengthM: p.lengthM, clientToken }),
      ),
    onSuccess: (res) => {
      setModal(null);
      Toast.show({ type: 'success', text1: res.message ?? 'Levent dönüşü kaydedildi', visibilityTime: 5000 });
      refresh();
    },
    onError: (e) => Toast.show({ type: 'error', text1: 'Dönüş kaydedilemedi', text2: failureText(e), visibilityTime: 6000 }),
  });

  return {
    context, isOnline, offlineReason, refresh,
    orders: context.data?.weavingOrders ?? [], order, setOrderId,
    modal, setModal, rows, setRows, manifestNo, setManifestNo, failedMessages,
    receive, returnBeam, busy: receive.isPending || returnBeam.isPending,
  };
}

export type FasonDokumaState = ReturnType<typeof useFasonDokuma>;
