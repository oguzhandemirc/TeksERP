// Şifreli kipte (K3) kilit ekranından açılan TAM EKRAN sunucu ekleme kabuğu; gövde `ServerPairFlow`.
import React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconButton, Text } from 'react-native-paper';

import AppModal from '../AppModal';
import { ServerPairFlow } from './ServerPairFlow';
import { C } from './styles';

export function SecureServerSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <AppModal visible={visible} onDismiss={onClose} position="right" contentStyle={{ width, height }}>
      <View style={[styles.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]} testID="sunucu-ekle-tam-ekran">
        <View style={styles.header}>
          <Icon source="server-network" size={24} color={C.accentLight} />
          <Text style={styles.title}>Sunucuyu ekle / değiştir</Text>
          <View style={styles.flex1} />
          <IconButton icon="close" iconColor={C.subtext} size={28} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ServerPairFlow onDone={onClose} />
        </ScrollView>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 20, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: C.text, fontSize: 22, fontWeight: '700' },
  flex1: { flex: 1 },
  scroll: { flexGrow: 1, alignSelf: 'center', width: '100%', maxWidth: 960, paddingBottom: 24 },
});
