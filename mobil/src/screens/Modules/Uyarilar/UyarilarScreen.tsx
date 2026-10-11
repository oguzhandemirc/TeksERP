// =============================================================================
// UYARILAR — tezgah alarmları (Faz A3; izin `mobile:tezgah-uyari`, modül tezgah izleme)
// =============================================================================
// Telefon dikey: liste → alarm sayfası (`UyariDetay`). Tablet yatay: liste + seçili alarm yan yana.
// Bildirim/ses ayrı yüzeydedir (`LoomAlarmNotifier`, uygulama genelinde); bu ekran yalnız okur ve
// eylemi açar. Alarm bayrağı kapalıyken istek atılmaz.
// =============================================================================
import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../../components/ScreenChrome';
import { useDeviceType } from '../../../hooks/useDeviceType';
import { usePortraitLock } from '../../../hooks/usePortraitLock';
import { useLoomAlarmAccess, useLoomAlarmFeed, useNow } from '../../../hooks/useLoomAlarms';
import { readNotifyPermission, type NotifyPermission } from '../../../services/alarmNotify';
import { queryProblem, QUERY_PROBLEM_TEXT } from '../../../utils/queryState';
import type { MainStackParamList } from '../../../navigation/types';
import AlarmListPane from './AlarmListPane';
import AlarmDetailView from './AlarmDetailView';
import { colors, spacing, typography } from '../../../theme';

export default function LoomAlarmsScreen() {
  const compact = useDeviceType() === 'phone';
  // Telefon dikey kilitli; tablet uygulamanın varsayılan yatayında kalır (Sipariş emsali —
  // `useLandscapeLock(false)` telefonda kilidi açıp dikey kilidi bozardı).
  usePortraitLock(compact);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const access = useLoomAlarmAccess();
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const feed = useLoomAlarmFeed({ enabled: access.canView, mine: !showAll });
  const now = useNow(15_000);
  const permission = useNotifyPermission(access.canView);

  if (!access.flagOn || !access.canView) {
    return (
      <ScreenChrome title="Uyarılar">
        <Text style={styles.closed}>{access.flagOn ? 'Tezgah alarmlarını görme yetkiniz yok.' : 'Tezgah alarmı bu kurulumda kapalı.'}</Text>
      </ScreenChrome>
    );
  }
  const items = feed.data?.items ?? [];
  const problem = queryProblem(feed);
  // Tablette seçim yoksa (ya da seçili alarm listeden düştüyse) en öndeki alarm açılır.
  const detailId = items.some((a) => a.id === selected) ? selected : (items[0]?.id ?? null);
  const list = (
    <AlarmListPane
      items={items}
      audience={feed.data?.audience ?? null}
      loading={feed.isLoading}
      problemText={problem ? QUERY_PROBLEM_TEXT[problem] : null}
      showAll={showAll}
      onShowAll={setShowAll}
      selectedId={compact ? null : detailId}
      onOpen={(alarmId) => (compact ? navigation.navigate('UyariDetay', { alarmId }) : setSelected(alarmId))}
      now={now}
    />
  );
  return (
    <ScreenChrome title="Uyarılar" subtitle={`${items.length} açık alarm`}>
      {permission === 'denied' && (
        <Text style={styles.banner}>Bildirim izni kapalı — uygulama kapalıyken hatırlatma gelmez. Telefon ayarlarından açabilirsiniz.</Text>
      )}
      {compact ? (
        <View style={styles.fill}>{list}</View>
      ) : (
        <View style={styles.split}>
          <View style={styles.listPane}>{list}</View>
          <View style={styles.detailPane}>
            {detailId ? <AlarmDetailView key={detailId} alarmId={detailId} access={access} /> : <Text style={styles.closed}>Seçili alarm yok.</Text>}
          </View>
        </View>
      )}
    </ScreenChrome>
  );
}

/** Bildirim izni (ekran açıkken bir kez okunur; soru `LoomAlarmNotifier`da sorulur). */
function useNotifyPermission(enabled: boolean): NotifyPermission | null {
  const [state, setState] = useState<NotifyPermission | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void readNotifyPermission().then((p) => alive && setState(p));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return state;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.appBg },
  split: { flex: 1, flexDirection: 'row', backgroundColor: colors.appBg },
  listPane: { flex: 1, borderRightWidth: 1, borderRightColor: colors.border },
  detailPane: { flex: 1.4, backgroundColor: colors.surfaceMuted },
  closed: { fontSize: typography.size.base, color: colors.textMuted, textAlign: 'center', padding: spacing.xxl },
  banner: { fontSize: typography.size.sm, color: colors.warningText, backgroundColor: colors.warningContainer, padding: spacing.md, textAlign: 'center' },
});
