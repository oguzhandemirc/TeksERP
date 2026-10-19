// =============================================================================
// Onaysız cihazda giriş formu — yalnız kullanıcı adı + parola (device.unpairedPasswordLogin)
// =============================================================================
// Sunucu `login-methods.unpairedPasswordOnly` dediğinde LoginScreen bu formu çizer: personel
// listesi, hızlı PIN ve kart onaysız cihaza kapalıdır (backend 401/403), o yüzden seçici yok.
// Kullanıcı adını bilen yazar; kilit kipinde oturum sahibinin adı önden dolar.
// =============================================================================
import React, { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { ActivityIndicator, Icon, Text, TouchableRipple } from 'react-native-paper';

import { colors, palette, radius, spacing } from '../../theme/tokens';
import { sanitizeAlphaInput } from './loginInput';

const USERNAME_MAX = 64;
const PASSWORD_MAX = 128;

export interface UnpairedPasswordFormProps {
  /** Kilit kipinde oturum sahibinin kullanıcı adı (önden dolu, değiştirilebilir). */
  initialUsername?: string;
  submitting: boolean;
  error: string;
  onSubmit: (username: string, password: string) => void;
}

export default function UnpairedPasswordForm({
  initialUsername,
  submitting,
  error,
  onSubmit,
}: UnpairedPasswordFormProps) {
  const [username, setUsername] = useState(initialUsername ?? '');
  const [password, setPassword] = useState('');
  const passwordRef = useRef<TextInput>(null);
  const trimmed = username.trim();
  const canSubmit = trimmed.length > 0 && password.length > 0 && !submitting;

  const send = () => {
    if (!canSubmit) return;
    onSubmit(trimmed, password);
    setPassword('');
  };

  return (
    <View style={styles.wrap} testID="onaysiz-parola-formu">
      <Text style={styles.title}>KULLANICI ADI VE PAROLA İLE GİRİŞ</Text>
      <View style={styles.notice}>
        <Icon source="shield-alert-outline" size={20} color={palette.amber[500]} />
        <Text style={styles.noticeText}>
          Bu tablet henüz onaylanmadı. Yalnız kullanıcı adı ve parolayla girilebilir; hızlı PIN ve
          kart, yönetici onayından sonra açılır.
        </Text>
      </View>
      <Text style={styles.label}>Kullanıcı adı</Text>
      <TextInput
        testID="onaysiz-kullanici-adi"
        accessibilityLabel="Kullanıcı adı"
        value={username}
        onChangeText={(t) => setUsername(sanitizeAlphaInput(t, USERNAME_MAX))}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        editable={!submitting}
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        placeholder="kullanıcı adı"
        placeholderTextColor={palette.slate[500]}
        style={styles.input}
      />
      <Text style={styles.label}>Parola</Text>
      <TextInput
        ref={passwordRef}
        testID="onaysiz-parola"
        accessibilityLabel="Parola"
        value={password}
        onChangeText={(t) => setPassword(sanitizeAlphaInput(t, PASSWORD_MAX))}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password"
        editable={!submitting}
        returnKeyType="go"
        onSubmitEditing={send}
        placeholder="parola"
        placeholderTextColor={palette.slate[500]}
        style={styles.input}
      />
      {!!error && (
        <View style={styles.errorRow}>
          <Icon source="alert-circle" size={18} color={colors.danger} />
          <Text style={styles.errorText} testID="onaysiz-hata">
            {error}
          </Text>
        </View>
      )}
      <SubmitButton enabled={canSubmit} submitting={submitting} onPress={send} />
    </View>
  );
}

function SubmitButton({ enabled, submitting, onPress }: { enabled: boolean; submitting: boolean; onPress: () => void }) {
  return (
    <TouchableRipple
      testID="onaysiz-giris-yap"
      accessibilityRole="button"
      accessibilityLabel="Giriş yap"
      accessibilityState={{ disabled: !enabled }}
      onPress={onPress}
      disabled={!enabled}
      style={[styles.submit, !enabled && styles.submitDisabled]}
    >
      <View style={styles.submitInner}>
        {submitting ? (
          <ActivityIndicator size={20} color={colors.textOnDark} />
        ) : (
          <Icon source="login" size={22} color={colors.textOnDark} />
        )}
        <Text style={styles.submitText}>{submitting ? 'Giriş yapılıyor…' : 'Giriş Yap'}</Text>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: spacing.sm },
  title: { color: palette.slate[400], fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.amber[700],
    backgroundColor: palette.slate[800],
  },
  noticeText: { flex: 1, color: colors.textOnDarkMuted, fontSize: 14 },
  label: { color: colors.textOnDarkMuted, fontSize: 14, marginTop: spacing.sm },
  input: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.slate[700],
    backgroundColor: palette.slate[800],
    color: colors.textOnDark,
    fontSize: 18,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  errorText: { flex: 1, color: colors.danger, fontSize: 14 },
  submit: {
    minHeight: 56,
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    justifyContent: 'center',
  },
  submitDisabled: { opacity: 0.45 },
  submitInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  submitText: { color: colors.textOnDark, fontSize: 18, fontWeight: '700' },
});
