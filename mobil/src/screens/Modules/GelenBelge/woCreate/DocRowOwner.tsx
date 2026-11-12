// Belge satırının "Müşteri" bölümü: toplu listede şerit (✓ seçildi / ! kontrol et / ● seçin) + seçici düğmesi, tek formda yalnız düğme; belgede geçen ad için
// soru çipi ve "yeni müşteri kaydet" önerisi (gk-musteri-modal sözleşmesi) yerinde kalır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Chip } from 'react-native-paper';
import { SectionBand } from '../../../../components/form/SectionBand';
import { SelectButton, type SelectButtonState } from '../../../../components/form/SelectButton';
import type { BandTone } from '../../../../components/form/tone';
import type { PickerOption } from '../../../../components/PickerModal';
import type { useReadResult } from '../useReadResult';
import CustomerFromDocOffer from './CustomerFromDocSheet';
import type { DocRow, WoRowsState } from './useWoRows';

interface Props {
  row: DocRow;
  wo: WoRowsState;
  read: ReturnType<typeof useReadResult>;
  customers: readonly PickerOption[];
  locked: boolean;
  single: boolean;
  onPick: () => void;
}

const STATUS: Record<'ok' | 'warn' | 'missing', { icon: 'check' | 'alert-outline' | 'alert-circle-outline'; text: string }> = {
  ok: { icon: 'check', text: 'Seçildi' },
  warn: { icon: 'alert-outline', text: 'Kontrol et' },
  missing: { icon: 'alert-circle-outline', text: 'Seçin' },
};

export default function DocRowOwner({ row, wo, read, customers, locked, single, onPick }: Props) {
  const f = row.form!;
  const no = row.noteNo;
  const unmatched = !f.ownerCustomerId && read.watch?.phase === 'done' ? read.watch.summary.ownerUnmatched ?? null : null;
  const askPending = !!f.ownerAsk && f.ownerCustomerId !== f.ownerAsk.customerId;
  const tone: BandTone = askPending || unmatched ? 'warn' : f.ownerCustomerId ? 'ok' : 'missing';
  const fromDoc = !!(f.ownerSuggested && f.ownerCustomerId);
  const state: SelectButtonState = tone === 'warn' ? 'review' : tone === 'missing' ? 'missing' : fromDoc ? 'fromDoc' : 'normal';
  const name = f.ownerCustomerId ? customers.find((o) => o.value === f.ownerCustomerId)?.label ?? f.ownerSuggested ?? 'Seçili müşteri' : null;
  return (
    <>
      {/* Tek formda şerit yok: durum (eksik kırmızı / kontrol sarı / belgeden) seçici düğmesinin çerçevesinde. */}
      {!single && <SectionBand title="Müşteri" icon="account-outline" tone={tone} status={STATUS[tone as keyof typeof STATUS]} testID={`belge-serit-musteri-${no}`} />}
      <View testID={fromDoc ? `belgeden-musteri-${no}` : undefined}>
        <SelectButton label="Müşteri seç" caption="Müşteri" value={name} state={state} onPress={onPick} disabled={locked} testID={`belge-satir-musteri-${no}`} />
      </View>
      {f.ownerAsk && askPending && (
        <Chip icon="help-circle-outline" onPress={() => wo.updateForm(row.noteId, { ownerCustomerId: f.ownerAsk!.customerId, ownerSuggested: f.ownerAsk!.name })}
          disabled={locked} style={styles.chip} testID={`belge-satir-sahip-sor-${no}`}>
          {`Belgede “${f.ownerAsk.matchedText}” geçiyor — ${f.ownerAsk.name} mi? Seç`}
        </Chip>
      )}
      {unmatched && (
        <CustomerFromDocOffer noteId={row.noteId} noteNo={no} unmatched={unmatched} disabled={locked}
          onPicked={(id) => wo.updateForm(row.noteId, { ownerCustomerId: id, ownerSuggested: null })} onPickFromList={onPick} />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 56, justifyContent: 'center' },
});
