// Lacivert üst şeritte etiketli ikincil iş düğmesi (tablet tasarım dili, Tambur `HeaderChip` ile aynı görünüm).
// Tambur/KK1/Kurşun kendi yerel kopyasını taşır; yeni ekranlar bunu kullanır (sonraki turda onlar da buna geçer).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { colors } from '../theme';

export interface HeaderPillProps {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

export default function HeaderPill({ icon, label, onPress, disabled, testID }: HeaderPillProps) {
  return (
    <TouchableRipple
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={[styles.pill, disabled && styles.off]}
      borderless
      rippleColor="rgba(255,255,255,0.2)"
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
    >
      <View style={styles.inner}>
        <Icon source={icon} size={18} color={colors.textOnDark} />
        <Text style={styles.text} numberOfLines={1}>{label}</Text>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 10, marginLeft: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' },
  off: { opacity: 0.45 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, minHeight: 44 },
  text: { color: colors.textOnDark, fontWeight: '700', fontSize: 14 },
});
