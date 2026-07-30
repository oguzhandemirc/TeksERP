import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text, Button } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import NumpadInput from '../../../components/NumpadInput';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// Elle kg girişi — ⋮ → "Elle kg gir" yolu. Normal akış TEK DOKUNUŞ otomatik
// tartıdır (⚖); bu sheet kantar yokken/bozukken açılan kaçış yoludur, o yüzden
// kartta yer kaplamaz.
//
// `NumpadInput useNativeKeyboard` bilinçli: büyük özel numpad bir `NumpadHost`
// render edilmesini ister (KK1/Tambur kendi kolonlarında yapıyor), modal içinde
// host yok → tuşlar görünmez kalırdı. useNativeKeyboard sistem decimal-pad'ini
// açar VE NumpadInput'un virgül→nokta normalizasyonunu korur ("40,5" → 40.5;
// düz TextInput'ta virgül düşüp 405 oluyordu).
// =============================================================================

interface Props {
  /** null → kapalı. */
  target: { id: string; label: string; weightKg: number | null } | null;
  onDismiss: () => void;
  /** true dönerse sheet kapanır. */
  onSave: (kg: number) => Promise<boolean>;
}

export default function SackManualWeightSheet({ target, onDismiss, onSave }: Props) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(target?.weightKg != null ? String(target.weightKg) : '');
  }, [target?.id, target?.weightKg]);

  const kg = parseFloat(text);
  const valid = Number.isFinite(kg) && kg > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (await onSave(kg)) onDismiss();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal visible={target !== null} onDismiss={onDismiss} position="bottom" contentStyle={styles.wrap}>
      <Surface style={styles.sheet} elevation={4}>
        <Text variant="titleMedium" style={styles.title}>
          {target?.label} — Elle Brüt Tartı
        </Text>
        <Text style={styles.hint}>
          Kantar okunamadığında kullanılır. Kantar çalışıyorsa karttaki ⚖ tuşuna basmak yeterli.
        </Text>

        <NumpadInput
          mode="outlined"
          label="Brüt ağırlık (kg)"
          value={text}
          onChangeText={setText}
          allowDecimal
          useNativeKeyboard
          autoFocus
          style={styles.input}
        />

        <View style={styles.actions}>
          <Button onPress={onDismiss} style={styles.actionBtn} disabled={saving}>
            İptal
          </Button>
          <Button
            mode="contained"
            icon="check"
            buttonColor={colors.successDark}
            style={styles.actionBtn}
            loading={saving}
            disabled={saving || !valid}
            onPress={submit}
          >
            Kaydet
          </Button>
        </View>
      </Surface>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', marginBottom: spacing.md },
  sheet: { width: '100%', borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface },
  title: { fontWeight: '700', marginBottom: spacing.xs, color: colors.text },
  hint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: spacing.sm },
  input: { marginTop: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});
