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
import { StyleSheet, Platform } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appbar } from 'react-native-paper';
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
