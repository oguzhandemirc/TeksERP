// "Kumaş nasıl geldi?" (Gülkesim fason): "Toplar halinde" seçiliyken top top metre + isteğe bağlı kg + gönderen top no girilir; tek iş
// emri açılır, her satır ayrı top doğar. "Tek parça" (varsayılan) gövde bugünkü tek parçadır. Çok partili belgede çizilmez.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import NumpadInput from '../../../../components/NumpadInput';
import { colors, spacing, typography } from '../../../../theme';
import { parseMeters } from '../approvalGate';
import { fmtKursunMeters } from '../readResult';
import { emptyRoll, initialRolls, ROLLS_MAX, rollsTotal, type RollRow } from './rollDraft';
import type { DocRow, WoRowsState } from './useWoRows';
import { ChoiceRow } from '../../../../components/form/ChoiceRow';

export default function RollRows({ row, wo, locked }: { row: DocRow; wo: WoRowsState; locked: boolean }) {
  const f = row.form;
  if (!f || f.multi) return null;
  const rolls = f.rolls ?? null;
  // Gelen metre top toplamını izler (taslak kaydında da toplam gider); doğrulama beklemez, toplar elle girildi.
  const set = (next: RollRow[]) => {
    const total = rollsTotal(next);
    wo.updateForm(row.noteId, { rolls: next, meters: total > 0 ? total : null, metersReview: false });
  };
  const choose = (v: string | null) => {
    if (v === 'toplar' && !rolls) set(initialRolls(row.detail?.docRolls));
    else if (v === 'tek' && rolls) wo.updateForm(row.noteId, { rolls: null });
  };
  const setRow = (key: string, patch: Partial<RollRow>) => rolls && set(rolls.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const no = row.noteNo;
  return (
    <View style={styles.box}>
      <ChoiceRow
        label="Kumaş nasıl geldi?"
        rowTestID={`belge-ayri-top-${no}`}
        options={[
          { value: 'toplar', label: 'Toplar halinde', icon: 'layers-triple-outline', testID: `belge-ayri-top-${no}-toplar` },
          { value: 'tek', label: 'Tek parça', icon: 'paper-roll-outline', testID: `belge-ayri-top-${no}-tek` },
        ]}
        value={rolls ? 'toplar' : 'tek'}
        onChange={choose}
        disabled={locked}
        testID={`belge-ayri-top-${no}-secim`}
      />
      {rolls && (
        <View style={styles.box} testID={`belge-toplar-${row.noteNo}`}>
          {rolls.map((r, i) => (
            <View key={r.key} style={styles.roll} testID={`belge-top-${row.noteNo}-${i + 1}`}>
              <Text style={styles.label}>{`${i + 1}. top`}</Text>
              <View style={styles.row}>
                <NumberInput initial={r.meters} label="Metre" locked={locked} onChange={(meters) => setRow(r.key, { meters })} testID={`belge-top-metre-${row.noteNo}-${i + 1}`} />
                <NumberInput initial={r.weightKg} label="Kg (isteğe bağlı)" locked={locked} onChange={(weightKg) => setRow(r.key, { weightKg })} testID={`belge-top-kg-${row.noteNo}-${i + 1}`} />
                <TextInput mode="outlined" label="Top no" value={r.senderRollNo} disabled={locked} style={styles.input} maxLength={64}
                  onChangeText={(t) => setRow(r.key, { senderRollNo: t })} testID={`belge-top-no-${row.noteNo}-${i + 1}`} />
                <Button mode="text" icon="delete-outline" onPress={() => set(rolls.filter((x) => x.key !== r.key))} disabled={locked || rolls.length <= 1}
                  contentStyle={styles.btn} testID={`belge-top-sil-${row.noteNo}-${i + 1}`}>
                  Sil
                </Button>
              </View>
            </View>
          ))}
          <View style={styles.row}>
            <Button mode="outlined" icon="plus" onPress={() => set([...rolls, emptyRoll()])} disabled={locked || rolls.length >= ROLLS_MAX}
              contentStyle={styles.btn} testID={`belge-top-ekle-${row.noteNo}`}>
              Top ekle
            </Button>
            <Text style={styles.total} testID={`belge-top-toplam-${row.noteNo}`}>
              {`${rolls.length} top · Toplam ${fmtKursunMeters(rollsTotal(rolls))} m`}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

/** Metin yerelde tutulur ("198," yazarken sayıya çevrilip silinmesin); sayı her tuşta üst forma gider. */
function NumberInput({ initial, label, locked, onChange, testID }: { initial: number | null; label: string; locked: boolean; onChange: (n: number | null) => void; testID: string }) {
  const [text, setText] = useState(initial !== null ? String(initial).replace('.', ',') : '');
  return (
    <View style={styles.input}>
      <NumpadInput value={text} label={label} mode="outlined" useNativeKeyboard allowDecimal editable={!locked} testID={testID}
        onChangeText={(t) => { setText(t); onChange(parseMeters(t)); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
  roll: { gap: spacing.xs },
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  input: { flex: 1, minWidth: 140 },
  total: { flex: 1, minWidth: 160, fontSize: typography.size.xl, fontWeight: typography.weight.semibold, color: colors.text },
  btn: { minHeight: 56 },
});
