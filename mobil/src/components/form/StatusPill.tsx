// Küçük durum hapı — şerit sağında ve alan panelinde aynı görünüm.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { radius, spacing } from '../../theme';
import { pillColors, type PillTone } from './tone';

export interface StatusPillProps {
  tone: PillTone;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  text: string;
  testID?: string;
}

export function StatusPill({ tone, icon, text, testID }: StatusPillProps) {
  const c = pillColors(tone);
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: c.bg }]}>
      {icon ? <MaterialCommunityIcons name={icon} size={18} color={c.fg} /> : null}
      <Text style={[styles.text, { color: c.fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 30,
    paddingHorizontal: spacing.md, borderRadius: radius.full, alignSelf: 'center',
  },
  text: { fontSize: 14, fontWeight: '700' },
});
