// Tambur müşteri parti no şeridi: "Etikete basılacak parti: J1 · bu değerle N. top". Tek dokunuşla
// değiştirme penceresi açılır; değer yapışkandır (iş emri değişince sıfırlanır). Ayar kapalıysa çizilmez.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
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
      <TouchableRipple onPress={() => setOpen(true)} style={s.strip} testID="tambur-parti-serit">
        <View>
          <Text style={s.text}>{batch.stripText}</Text>
          {batch.warning ? <Text style={s.warn}>{batch.warning}</Text> : null}
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
            <Button mode="text" onPress={() => save('')} testID="tambur-parti-temizle">Temizle</Button>
            <Button mode="text" onPress={() => setOpen(false)}>Vazgeç</Button>
            <Button mode="contained" onPress={() => save(draft)} testID="tambur-parti-kaydet">Kaydet</Button>
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
  text: { fontSize: 16, fontWeight: '600' },
  warn: { fontSize: 13, color: colors.dangerText },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
