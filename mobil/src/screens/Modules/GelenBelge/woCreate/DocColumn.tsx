// Tek İE formunun sol sütunu ("belgeden gelenler"): belge yokken tek büyük "Belgeyi okut" + tek satır yardım;
// belge varken satır kartı tek form kipinde (yeniden okutma belge satırında ikon, dev düğme yok).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { colors, typography } from '../../../../theme';
import { ScannerSection } from './DocBatchView';
import DocRowCard, { type DocRowOpenRequest } from './DocRowCard';
import type { useUnifiedWoForm } from './useUnifiedWoForm';

type FormModel = ReturnType<typeof useUnifiedWoForm>;

export default function DocColumn({ u, openRequest }: { u: FormModel; openRequest: DocRowOpenRequest | null }) {
  const { wo, row, scan, done, fields } = u;
  if (row) {
    // Önizleme yalnız bu satırın notu bu cihazda okutulduysa (sayfaların yerel kopyası `done.sent`).
    const sent = scan.b.done?.note.id === row.noteId ? scan.b.done.sent : [];
    return (
      <DocRowCard row={row} wo={wo} customers={u.customers} customersLoading={u.customersLoading} hideGramaj={fields.isOther('gramaj') || u.partyGramaj}
        variant="single" onReread={u.manual ? u.addDoc : u.okut} manual={u.manual && wo.isManual(row.noteId)} onDraftCancelled={u.dropDoc} openRequest={openRequest} partyPlan={u.partyPlan}
        onPreview={sent.length > 0 ? () => scan.setSentIndex(0) : undefined} />
    );
  }
  return (
    <>
      {u.manual && !done && (
        <Button mode="outlined" icon="pencil-outline" onPress={u.draft.start} loading={u.draft.busy} disabled={u.draft.busy || wo.saving}
          contentStyle={styles.bigBtn} labelStyle={styles.bigLabel} testID="ie-belgesiz-baslat">
          {u.draft.busy ? 'Belgesiz form hazırlanıyor…' : 'Belgesiz devam et'}
        </Button>
      )}
      {!done && (
        <Button mode="contained" icon="file-document-outline" onPress={u.okut} disabled={wo.saving || scan.b.sending || scan.source.busy}
          contentStyle={styles.bigBtn} labelStyle={styles.bigLabel} testID="ie-belge-okut">
          Belgeyi okut
        </Button>
      )}
      {/* Yer tutucu tek satır: müşteri/parti/metre okutunca burada belirir (ayrı sönük şeritler yok). */}
      <View testID="ie-form-belge-yer-tutucu">
        <Text style={styles.help}>Kamerayı belgeye tutun; müşteri, parti ve metre kendiliğinden dolar.</Text>
      </View>
      {(scan.b.pages.length > 0 || scan.b.headerLocked || scan.b.sending) && (
        <ScannerSection b={scan.b} hasRows={false} onAdd={scan.source.add} busy={scan.source.busy} onClassic={scan.openCamera} onRemove={scan.remove} onOpen={scan.setPreviewIndex} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  bigBtn: { minHeight: 80 },
  bigLabel: { fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  help: { fontSize: typography.size.base, color: colors.textSecondary },
});
