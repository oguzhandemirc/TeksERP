// =============================================================================
// GERİ ALMA MODALİ — sebep zorunlu (koşum ve duruş paylaşır; damga, defter satırı düşer)
// =============================================================================
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import ModalTextInput from '../../../components/ModalTextInput';
import { colors, spacing, typography } from '../../../theme';

interface Props {
  visible: boolean;
  title: string;
  hint: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export default function RevokeReasonModal({ visible, title, hint, busy, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const close = () => {
    setReason('');
    onClose();
  };
  return (
    <AppModal visible={visible} onDismiss={close} position="center">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{hint}</Text>
      <ModalTextInput label="Sebep" value={reason} onChangeText={setReason} maxLength={300} autoFocus mode="outlined" />
      <View style={styles.actions}>
        <Button onPress={close} disabled={busy}>Vazgeç</Button>
        <Button
          mode="contained"
          disabled={reason.trim().length < 3 || busy}
          loading={busy}
          onPress={() => {
            onConfirm(reason.trim());
            setReason('');
          }}
        >
          Geri Al
        </Button>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, marginBottom: spacing.sm },
  meta: { fontSize: typography.size.sm, color: colors.textSecondary },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md },
});
