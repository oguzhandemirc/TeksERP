// Belgeden İE satır kartının parti alanları: müşteri parti no (belgeden, elle düzeltilebilir) + bizim parti no (İE partisi).
// `DocRowCard.tsx` 300 satır sınırında olduğundan ayrı dosya.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { SelectButton } from '../../../../components/form/SelectButton';
import { DOC_HIGHLIGHT_BG, DocHighlight } from '../../../../components/DocHighlight';
import { colors, radius, spacing, typography } from '../../../../theme';
import { editCustomerBatchNo } from './woFromDoc';
import type { DocRow, WoRowsState } from './useWoRows';

/**
 * Müşteri parti no (belgeden okunan, elle yazılabilir düz metin; seçici yok) + bizim parti no (İE partisi) aynı satırda.
 * Seri kipinde bizimki gri "Bizim parti: otomatik" hapı; belgeden kipinde aday seçici düğmesi (bugünkü davranış).
 */
export default function BatchFields({ row, wo, locked, onPick }: { row: DocRow; wo: WoRowsState; locked: boolean; onPick: () => void }) {
  const f = row.form!;
  const candidates = row.detail?.batchNoCandidates ?? [];
  const fromDoc = wo.batchSource === 'DOCUMENT';
  return (
    <View style={styles.row}>
      <DocHighlight active={!!f.customerBatchNoFromDoc} style={styles.hl}>
        <TextInput
          mode="outlined"
          label="Müşteri parti no"
          value={f.customerBatchNo ?? ''}
          disabled={locked}
          maxLength={64}
          style={[styles.input, f.customerBatchNoFromDoc ? styles.hlInput : null]}
          onChangeText={(t) => wo.updateForm(row.noteId, editCustomerBatchNo(t))}
          testID={`belge-satir-musteri-parti-${row.noteNo}`}
        />
      </DocHighlight>
      {fromDoc ? (
        <View style={styles.pick}>
          <SelectButton
            label={candidates.length > 1 ? `Seçin (${candidates.length} aday)` : 'Bizim parti: otomatik'}
            caption="Bizim parti"
            value={f.ourBatchNo}
            onPress={onPick}
            disabled={locked || candidates.length === 0}
            testID={`belge-satir-bizim-parti-sec-${row.noteNo}`}
          />
        </View>
      ) : (
        <View style={styles.auto} testID={`belge-satir-bizim-parti-${row.noteNo}`}>
          <Text style={styles.autoText}>Bizim parti: otomatik</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // İki kutu eşit genişlik ve aynı yükseklik (SelectButton 64dp; outlined girdi 58 + etiket payı).
  row: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  hl: { padding: 2, flex: 1, minWidth: 220 },
  input: { height: 58 },
  hlInput: { backgroundColor: DOC_HIGHLIGHT_BG },
  pick: { flex: 1, minWidth: 220 },
  auto: { flex: 1, minWidth: 220, minHeight: 64, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  autoText: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.textSecondary },
});
