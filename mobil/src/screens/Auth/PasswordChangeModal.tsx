// Zorunlu parola değişimi ekranı (tablet) — mantık `usePasswordChangeStep`te; burada yalnız
// form. Kaydırarak/dışına dokunarak kapanmaz: tek çıkış "Vazgeç" ya da başarılı değişim.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Button, Icon, Text } from 'react-native-paper';
import AppModal from '../../components/AppModal';
import ModalTextInput from '../../components/ModalTextInput';
import { colors } from '../../theme/tokens';
import type { PasswordChangeInput, PasswordChangeRequest } from './usePasswordChangeStep';

interface Props {
  pending: PasswordChangeRequest | null;
  submitting: boolean;
  error: string | null;
  onSubmit: (input: PasswordChangeInput) => void;
  onCancel: () => void;
}

function SecretField({
  testID,
  label,
  value,
  onChange,
  autoFocus,
}: {
  testID: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <ModalTextInput
      testID={testID}
      mode="outlined"
      label={label}
      value={value}
      onChangeText={onChange}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={autoFocus}
      style={styles.input}
    />
  );
}

function usePasswordForm(visible: boolean) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (visible) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    }
  }, [visible]);
  return { currentPassword, setCurrentPassword, newPassword, setNewPassword, confirm, setConfirm };
}

export default function PasswordChangeModal({ pending, submitting, error, onSubmit, onCancel }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const visible = pending !== null;
  const askCurrent = visible && pending.currentPassword === undefined;
  const f = usePasswordForm(visible);

  return (
    <AppModal visible={visible} onDismiss={onCancel} dismissable={false} swipeToDismiss={false}>
      <View style={[styles.sheet, { maxWidth: Math.min(winW * 0.9, 480), maxHeight: winH * 0.85 }]}>
        <View style={styles.header}>
          <Icon source="lock-reset" size={22} color={colors.text} />
          <Text variant="titleMedium" style={styles.title}>
            Yeni parola belirleyin
          </Text>
        </View>
        <KeyboardAwareScrollView
          style={styles.bodyScroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          bottomOffset={72}
        >
          <Text style={styles.desc}>
            <Text style={styles.bold}>{pending?.username ?? ''}</Text> hesabının parolası sıfırlandı.
            Devam etmek için kendi parolanızı belirleyin.
          </Text>
          {askCurrent && (
            <SecretField testID="pcm-current" label="Size verilen parola" value={f.currentPassword} onChange={f.setCurrentPassword} autoFocus />
          )}
          <SecretField testID="pcm-new" label="Yeni parola" value={f.newPassword} onChange={f.setNewPassword} autoFocus={!askCurrent} />
          <SecretField testID="pcm-confirm" label="Yeni parola (tekrar)" value={f.confirm} onChange={f.setConfirm} />
          {error ? <Text testID="pcm-error" style={styles.error}>{error}</Text> : null}
        </KeyboardAwareScrollView>
        <View style={styles.actions}>
          <Button mode="text" onPress={onCancel} disabled={submitting}>
            Vazgeç
          </Button>
          <Button
            testID="pcm-submit"
            mode="contained"
            onPress={() => onSubmit({ currentPassword: f.currentPassword, newPassword: f.newPassword, confirm: f.confirm })}
            disabled={submitting}
            loading={submitting}
          >
            Parolayı değiştir
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    width: '90%',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingBottom: 8 },
  title: { flex: 1, fontWeight: '700', color: colors.text },
  bodyScroll: { flexGrow: 0 },
  body: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  desc: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '700' },
  input: { backgroundColor: colors.surface },
  error: { color: colors.dangerDark, fontSize: 13 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
