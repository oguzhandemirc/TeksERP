// Hata girişi bloğu: metre gir → hata tipine bas (4 puan modunda ardından boyut).
// Kaydetmez; seçimi InspectionPanel'e verir. Tek yüzey (GK 2026-11-11): birimli metre kutusu + tür düğmeleri aynı satırda,
// aynı yükseklikte; kutu-içinde-kutu yok.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import TruncatedText from '../TruncatedText';
import UnitInput from '../UnitInput';
import { colors, palette, radius, spacing, typography } from '../../theme/tokens';
import type { DefectType } from '../../types/models';
import { SIZE_CLASSES, type InspectionSizeClass } from './inspectionModel';

const RIPPLE = 'rgba(255,255,255,0.25)';

interface InspectionEntryProps {
  defectTypes: DefectType[];
  meterInput: string;
  onMeterChange: (v: string) => void;
  compact: boolean;
  pendingTypeId: string | null;
  onTypePress: (defectTypeId: string) => void;
  onSizePick: (sizeClass: InspectionSizeClass) => void;
  onSizeCancel: () => void;
  /** 4 puan modu: tür ızgarası + boyut şeridi birlikte görünür (seçim değiştirilebilir). */
  sizeClassMode?: boolean;
  /** false: metre alanı numpad'i kendiliğinden almaz (KK1 konağında metraj alanı alır). */
  meterAutoActivate?: boolean;
  meterOptional?: boolean;
}

// Boyut renkleri 1 gri · 2 sarı · 3 turuncu · 4 kırmızı; rakam + aralık da yazılır.
const SIZE_TONE: Record<InspectionSizeClass, { bg: string; fg: string }> = {
  S1: { bg: palette.slate[400], fg: palette.white },
  S2: { bg: palette.amber[300], fg: palette.amber[900] },
  S3: { bg: palette.amber[600], fg: palette.white },
  S4: { bg: palette.red[600], fg: palette.white },
};

function SizeStrip({ title, active, onPick, onCancel }: { title: string | null; active: boolean; onPick: (s: InspectionSizeClass) => void; onCancel: () => void }) {
  return (
    <View style={[styles.sizeBlock, active && styles.sizeBlockActive]} testID="inspection-size-strip">
      <TruncatedText style={styles.sizeTitle}>{active && title ? [title, ' — boyut?'] : ['BOYUT — önce hata türüne dokun']}</TruncatedText>
      <View style={styles.grid}>
        {SIZE_CLASSES.map((s) => (
          <TouchableRipple
            key={s.code}
            testID={`inspection-size-${s.code}`}
            disabled={!active}
            onPress={() => onPick(s.code)}
            rippleColor={RIPPLE}
            style={[styles.btn, styles.sizeBtn, { backgroundColor: SIZE_TONE[s.code].bg }, !active && styles.dim]}
          >
            <View style={styles.sizeInner}>
              <Text style={[styles.sizeNum, { color: SIZE_TONE[s.code].fg }]}>{s.label}</Text>
              <Text style={[styles.sizeRange, { color: SIZE_TONE[s.code].fg }]}>{s.range}</Text>
            </View>
          </TouchableRipple>
        ))}
        {active && (
          <TouchableRipple onPress={onCancel} style={[styles.btn, styles.sizeBtn, styles.sizeCancel]}>
            <Text style={[styles.btnText, styles.sizeCancelText]}>Vazgeç</Text>
          </TouchableRipple>
        )}
      </View>
    </View>
  );
}

interface TypeGridProps {
  defectTypes: DefectType[];
  onTypePress: (id: string) => void;
  selectedId?: string | null;
  large?: boolean;
  /** Metre kutusu ızgaranın İLK hücresi — düğmelerle aynı satır ve yükseklik. */
  lead?: React.ReactNode;
}

function TypeGrid({ defectTypes, onTypePress, selectedId, large, lead }: TypeGridProps) {
  return (
    <View style={styles.grid} testID="inspection-type-grid">
      {lead}
      {defectTypes.map((dt) => (
        <TouchableRipple
          key={dt.id}
          testID={`inspection-type-${dt.id}`}
          onPress={() => onTypePress(dt.id)}
          rippleColor={RIPPLE}
          style={[styles.btn, selectedId === dt.id && styles.btnSelected]}
        >
          <TruncatedText style={[styles.btnText, large && styles.btnTextLarge]}>
            {large && dt.fixedPoints != null ? [dt.name, ` ·${dt.fixedPoints}p`] : [dt.name]}
          </TruncatedText>
        </TouchableRipple>
      ))}
    </View>
  );
}

export default function InspectionEntry(p: InspectionEntryProps) {
  const pendingTitle = p.defectTypes.find((d) => d.id === p.pendingTypeId)?.name ?? null;
  // autoActivate (varsayılan): kutuya dokunmadan tuş takımı doğrudan buraya yazar.
  const meter = (
    <UnitInput
      value={p.meterInput}
      onChange={p.onMeterChange}
      unit="m"
      unitName="metre"
      label="Hata metresi"
      placeholder={p.meterOptional ? 'İsteğe bağlı' : 'Hata metresi'}
      autoActivate={p.meterAutoActivate ?? true}
      useNativeKeyboard={p.compact}
      style={[styles.meterBox, p.compact && styles.meterBoxCompact]}
      testID="inspection-meter"
    />
  );
  let body: React.ReactNode;
  if (p.defectTypes.length === 0) {
    body = (
      <>
        {meter}
        <Text style={styles.muted}>Hata tipi tanımlı değil — admin'den ekleyin</Text>
      </>
    );
  } else if (p.sizeClassMode) {
    body = (
      <>
        <TypeGrid defectTypes={p.defectTypes} onTypePress={p.onTypePress} selectedId={p.pendingTypeId} large lead={meter} />
        <SizeStrip title={pendingTitle} active={!!p.pendingTypeId} onPick={p.onSizePick} onCancel={p.onSizeCancel} />
      </>
    );
  } else {
    body = <TypeGrid defectTypes={p.defectTypes} onTypePress={p.onTypePress} lead={meter} />;
  }
  return (
    <View style={styles.section} testID="inspection-entry">
      {body}
    </View>
  );
}

const BTN_HEIGHT = 64;

const styles = StyleSheet.create({
  // Tek sakin yüzey: kutu ve düğmeler aynı zeminde; çerçeve/gölge yok.
  section: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  muted: { fontSize: typography.size.xs, color: colors.textMuted },
  // Metre kutusu düğmelerle aynı yükseklikte; telefonda satırı tek başına doldurur.
  meterBox: { minHeight: BTN_HEIGHT, flexGrow: 0, flexBasis: 200, minWidth: 180 },
  meterBoxCompact: { flexBasis: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // Hata tipi = ANA TUŞ (≥64 dp, eldivenle basılır); satırı tam doldurur.
  btn: {
    backgroundColor: palette.amber[600],
    borderRadius: radius.md,
    minHeight: BTN_HEIGHT,
    flexGrow: 1,
    flexBasis: 124,
    minWidth: 124,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  btnText: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: palette.white },
  btnSelected: { backgroundColor: palette.amber[900] },
  btnTextLarge: { fontSize: typography.size.xl },
  sizeBlock: { gap: spacing.sm, borderRadius: radius.md, padding: spacing.xs },
  sizeBlockActive: { backgroundColor: palette.amber[100] },
  sizeBtn: { flexBasis: 96, minWidth: 96 },
  sizeInner: { alignItems: 'center' },
  sizeNum: { fontSize: typography.size.xxl, fontWeight: typography.weight.bold },
  sizeRange: { fontSize: typography.size.sm, fontWeight: typography.weight.bold },
  dim: { opacity: 0.45 },
  sizeTitle: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: palette.amber[900] },
  sizeCancel: { backgroundColor: palette.slate[600] },
  sizeCancelText: { color: palette.white },
});
