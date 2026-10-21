// =============================================================================
// İstasyon ana-aksiyon butonu — Tambur "Kes" butonuyla aynı görsel dil.
//
// Tam genişlik, büyük dokunma hedefi (60dp · `large` 72dp · `size="xl"` 112dp = KK1
// Kaydet ölçüsü), gölgeyle "kalkık". Dokunma =
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
/** İstasyon ana düğmesi (KK1 Kaydet ölçüsü) — eldivenle tek dokunuş; S3: Devere SAR/TAK. */
export const XL_BAR_HEIGHT = 112;

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
  /** `xl` = 112dp istasyon ana düğmesi (KK1 Kaydet ile aynı ölçü); verilirse `large`ı ezer. */
  size?: 'xl';
  testID?: string;
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
  size,
  testID,
}: Props) {
  const xl = size === 'xl';
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
        style={[styles.inner, large && styles.innerLarge, xl && styles.innerXl, { backgroundColor: surfaceColor }]}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked }}
        accessibilityLabel={loading ? (loadingLabel ?? label) : label}
      >
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator size={xl ? 28 : 20} color={colors.textOnDark} />
          ) : (
            <Icon source={icon} size={xl ? 32 : 22} color={dimmed ? colors.textMuted : colors.textOnDark} />
          )}
          <Text
            style={[
              styles.label,
              { fontSize: xl ? 26 : large ? 19 : compact ? 16 : 17 },
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
  innerXl: { height: XL_BAR_HEIGHT },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { color: colors.textOnDark, fontWeight: '700', letterSpacing: 0.2 },
  labelDimmed: { color: colors.textMuted },
});
