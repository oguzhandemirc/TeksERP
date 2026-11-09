// Tek İE formu okuma uyarıları (kullanıcı 2026-11-09): başlık çubuğunda çarkın solunda sarı ünlem (56dp, 1'den fazlaysa
// sayı rozeti) + ortada modal. Okuma başına (not + runKey) bir kez kendiliğinden açılır; kapatılınca aynı okumada yeniden
// açılmaz, ikon yerinde kalır. Tanınmamış belge sorusu / tanıtma açıkken beklenir (üst üste modal yok).
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Button, Text } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import { colors, spacing, typography } from '../../../../theme';
import { useReadWarningStore } from './readWarningStore';
import type { WarningLine } from './warningLines';

const autoShown = new Set<string>();
/** Test yardımcısı: oturum belleğini boşaltır. */
export const clearReadWarnings = () => autoShown.clear();

export const READ_WARNINGS_TITLE = 'Belge uyarıları';

export function ReadWarningsHeaderIcon() {
  const { readKey, lines, held } = useReadWarningStore();
  const [open, setOpen] = useState(false);
  const has = !!readKey && lines.length > 0;
  useEffect(() => {
    if (!has || held || autoShown.has(readKey!)) return;
    autoShown.add(readKey!);
    setOpen(true);
  }, [has, held, readKey]);
  if (!has) return null;
  return (
    <>
      <View>
        <Appbar.Action icon="alert" color={colors.warning} size={28} onPress={() => setOpen(true)} style={styles.icon}
          accessibilityLabel={`${READ_WARNINGS_TITLE} (${lines.length})`} testID="ie-uyari-ikon" />
        {lines.length > 1 && (
          <View style={styles.badge} pointerEvents="none">
            <Text style={styles.badgeText} testID="ie-uyari-sayi">{lines.length}</Text>
          </View>
        )}
      </View>
      <ReadWarningsModal visible={open && !held} lines={lines} onDismiss={() => setOpen(false)} />
    </>
  );
}

function ReadWarningsModal({ visible, lines, onDismiss }: { visible: boolean; lines: WarningLine[]; onDismiss: () => void }) {
  return (
    <ModuleSheet visible={visible} size="sm" onDismiss={onDismiss} title={READ_WARNINGS_TITLE}
      footer={<Button mode="contained" onPress={onDismiss} contentStyle={styles.btn} labelStyle={styles.btnLabel} testID="ie-uyari-tamam">Tamam</Button>}>
      <View style={styles.list} testID="ie-uyari-modal">
        {lines.map((l) => (
          <View key={l.key} style={styles.line} testID={`ie-uyari-${l.key}`}>
            <Text style={styles.text}>
              <Text style={styles.title}>{l.value ? `${l.title}: ` : l.title}</Text>
              {l.value ? <Text style={styles.value}>{l.value}</Text> : null}
            </Text>
          </View>
        ))}
      </View>
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  icon: { width: 56, height: 56, margin: 0 },
  badge: {
    position: 'absolute', top: 6, right: 6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.warning,
  },
  badgeText: { fontSize: 12, fontWeight: typography.weight.bold, color: colors.text },
  list: { gap: spacing.md },
  line: { borderLeftWidth: 6, borderLeftColor: colors.warning, paddingLeft: spacing.md, paddingVertical: spacing.xs },
  text: { fontSize: 22, color: colors.text },
  title: { fontSize: 22, fontWeight: typography.weight.bold, color: colors.text },
  value: { fontSize: 22, fontWeight: typography.weight.bold, color: colors.warningText },
  btn: { minHeight: 56, paddingHorizontal: spacing.lg },
  btnLabel: { fontSize: typography.size.lg },
});
