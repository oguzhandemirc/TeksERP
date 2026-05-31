import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import ScreenChrome from '../../components/ScreenChrome';
import { PressableScale, AnimatedEntrance } from '../../components/motion';
import { usePermissions } from '../../hooks/usePermission';
import { useDeviceType } from '../../hooks/useDeviceType';
import { colors, moduleAccents, radius, shadow, spacing } from '../../theme';
import type { MainStackParamList } from '../../navigation/types';
import type { MobileScreenKey, MobileScreenMeta } from '../../types/permissions';

type Nav = NativeStackNavigationProp<MainStackParamList, 'ModuleSelect'>;

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
          {row.map((s, cIdx) => (
            <ModuleCard
              key={s.key}
              meta={s}
              compact={isPhone}
              index={rIdx * columns + cIdx}
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
  index,
  onPress,
}: {
  meta: MobileScreenMeta;
  compact: boolean;
  index: number;
  onPress: (key: MobileScreenKey) => void;
}) {
  const color = moduleAccents[meta.key];
  const handlePress = useCallback(() => onPress(meta.key), [onPress, meta.key]);
  return (
    <AnimatedEntrance index={index} style={styles.slot}>
      <PressableScale
        onPress={handlePress}
        rippleColor={color.tint + '22'}
        accessibilityLabel={meta.label}
        style={[styles.card, { borderTopColor: color.tint }]}
        contentStyle={styles.cardFill}
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
              name={meta.icon as never}
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
      </PressableScale>
    </AnimatedEntrance>
  );
});

const styles = StyleSheet.create({
  scroll: { flexGrow: 1 },
  grid: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.lg,
  },
  gridPhone: { padding: spacing.md, gap: spacing.md },
  row: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.lg,
  },
  rowPhone: { flex: 0, gap: spacing.md },
  slot: { flex: 1 },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderTopWidth: 4,
    overflow: 'hidden',
    ...shadow.md,
  },
  cardFill: { flex: 1 },
  cardInner: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
  },
  cardInnerPhone: { padding: spacing.md + 2, gap: spacing.xs + 2, minHeight: 160 },
  spacer: { flex: 1 },
  iconBox: {
    width: 88,
    height: 88,
    borderRadius: radius.xxl,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  iconBoxPhone: { width: 64, height: 64, borderRadius: radius.lg, marginBottom: 0 },
  label: {
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  desc: {
    color: colors.textMuted,
    textAlign: 'center',
  },
});
