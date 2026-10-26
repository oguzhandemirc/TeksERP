// Başlıkta zil (rozet: tablet gelen kutusunun okunmamış sayısı; ≥48 dp). Bayrak kapalı / eski backend →
// hiçbir şey çizilmez. Zil istemcisini (SSE / uzun yoklama) ve bildirim sesini bu bileşen ayakta tutar.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Badge, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import InboxDrawer from './InboxDrawer';
import { useNotificationBell } from '../../hooks/useNotificationBell';
import { useInboxUnreadCount, useStripItems } from '../../hooks/useInboxQueries';
import type { MainStackParamList, RootStackParamList } from '../../navigation/types';
import type { InboxItem } from '../../services/bildirim/types';
import { colors } from '../../theme';

type Nav = NativeStackNavigationProp<MainStackParamList & RootStackParamList>;

export default function NotificationBellButton() {
  const bell = useNotificationBell();
  const live = bell.ready && bell.supported && bell.enabled;
  const unread = useInboxUnreadCount(live);
  useStripItems(live); // ses kaynağı: başlık her ekranda var, şerit yalnız istasyonda
  const [open, setOpen] = useState(false);
  const navigation = useNavigation<Nav>();
  if (!live) return null;
  const openItem = (item: InboxItem) => {
    setOpen(false);
    if (item.tabletRota === 'UyariDetay' && item.konu.id) navigation.navigate('UyariDetay', { alarmId: item.konu.id });
  };
  return (
    <View style={styles.wrap}>
      <IconButton
        icon={unread > 0 ? 'bell-ring' : 'bell-outline'}
        iconColor={colors.textOnDark}
        size={26}
        style={styles.btn}
        onPress={() => setOpen(true)}
        accessibilityLabel={unread > 0 ? `Bildirimler, ${unread} okunmamış` : 'Bildirimler'}
        testID="zil-dugmesi"
      />
      {unread > 0 && <Badge style={styles.badge} size={20}>{unread > 99 ? '99+' : unread}</Badge>}
      <InboxDrawer
        visible={open}
        onDismiss={() => setOpen(false)}
        onOpenItem={openItem}
        onOpenSettings={() => {
          setOpen(false);
          navigation.navigate('SettingsNotifications');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  btn: { width: 48, height: 48, margin: 0 },
  badge: { position: 'absolute', top: 2, right: 2 },
});
