// Belgeden İE satır kartının parti alanları: müşteri parti no (belgeden, elle düzeltilebilir) + bizim parti no (İE partisi).
// `DocRowCard.tsx` 300 satır sınırında olduğundan ayrı dosya.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { SheetField } from '../../../../components/ModuleSheet';
import { DOC_HIGHLIGHT_BG, DocHighlight } from '../../../../components/DocHighlight';
import { colors, typography } from '../../../../theme';
import { editCustomerBatchNo } from './woFromDoc';
import type { DocRow, WoRowsState } from './useWoRows';

/**
 * Müşteri parti no (belgeden okunan, elle yazılabilir düz metin; seçici yok) + bizim parti no (İE partisi). Seri kipinde
 * bizimki salt okunur "Otomatik verilir"; belgeden kipinde değer ya da aday seçici (bugünkü davranış).
 */
export default function BatchFields({ row, wo, locked, onPick }: { row: DocRow; wo: WoRowsState; locked: boolean; onPick: () => void }) {
  const f = row.form!;
  const candidates = row.detail?.batchNoCandidates ?? [];
  const fromDoc = wo.batchSource === 'DOCUMENT';
  return (
    <>
      <DocHighlight active={!!f.customerBatchNoFromDoc} style={styles.hl}>
        <TextInput
          mode="outlined"
          dense
          label="Müşteri parti no"
          value={f.customerBatchNo ?? ''}
          disabled={locked}
          maxLength={64}
          style={f.customerBatchNoFromDoc ? styles.hlInput : undefined}
          onChangeText={(t) => wo.updateForm(row.noteId, editCustomerBatchNo(t))}
          testID={`belge-satir-musteri-parti-${row.noteNo}`}
        />
      </DocHighlight>
      {fromDoc ? (
        <SheetField
          label="Bizim parti no"
          value={f.ourBatchNo ?? ''}
          placeholder={candidates.length > 1 ? `Seçin (${candidates.length} aday)` : 'Otomatik verilir'}
          onPress={onPick}
          disabled={locked || candidates.length === 0}
        />
      ) : (
        <View style={styles.autoBatch} testID={`belge-satir-bizim-parti-${row.noteNo}`}>
          <Text style={styles.label}>Bizim parti no</Text>
          <Text style={styles.autoText}>Otomatik verilir</Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold },
  hl: { padding: 2 },
  hlInput: { backgroundColor: DOC_HIGHLIGHT_BG },
  autoBatch: { gap: 2 },
  autoText: { fontSize: typography.size.base, color: colors.textMuted },
});
