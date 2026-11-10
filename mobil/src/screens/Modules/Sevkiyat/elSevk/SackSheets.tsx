// Çuval alt sayfaları: içerik (basılı tut) ve elle kg (sağdaki kg ikonu → tuş takımı).
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import ModuleSheet from '../../../../components/ModuleSheet';
import Numpad from '../../../../components/Numpad';
import type { HandheldSack } from '../../../../services/handheldShipment.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import { RollRow } from './LoadItems';
import { fmtKg, parseKgInput, sackKgDisplay, sackMeta } from './summary';
import { EmptyState, FilledButton, ui } from './ui';

export function SackRollsSheet({ sack, onDismiss }: { sack: HandheldSack | null; onDismiss: () => void }) {
  const kg = sack ? sackKgDisplay(sack) : null;
  return (
    <ModuleSheet
      visible={sack != null}
      onDismiss={onDismiss}
      title={sack?.sackNo ?? ''}
      subtitle={sack ? `${sackMeta(sack)}${kg?.text ? ` · ${kg.text}` : ''}` : undefined}
      footer={<FilledButton label="Kapat" tone="neutral" onPress={onDismiss} style={ui.flex} testID="sevk-cuval-icerik-kapat" />}
    >
      {sack && sack.rolls.length === 0 ? <EmptyState icon="package-variant" text="Çuval boş" /> : null}
      <ScrollView style={styles.list} testID="sevk-cuval-icerik">
        {sack?.rolls.map((r) => <RollRow key={r.id} roll={r} highlighted={false} />)}
      </ScrollView>
    </ModuleSheet>
  );
}

interface KgProps {
  sack: HandheldSack | null;
  onDismiss: () => void;
  /** true → kaydedildi (sayfa kapanır). */
  onSave: (sackId: string, kg: number | null) => Promise<boolean>;
}

export function SackKgSheet({ sack, onDismiss, onSave }: KgProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setValue(sack?.weightKg != null ? String(sack.weightKg) : '');
  }, [sack]);
  const parsed = parseKgInput(value);
  const save = async (kg: number | null) => {
    if (!sack) return;
    setBusy(true);
    const ok = await onSave(sack.id, kg);
    setBusy(false);
    if (ok) onDismiss();
  };
  const hint = sack && sack.rollKgSum != null ? `Topların toplamı ${fmtKg(sack.rollKgSum)} kg` : 'Topların tartısı yok';
  return (
    <ModuleSheet
      visible={sack != null}
      onDismiss={onDismiss}
      title={sack ? `${sack.sackNo} · kg` : ''}
      size="sm"
      footer={
        <View style={ui.row}>
          {sack?.weightKg != null ? (
            <FilledButton label="Kaldır" tone="neutral" onPress={() => void save(null)} disabled={busy} style={ui.flex} testID="sevk-kg-kaldir" />
          ) : (
            <FilledButton label="Vazgeç" tone="neutral" onPress={onDismiss} style={ui.flex} />
          )}
          <FilledButton label="Kaydet" onPress={() => parsed != null && void save(parsed)} loading={busy} disabled={parsed == null} style={ui.flex} testID="sevk-kg-kaydet" />
        </View>
      }
    >
      <View style={styles.display} testID="sevk-kg-deger">
        <Text style={styles.big}>{value === '' ? '0' : value.replace('.', ',')}</Text>
        <Text style={styles.unit}>kg</Text>
      </View>
      <Text style={[ui.secondary, styles.hint]}>{hint}</Text>
      <Numpad value={value} onChange={setValue} allowDecimal maxLength={7} compact />
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 420 },
  display: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  big: { fontSize: typography.size.display, fontWeight: typography.weight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  unit: { fontSize: typography.size.lg, color: colors.textMuted },
  hint: { textAlign: 'center', marginVertical: spacing.sm },
});
