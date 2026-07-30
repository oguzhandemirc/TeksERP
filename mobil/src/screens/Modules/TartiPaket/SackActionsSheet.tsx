import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Surface, Text, TouchableRipple, Icon, Button } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import { colors, spacing, radius } from '../../../theme';

// =============================================================================
// Çuval ⋮ (taşan aksiyonlar) sheet'i.
//
// Çuval kartında yalnız SIK kullanılan iki şey durur: çuvala dokun (aktif yap) +
// ⚖ tek dokunuş tart. Geri kalan her şey buraya toplanır — "ortalıkta durmasın"
// ilkesi. Elle kg girişi bilinçli olarak BURADA: kantar varken kimse elle
// girmemeli, ama kantar bozulduğunda yol kapanmamalı.
//
// Satır yüksekliği 56dp (mobil/CLAUDE.md dokunma hedefi) — fabrika eldiveni.
// =============================================================================

export interface SackAction {
  key: string;
  icon: string;
  label: string;
  /** Satırın altındaki küçük açıklama (opsiyonel). */
  hint?: string;
  danger?: boolean;
  onPress: () => void;
}

interface Props {
  /** null → kapalı. */
  target: { id: string; label: string } | null;
  actions: SackAction[];
  onDismiss: () => void;
}

export default function SackActionsSheet({ target, actions, onDismiss }: Props) {
  return (
    <AppModal visible={target !== null} onDismiss={onDismiss} position="bottom" contentStyle={styles.wrap}>
      <Surface style={styles.sheet} elevation={4}>
        <Text variant="titleMedium" style={styles.title}>
          {target?.label}
        </Text>

        {actions.map((a) => (
          <TouchableRipple
            key={a.key}
            onPress={() => {
              onDismiss();
              a.onPress();
            }}
            style={styles.row}
          >
            <View style={styles.rowInner}>
              <Icon source={a.icon} size={22} color={a.danger ? colors.danger : colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, a.danger && { color: colors.danger }]}>{a.label}</Text>
                {a.hint ? <Text style={styles.rowHint}>{a.hint}</Text> : null}
              </View>
            </View>
          </TouchableRipple>
        ))}

        <Button onPress={onDismiss} style={styles.close}>
          Kapat
        </Button>
      </Surface>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', marginBottom: spacing.md },
  sheet: { width: '100%', borderRadius: radius.lg, padding: spacing.md, backgroundColor: colors.surface },
  title: { fontWeight: '700', color: colors.text, paddingHorizontal: spacing.sm, marginBottom: spacing.xs },
  // 56dp dokunma hedefi — fabrika ortamı.
  row: { borderRadius: radius.md, minHeight: 56, justifyContent: 'center' },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowHint: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
  close: { marginTop: spacing.xs },
});
