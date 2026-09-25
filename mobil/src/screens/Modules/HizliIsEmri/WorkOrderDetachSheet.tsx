import React, { useState } from 'react';
import { View } from 'react-native';
import { Checkbox, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { useMutation, useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import { workOrderService } from '../../../services/workOrder.service';
import { detachResultMessage, MIN_REASON_LENGTH } from './workOrderFix';
import { errorText, Footer, useAfterSave, type FixWo } from './fixSheetParts';

/**
 * Top Çıkar (hareket defteri D6) — yanlış okutulan topu iş emrinden geri al. Her top ayrı
 * satır: işlem görmüş top seçilemez ve nedeni altında yazar (panelde Konumu Düzelt / Parti Düşür).
 */
export default function WorkOrderDetachSheet({ wo, onDismiss, onDone }: { wo: FixWo; onDismiss: () => void; onDone: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState('Yanlış okutuldu');
  const q = useQuery({ queryKey: ['wo-detach-candidates', wo.id], queryFn: () => workOrderService.getDetachCandidates(wo.id) });
  const rows = q.data?.data ?? [];
  const after = useAfterSave(wo.id, onDone);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const save = useMutation({
    mutationFn: async () => {
      const failed: string[] = [];
      let ok = 0;
      let reverted = false;
      for (const id of selected) {
        try {
          const res = await workOrderService.detachRoll(wo.id, id, reason.trim());
          ok += 1;
          reverted = reverted || !!res.data?.workOrderReverted;
        } catch (err) {
          failed.push(errorText(err) ?? 'bilinmeyen hata');
        }
      }
      return detachResultMessage(ok, failed, reverted);
    },
    onSuccess: (msg) => {
      if (msg.type === 'error') Toast.show({ type: 'error', text1: 'Top Çıkar', text2: msg.text, visibilityTime: 6000 });
      after(msg.type === 'success' ? msg.text : 'Top Çıkar tamamlandı');
    },
  });
  return (
    <ModuleSheet
      visible
      onDismiss={onDismiss}
      title="Top Çıkar"
      subtitle={`${wo.workOrderNumber} · yalnız işlem görmemiş top çıkar`}
      footer={<Footer onCancel={onDismiss} onSave={() => save.mutate()} busy={save.isPending} disabled={selected.length === 0 || reason.trim().length < MIN_REASON_LENGTH} label={`Çıkar (${selected.length})`} />}
    >
      {q.isLoading ? <Text style={sheet.hint}>Toplar yükleniyor…</Text> : null}
      {!q.isLoading && rows.length === 0 ? <Text style={sheet.hint}>Bu iş emrinde top yok.</Text> : null}
      {rows.map((r) => (
        <TouchableRipple key={r.id} onPress={() => toggle(r.id)} disabled={!r.detachable} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(r.id), disabled: !r.detachable }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', opacity: r.detachable ? 1 : 0.55 }}>
            <Checkbox.Android status={selected.includes(r.id) ? 'checked' : 'unchecked'} disabled={!r.detachable} />
            <View style={{ flex: 1 }}>
              <Text style={sheet.line}>{`${r.barcode ?? '—'} · ${Math.round(r.currentQty)} m`}</Text>
              {r.detachable ? null : <Text style={sheet.warn}>{`Çıkarılamaz: ${r.blockers.join(', ')} — panelden Konumu Düzelt / Parti Düşür`}</Text>}
            </View>
          </View>
        </TouchableRipple>
      ))}
      <Text style={sheet.label}>Sebep</Text>
      <TextInput mode="outlined" value={reason} onChangeText={setReason} style={sheet.input} maxLength={300} />
      <Text style={sheet.hint}>Top iş emrine girmeden önceki yerine döner; kayıt silinmez, Hareketler'de "Top çıkarıldı" görünür.</Text>
    </ModuleSheet>
  );
}
