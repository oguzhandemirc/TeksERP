import React, { useCallback, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedRef } from 'react-native-reanimated';
import Sortable, {
  type SortableGridRenderItem,
  type SortableGridDragEndParams,
} from 'react-native-sortables';
import ScreenChrome from '../../components/ScreenChrome';
import { useDeviceType } from '../../hooks/useDeviceType';
import { useModuleOrder } from '../../hooks/useModuleOrder';
import { colors, moduleAccents, radius, shadow, spacing } from '../../theme';
import type { MainStackParamList } from '../../navigation/types';
import type { MobileScreenKey, MobileScreenMeta } from '../../types/permissions';

type Nav = NativeStackNavigationProp<MainStackParamList, 'ModuleSelect'>;

export default function ModuleSelectScreen() {
  const device = useDeviceType();
  const nav = useNavigation<Nav>();
  const isPhone = device === 'phone';
  const gap = isPhone ? spacing.md : spacing.lg;

  // Sıra kullanıcı profilinden (backend) gelir; sürükle-bırakta geri yazılır.
  const { orderedScreens, setModuleOrder } = useModuleOrder();

  // Tablet: kartlar yatayda ekranı DOLDURMALI. Sabit 4 sütun yerine kart
  // sayısına göre dengeli sütun sayısı hesapla — az seçenek (örn. 3 modül)
  // tek satırda tam genişliğe yayılır; daha çok seçenek satır başına eşit
  // dağılır (maks. 4/satır). Telefon: her zaman 2 sütun (scroll'lu).
  const count = orderedScreens.length;
  const maxCols = isPhone ? 2 : 4;
  const rows = Math.max(1, Math.ceil(count / maxCols));
  const columns = isPhone ? 2 : Math.max(1, Math.ceil(count / rows));

  // Tablet: grid tek ekrana sığar → kartları ölçülen alana göre yükselt (doldur).
  // Telefon: scroll'lu, sabit yükseklik.
  const scrollableRef = useAnimatedRef<Animated.ScrollView>();
  const [areaH, setAreaH] = useState(0);
  const onArea = useCallback((e: LayoutChangeEvent) => {
    setAreaH(e.nativeEvent.layout.height);
  }, []);

  const cardHeight = isPhone
    ? 168
    : areaH > 0
      ? Math.max(180, Math.floor((areaH - 2 * gap - (rows - 1) * gap) / rows))
      : 200;

  const renderItem = useCallback<SortableGridRenderItem<MobileScreenMeta>>(
    ({ item }) => (
      // Sortable.Touchable: tek dokunuş → ekrana git; basılı tutma grid'in
      // sürükleme jestine bırakılır (ikisi çakışmaz).
      <Sortable.Touchable onTap={() => nav.navigate(item.key)}>
        <ModuleCard meta={item} height={cardHeight} compact={isPhone} />
      </Sortable.Touchable>
    ),
    [nav, cardHeight, isPhone],
  );

  const handleDragEnd = useCallback(
    ({ data }: SortableGridDragEndParams<MobileScreenMeta>) => {
      setModuleOrder(data.map((s) => s.key));
    },
    [setModuleOrder],
  );

  const handleDragStart = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, []);

  const grid = (
    <Sortable.Grid
      columns={columns}
      data={orderedScreens}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      rowGap={gap}
      columnGap={gap}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      hapticsEnabled={false}
      autoScrollEnabled={isPhone}
      {...(isPhone ? { scrollableRef } : {})}
    />
  );

  return (
    <ScreenChrome title="Modül Seçimi">
      {isPhone ? (
        <Animated.ScrollView
          ref={scrollableRef}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {grid}
        </Animated.ScrollView>
      ) : (
        <View style={styles.tabletArea} onLayout={onArea}>
          {grid}
        </View>
      )}
    </ScreenChrome>
  );
}

const ModuleCard = React.memo(function ModuleCard({
  meta,
  height,
  compact,
}: {
  meta: MobileScreenMeta;
  height: number;
  compact: boolean;
}) {
  const color = moduleAccents[meta.key as MobileScreenKey];
  return (
    <View style={[styles.card, { borderTopColor: color.tint, height }]}>
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
    </View>
  );
});

const styles = StyleSheet.create({
  scroll: { padding: spacing.md },
  tabletArea: { flex: 1, padding: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderTopWidth: 4,
    overflow: 'hidden',
    ...shadow.md,
  },
  cardInner: {
    flex: 1,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm + 2,
  },
  cardInnerPhone: { padding: spacing.md + 2, gap: spacing.xs + 2 },
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
