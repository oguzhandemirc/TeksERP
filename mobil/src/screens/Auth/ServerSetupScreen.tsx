// =============================================================================
// İlk açılış — "Sunucuyu bul"
// =============================================================================
// Tek ortak paket ERP adresi taşımaz (docs/design/TEK-ORTAK-PAKET.md §2.2, §5): adres yokken uygulama
// localhost'a değil buraya düşer. Ağ keşfi kendiliğinden başlar; bulunan sunucuya dokunmak adresi kaydeder
// ve uygulama giriş ekranına geçer. Elle adres yolu mevcut `ServerAddressSheet`tir (test + kaydet).
// Sabitleme burada YAPILMAZ: kimlik ilk başarılı girişte sabitlenir (`baseUrlStore`).
// =============================================================================

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';

import ServerAddressSheet from '../../components/ServerAddressSheet';
import { ServerDiscoveryList } from '../../components/ServerDiscoveryList';
import { useBaseUrlStore } from '../../store/baseUrlStore';
import type { DiscoveredServer } from '../../lib/discovery';
import { SettingsActionButton } from '../Common/settings/settingsUi';
import { palette } from '../../theme/tokens';

const COLORS = {
  bg: palette.slate[900],
  card: palette.slate[800],
  accentLight: palette.indigo[500],
  text: palette.slate[100],
  subtext: palette.slate[400],
  border: palette.slate[700],
};

export default function ServerSetupScreen() {
  const insets = useSafeAreaInsets();
  const recentUrls = useBaseUrlStore((s) => s.recentUrls);
  const setCustomUrl = useBaseUrlStore((s) => s.setCustomUrl);
  const [manualOpen, setManualOpen] = useState(false);

  const pick = async (srv: DiscoveredServer) => {
    try {
      await setCustomUrl(srv.baseUrl);
      Toast.show({
        type: 'success',
        text1: 'Sunucu seçildi',
        text2: srv.identity?.companyName || srv.identity?.serverName || srv.host,
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Adres kaydedilemedi', text2: e instanceof Error ? e.message : '' });
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }]} testID="sunucu-bul-ekrani">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.header}>
            <Icon source="server-network" size={28} color={COLORS.accentLight} />
            <Text style={styles.title}>Sunucuyu bul</Text>
          </View>
          <Text style={styles.body}>
            Bu tablet henüz bir TeksERP sunucusuna bağlı değil. Tabletin fabrika Wi-Fi&apos;sine bağlı
            olduğundan emin olun; ağdaki sunucular aşağıda listelenir. Firmanızın adına dokunun.
          </Text>

          <ServerDiscoveryList autoStart recentUrls={recentUrls} onPick={(srv) => void pick(srv)} />

          <View style={styles.divider} />
          <Text style={styles.hint}>Sunucu listede yoksa adresini (IP) yöneticinizden öğrenip elle girin.</Text>
          <SettingsActionButton
            testID="sunucu-elle-gir"
            tone="neutral"
            icon="keyboard-outline"
            label="Adresi elle gir"
            onPress={() => setManualOpen(true)}
          />
        </View>
      </ScrollView>
      <ServerAddressSheet visible={manualOpen} onClose={() => setManualOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 16 },
  card: {
    width: '100%',
    maxWidth: 640,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    gap: 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: COLORS.text, fontSize: 22, fontWeight: '700' },
  body: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },
  hint: { color: COLORS.subtext, fontSize: 13, lineHeight: 18 },
});
