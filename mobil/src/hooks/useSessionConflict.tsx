// =============================================================================
// useSessionConflict — 'notify' politikasında SESSION_EXISTS onay diyaloğu
// =============================================================================
// Promise tabanlı: `requestConfirm(existing)` bir Promise<boolean> döner; diyalog
// "Yine de devam et" → true, "İptal"/backdrop → false ile çözer. LoginScreen ve
// LockOverlay `authActions.*`'a bu resolver'ı onConflict olarak verir; `{modal}`
// elemanını render eder.
// =============================================================================

import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import AppModal from '../components/AppModal';
import type { ExistingSessionInfo } from '../types/auth';
import { colors, radius, spacing } from '../theme/tokens';

function deviceLabel(info: ExistingSessionInfo | null): string {
  if (!info) return 'başka bir cihaz';
  return info.deviceType === 'electron' ? 'bir masaüstü (Electron)' : 'başka bir tablet';
}

export function useSessionConflict() {
  const [existing, setExisting] = useState<ExistingSessionInfo | null>(null);
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const requestConfirm = useCallback(
    (info: ExistingSessionInfo | null): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setExisting(info);
        setOpen(true);
      }),
    [],
  );

  const finish = useCallback((v: boolean) => {
    setOpen(false);
    const r = resolveRef.current;
    resolveRef.current = null;
    r?.(v);
  }, []);

  const modal = (
    <AppModal visible={open} onDismiss={() => finish(false)} swipeToDismiss={false}>
      <View style={styles.card}>
        <Icon source="account-alert" size={40} color={colors.warning} />
        <Text style={styles.title}>Hesap başka yerde açık</Text>
        <Text style={styles.body}>
          Bu kullanıcı {deviceLabel(existing)} üzerinde zaten açık. Devam edersen iki oturum da
          açık kalır. İptal edersen giriş yapılmaz.
        </Text>
        <View style={styles.actions}>
          <Button mode="text" textColor={colors.textSecondary} onPress={() => finish(false)}>
            İptal
          </Button>
          <Button mode="contained" onPress={() => finish(true)}>
            Yine de devam et
          </Button>
        </View>
      </View>
    </AppModal>
  );

  return { requestConfirm, modal };
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
});
