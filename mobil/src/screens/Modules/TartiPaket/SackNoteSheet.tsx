import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text, Button, TextInput } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import { useMutation } from '@tanstack/react-query';
import AppModal from '../../../components/AppModal';
import { colors, spacing, radius } from '../../../theme';
import { packingService } from '../../../services/packing.service';
import { isWorkSessionLost } from '../../../services/api';

// =============================================================================
// Çuval yorumu sheet'i — İÇ serbest not ("kendimiz için").
//
// Çuvalın durumu FARK ETMEZ: sevkiyata atanmış / sevk edilmiş çuvala da yazılır
// (backend'de touchWarehouseSackTx guard'ı bilinçli olarak YOK — annotation).
// Boş kaydetmek yorumu SİLER (ayrı "sil" butonu yok, tek yol).
//
// Klavye: multiline input sheet'in altında → AppModal position="bottom" ile TAM
// klavye yüksekliği kadar kalkar. AppModal İÇİNE KeyboardAware* KOYULMAZ (çift
// telafi olur — bkz. mobil klavye modal deseni).
// =============================================================================

const MAX = 500;

interface Props {
  /** null → kapalı. */
  target: { id: string; label: string; notes: string | null } | null;
  onDismiss: () => void;
  /** Kayıt sonrası listeyi tazele. */
  onSaved: () => void;
}

export default function SackNoteSheet({ target, onDismiss, onSaved }: Props) {
  const [text, setText] = useState('');

  // Hedef değişince (başka çuval açılınca) alanı o çuvalın notuyla doldur.
  useEffect(() => {
    setText(target?.notes ?? '');
  }, [target?.id, target?.notes]);

  const saveMut = useMutation({
    mutationFn: (notes: string | null) => packingService.setSackNotes(target!.id, notes),
    onSuccess: (res) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({
        type: 'success',
        text1: res.data.notes ? 'Not kaydedildi' : 'Not temizlendi',
        text2: target?.label,
      });
      onDismiss();
      onSaved();
    },
    onError: (e: Error) => {
      if (isWorkSessionLost(e)) return;
      Toast.show({ type: 'error', text1: 'Not kaydedilemedi', text2: e.message });
    },
  });

  const trimmed = text.trim();
  const original = target?.notes ?? '';
  const dirty = trimmed !== original.trim();

  return (
    <AppModal visible={target !== null} onDismiss={onDismiss} position="bottom" contentStyle={styles.wrap}>
      <Surface style={styles.sheet} elevation={4}>
        <Text variant="titleMedium" style={styles.title}>
          {target?.label} — Not
        </Text>
        <Text style={styles.hint}>Kendimiz için. Boş kaydetmek notu siler.</Text>

        <TextInput
          mode="outlined"
          label="Çuval notu"
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={4}
          maxLength={MAX}
          autoFocus
          style={styles.input}
        />
        <Text style={styles.counter}>
          {trimmed.length} / {MAX}
        </Text>

        <View style={styles.actions}>
          <Button onPress={onDismiss} style={styles.actionBtn} disabled={saveMut.isPending}>
            İptal
          </Button>
          <Button
            mode="contained"
            icon="check"
            buttonColor={colors.successDark}
            style={styles.actionBtn}
            loading={saveMut.isPending}
            // Değişiklik yoksa kaydetmeye gerek yok (gereksiz istek + audit satırı).
            disabled={saveMut.isPending || !dirty}
            onPress={() => saveMut.mutate(trimmed || null)}
          >
            Kaydet
          </Button>
        </View>
      </Surface>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  // position="bottom" + sabit genişlik → alignSelf:'center' ŞART (yoksa sola yaslanır).
  wrap: { alignSelf: 'center', marginBottom: spacing.md },
  sheet: { width: '100%', borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface },
  title: { fontWeight: '700', marginBottom: spacing.xs, color: colors.text },
  hint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: spacing.sm },
  input: { minHeight: 96 },
  counter: { alignSelf: 'flex-end', color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});
