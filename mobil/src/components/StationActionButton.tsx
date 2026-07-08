// =============================================================================
// İstasyon ana-aksiyon butonu — Tambur "Kes" butonuyla aynı görsel dil.
//
// Tam genişlik, büyük dokunma hedefi (60dp), gölgeyle "kalkık". Dokunma =
// TouchableRipple (proje kuralı). Micro-interaction = Reanimated: basışta
// scale-down + haptic; loading (spinner) / disabled (gri kilit) görsel
// durumları. Renk/spacing/radius token'lardan (ham hex yok).
//
// KK2 "Kumaşı Bitir" ve benzeri tekil ana aksiyonlar için ortak bileşen.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text, TouchableRipple } from 'react-native-paper';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { colors, moduleAccents, radius, shadow, spacing, springs } from '../theme';

const RIPPLE_ON_TINT = 'rgba(255,255,255,0.26)';
const BAR_HEIGHT = 60;

interface Props {
  label: string;
  icon: string;
  onPress: () => void;
  /** Asıl renk — Tambur moru default (istasyon vurgu rengiyle de override edilebilir). */
  tint?: string;
  /** İşlem sürüyor — spinner + kilit (renk korunur). */
  loading?: boolean;
  /** Geçersiz/kilitli — gri görünüm. */
  disabled?: boolean;
  /** loading sırasında gösterilecek etiket. */
  loadingLabel?: string;
  /** Telefon ölçeği — biraz küçük font. */
  compact?: boolean;
  /** Daha büyük bar (72dp) + büyük font — geniş tablet footer'ı için. */
  large?: boolean;
}

export default function StationActionButton({
  label,
  icon,
  onPress,
  tint = moduleAccents.Tambur.tint,
  loading = false,
  disabled = false,
  loadingLabel,
  compact = false,
  large = false,
}: Props) {
  const reduced = useReducedMotion();
  const press = useSharedValue(1);

  const blocked = disabled || loading; // dokunma kilidi
  const dimmed = disabled && !loading; // gri görünüm (loading'de mor kalır)

  const wrapStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const surfaceColor = dimmed ? colors.surfaceSunken : tint;

  return (
    <Animated.View
      style={[styles.wrap, { backgroundColor: surfaceColor }, dimmed ? null : shadow.md, wrapStyle]}
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
        rippleColor={RIPPLE_ON_TINT}
        style={[styles.inner, large && styles.innerLarge, { backgroundColor: surfaceColor }]}
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked }}
        accessibilityLabel={loading ? (loadingLabel ?? label) : label}
      >
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator size={20} color={colors.textOnDark} />
          ) : (
            <Icon source={icon} size={22} color={dimmed ? colors.textMuted : colors.textOnDark} />
          )}
          <Text
            style={[
              styles.label,
              { fontSize: large ? 19 : compact ? 16 : 17 },
              dimmed && styles.labelDimmed,
            ]}
            numberOfLines={1}
          >
            {loading ? (loadingLabel ?? label) : label}
          </Text>
        </View>
      </TouchableRipple>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: radius.md },
  inner: {
    height: BAR_HEIGHT,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
  },
  innerLarge: { height: 72 },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { color: colors.textOnDark, fontWeight: '700', letterSpacing: 0.2 },
  labelDimmed: { color: colors.textMuted },
});
