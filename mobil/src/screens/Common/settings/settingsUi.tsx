// =============================================================================
// Ayarlar — ortak kabuk + paylaşılan stiller
// =============================================================================
// Ayarlar artık TEK uzun sayfa değil: kök `SettingsScreen` bir MENÜ, her başlık
// kendi alt sayfasını açar (Sunucu / Bu Yerin Donanımı / Cihaz / Barkod). Bu
// dosya o alt sayfaların paylaştığı koyu temayı ve Appbar+scroll kabuğunu tutar
// — her sayfada aynı renk/stil bloğunu kopyalamamak için.
//
// Renkler kasıtlı olarak lokal (theme/tokens `colors` açık zeminli ekranlar
// içindir; ayarlar ekranı koyu). Yeni bir ayar sayfası eklerken bu kabuğu kullan.
// =============================================================================

import React from 'react';
import { StyleSheet, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appbar, Button } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';

export const SETTINGS_COLORS = {
  bg: '#0f172a',
  bgDarker: '#0a1120',
  bgSoft: '#1e293b',
  accent: '#4f46e5',
  accentLight: '#6366f1',
  text: '#f1f5f9',
  subtext: '#94a3b8',
  border: '#334155',
  success: '#22c55e',
  successBg: '#052e1a',
  error: '#ef4444',
  errorBg: '#3f1d1f',
  // Dikkat çeken ama yıkıcı olmayan durum — tokens `colors.warning` (amber 500).
  warning: '#f59e0b',
  // Teşhis (salt-okunur, "dene/bak") aksiyonları — tokens `colors.info` (blue 500).
  info: '#3b82f6',
  infoBg: '#0b2545',
  // Keşif/"yeni getir" aksiyonu — tokens `colors.action` (violet 600). Marka
  // indigo'sundan bilinçli ayrı: yan yana durunca "aynı iş" gibi okunmasın.
  action: '#7c3aed',
  // Gerçekten kullanılamaz düğmenin GÖRÜNÜR hali (aşağıdaki uyarıya bak).
  disabledBg: '#1b2540',
  disabledText: '#64748b',
} as const;

const C = SETTINGS_COLORS;

/**
 * Ayar alt sayfası kabuğu — geri butonlu koyu Appbar + klavye-farkında scroll.
 * `KeyboardAwareScrollView` her sayfada kullanılır (girişi olmayan sayfada da
 * zararsız), böylece kabuk tek tip kalır.
 */
export function SettingsPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  return (
    <SafeAreaView edges={['left', 'right']} style={pageStyles.root}>
      <Appbar.Header style={pageStyles.appbar} dark statusBarHeight={insets.top}>
        <Appbar.BackAction
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
          }}
          color={C.text}
        />
        <Appbar.Content title={title} titleStyle={pageStyles.appbarTitle} />
      </Appbar.Header>

      <KeyboardAwareScrollView
        contentContainerStyle={[
          pageStyles.scroll,
          { paddingBottom: 32 + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        {children}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const pageStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  appbar: { backgroundColor: C.bgDarker, elevation: 0 },
  appbarTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  scroll: { padding: 20, gap: 16 },
});

/** Ayarlar sayfalarının paylaştığı kart/başlık/etiket stilleri. */
export const settingsStyles = StyleSheet.create({
  card: {
    backgroundColor: C.bgSoft,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  headRow: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 13,
    backgroundColor: C.bgDarker,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headText: { flex: 1, justifyContent: 'center' },
  title: { color: C.text, fontSize: 18, fontWeight: '700' },
  subtitle: { color: C.subtext, fontSize: 13, marginTop: 4, lineHeight: 18 },
  label: {
    color: C.subtext,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  hint: { color: C.subtext, fontSize: 12, marginTop: 8, lineHeight: 17 },
  mono: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: C.text,
  },
});


/* ===========================================================================
 * Ayar aksiyon düğmesi — "kaybolmayan buton"
 * ===========================================================================
 * ⚠️ NEDEN KENDİ SARMALAYICIMIZ VAR (2026-09-04, sahadan ölçülen hata):
 * Paper `Button`, `disabled` olduğu anda `buttonColor`/`textColor` proplarını
 * YOK SAYAR (`components/Button/utils.tsx`: `if (customButtonColor && !disabled)`)
 * ve MD3 **açık** temanın `surfaceDisabled` / `onSurfaceDisabled` değerlerine
 * düşer. Ayarlar ekranları KOYU zeminli olduğu için sonuç, düğmenin fiilen
 * GÖRÜNMEZ olmasıdır — sahadaki tarif birebir buydu: "denetle deyince buton
 * kayboluyor". Üstelik `mode="outlined"` düğmenin zaten dolgusu olmadığı için
 * kaybolma tam oluyordu.
 *
 * Bu yüzden burada:
 *   • renk HER ZAMAN `style`/`labelStyle` ile verilir (ikisi Paper'ın hesapladığı
 *     renklerden SONRA uygulanır, yani disabled dalında da geçerlidir),
 *   • MEŞGULken `disabled` GÖNDERİLMEZ — tekrar basma `onPress` içinde yutulur;
 *     böylece düğme dolu rengini ve etiketini korur, yalnız içine spinner girer,
 *   • gerçekten kullanılamaz durumda düğme silikleşir ama OKUNUR kalır
 *     (`disabledBg`/`disabledText`), çünkü kaybolan düğme "bozuldu" diye okunur.
 *
 * Dokunma hedefi 56 dp: mobil CLAUDE.md'nin taban dokunma hedefi (eldivenli el).
 * =========================================================================== */

export type SettingsButtonTone = 'primary' | 'success' | 'danger' | 'info' | 'action' | 'neutral';

interface ToneSpec {
  bg: string;
  label: string;
  border: string;
}

const TONES: Record<SettingsButtonTone, ToneSpec> = {
  primary: { bg: C.accent, label: '#ffffff', border: C.accent },
  success: { bg: C.success, label: '#052e1a', border: C.success },
  danger: { bg: C.error, label: '#ffffff', border: C.error },
  info: { bg: C.info, label: '#ffffff', border: C.info },
  action: { bg: C.action, label: '#ffffff', border: C.action },
  // Nötr = dolgusuz ama KENARLIKLI ve okunur etiketli; "sessiz" ikinci aksiyon.
  neutral: { bg: C.bgDarker, label: C.text, border: C.border },
};

export interface SettingsActionButtonProps {
  label: string;
  /** Meşgulken gösterilecek metin (yoksa `label` kalır). */
  busyLabel?: string;
  tone?: SettingsButtonTone;
  icon?: string;
  busy?: boolean;
  /** GERÇEKTEN kullanılamaz (yetki/kapalı özellik) — meşguliyet için KULLANMA. */
  disabled?: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SettingsActionButton({
  label,
  busyLabel,
  tone = 'primary',
  icon,
  busy = false,
  disabled = false,
  onPress,
  style,
  testID,
}: SettingsActionButtonProps) {
  const t = TONES[tone];
  const bg = disabled ? C.disabledBg : t.bg;
  const fg = disabled ? C.disabledText : t.label;

  return (
    <Button
      mode="contained"
      testID={testID}
      // ⚠️ `busy` BURAYA GİRMEZ — bkz. dosya başındaki uyarı.
      disabled={disabled}
      loading={busy}
      icon={busy ? undefined : icon}
      onPress={() => {
        if (busy || disabled) return;
        onPress();
      }}
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={[buttonStyles.base, { backgroundColor: bg, borderColor: disabled ? C.border : t.border }, style]}
      contentStyle={buttonStyles.content}
      labelStyle={[buttonStyles.label, { color: fg }]}
    >
      {busy ? (busyLabel ?? label) : label}
    </Button>
  );
}

const buttonStyles = StyleSheet.create({
  base: { borderRadius: 12, borderWidth: 1 },
  content: { height: 56 },
  label: { fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});
