// =============================================================================
// İlk açılış — "Sunucuyu ekle" (tam ekran sayfa)
// =============================================================================
// Tek ortak paket ERP adresi taşımaz (docs/design/TEK-ORTAK-PAKET.md §2.2, §5): adres yokken uygulama
// localhost'a değil buraya düşer. Sürüm paketi sunucuya yalnız şifreli ve sabitli bağlanır (K3): sunucu QR ya da
// IP + doğrulama koduyla eklenir (`ServerPairFlow`). Kayıtlı adres şifresiz/sabitsizse burada gösterilir.
// Şifresiz elle adres yalnız geliştirme derlemesinde (Metro) kalır.
// =============================================================================

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ServerAddressSheet from '../../components/ServerAddressSheet';
import { ServerPairFlow } from '../../components/serverPair/ServerPairFlow';
import { secureTransportOnly } from '../../lib/secure-transport';
import { displayUrl, useBaseUrlStore } from '../../store/baseUrlStore';
import { SettingsActionButton } from '../Common/settings/settingsUi';
import { palette } from '../../theme/tokens';

const COLORS = {
  bg: palette.slate[900],
  accentLight: palette.indigo[500],
  text: palette.slate[100],
  subtext: palette.slate[400],
};

/** Kayıtlı ama yalnız şifreli kipte kullanılamayan adresin açıklaması. */
export function unusableUrlNotice(url: string | null, reason: string | null = null): string | null {
  if (!url) return null;
  if (reason) return `${displayUrl(url)}: ${reason}`;
  return /^http:\/\//i.test(url)
    ? `Önceki sunucu adresi (${displayUrl(url)}) şifresizdi. Bu sürüm sunucuya yalnız şifreli bağlanır — sunucuyu aşağıdan yeniden ekleyin.`
    : `Önceki sunucu (${displayUrl(url)}) bu tablette doğrulanmamış. Sunucuyu aşağıdan yeniden ekleyin.`;
}

export default function ServerSetupScreen() {
  const insets = useSafeAreaInsets();
  const unusableUrl = useBaseUrlStore((s) => s.unusableUrl);
  const unusableReason = useBaseUrlStore((s) => s.unusableReason);
  const [devSheetOpen, setDevSheetOpen] = useState(false);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]} testID="sunucu-bul-ekrani">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <View style={styles.header}>
            <Icon source="server-network" size={32} color={COLORS.accentLight} />
            <Text style={styles.title}>Sunucuyu ekle</Text>
          </View>
          <Text style={styles.body}>
            Bu tablet henüz bir TeksERP sunucusuna bağlı değil. Tablet fabrika Wi-Fi&apos;sine bağlı olmalı. Aşağıdaki
            iki yoldan birini seçin.
          </Text>
          {/* Başarıda adres deposu dolar; kök gezgin kendiliğinden giriş ekranına geçer. */}
          <ServerPairFlow onDone={() => undefined} notice={unusableUrlNotice(unusableUrl, unusableReason)} />
          {!secureTransportOnly() && (
            <SettingsActionButton
              testID="sunucu-elle-gir"
              tone="neutral"
              icon="code-braces"
              label="Geliştirme: şifresiz adres gir"
              onPress={() => setDevSheetOpen(true)}
            />
          )}
        </View>
      </ScrollView>
      {!secureTransportOnly() && <ServerAddressSheet visible={devSheetOpen} onClose={() => setDevSheetOpen(false)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24 },
  content: { width: '100%', maxWidth: 960, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '700' },
  body: { color: COLORS.text, fontSize: 17, lineHeight: 25 },
});
