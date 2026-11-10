// =============================================================================
// H3 sayaç şeridi — GİRİŞ / ÇIKIŞ / FARK + kaynak rengi + bekleyen onay bantları
// =============================================================================
// Yeşil = bağlı sayaç, amber = elle, kırmızı = SİMÜLASYON. Gramaj panelinin ÜSTÜNDE
// durur; telefon dikeyinde hücreler alt alta kırılır (flexWrap). `fill` (tablet, GK 2026-11-11): şerit sol sütunun boş
// dikey alanını doldurur, rakamlar kritik boyda (32) — cetvel ile alt blok arasında ölü boşluk kalmasın.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { colors, radius, shadow, spacing, typography } from '../../../theme/tokens';
import { fmtMeters, stripToneOf } from './meterCapture';
import type { MeterAcksState } from './useMeterAcks';
import type { MeterCaptureState, MeterRoll } from './useMeterCapture';

interface Props {
  meter: MeterCaptureState;
  acks: MeterAcksState;
  roll: MeterRoll | null;
  stepId: string | null;
  /** Tablet: boş dikey alana yayıl (flexGrow, tavanlı) + büyük rakam. Telefonda verilmez (taşma yok). */
  fill?: boolean;
}

const TONE = {
  GREEN: { bg: colors.successContainer, fg: colors.successText, label: 'SAYAÇ' },
  AMBER: { bg: colors.warningContainer, fg: colors.warningText, label: 'ELLE' },
  RED: { bg: colors.dangerContainer, fg: colors.dangerText, label: 'SİMÜLASYON' },
  NONE: { bg: colors.surfaceMuted, fg: colors.textSecondary, label: '' },
} as const;

function Cell({ label, value, strong, big }: { label: string; value: string; strong?: boolean; big?: boolean }) {
  return (
    <View style={s.cell}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={[s.cellValue, big && s.cellValueBig, strong && s.cellStrong]}>{value}</Text>
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

export default function MeterStrip({ meter, acks, roll, stepId, fill }: Props) {
  const last = meter.last;
  const inMeters = meter.inMetersOf(roll);
  const declared = meter.declaredOf(roll);
  const tone = TONE[stripToneOf(last?.source ?? null)];
  return (
    <View style={[s.root, fill && s.rootFill, { backgroundColor: tone.bg }]} testID="metre-serit">
      <View style={s.row}>
        <Cell label={inMeters != null ? 'GİRİŞ' : 'GİRİŞ (irsaliye)'} value={fmtMeters(inMeters ?? declared)} big={fill} />
        {meter.inOn && roll && stepId && (
          <Button mode="contained" compact onPress={() => meter.readIn(roll, stepId)} testID="metre-giris-oku">
            GİRİŞ OKU
          </Button>
        )}
        <Cell label={last ? `ÇIKIŞ · top ${last.barcode ? last.barcode.slice(-4) : '—'}` : 'ÇIKIŞ'} value={fmtMeters(last?.outMeters)} strong big={fill} />
        <Cell label="FARK" value={last?.diff != null ? fmtMeters(last.diff) : '—'} strong={!!last?.deviated} big={fill} />
        {!!tone.label && <Text style={[s.tag, { color: tone.fg }]} testID="metre-kaynak">{tone.label}</Text>}
      </View>
      <AckBands acks={acks} />
    </View>
  );
}

const s = StyleSheet.create({
  // Paper Surface değil düz View: Surface flexGrow'u dış katmana verip zemini içerikte bırakıyordu.
  root: { borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, ...shadow.sm },
  // Boş alanı doldurur ama sınırsız şişmez; içerik dikeyde ortalı.
  rootFill: { flexGrow: 1, minHeight: 112, maxHeight: 220, justifyContent: 'center' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.lg },
  cell: { flex: 1, minWidth: 110, gap: spacing.xs },
  cellLabel: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.bold, letterSpacing: 0.5 },
  cellValue: { fontSize: typography.size.xxl, fontWeight: typography.weight.bold, color: colors.text, fontVariant: ['tabular-nums'] },
  cellValueBig: { fontSize: typography.size.display },
  cellStrong: { color: colors.dangerDark },
  tag: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, marginLeft: 'auto' },
  band: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md },
  bandDanger: { backgroundColor: colors.dangerContainer },
  bandWarn: { backgroundColor: colors.warningContainer },
  bandText: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1 },
});
