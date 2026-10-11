// =============================================================================
// ALARM SAYFASI (telefon / derin bağlantı) — `UyariDetay {alarmId}`
// =============================================================================
// Uyarılar listesi (telefon), Tezgah şeridi ve bildirime dokunma buraya açar. Veri kapısı sunucudadır;
// erişimi olmayan (izin/bayrak) kullanıcıya istek atılmadan sebep söylenir.
// =============================================================================
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useRoute, type RouteProp } from '@react-navigation/native';
import ScreenChrome from '../../../components/ScreenChrome';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useLoomAlarmAccess } from '../../../hooks/useLoomAlarms';
import type { MainStackParamList } from '../../../navigation/types';
import AlarmDetailView from './AlarmDetailView';
import { colors, spacing, typography } from '../../../theme';

export default function LoomAlarmDetailScreen() {
  usePortraitLock(useDeviceType() === 'phone');
  const { alarmId } = useRoute<RouteProp<MainStackParamList, 'UyariDetay'>>().params;
  const access = useLoomAlarmAccess();
  return (
    <ScreenChrome title="Tezgah alarmı">
      <View style={styles.root}>
        {access.canView ? (
          <AlarmDetailView alarmId={alarmId} access={access} />
        ) : (
          <Text style={styles.closed}>{access.flagOn ? 'Bu alarmı görme yetkiniz yok.' : 'Tezgah alarmı bu kurulumda kapalı.'}</Text>
        )}
      </View>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.appBg },
  closed: { fontSize: typography.size.base, color: colors.textMuted, textAlign: 'center', padding: spacing.xxl },
});
