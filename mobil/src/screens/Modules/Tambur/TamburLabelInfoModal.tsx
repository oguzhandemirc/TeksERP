// İş emri etiket bilgisi (Gülkesim S5 · cevap 9): tamburcu basım öncesi desen/renk/en vb. ekler,
// düzeltir ya da "boş bas" der. Değer İE'ye yazılır (sunucu audit'ler), bu işin her etiketine uygulanır.
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Checkbox, Text, TouchableRipple } from 'react-native-paper';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import AppModal from '../../../components/AppModal';
import ModalTextInput from '../../../components/ModalTextInput';
import { tamburService } from '../../../services/tambur.service';
import { showScreenError } from '../../../lib/screenToast';
import { colors, spacing } from '../../../theme/tokens';
import { overridePatch } from './finalLabel';

type Draft = Record<string, { text: string; blank: boolean }>; // anahtar → kutu taslağı

export default function TamburLabelInfoModal({ workOrderId, visible, onDismiss }: { workOrderId: string | null; visible: boolean; onDismiss: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['labels', 'wo-overrides', workOrderId],
    queryFn: () => tamburService.getLabelOverrides(workOrderId as string),
    enabled: visible && !!workOrderId,
  });
  const [draft, setDraft] = useState<Draft>({});
  useEffect(() => {
    if (!q.data) return;
    const d: Draft = {};
    for (const k of q.data.keys) {
      const v = q.data.overrides[k.key];
      d[k.key] = { text: v ?? '', blank: v === '' };
    }
    setDraft(d);
  }, [q.data]);

  const save = useMutation({
    mutationFn: (patch: Record<string, string | null>) =>
      tamburService.putLabelOverrides(workOrderId as string, { overrides: patch, updatedAt: q.data?.updatedAt ?? null }),
    onSuccess: (res) => {
      qc.setQueryData(['labels', 'wo-overrides', workOrderId], res);
      Toast.show({ type: 'success', text1: 'Etiket bilgisi kaydedildi', text2: 'Bu işin sonraki etiketlerine uygulanır.' });
      onDismiss();
    },
    onError: (err: Error) => showScreenError(err, 'Etiket bilgisi kaydedilemedi'),
  });

  const submit = () => {
    if (!q.data) return;
    const patch = overridePatch(q.data.overrides, draft);
    if (Object.keys(patch).length === 0) {
      onDismiss();
      return;
    }
    save.mutate(patch);
  };

  return (
    <AppModal visible={visible} onDismiss={onDismiss} contentStyle={s.box}>
      <Text variant="titleMedium" style={s.title}>{`Etiket bilgisi${q.data ? ` · ${q.data.workOrderNumber}` : ''}`}</Text>
      <Text style={s.sub}>Boş kutu = kaynak değer. "Boş bas" işaretli alan etikete boş çıkar.</Text>
      {q.isLoading ? <Text style={s.sub}>Yükleniyor…</Text> : null}
      {q.isError ? <Text style={s.err}>Etiket bilgisi okunamadı.</Text> : null}
      <ScrollView style={s.list} keyboardShouldPersistTaps="handled">
        {(q.data?.keys ?? []).map((k) => (
          <LabelInfoRow
            key={k.key}
            field={k}
            value={draft[k.key] ?? { text: '', blank: false }}
            onChange={(v) => setDraft((d) => ({ ...d, [k.key]: v }))}
          />
        ))}
      </ScrollView>
      <View style={s.actions}>
        <Button onPress={onDismiss}>Vazgeç</Button>
        <Button mode="contained" onPress={submit} loading={save.isPending} disabled={!q.data || save.isPending} testID="etiket-bilgisi-kaydet">
          Kaydet
        </Button>
      </View>
    </AppModal>
  );
}

type FieldDraft = { text: string; blank: boolean };

function LabelInfoRow({ field, value: v, onChange }: { field: { key: string; label: string; type: 'text' | 'number' }; value: FieldDraft; onChange: (v: FieldDraft) => void }) {
  return (
    <View style={s.row}>
      <View style={s.input}>
        <ModalTextInput
          mode="outlined"
          dense
          label={field.label}
          value={v.text}
          disabled={v.blank}
          keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'}
          maxLength={120}
          onChangeText={(text) => onChange({ ...v, text })}
          testID={`etiket-bilgisi-${field.key}`}
        />
      </View>
      <TouchableRipple onPress={() => onChange({ text: '', blank: !v.blank })} testID={`etiket-bilgisi-bos-${field.key}`}>
        <View style={s.blank}>
          <Checkbox.Android status={v.blank ? 'checked' : 'unchecked'} />
          <Text>Boş bas</Text>
        </View>
      </TouchableRipple>
    </View>
  );
}

const s = StyleSheet.create({
  box: { width: 560, maxWidth: '96%', padding: spacing.lg, backgroundColor: colors.surface, borderRadius: 12 },
  title: { fontWeight: '700', marginBottom: spacing.xs },
  sub: { color: colors.textSecondary, marginBottom: spacing.sm },
  err: { color: colors.dangerText, marginBottom: spacing.sm },
  list: { maxHeight: 420 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  input: { flex: 1 },
  blank: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
