// "Kendi üretim" kipinin kayıt kancası: toplar (okut / listeden seç, emanet ön süzgeçli) + `quick-start` (`ownGoods`).
// Token mantıksal deneme başına (aynı gövde = aynı deneme), yalnız belirsiz hatada (ağ/5xx) yapışır.
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../../offline/attemptToken';
import type { ProductionRoute } from '../../../../services/route.service';
import { workOrderService } from '../../../../services/workOrder.service';
import { useAddBatchRolls } from '../../HizliIsEmri/useAddBatchRolls';
import { totalQty } from '../../HizliIsEmri/addBatch';
import { buildOwnGoodsBody, ownGoodsAttemptKey, ownGoodsResultText, ownGoodsRollReject } from './ownGoods';
import type { ExtraBody } from './woForm';
import { errorText } from './woFromDoc';

export interface OwnGoodsResult {
  workOrderId: string;
  workOrderNumber: string;
  attached: number;
  text: string;
}

export function useOwnGoodsCreate(a: { lockedItemId: string | null; route: ProductionRoute | null; extraBody: () => ExtraBody }) {
  const rolls = useAddBatchRolls(a.lockedItemId, ownGoodsRollReject);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<OwnGoodsResult | null>(null);
  const attempt = useAttemptToken();
  const lastKey = useRef<string | null>(null);
  const argsRef = useRef(a);
  argsRef.current = a;

  const save = useCallback(async () => {
    const { route, extraBody } = argsRef.current;
    const barcodes = rolls.rolls.map((r) => r.barcode);
    const draft = buildOwnGoodsBody(extraBody(), route, barcodes, '');
    const key = ownGoodsAttemptKey(draft);
    // İçerik değiştiyse yeni mantıksal deneme (belirsiz hatada yapışan token başka gövdeye gitmez).
    if (lastKey.current !== key) attempt.renew();
    lastKey.current = key;
    setSaving(true);
    try {
      const res = await workOrderService.quickStart({ ...draft, clientToken: attempt.token() });
      attempt.onSuccess();
      const wo = res.data?.workOrder;
      if (!wo) throw new Error(res.message ?? 'İş emri açılamadı');
      const attached = res.data?.attached ?? 0;
      const text = ownGoodsResultText({ workOrderNumber: wo.workOrderNumber, attached, batchNumber: res.data?.batch?.batchNumber ?? null });
      setResult({ workOrderId: wo.id, workOrderNumber: wo.workOrderNumber, attached, text });
      Toast.show({ type: 'success', text1: text });
      for (const w of res.warnings ?? []) Toast.show({ type: 'info', text1: 'Not', text2: w, visibilityTime: 6000 });
    } catch (e) {
      attempt.onFailure(e);
      Toast.show({ type: 'error', text1: 'İş emri oluşturulamadı', text2: errorText(e), visibilityTime: 6000 });
    } finally {
      setSaving(false);
    }
  }, [rolls.rolls, attempt]);

  return { ...rolls, totalQty: totalQty(rolls.rolls), saving, result, save };
}

export type OwnGoodsCreate = ReturnType<typeof useOwnGoodsCreate>;
