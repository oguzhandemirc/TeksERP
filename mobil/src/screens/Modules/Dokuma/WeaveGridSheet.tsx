// =============================================================================
// ARMÜR PLANI — mini görsel (dokununca tam ekran pencere), salt-okunur
// =============================================================================
// Tezgâh ekranı gibi 1. atkı EN ALTTA (varsayılan); pencerede tek düğmeyle çevrilir. Satır boyu
// ekrana sığdırılır; çok satırda (512) gövde dikey kayar. Çimdik yakınlaştırma yok.
// Sunucu armür göndermiyorsa (eski sunucu / armürsüz desen) hiçbir şey çizilmez.
// =============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Text, TouchableRipple } from 'react-native-paper';
import ModuleSheet, { moduleSheetWidth } from '../../../components/ModuleSheet';
import WeaveGrid from '../../../components/weave/WeaveGrid';
import { fitCell, hasLiftPlan, weaveGridShape, type GridDirection } from '../../../components/weave/weaveLayout';
import { WEAVE_COLORS, yarnColor } from '../../../components/weave/weavePalette';
import type { RunConstruction } from '../../../services/machineRun.service';
import { colors, radius, spacing, typography } from '../../../theme';

export const MINI_MAX_ROWS = 24;
const MINI_CELL = 6;

/** Görsel çizilecek mi? Alan yoksa (eski sunucu) false. */
export function canShowWeave(c: RunConstruction | null | undefined): boolean {
  return hasLiftPlan(c?.design?.liftPlan);
}

function gridInput(c: RunConstruction) {
  return {
    liftPlan: c.design?.liftPlan ?? null,
    lenoFrames: c.design?.lenoFrames ?? [],
    selvedgeFrames: c.design?.selvedgeFrames ?? [],
    pickSequence: c.weft?.pickSequence ?? null,
    yarnCount: c.weft?.yarns.length ?? 0,
  };
}

export function WeaveMini({ c }: { c: RunConstruction }) {
  const [open, setOpen] = useState(false);
  if (!canShowWeave(c)) return null;
  const input = gridInput(c);
  const shape = weaveGridShape(input);
  const cut = shape.rows > MINI_MAX_ROWS;
  return (
    <>
      <TouchableRipple
        onPress={() => setOpen(true)}
        style={styles.mini}
        borderless={false}
        testID="weave-mini"
        accessibilityRole="button"
        accessibilityLabel="Desen örgüsünü büyüt"
      >
        <View style={styles.miniRow}>
          <WeaveGrid {...input} cell={MINI_CELL} maxRows={MINI_MAX_ROWS} />
          <View style={styles.miniText}>
            <Text style={styles.miniTitle}>Desen örgüsü</Text>
            <Text style={styles.miniSub}>{`${shape.rows} atkı · ${shape.frames} çerçeve${cut ? ` (ilk ${MINI_MAX_ROWS} atkı)` : ''}`}</Text>
            <Text style={styles.miniHint}>Büyütmek için dokunun</Text>
          </View>
        </View>
      </TouchableRipple>
      <WeaveGridSheet c={c} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default function WeaveGridSheet({ c, visible, onClose }: { c: RunConstruction; visible: boolean; onClose: () => void }) {
  const [direction, setDirection] = useState<GridDirection>('bottom-up');
  const { width, height } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const input = gridInput(c);
  const shape = weaveGridShape(input);
  // Kart genişliği − iç boşluk − etiket şeridi; yükseklik: %88 tavan − başlık/lejant/alt çubuk.
  const cell = fitCell(shape, { width: moduleSheetWidth(width, 'xl') - 2 * spacing.lg - 40, height: Math.round(height * 0.88) - 250 });
  const lenoCount = (c.design?.lenoFrames ?? []).length;
  const selvedgeCount = (c.design?.selvedgeFrames ?? []).length;
  const yarns = c.weft?.yarns ?? [];

  // Alttan yukarı kipte 1. atkı en altta: kayan gövde açılışta sona gider.
  useEffect(() => {
    if (!visible || direction !== 'bottom-up') return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(t);
  }, [visible, direction]);

  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onClose}
      size="xl"
      scrollRef={scrollRef}
      title={`Desen örgüsü${c.design ? ` · ${c.design.code}` : ''}`}
      subtitle={[c.design?.loomFileName ? `Dosya ${c.design.loomFileName}` : null, `${shape.rows} atkı · ${shape.frames} çerçeve`, direction === 'bottom-up' ? '1. atkı en altta (tezgâh ekranı gibi)' : '1. atkı en üstte (kâğıt gibi)'].filter(Boolean).join(' · ')}
      header={
        <View style={styles.legend} testID="weave-legend">
          <Legend color={WEAVE_COLORS.lift} label="Dolu kare = çerçeve kalkık" />
          {lenoCount > 0 ? <Legend color={WEAVE_COLORS.leno} label="Döner çerçeve" /> : null}
          {selvedgeCount > 0 ? <Legend color={WEAVE_COLORS.selvedge} label="Kenar çerçevesi" /> : null}
          {shape.selCount > 0 ? yarns.map((y, i) => <Legend key={y.letter} color={yarnColor(i + 1)} label={`${y.letter}: ${y.yarnCode}`} />) : null}
        </View>
      }
      footer={
        <View style={styles.footer}>
          <Button
            mode="outlined"
            icon="swap-vertical"
            onPress={() => setDirection((d) => (d === 'bottom-up' ? 'top-down' : 'bottom-up'))}
            contentStyle={styles.btn}
            testID="weave-direction"
          >
            {direction === 'bottom-up' ? '1. atkı üstte göster' : '1. atkı altta göster'}
          </Button>
          <Button mode="contained" onPress={onClose} contentStyle={styles.btn} testID="weave-sheet-close">Kapat</Button>
        </View>
      }
    >
      <ScrollView horizontal contentContainerStyle={styles.gridWrap}>
        <WeaveGrid {...input} cell={cell} direction={direction} labels testID="weave-full" />
      </ScrollView>
    </ModuleSheet>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mini: { marginTop: spacing.xs, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignSelf: 'flex-start', minHeight: 56 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  miniText: { gap: 2 },
  miniTitle: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  miniSub: { fontSize: typography.size.sm, color: colors.textSecondary },
  miniHint: { fontSize: typography.size.sm, color: colors.brand, fontWeight: typography.weight.medium },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 14, height: 14, borderRadius: 2 },
  legendText: { fontSize: typography.size.sm, color: colors.textSecondary },
  gridWrap: { paddingVertical: spacing.sm, flexGrow: 1, justifyContent: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, flexWrap: 'wrap' },
  btn: { minHeight: 56, paddingHorizontal: spacing.lg },
});
