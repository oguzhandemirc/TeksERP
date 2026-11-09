// Belgeden İE satır kartının parti alanları: müşteri parti no (belgeden, elle düzeltilebilir) + bizim parti no (İE partisi).
// `DocRowCard.tsx` 300 satır sınırında olduğundan ayrı dosya.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { batchService } from '../../../../services/batch.service';
import { SelectButton } from '../../../../components/form/SelectButton';
import { DeclaredEditSheet, DeclaredField, declaredLayout } from './DeclaredField';
import { editCustomerBatchNo } from './woFromDoc';
import { ourBatchAutoText, previewCodes } from './ourBatchPreview';
import type { DocRow, WoRowsState } from './useWoRows';

/**
 * Müşteri parti no (belgeden okunan beyan kutusu; dokununca düz metin sayfası, seçici yok) + bizim parti no (İE partisi) aynı
 * satırda. Seri kipinde bizimki aynı kutu stilinde salt okunur "Otomatik · X"; belgeden kipinde aday seçici düğmesi.
 */
export default function BatchFields({ row, wo, locked, onPick }: { row: DocRow; wo: WoRowsState; locked: boolean; onPick: () => void }) {
  const f = row.form!;
  const candidates = row.detail?.batchNoCandidates ?? [];
  const fromDoc = wo.batchSource === 'DOCUMENT';
  const preview = useOurBatchPreview(1, !fromDoc && !locked);
  const [edit, setEdit] = useState(false);
  return (
    <View style={declaredLayout.row}>
      <DeclaredField label="Müşteri parti no" value={f.customerBatchNo || null} fromDoc={!!f.customerBatchNoFromDoc} emptyText="Yok — dokunun"
        onPress={() => setEdit(true)} disabled={locked} testID={`belge-satir-musteri-parti-${row.noteNo}`} />
      {fromDoc ? (
        <View style={declaredLayout.cell}>
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
      {edit && (
        <DeclaredEditSheet title="Müşteri parti no" subtitle="Belgedeki gönderen parti numarası" kind="text" label="Müşteri parti no" maxLength={64}
          initial={f.customerBatchNo ?? ''} allowEmpty onDismiss={() => setEdit(false)} testID={`belge-satir-musteri-parti-duzelt-${row.noteNo}`}
          onSave={(t) => { setEdit(false); if (t.trim() !== (f.customerBatchNo ?? '')) wo.updateForm(row.noteId, editCustomerBatchNo(t.trim())); }} />
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

/** Seri kipinde bizim parti no: beyan kutusu stilinde salt okunur (sarı değil — belgeden gelmez, sayaçtan). */
export function OurBatchAutoField({ code, testID }: { code: string | null | undefined; testID: string }) {
  return <DeclaredField label="Bizim parti no" value={ourBatchAutoText(code)} testID={testID} />;
}

/** Belgeden kipinde numara kâğıttan gelir; tek adayda "otomatik" demek seri sayaç sanılırdı. */
function docBatchLabel(n: number): string {
  if (n > 1) return `Bizim parti no seçin (${n} aday)`;
  return n === 1 ? 'Bizim parti no: belgeden' : 'Bizim parti no: belgede bulunamadı';
}
