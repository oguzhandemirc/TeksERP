import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../components/ScreenChrome';
import { usePermissions } from '../../hooks/usePermission';
import { useDeviceType } from '../../hooks/useDeviceType';
import type { MainStackParamList } from '../../navigation/types';
import type { MobileScreenKey, MobileScreenMeta } from '../../types/permissions';

type Nav = NativeStackNavigationProp<MainStackParamList, 'ModuleSelect'>;

const MODULE_COLORS: Record<MobileScreenKey, { tint: string; bg: string }> = {
  KK1:        { tint: '#2563eb', bg: '#dbeafe' },
  KursunQc:   { tint: '#d97706', bg: '#fef3c7' },
  Tambur:     { tint: '#7c3aed', bg: '#ede9fe' },
  Depo:       { tint: '#475569', bg: '#e2e8f0' },
  TartiPaket: { tint: '#059669', bg: '#d1fae5' },
  Sevkiyat:   { tint: '#ea580c', bg: '#ffedd5' },
  FasonSevk:  { tint: '#0891b2', bg: '#cffafe' },
  FasonKabul: { tint: '#db2777', bg: '#fce7f3' },
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function ModuleSelectScreen() {
  const { allowedScreens } = usePermissions();
  const device = useDeviceType();
  const nav = useNavigation<Nav>();
  const isPhone = device === 'phone';
  const columns = isPhone ? 2 : 4;
  const rows = useMemo(
    () => chunk(allowedScreens, columns),
    [allowedScreens, columns],
  );

  const handlePress = useCallback(
    (key: MobileScreenKey) => nav.navigate(key),
    [nav],
  );

  const grid = (
    <View style={[styles.grid, isPhone && styles.gridPhone]}>
      {rows.map((row, rIdx) => (
        <View key={rIdx} style={[styles.row, isPhone && styles.rowPhone]}>
          {row.map((s) => (
            <ModuleCard
              key={s.key}
              meta={s}
              compact={isPhone}
              onPress={handlePress}
            />
          ))}
          {Array.from({ length: columns - row.length }).map((_, i) => (
            <View key={`spacer-${i}`} style={styles.spacer} />
          ))}
        </View>
      ))}
    </View>
  );

  return (
    <ScreenChrome title="Modül Seçimi" subtitle="Çalışacağınız ekranı seçin">
      {isPhone ? (
        <ScrollView contentContainerStyle={styles.scroll}>{grid}</ScrollView>
      ) : (
        grid
      )}
    </ScreenChrome>
  );
}

const ModuleCard = React.memo(function ModuleCard({
  meta,
  compact,
  onPress,
}: {
  meta: MobileScreenMeta;
  compact: boolean;
  onPress: (key: MobileScreenKey) => void;
}) {
  const color = MODULE_COLORS[meta.key];
  const handlePress = useCallback(() => onPress(meta.key), [onPress, meta.key]);
  return (
    <TouchableRipple
      onPress={handlePress}
      borderless={false}
      rippleColor={color.tint + '22'}
      style={[styles.card, compact && styles.cardPhone, { borderTopColor: color.tint }]}
    >
      <View style={[styles.cardInner, compact && styles.cardInnerPhone]}>
        <View
          style={[
            styles.iconBox,
            compact && styles.iconBoxPhone,
            { backgroundColor: color.bg },
          ]}
        >
          <MaterialCommunityIcons
            name={meta.icon as any}
            size={compact ? 40 : 56}
            color={color.tint}
          />
        </View>
        <Text
          variant={compact ? 'titleMedium' : 'titleLarge'}
          style={styles.label}
          numberOfLines={2}
        >
          {meta.label}
        </Text>
        <Text variant="bodySmall" style={styles.desc} numberOfLines={2}>
          {meta.description}
        </Text>
      </View>
    </TouchableRipple>
  );
});

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  grid: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  gridPhone: { padding: 12, gap: 12 },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
  },
  rowPhone: { flex: 0, gap: 12 },
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderTopWidth: 4,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  cardPhone: { borderRadius: 14, minHeight: 160 },
  cardInner: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  cardInnerPhone: { padding: 14, gap: 6 },
  spacer: { flex: 1 },
  iconBox: {
    width: 88,
    height: 88,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  iconBoxPhone: { width: 64, height: 64, borderRadius: 16, marginBottom: 0 },
  label: {
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  desc: {
    color: '#64748b',
    textAlign: 'center',
  },
});
