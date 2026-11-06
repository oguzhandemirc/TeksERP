// Gramajı Değiştir (tablet Düzelt menüsü, 2026-11-06): başlamış iş emrinde kurşun hedef gramajı. Uygulanmış topun
// gramajı değişmez; önizleme bunu sayıyla söyler. Yetki `workorder:write ∨ mobile:is-emri-duzelt` (sunucu kurşun dışını reddeder).
import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import ModuleSheet, { sheet } from '../../../components/ModuleSheet';
import ReasonPresetPicker, { type ReasonPresetValue } from '../../../components/reasonPresets/ReasonPresetPicker';
import { useReasonPresets } from '../../../hooks/useReasonPresets';
import { workOrderGramajService } from '../../../services/workOrderGramaj.service';
import { gramajImpactText, reasonPayload, reasonReady } from './workOrderFix';
import { errorText, Footer, useAfterSave, type FixWo } from './fixSheetParts';

export const kursunGramajKey = (woId: string) => ['wo-kursun-gramaj', woId] as const;

export default function GramajFixSheet({ wo, onDismiss, onDone }: { wo: FixWo; onDismiss: () => void; onDone: () => void }) {
  const q = useQuery({ queryKey: kursunGramajKey(wo.id), queryFn: () => workOrderGramajService.kursunGramaj(wo.id) });
  const p = q.data;
  const [valueId, setValueId] = useState<string | null>(null);
  const [reason, setReason] = useState<ReasonPresetValue>({ code: null, text: '' });
  const { presets } = useReasonPresets('WORK_ORDER_PLAN_CHANGE');
  const changed = !!valueId && valueId !== (p?.target?.valueId ?? null);
  const after = useAfterSave(wo.id, onDone);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => workOrderGramajService.changeKursunGramaj(wo.id, { propertyId: p!.propertyId!, valueId: valueId!, reason: reasonPayload(reason, presets).reason }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: kursunGramajKey(wo.id) });
      after('Gramaj değiştirildi', r.warnings);
    },
    onError: (err) => Toast.show({ type: 'error', text1: 'Gramaj değiştirilemedi', text2: errorText(err) }),
  });
  return (
    <ModuleSheet
      visible
      onDismiss={onDismiss}
      title="Gramajı Değiştir"
      subtitle={`${wo.workOrderNumber} · şu an: ${p?.target?.valueName ?? '—'}`}
      footer={<Footer onCancel={onDismiss} onSave={() => save.mutate()} busy={save.isPending} disabled={!changed || !p?.propertyId || !reasonReady(reason, presets)} />}
    >
      {q.isLoading ? <Text style={sheet.hint}>Yükleniyor…</Text> : null}
      {q.isError ? <Text style={sheet.error}>Gramaj bilgisi alınamadı: {errorText(q.error)}</Text> : null}
      {p && !p.propertyId ? <Text style={sheet.error}>Kurşun gramajı özelliği tanımlı değil.</Text> : null}
      {p?.propertyId ? (
        <>
          <Text style={sheet.label}>Yeni gramaj</Text>
          <View style={sheet.row}>
            {p.options.map((o) => (
              <Button key={o.id} mode={valueId === o.id ? 'contained' : 'outlined'} onPress={() => setValueId(o.id)} testID={`gramaj-${o.id}`}>
                {o.name}
              </Button>
            ))}
          </View>
          <Text style={p.appliedRollCount > 0 ? sheet.warn : sheet.hint} testID="gramaj-onizleme">{gramajImpactText(p)}</Text>
          <Text style={sheet.label}>Sebep</Text>
          <ReasonPresetPicker kind="WORK_ORDER_PLAN_CHANGE" value={reason} onChange={setReason} />
        </>
      ) : null}
    </ModuleSheet>
  );
}
