// =============================================================================
// Tambur kesim aksiyon barı — "Kartela" toggle + "Kes" (asıl aksiyon).
//
// Hem ana açık-kumaş kesimi hem Top Kesme (recut) akışı aynı barı kullanır.
// Yan yana düzen (telefon + tablet ortak dil); sadece genişlik/font ölçeklenir.
// Dokunma = TouchableRipple (proje kuralı), micro-interaction = Reanimated:
//   • Kartela: dolu↔outline renk geçişi + açılınca küçük "onay" zıplaması
//   • Kes: basışta scale-down + haptic; loading/disabled görsel durumları
// Renk/spacing/radius token'lardan (ham hex yok); mor = moduleAccents.Tambur.
// =============================================================================

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  ActivityIndicator,
  Icon,
  Surface,
  Text,
  TouchableRipple,
} from 'react-native-paper';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import {
  colors,
  durations,
  easing,
  moduleAccents,
  radius,
  shadow,
  spacing,
  springs,
} from '../../../theme';

const PURPLE = moduleAccents.Tambur.tint; // #7c3aed
const RIPPLE_ON_PURPLE = 'rgba(255,255,255,0.26)';
const RIPPLE_ON_LIGHT = 'rgba(124,58,237,0.16)';
const BAR_HEIGHT = 60; // telefon
const BAR_HEIGHT_TABLET = 80; // tablet — daha büyük dokunma hedefi (Kes/Kartela)

interface Props {
  compact: boolean;
  /** Kartelalık işareti — açıksa çıktı toplar depoda kartela sevki için işaretlenir. */
  kartelaOn: boolean;
  onToggleKartela: () => void;
  /** Asıl "Kes" aksiyonu — etiket akışa göre çağıran tarafça hesaplanır. */
  kesLabel: string;
  onKes: () => void;
  /** Geçersiz form (gri görünüm, kilit). */
  kesDisabled: boolean;
  /** İşlem sürüyor (spinner + kilit, ama mor görünüm korunur). */
  kesLoading: boolean;
  /** Opsiyonel "Bitir" aksiyonu (Top Kesme akışı): kalan kumaş için karar modalını
   *  açar (1.KALITE/A1/FIRE). Verilmezse buton render edilmez — açık kumaş akışı
   *  kendi bitişini yönetir. */
  onBitir?: () => void;
  bitirDisabled?: boolean;
}

export default function CutActionBar({
  compact,
  kartelaOn,
  onToggleKartela,
  kesLabel,
  onKes,
  kesDisabled,
  kesLoading,
  onBitir,
  bitirDisabled,
}: Props) {
  return (
    <Surface style={styles.bar} elevation={3}>
      <View style={styles.row}>
        <KartelaToggle on={kartelaOn} onToggle={onToggleKartela} compact={compact} />
        {onBitir && (
          <BitirButton
            onPress={onBitir}
            disabled={!!bitirDisabled}
            compact={compact}
          />
        )}
        <KesButton
          label={kesLabel}
          onPress={onKes}
          disabled={kesDisabled}
          loading={kesLoading}
          compact={compact}
        />
      </View>
    </Surface>
  );
}

// ───────────────────────── Bitir (Top Kesme kapanışı) ─────────────────────────
function BitirButton({
  onPress,
  disabled,
  compact,
}: {
  onPress: () => void;
  disabled: boolean;
  compact: boolean;
}) {
  return (
    <View
      style={[
        styles.toggle,
        {
          width: compact ? 88 : 112,
          height: compact ? BAR_HEIGHT : BAR_HEIGHT_TABLET,
        },
        disabled && styles.bitirDisabled,
      ]}
    >
      <TouchableRipple
        onPress={
          disabled
            ? undefined
            : () => {
                Haptics.selectionAsync().catch(() => {});
                onPress();
              }
        }
        disabled={disabled}
        borderless
        rippleColor={RIPPLE_ON_LIGHT}
        style={styles.toggleInner}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel="Top kesmeyi bitir — kalan kumaş için karar ver"
      >
        <View style={styles.toggleContent}>
          <Icon
            source="flag-checkered"
            size={20}
            color={disabled ? colors.textMuted : PURPLE}
          />
          <Text
            style={[
              styles.bitirLabel,
              { fontSize: compact ? 13 : 14 },
              disabled && { color: colors.textMuted },
            ]}
            numberOfLines={1}
          >
            Bitir
          </Text>
        </View>
      </TouchableRipple>
    </View>
  );
}

// ───────────────────────── Kartela toggle ─────────────────────────
function KartelaToggle({
  on,
  onToggle,
  compact,
}: {
  on: boolean;
  onToggle: () => void;
  compact: boolean;
}) {
  const reduced = useReducedMotion();
  const press = useSharedValue(1); // parmak basılıyken küçülme
  const pop = useSharedValue(1); // açılınca onay zıplaması (press'ten bağımsız)
  const prog = useSharedValue(on ? 1 : 0); // 0=outline, 1=dolu (renk geçişi)

  useEffect(() => {
    prog.value = withTiming(on ? 1 : 0, {
      duration: durations.fast,
      easing: easing.standard,
    });
    if (!reduced && on) {
      pop.value = withSequence(
        withSpring(1.06, springs.bouncy),
        withSpring(1, springs.press),
      );
    }
  }, [on, reduced, prog, pop]);

  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value * pop.value }],
    backgroundColor: interpolateColor(prog.value, [0, 1], [colors.surface, PURPLE]),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(prog.value, [0, 1], [PURPLE, colors.textOnDark]),
  }));

  return (
    <Animated.View
      style={[
        styles.toggle,
        {
          width: compact ? 104 : 132,
          height: compact ? BAR_HEIGHT : BAR_HEIGHT_TABLET,
        },
        boxStyle,
      ]}
    >
      <TouchableRipple
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onToggle();
        }}
        onPressIn={() => {
          if (!reduced) press.value = withSpring(0.94, springs.press);
        }}
        onPressOut={() => {
          if (!reduced) press.value = withSpring(1, springs.press);
        }}
        borderless
        rippleColor={on ? RIPPLE_ON_PURPLE : RIPPLE_ON_LIGHT}
        style={styles.toggleInner}
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        accessibilityLabel="Çıktıyı kartelalık olarak işaretle"
      >
        <View style={styles.toggleContent}>
          <Icon
            source={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={20}
            color={on ? colors.textOnDark : PURPLE}
          />
          <Animated.Text
            style={[styles.toggleLabel, { fontSize: compact ? 13 : 14 }, labelStyle]}
            numberOfLines={1}
          >
            Kartela
          </Animated.Text>
        </View>
      </TouchableRipple>
    </Animated.View>
  );
}

// ───────────────────────── Kes (asıl aksiyon) ─────────────────────────
function KesButton({
  label,
  onPress,
  disabled,
  loading,
  compact,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  loading: boolean;
  compact: boolean;
}) {
  const reduced = useReducedMotion();
  const press = useSharedValue(1);

  const blocked = disabled || loading; // dokunma kilidi
  const dimmed = disabled && !loading; // gri görünüm (loading'de mor kalır)

  const wrapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value }],
  }));

  return (
    <Animated.View
      style={[styles.kesWrap, dimmed ? styles.kesBlocked : shadow.md, wrapStyle]}
    >
      <TouchableRipple
        onPress={
          blocked
            ? undefined
            : () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                onPress();
              }
        }
        onPressIn={() => {
          if (!reduced && !blocked) press.value = withSpring(0.97, springs.press);
        }}
        onPressOut={() => {
          if (!reduced) press.value = withSpring(1, springs.press);
        }}
        disabled={blocked}
        borderless
        rippleColor={RIPPLE_ON_PURPLE}
        style={[
          styles.kesInner,
          { height: compact ? BAR_HEIGHT : BAR_HEIGHT_TABLET },
          dimmed && styles.kesBlocked,
        ]}
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked }}
        accessibilityLabel={loading ? 'Kesiliyor' : label}
      >
        <View style={styles.kesContent}>
          {loading ? (
            <ActivityIndicator size={20} color={colors.textOnDark} />
          ) : (
            <Icon
              source="content-cut"
              size={22}
              color={dimmed ? colors.textMuted : colors.textOnDark}
            />
          )}
          <Text
            style={[
              styles.kesLabel,
              { fontSize: compact ? 15 : 17 },
              dimmed && styles.kesLabelDimmed,
            ]}
            numberOfLines={1}
          >
            {loading ? 'Kesiliyor…' : label}
          </Text>
        </View>
      </TouchableRipple>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },

  // Kartela toggle — sabit genişlik (outline↔dolu geçişinde Kes zıplamasın).
  toggle: {
    height: BAR_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: PURPLE,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  toggleInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  toggleContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleLabel: { fontWeight: '800', letterSpacing: 0.2 },
  bitirLabel: { fontWeight: '800', letterSpacing: 0.2, color: PURPLE },
  bitirDisabled: { borderColor: colors.border, backgroundColor: colors.surfaceSunken },

  // Kes — esnek (kalanı doldurur), büyük dokunma hedefi, gölgeyle "kalkık".
  kesWrap: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: PURPLE,
  },
  kesInner: {
    flex: 1,
    height: BAR_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
  },
  kesBlocked: { backgroundColor: colors.surfaceSunken },
  kesContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kesLabel: { color: colors.textOnDark, fontWeight: '700', letterSpacing: 0.2 },
  kesLabelDimmed: { color: colors.textMuted },
});
