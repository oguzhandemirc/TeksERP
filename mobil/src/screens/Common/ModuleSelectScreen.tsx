import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../components/ScreenChrome';
import { usePermissions } from '../../hooks/usePermission';
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

const COLUMNS = 4;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function ModuleSelectScreen() {
  const { allowedScreens } = usePermissions();
  const nav = useNavigation<Nav>();
  const rows = chunk(allowedScreens, COLUMNS);

  return (
    <ScreenChrome title="Modül Seçimi" subtitle="Çalışacağınız ekranı seçin">
      <View style={styles.grid}>
        {rows.map((row, rIdx) => (
          <View key={rIdx} style={styles.row}>
            {row.map((s) => (
              <ModuleCard key={s.key} meta={s} onPress={() => nav.navigate(s.key)} />
            ))}
            {Array.from({ length: COLUMNS - row.length }).map((_, i) => (
              <View key={`spacer-${i}`} style={styles.spacer} />
            ))}
          </View>
        ))}
      </View>
    </ScreenChrome>
  );
}

function ModuleCard({ meta, onPress }: { meta: MobileScreenMeta; onPress: () => void }) {
  const color = MODULE_COLORS[meta.key];
  return (
    <TouchableRipple
      onPress={onPress}
      borderless={false}
      rippleColor={color.tint + '22'}
      style={[styles.card, { borderTopColor: color.tint }]}
    >
      <View style={styles.cardInner}>
        <View style={[styles.iconBox, { backgroundColor: color.bg }]}>
          <MaterialCommunityIcons name={meta.icon as any} size={56} color={color.tint} />
        </View>
        <Text variant="titleLarge" style={styles.label} numberOfLines={2}>
          {meta.label}
        </Text>
        <Text variant="bodyMedium" style={styles.desc} numberOfLines={2}>
          {meta.description}
        </Text>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  grid: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
  },
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
  cardInner: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  spacer: { flex: 1 },
  iconBox: {
    width: 88,
    height: 88,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
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
