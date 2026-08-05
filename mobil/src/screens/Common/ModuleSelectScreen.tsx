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
import SyncStatusChip from '../../components/SyncStatusChip';
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

  // Yerleşim TEK yol: her iki cihazda da grid kaydırılabilir bir alanda yaşar.
  // Tablet kartları ölçülen alana YAYILIR (ekranı doldurur) ama dolgu yüksekliği
  // taban yüksekliğin altına düşerse (tüm yetkileri açık kullanıcıda 12+ kart)
  // kartlar tabanda kalır ve grid dikeyde TAŞAR → kaydırma devreye girer.
  // Eskiden tablet dalı sabit bir View'daydı: taşan kartlar erişilemez oluyordu.
  const scrollableRef = useAnimatedRef<Animated.ScrollView>();
  const [areaH, setAreaH] = useState(0);
  const onArea = useCallback((e: LayoutChangeEvent) => {
    setAreaH(e.nativeEvent.layout.height);
  }, []);

  const pad = isPhone ? spacing.md : spacing.lg;
  const minCardHeight = isPhone ? 168 : 180;
  // areaH ölçülen GÖRÜNÜR alandır (ScrollView'in kendi yüksekliği), içeriğin değil.
  const fillHeight =
    areaH > 0 ? Math.floor((areaH - 2 * pad - (rows - 1) * gap) / rows) : 0;
  const cardHeight = isPhone ? minCardHeight : Math.max(minCardHeight, fillHeight);

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
      autoScrollEnabled
      scrollableRef={scrollableRef}
    />
  );

  // İzin var ama görünür bölüm yok — tek yetkisi kapalı bir düzene (örn. kurşun
  // bypass bayrağı kapalı) bağlı kullanıcı buraya düşer. Boş grid yerine NE
  // olduğunu söyle: operatör "uygulama bozuldu" sanmasın.
  if (count === 0) {
    return (
      <ScreenChrome
        title="Adnan Şahin Tekstil"
        subtitle="Bölüm Seçimi"
        headerExtras={<SyncStatusChip />}
      >
        <View style={styles.empty}>
          <MaterialCommunityIcons name="folder-off-outline" size={64} color={colors.textMuted} />
          <Text variant="titleMedium" style={styles.emptyTitle}>
            Görünür bölüm yok
          </Text>
          <Text style={styles.emptyText}>
            Yetkili olduğun bölüm şu an yönetim panelinden kapatılmış. Açıldığında burada
            kendiliğinden görünür.
          </Text>
        </View>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome
      title="Adnan Şahin Tekstil"
      subtitle="Bölüm Seçimi"
      // Ölü mektup kutusunun ANA MENÜDEKİ girişi: operatör istasyondan çıkıp
      // buraya dönse de gönderilemeyen kaydı görebilsin (istasyon ekranlarında
      // çip zaten header'da duruyor). Hiçbir yerde görünmeyen kayıt yok demektir.
      headerExtras={<SyncStatusChip />}
    >
      <Animated.ScrollView
        ref={scrollableRef}
        onLayout={onArea}
        contentContainerStyle={isPhone ? styles.scroll : styles.scrollTablet}
        showsVerticalScrollIndicator={!isPhone}
      >
        {grid}
      </Animated.ScrollView>
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
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  scroll: { padding: spacing.md },
  scrollTablet: { padding: spacing.lg },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.sm,
  },
  emptyTitle: { fontWeight: '700', color: colors.text },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 420,
  },
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
});
