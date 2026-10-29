// =============================================================================
// H3 sayaç şeridi — GİRİŞ / ÇIKIŞ / FARK + kaynak rengi + bekleyen onay bantları
// =============================================================================
// Yeşil = bağlı sayaç, amber = elle, kırmızı = SİMÜLASYON. Gramaj panelinin ÜSTÜNDE
// durur; telefon dikeyinde hücreler alt alta kırılır (flexWrap).
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text } from 'react-native-paper';
import { colors, radius, spacing } from '../../../theme/tokens';
import { fmtMeters, stripToneOf } from './meterCapture';
import type { MeterAcksState } from './useMeterAcks';
import type { MeterCaptureState, MeterRoll } from './useMeterCapture';

interface Props {
  meter: MeterCaptureState;
  acks: MeterAcksState;
  roll: MeterRoll | null;
  stepId: string | null;
}

const TONE = {
  GREEN: { bg: colors.successContainer, fg: colors.successText, label: 'SAYAÇ' },
  AMBER: { bg: colors.warningContainer, fg: colors.warningText, label: 'ELLE' },
  RED: { bg: colors.dangerContainer, fg: colors.dangerText, label: 'SİMÜLASYON' },
  NONE: { bg: colors.surfaceMuted, fg: colors.textSecondary, label: '' },
} as const;

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.cell}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={[s.cellValue, strong && s.cellStrong]}>{value}</Text>
    </View>
  );
}

function AckBands({ acks }: { acks: MeterAcksState }) {
  return (
    <>
      {acks.pinPendingCount > 0 && (
        <View style={[s.band, s.bandDanger]} testID="metre-pin-bekliyor">
          <Text style={s.bandText}>{`Süpervizör onayı bekliyor (${acks.pinPendingCount})`}</Text>
          <Button mode="contained" compact onPress={acks.openPin} testID="metre-pin-ac">
            PIN GİR
          </Button>
        </View>
      )}
      {acks.officePendingCount > 0 && (
        <View style={[s.band, s.bandWarn]} testID="metre-ofis-bekliyor">
          <Text style={s.bandText}>{`Ofis onayı bekliyor (${acks.officePendingCount}) — makine durmaz`}</Text>
        </View>
      )}
    </>
  );
}

export default function MeterStrip({ meter, acks, roll, stepId }: Props) {
  const last = meter.last;
  const inMeters = meter.inMetersOf(roll);
  const declared = meter.declaredOf(roll);
  const tone = TONE[stripToneOf(last?.source ?? null)];
  return (
    <Surface style={[s.root, { backgroundColor: tone.bg }]} elevation={1} testID="metre-serit">
      <View style={s.row}>
        <Cell label={inMeters != null ? 'GİRİŞ' : 'GİRİŞ (irsaliye)'} value={fmtMeters(inMeters ?? declared)} />
        {meter.inOn && roll && stepId && (
          <Button mode="outlined" compact onPress={() => meter.readIn(roll, stepId)} testID="metre-giris-oku">
            GİRİŞ OKU
          </Button>
        )}
        <Cell label={last ? `ÇIKIŞ · top ${last.barcode ? last.barcode.slice(-4) : '—'}` : 'ÇIKIŞ'} value={fmtMeters(last?.outMeters)} strong />
        <Cell label="FARK" value={last?.diff != null ? fmtMeters(last.diff) : '—'} strong={!!last?.deviated} />
        {!!tone.label && <Text style={[s.tag, { color: tone.fg }]} testID="metre-kaynak">{tone.label}</Text>}
      </View>
      <AckBands acks={acks} />
    </Surface>
  );
}

const s = StyleSheet.create({
  root: { borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg },
  cell: { minWidth: 110 },
  cellLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  cellValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  cellStrong: { color: colors.dangerDark },
  tag: { fontSize: 14, fontWeight: '800', marginLeft: 'auto' },
  band: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md },
  bandDanger: { backgroundColor: colors.dangerContainer },
  bandWarn: { backgroundColor: colors.warningContainer },
  bandText: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
});
