// =============================================================================
// useTotpPrompt — giriş ikinci faktör (TOTP) kod adımı
// =============================================================================
// Promise tabanlı (useSessionConflict ile aynı kalıp): `requestCode(invalid)` bir
// Promise<string | null> döner; "Doğrula" → girilen kod, "Vazgeç"/backdrop → null.
// LoginScreen `authActions.*`'a bu resolver'ı onTotp olarak verir. Sunucu 409
// TOTP_REQUIRED (süperadminde PIN/kart girişinde hep; diğerlerinde ayar açıksa) ya da
// 401 TOTP_INVALID döndüğünde açılır. Kurtarma kodu da aynı alana yazılır (sunucu ayırır).
// =============================================================================

import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TextInput } from 'react-native-paper';
import AppModal from '../components/AppModal';
import { colors, radius, spacing } from '../theme/tokens';

/** Gönderilebilir kod: 6 haneli TOTP ya da kurtarma kodu (ör. ABCD-EFGH). */
export function isSubmittableTotpCode(raw: string): boolean {
  const v = raw.trim();
  return /^\d{6}$/.test(v) || /^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(v);
}

export function useTotpPrompt() {
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [code, setCode] = useState('');
  const resolveRef = useRef<((v: string | null) => void) | null>(null);

  const requestCode = useCallback(
    (wasInvalid: boolean): Promise<string | null> =>
      new Promise<string | null>((resolve) => {
        resolveRef.current = resolve;
        setInvalid(wasInvalid);
        setCode('');
        setOpen(true);
      }),
    [],
  );

  const finish = useCallback((v: string | null) => {
    setOpen(false);
    const r = resolveRef.current;
    resolveRef.current = null;
    r?.(v);
  }, []);

  const canSubmit = isSubmittableTotpCode(code);

  const modal = (
    <AppModal visible={open} onDismiss={() => finish(null)} swipeToDismiss={false}>
      <View style={styles.card}>
        <Icon source="shield-key" size={40} color={colors.brand} />
        <Text style={styles.title}>Doğrulama kodu</Text>
        <Text style={styles.body}>
          Bu hesapta iki adımlı doğrulama açık. Telefonunuzdaki doğrulama uygulamasında görünen 6
          haneli kodu ya da bir kurtarma kodunu girin.
        </Text>
        {invalid && <Text style={styles.error}>Kod geçersiz — güncel kodu yeniden girin.</Text>}
        <TextInput
          mode="outlined"
          label="Kod"
          value={code}
          onChangeText={setCode}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          style={styles.input}
          onSubmitEditing={() => canSubmit && finish(code.trim())}
          testID="totp-code-input"
        />
        <View style={styles.actions}>
          <Button mode="text" textColor={colors.textSecondary} onPress={() => finish(null)}>
            Vazgeç
          </Button>
          <Button mode="contained" disabled={!canSubmit} onPress={() => finish(code.trim())}>
            Doğrula
          </Button>
        </View>
      </View>
    </AppModal>
  );

  return { requestCode, modal };
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.md,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center' },
  body: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  error: { fontSize: 14, color: colors.dangerDark, textAlign: 'center', fontWeight: '700' },
  input: { alignSelf: 'stretch', fontSize: 20 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
});
