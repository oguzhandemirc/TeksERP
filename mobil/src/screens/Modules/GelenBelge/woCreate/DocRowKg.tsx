// "Gelen kg" kutusu (T2): belgeden önerilen gelen kg (`incomingKg`, sunucu `pickIncomingKg`) — HEDEF kg değildir, hedef kg'ye
// kopyalanmaz. Elle değişince gövdeye girer; boşaltılırsa anahtar gitmez ve sunucu belgedekini yazar (not satırı bunu söyler).
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import NumpadInput from '../../../../components/NumpadInput';
import type { IncomingKgSource } from '../../../../services/inboundDoc.service';
import { colors, spacing, typography } from '../../../../theme';
import { fmtKursunMeters } from '../readResult';
import { parseMeters } from '../approvalGate';
import type { DocRow, WoRowsState } from './useWoRows';

const SOURCE_TEXT: Record<IncomingKgSource, string> = { FIELD: 'belgedeki kg alanından', TOTAL: 'belgedeki toplamdan', LINE_SUM: 'satır toplamı' };

/** Kutunun altındaki kaynak notu: belgeden (kaynak) · elle · belgede yok. */
export function incomingKgNote(a: { value: number | null; edited: boolean; suggested: number | null; source: IncomingKgSource | null }): string {
  if (a.edited && a.value == null) return a.suggested != null ? `Boş bırakılırsa belgedeki ${fmtKursunMeters(a.suggested)} kg yazılır` : 'Belgede kg yok';
  if (a.edited) return 'Elle girildi';
  if (a.value == null) return 'Belgede kg yok';
  return a.source ? `Belgeden · ${SOURCE_TEXT[a.source]}` : 'Belgeden';
}

export function IncomingKgField({ row, wo, locked }: { row: DocRow; wo: WoRowsState; locked: boolean }) {
  const f = row.form!;
  const suggested = row.detail?.incomingKg != null && Number(row.detail.incomingKg) > 0 ? Number(row.detail.incomingKg) : null;
  // Metin yerelde ("12," yazarken silinmesin); sayı her tuşta forma gider.
  const [text, setText] = useState(f.incomingKg != null ? String(f.incomingKg).replace('.', ',') : '');
  const note = incomingKgNote({ value: f.incomingKg ?? null, edited: !!f.incomingKgEdited, suggested, source: row.detail?.incomingKgSource ?? null });
  return (
    <View style={styles.wrap} testID={`belge-satir-kg-${row.noteNo}`}>
      <NumpadInput value={text} label="Gelen kg" mode="outlined" useNativeKeyboard allowDecimal editable={!locked} testID={`belge-satir-kg-giris-${row.noteNo}`}
        onChangeText={(t) => { setText(t); wo.updateForm(row.noteId, { incomingKg: parseMeters(t), incomingKgEdited: true }); }} />
      <Text style={styles.note} testID={`belge-satir-kg-not-${row.noteNo}`}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minWidth: 180, flexGrow: 1, flexBasis: 180, gap: spacing.xs },
  note: { fontSize: typography.size.sm, color: colors.textSecondary },
});
