// İnce bilgi/uyarı şeridi — form içinde yerinde açıklama; isteğe bağlı tek eylem düğmesi.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../theme';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type NoticeTone = 'info' | 'warn' | 'danger';

const TONES: Record<NoticeTone, { bg: string; fg: string; edge: string; icon: IconName }> = {
  info: { bg: colors.infoContainer, fg: colors.infoText, edge: colors.info, icon: 'information-outline' },
  warn: { bg: colors.warningContainer, fg: colors.warningText, edge: colors.warning, icon: 'alert-outline' },
  danger: { bg: colors.dangerContainer, fg: colors.dangerText, edge: colors.danger, icon: 'alert-circle-outline' },
};

export interface NoticeStripProps {
  tone: NoticeTone;
  icon?: IconName;
  text: string;
  action?: { label: string; icon?: IconName; onPress: () => void; testID?: string };
  testID: string;
}

export function NoticeStrip({ tone, icon, text, action, testID }: NoticeStripProps) {
  const t = TONES[tone];
  return (
    <View testID={testID} style={[styles.strip, { backgroundColor: t.bg, borderLeftColor: t.edge }]}>
      <MaterialCommunityIcons name={icon ?? t.icon} size={20} color={t.fg} />
      <Text style={[styles.text, { color: t.fg }]}>{text}</Text>
      {action ? (
        <TouchableRipple testID={action.testID} accessibilityRole="button" onPress={action.onPress} style={styles.action}>
          <View style={styles.actionRow}>
            {action.icon ? <MaterialCommunityIcons name={action.icon} size={18} color={t.fg} /> : null}
            <Text style={[styles.actionText, { color: t.fg }]}>{action.label}</Text>
          </View>
        </TouchableRipple>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderLeftWidth: 4,
    borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  text: { flex: 1, fontSize: 15 },
  action: { borderRadius: radius.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  actionText: { fontSize: 15, fontWeight: '700' },
});
