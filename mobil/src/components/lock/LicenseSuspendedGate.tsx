// =============================================================================
// LicenseSuspendedGate — K5 (sunucu lisansı DURDURULDU) tam ekranı
// =============================================================================
// IdleLockGate emsali: kök katmanda, modalların üstünde; kullanıcı yoksa hiçbir şey
// çizmez (giriş ekranı kendi hatasını gösterir). Tetik iki kaynaktan: `/license/durum`
// kademesi DURDURULMUS (yalnız zorlama kipinde) YA DA bir isteğin 403 LICENSE_SUSPENDED
// dönmesi. Güncelleme katmanı (UpdateGate) bunun ÜSTÜNDE kalır — OTA kurtarma açık.
// Veri erişimi sunucuda yönetici "verilerimi al" kapısından sürer; tablette üretim girişi yok.
// =============================================================================

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { useAuthStore } from '../../store/authStore';
import { useLicenseStore } from '../../store/licenseStore';
import { useLicenseStatus } from '../../hooks/useLicenseStatus';
import { performLogout } from '../../offline/sessionSwitch';
import { bannerToShow, isSuspendedStatus } from '../../lib/license';
import { colors, spacing } from '../../theme/tokens';

/** Oturumlu tablette K5 metni: giriş yapılmış, kayıt yapılamaz. */
const SIGNED_IN_BODY =
  'Bu sunucunun lisansı durdurulduğu için tabletten kayıt yapılamaz. Verileriniz ' +
  'korunuyor — yönetici panelden yedek ve dışa aktarma alabilir.';

/**
 * K5 kartı — oturumlu tam ekranda ve GİRİŞ EKRANINDA (`login-methods.lisansDurduruldu`)
 * ortak. Çıkış düğmesi yalnız oturum varken anlamlıdır (`onLogout` verilirse çizilir).
 */
export function LicenseSuspendedCard({
  body = SIGNED_IN_BODY,
  message,
  busy,
  onRetry,
  onLogout,
}: {
  body?: string;
  message: string | null;
  busy: boolean;
  onRetry: () => void;
  onLogout?: () => void;
}) {
  return (
    <View style={styles.card}>
      <Icon source="shield-lock-outline" size={64} color={colors.danger} />
      <Text style={styles.title}>Lisans durduruldu</Text>
      <Text style={styles.body}>{body}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Text style={styles.hint}>Yöneticinize başvurun.</Text>
      <View style={styles.actions}>
        <Button
          mode="contained"
          icon="refresh"
          loading={busy}
          onPress={() => {
            if (!busy) onRetry();
          }}
          contentStyle={styles.buttonContent}
          buttonColor={colors.brand}
          testID="lisans-k5-tekrar"
        >
          Tekrar dene
        </Button>
        {onLogout ? (
          <Button
            mode="outlined"
            icon="logout"
            onPress={onLogout}
            contentStyle={styles.buttonContent}
            textColor={colors.textOnDark}
            style={styles.outlined}
            testID="lisans-k5-cikis"
          >
            Çıkış yap
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export function LicenseSuspendedScreen(props: {
  message: string | null;
  busy: boolean;
  onRetry: () => void;
  onLogout: () => void;
}) {
  return (
    <View style={styles.root} testID="lisans-k5-ekrani">
      <LicenseSuspendedCard {...props} />
    </View>
  );
}

export default function LicenseSuspendedGate() {
  const user = useAuthStore((s) => s.user);
  const flagged = useLicenseStore((s) => s.suspended);
  const status = useLicenseStatus();
  const [busy, setBusy] = useState(false);

  // Çıkışta sinyal düşer: sonraki girişte sunucu hâlâ durdurulmuşsa yeniden söyler.
  useEffect(() => {
    if (!user) useLicenseStore.getState().clearSuspended();
  }, [user]);

  if (!user || !(flagged || isSuspendedStatus(status.data))) return null;

  const retry = async () => {
    setBusy(true);
    useLicenseStore.getState().clearSuspended();
    try {
      await status.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <LicenseSuspendedScreen
      message={bannerToShow(status.data)?.metin ?? null}
      busy={busy}
      onRetry={() => void retry()}
      onLogout={() => void performLogout().catch(() => undefined)}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.headerBg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xxl,
    zIndex: 9999,
    elevation: 9999,
  },
  card: { maxWidth: 560, width: '100%', alignItems: 'center', gap: spacing.md },
  title: { color: colors.textOnDark, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  body: { color: colors.textOnDarkMuted, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  message: { color: colors.textOnDark, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  hint: { color: colors.textOnDarkMuted, fontSize: 14, textAlign: 'center' },
  actions: { marginTop: spacing.lg, gap: spacing.md, alignSelf: 'stretch' },
  buttonContent: { height: 56 },
  outlined: { borderColor: colors.textOnDarkMuted },
});
