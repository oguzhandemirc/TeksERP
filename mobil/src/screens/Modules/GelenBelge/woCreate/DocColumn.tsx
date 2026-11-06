// Tek İE formunun sol sütunu ("belgeden gelenler"): belge yokken tek büyük "Belgeyi okut" + yardım + sönük şeritler;
// belge varken satır kartı tek form kipinde (yeniden okutma Belge şeridinin altında, dev düğme yok).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { SectionBand } from '../../../../components/form/SectionBand';
import { colors, spacing, typography } from '../../../../theme';
import { ScannerSection } from './DocBatchView';
import DocRowCard, { type DocRowOpenRequest } from './DocRowCard';
import type { useUnifiedWoForm } from './useUnifiedWoForm';

type FormModel = ReturnType<typeof useUnifiedWoForm>;

const WAITING = { text: 'belge bekleniyor' };

export default function DocColumn({ u, openRequest }: { u: FormModel; openRequest: DocRowOpenRequest | null }) {
  const { wo, row, scan, done, fields } = u;
  if (row) {
    return (
      <DocRowCard row={row} wo={wo} customers={u.customers} customersLoading={u.customersLoading} hideGramaj={fields.isOther('gramaj') || u.partyGramaj}
        variant="single" onReread={u.okut} openRequest={openRequest} partyPlan={u.partyPlan} />
    );
  }
  return (
    <>
      {!done && (
        <Button mode="contained" icon="file-document-outline" onPress={u.okut} disabled={wo.saving || scan.b.sending || scan.source.busy}
          contentStyle={styles.bigBtn} labelStyle={styles.bigLabel} testID="ie-belge-okut">
          Belgeyi okut
        </Button>
      )}
      <Text style={styles.help}>Kamerayı belgeye tutun; müşteri, parti ve metre kendiliğinden dolar.</Text>
      {(scan.b.pages.length > 0 || scan.b.headerLocked || scan.b.sending) && (
        <ScannerSection b={scan.b} hasRows={false} onAdd={scan.source.add} busy={scan.source.busy} onClassic={scan.openCamera} onRemove={scan.remove} onOpen={scan.setPreviewIndex} />
      )}
      <View style={styles.placeholders} testID="ie-form-belge-yer-tutucu">
        <SectionBand title="Müşteri" icon="account-outline" status={WAITING} dimmed testID="ie-serit-musteri-bos" />
        <SectionBand title="Parti ve metre" icon="pound" status={WAITING} dimmed testID="ie-serit-parti-bos" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  bigBtn: { minHeight: 80 },
  bigLabel: { fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  help: { fontSize: typography.size.base, color: colors.textSecondary },
  placeholders: { gap: spacing.sm, marginTop: spacing.sm },
});
