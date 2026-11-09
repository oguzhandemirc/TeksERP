// Belgeden İE satır kartının parti alanları: müşteri parti no (belgeden, elle düzeltilebilir) + bizim parti no (İE partisi).
// `DocRowCard.tsx` 300 satır sınırında olduğundan ayrı dosya.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TextInput } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { batchService } from '../../../../services/batch.service';
import { SelectButton } from '../../../../components/form/SelectButton';
import { DOC_HIGHLIGHT_BG, DocHighlight } from '../../../../components/DocHighlight';
import { spacing } from '../../../../theme';
import { editCustomerBatchNo } from './woFromDoc';
import { ourBatchAutoText, previewCodes } from './ourBatchPreview';
import type { DocRow, WoRowsState } from './useWoRows';

/**
 * Müşteri parti no (belgeden okunan, elle yazılabilir düz metin; seçici yok) + bizim parti no (İE partisi) aynı satırda.
 * Seri kipinde bizimki müşteri alanıyla aynı görünümde salt okunur "Otomatik · sıradaki: X"; belgeden kipinde aday seçici
 * düğmesi (bugünkü davranış).
 */
export default function BatchFields({ row, wo, locked, onPick }: { row: DocRow; wo: WoRowsState; locked: boolean; onPick: () => void }) {
  const f = row.form!;
  const candidates = row.detail?.batchNoCandidates ?? [];
  const fromDoc = wo.batchSource === 'DOCUMENT';
  const preview = useOurBatchPreview(1, !fromDoc && !locked);
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
            label={docBatchLabel(candidates.length)}
            caption="Bizim parti"
            value={f.ourBatchNo}
            onPress={onPick}
            disabled={locked || candidates.length === 0}
            testID={`belge-satir-bizim-parti-sec-${row.noteNo}`}
          />
        </View>
      ) : (
        <OurBatchAutoField code={preview[0]} testID={`belge-satir-bizim-parti-${row.noteNo}`} />
      )}
    </View>
  );
}

const NO_PREVIEW: readonly string[] = [];

/** Sıradaki `count` parti numarası tahmini (numara TÜKETMEZ); kapalıyken / hata / çevrimdışı boş → "Otomatik". */
export function useOurBatchPreview(count: number, enabled: boolean): readonly string[] {
  const q = useQuery({
    queryKey: ['batch-number-state', 'preview', count],
    queryFn: () => batchService.getNumberPreview(count),
    enabled: enabled && count > 0,
    staleTime: 5_000,
    retry: false,
  });
  return q.data ? previewCodes(q.data.data) : NO_PREVIEW;
}

/** Seri kipinde bizim parti no: müşteri parti no girdisiyle aynı outlined görünüm, salt okunur. */
export function OurBatchAutoField({ code, testID }: { code: string | null | undefined; testID: string }) {
  return (
    <View style={styles.autoBox}>
      <TextInput mode="outlined" label="Bizim parti no" value={ourBatchAutoText(code)} editable={false} style={styles.input} testID={testID} />
    </View>
  );
}

/** Belgeden kipinde numara kâğıttan gelir; tek adayda "otomatik" demek seri sayaç sanılırdı. */
function docBatchLabel(n: number): string {
  if (n > 1) return `Bizim parti no seçin (${n} aday)`;
  return n === 1 ? 'Bizim parti no: belgeden' : 'Bizim parti no: belgede bulunamadı';
}

const styles = StyleSheet.create({
  // İki kutu eşit genişlik ve aynı yükseklik (SelectButton 64dp; outlined girdi 58 + etiket payı).
  row: { flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  hl: { padding: 2, flex: 1, minWidth: 220 },
  input: { height: 58 },
  hlInput: { backgroundColor: DOC_HIGHLIGHT_BG },
  pick: { flex: 1, minWidth: 220 },
  // Müşteri kutusunun DocHighlight payı (2) kadar: iki outlined kutu aynı hizada.
  autoBox: { padding: 2, flex: 1, minWidth: 220 },
});
