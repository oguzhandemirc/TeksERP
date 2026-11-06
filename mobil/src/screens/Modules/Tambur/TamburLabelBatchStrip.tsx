// Tambur müşteri parti no şeridi: "Etikete basılacak parti: J1 · bu değerle N. top". Tek dokunuşla
// değiştirme penceresi açılır; değer yapışkandır (iş emri değişince sıfırlanır). Ayar kapalıysa çizilmez.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import ModalTextInput from '../../../components/ModalTextInput';
import { colors, spacing } from '../../../theme/tokens';
import { TERIM } from '../../../lib/terim';
import { LABEL_BATCH_MAX } from './labelBatch';
import type { TamburLabelBatch } from './useTamburLabelBatch';

export default function TamburLabelBatchStrip({ batch }: { batch: TamburLabelBatch }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(batch.value);
  useEffect(() => {
    if (open) setDraft(batch.value);
  }, [open, batch.value]);
  if (!batch.enabled) return null;
  const save = (text: string) => {
    batch.setValue(text);
    setOpen(false);
  };
  return (
    <>
      {/* Değer kritik bilgidir (etikete basılır): uzaktan okunur boyutta; şeridin dokunulabilir olduğu "Değiştir" ile söylenir. */}
      <TouchableRipple onPress={() => setOpen(true)} style={s.strip} testID="tambur-parti-serit" accessibilityRole="button"
        accessibilityLabel={`${batch.stripText}. Değiştirmek için dokunun`}>
        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>Etikete basılacak müşteri partisi</Text>
            <View style={s.valueRow}>
              <Text style={batch.stripParts.value ? s.value : s.valueEmpty} testID="tambur-parti-deger">{batch.stripParts.value ?? '—'}</Text>
              {batch.stripParts.countText ? <Text style={s.count}>{batch.stripParts.countText}</Text> : null}
            </View>
            {batch.warning ? <Text style={s.warn}>{batch.warning}</Text> : null}
          </View>
          <View style={s.action}>
            <Icon source="pencil" size={22} color={colors.brand} />
            <Text style={s.actionText}>{batch.stripParts.value ? 'Değiştir' : 'Gir'}</Text>
          </View>
        </View>
      </TouchableRipple>
      <ModuleSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        size="sm"
        title="Etikete basılacak müşteri partisi"
        subtitle={`Değer sonraki kesimlerde aynen kalır; ${TERIM.terbiyeIsEmri.tekilKucuk} değişince sıfırlanır.`}
        footer={
          <View style={s.actions}>
            <Button mode="text" onPress={() => save('')} contentStyle={s.btn} testID="tambur-parti-temizle">Temizle</Button>
            <Button mode="text" onPress={() => setOpen(false)} contentStyle={s.btn}>Vazgeç</Button>
            <Button mode="contained" onPress={() => save(draft)} contentStyle={s.btn} testID="tambur-parti-kaydet">Kaydet</Button>
          </View>
        }
      >
        <ModalTextInput
          mode="outlined"
          autoFocus
          value={draft}
          onChangeText={setDraft}
          maxLength={LABEL_BATCH_MAX}
          placeholder="ör. J1"
          autoCapitalize="characters"
          onSubmitEditing={() => save(draft)}
          testID="tambur-parti-input"
        />
      </ModuleSheet>
    </>
  );
}

const s = StyleSheet.create({
  strip: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceMuted,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  col: { flex: 1 },
  label: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: spacing.sm },
  value: { fontSize: 24, fontWeight: '800', color: colors.text },
  valueEmpty: { fontSize: 24, fontWeight: '800', color: colors.textMuted },
  count: { fontSize: 14, color: colors.textSecondary },
  warn: { fontSize: 14, color: colors.warningText, fontWeight: '600' },
  action: { minWidth: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 14, fontWeight: '700', color: colors.brand },
  btn: { minHeight: 56 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
