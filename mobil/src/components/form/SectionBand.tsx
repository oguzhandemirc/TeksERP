// Bölüm şeridi — formun tek cesur öğesi: sol çubuk rengi bölümün durumunu söyler.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../theme';
import { StatusPill } from './StatusPill';
import type { BandTone } from './tone';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface SectionBandProps {
  title: string;
  icon: IconName;
  tone?: BandTone;
  aside?: string | null;
  status?: { icon?: IconName; text: string } | null;
  dimmed?: boolean;
  testID: string;
}

export function SectionBand({ title, icon, tone = 'idle', aside, status, dimmed, testID }: SectionBandProps) {
  return (
    <View testID={testID} accessibilityRole="header" style={[styles.band, dimmed ? styles.dimmed : null]}>
      <View testID={`${testID}-kenar`} style={[styles.bar, { backgroundColor: colors.band.bar[tone] }]} />
      <MaterialCommunityIcons name={icon} size={22} color={colors.band.text} />
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {aside ? <Text style={styles.aside} numberOfLines={1}>{aside}</Text> : null}
      <View style={styles.flex} />
      {status ? <StatusPill tone={tone} icon={status.icon} text={status.text} testID={`${testID}-durum`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, borderRadius: radius.sm,
    backgroundColor: colors.band.bg, paddingRight: spacing.sm, overflow: 'hidden',
  },
  bar: { width: 6, alignSelf: 'stretch', marginRight: spacing.xs },
  title: { fontSize: 18, fontWeight: '700', color: colors.band.text },
  aside: { fontSize: 14, fontWeight: '600', color: colors.band.aside, flexShrink: 1 },
  flex: { flex: 1 },
  dimmed: { opacity: 0.55 },
});
