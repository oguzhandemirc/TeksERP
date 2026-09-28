// =============================================================================
// Etiketteki ad düzeltmesinin YAZMA yarısı — servis çağrıları burada, karar saf
// modülde (`labelNameSave`). Bileşen yalnız görünümü taşır.
// =============================================================================
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import { labelService, type LabelNamePreview } from '../../../services/label.service';
import {
  masterChanged,
  NameChangedError,
  partialFailureMessage,
  planPermanentWrites,
  type MasterSnapshot,
  type PermanentWrite,
} from './labelNameSave';

function writePermanent(w: PermanentWrite): Promise<unknown> {
  if (w.kind === 'ITEM_ALIAS') return labelService.setCustomerItemAlias(w.customerId, w.itemId, w.alias);
  if (w.kind === 'ITEM_COLOR_ALIAS') {
    return labelService.setCustomerItemColorAlias(w.customerId, w.itemId, w.colorId, w.alias);
  }
  return labelService.setCustomerColorAlias(w.customerId, w.colorId, w.alias);
}

/**
 * "Bu müşteride hep": ana veri kayıt anında yeniden okunur — açılıştan beri panelden
 * kumaşa özel ad eklendi/silindiyse yanlış kademeye yazmak yerine durulur. Renk
 * kademesi kalem adı OLMADAN çözülen zincirden gelir (kalem adının altı görünsün).
 */
async function savePermanentNames(
  rollId: string,
  p: LabelNamePreview,
  seen: MasterSnapshot | null,
  input: { itemName: string; colorName: string },
): Promise<void> {
  if (!p.customerId) throw new Error('Müşteri seçili değil');
  if (!seen) throw new Error('Güncel ad alınamadı — pencereyi kapatıp yeniden açın.');
  const fresh = (await labelService.previewCustomerNames({ rollId, orderLineId: null, customerId: p.customerId }))
    .data;
  if (!fresh || masterChanged(seen, fresh)) throw new NameChangedError();
  const plan = planPermanentWrites({ ...p, colorNameScope: fresh.colorNameScope ?? null }, input);
  // Sıralı: yazımlar ayrı uçlara gider, biri düşerse hangisinin yazıldığı belli kalsın.
  const done: PermanentWrite['kind'][] = [];
  for (const w of plan) {
    try {
      await writePermanent(w);
    } catch (e) {
      throw new Error(partialFailureMessage(done, w.kind, e instanceof Error ? e.message : String(e)));
    }
    done.push(w.kind);
  }
}

export function useLabelNameSave(a: {
  rollId: string | null;
  orderLineId: string | null;
  p: LabelNamePreview | null;
  master: MasterSnapshot | null;
  scope: 'ORDER' | 'PERMANENT' | null;
  itemName: string;
  colorName: string;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['label', 'name-preview'] });
    void qc.invalidateQueries({ queryKey: ['label', 'roll'] });
  };
  return useMutation({
    mutationFn: async () => {
      if (!a.p || !a.rollId) return;
      const nextItem = a.itemName.trim();
      const nextColor = a.colorName.trim();
      if (a.scope === 'ORDER') {
        if (!a.orderLineId) throw new Error('Sipariş satırı yok');
        await labelService.updateOrderLineCustomerNames(a.orderLineId, {
          customerItemName: nextItem || null,
          customerColorName: nextColor || null,
        });
        return;
      }
      await savePermanentNames(a.rollId, a.p, a.master, { itemName: nextItem, colorName: nextColor });
    },
    onSuccess: () => {
      Toast.show({
        type: 'success',
        text1: a.scope === 'ORDER' ? 'Bu sipariş için güncellendi' : 'Müşteri adı güncellendi',
      });
      refresh();
      a.onSaved();
    },
    // Yazımın bir kısmı geçmiş olabilir: önizleme kâğıtla ayrışmasın diye her hatada tazelenir.
    onError: (e: Error) => {
      refresh();
      Toast.show({
        type: 'error',
        text1: e instanceof NameChangedError ? 'Kaydedilmedi' : 'Güncellenemedi',
        text2: e.message,
      });
    },
  });
}
