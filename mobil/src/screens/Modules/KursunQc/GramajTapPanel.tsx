// =============================================================================
// Tek dokunuş gramaj paneli (KQ-D5) — yalnız kurşun istasyonu
// =============================================================================
// Eldivenle basılan büyük değer düğmeleri: dokunuş = top bitti. Hedef değer
// ★ + kalın çerçeve; hedef dışı basış ENGELLENMEZ, turuncu vurgu + şerit.
// Son işlem şeridindeki DÜZELT aynı düğmeleri o top için açar.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Surface, Text, TouchableRipple } from 'react-native-paper';
import { colors, palette } from '../../../theme/tokens';
import { lastTapText, type GramajValue } from './gramajTap';
import type { GramajTapState } from './useGramajTap';

interface Props {
  state: GramajTapState;
  /** false → yalnız son işlem şeridi (sırada top yok); düzeltme modunda yine açılır. */
  hasRoll: boolean;
}

function ValueButton({
  v,
  isTarget,
  flash,
  disabled,
  onPress,
}: {
  v: GramajValue;
  isTarget: boolean;
  flash: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableRipple
      testID={`gramaj-tap-${v.code}`}
      accessibilityRole="button"
      accessibilityLabel={isTarget ? `${v.label}, hedef` : v.label}
      borderless
      disabled={disabled}
      onPress={onPress}
      style={[s.btn, isTarget && s.btnTarget, flash && s.btnFlash, disabled && s.btnLocked]}
    >
      <Text style={[s.btnText, flash && s.btnTextFlash]}>{isTarget ? `★ ${v.label}` : v.label}</Text>
    </TouchableRipple>
  );
}

function LastTapStrip({ state }: { state: GramajTapState }) {
  const last = state.last;
  if (!last) return null;
  return (
    <Surface style={s.strip} elevation={1} testID="gramaj-strip">
      <View style={s.stripBody}>
        <Text style={s.stripText}>{lastTapText(last)}</Text>
        {last.queued && (
          <Text style={s.queued} testID="gramaj-kuyrukta">
            kuyrukta
          </Text>
        )}
        {!!state.deviation && (
          <Text style={s.deviation} testID="gramaj-sapma">
            {state.deviation}
          </Text>
        )}
      </View>
      {!state.correcting && (
        <Button
          mode="outlined"
          icon="pencil"
          testID="gramaj-duzelt"
          onPress={state.startCorrect}
          style={s.fixBtn}
          contentStyle={s.fixBtnContent}
          labelStyle={s.fixBtnLabel}
        >
          DÜZELT
        </Button>
      )}
    </Surface>
  );
}

export default function GramajTapPanel({ state, hasRoll }: Props) {
  const showValues = hasRoll || state.correcting;
  const tail = state.last?.barcode ? state.last.barcode.slice(-4) : '—';
  return (
    <View style={s.root}>
      {showValues && (
        <Surface style={s.card} elevation={1}>
          <View style={s.head}>
            <Text style={s.title}>{state.correcting ? `DÜZELT — top ${tail}` : state.title}</Text>
            {!!state.target && (
              <Text style={s.targetChip} testID="gramaj-hedef">{`HEDEF ${state.target.label}`}</Text>
            )}
          </View>
          <Text style={s.hint}>
            {state.correcting ? 'Doğru değere dokunun' : 'Değere dokunun — top tamamlanır, sıradakine geçilir'}
          </Text>
          <View style={s.grid}>
            {state.values.map((v) => (
              <ValueButton
                key={v.code}
                v={v}
                isTarget={state.target?.code === v.code}
                flash={state.flashCode === v.code}
                disabled={state.locked}
                onPress={() => state.tap(v)}
              />
            ))}
          </View>
          <View style={s.actions}>
            {state.correcting ? (
              <Button mode="text" onPress={state.cancelCorrect} contentStyle={s.fixBtnContent}>
                Vazgeç
              </Button>
            ) : (
              state.canSkip && (
                <Button
                  mode="outlined"
                  icon="debug-step-over"
                  testID="gramaj-skip"
                  disabled={state.locked}
                  onPress={state.skip}
                  contentStyle={s.fixBtnContent}
                  labelStyle={s.fixBtnLabel}
                >
                  Kurşunsuz geç
                </Button>
              )
            )}
          </View>
        </Surface>
      )}
      <LastTapStrip state={state} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 12, alignSelf: 'stretch' },
  card: { borderRadius: 12, padding: 16, gap: 10, backgroundColor: colors.surface },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 20, fontWeight: '800', color: palette.slate[900], flexShrink: 1 },
  targetChip: {
    fontSize: 18,
    fontWeight: '800',
    color: palette.emerald[900],
    backgroundColor: palette.emerald[100],
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  hint: { fontSize: 14, color: palette.slate[600] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  btn: {
    minHeight: 96,
    minWidth: 160,
    flexGrow: 1,
    flexBasis: 160,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: palette.emerald[600],
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  btnTarget: { borderWidth: 6, borderColor: palette.emerald[800], backgroundColor: palette.emerald[50] },
  btnFlash: { backgroundColor: palette.amber[500], borderColor: palette.amber[700] },
  btnLocked: { opacity: 0.5 },
  btnText: { fontSize: 32, fontWeight: '800', color: palette.emerald[800] },
  btnTextFlash: { color: palette.amber[900] },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
  strip: {
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.slate[50],
  },
  stripBody: { flex: 1, gap: 4 },
  stripText: { fontSize: 18, fontWeight: '700', color: palette.slate[800] },
  queued: {
    alignSelf: 'flex-start',
    fontSize: 13,
    fontWeight: '700',
    color: palette.amber[900],
    backgroundColor: palette.amber[100],
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  deviation: { fontSize: 16, fontWeight: '700', color: palette.amber[700] },
  fixBtn: { borderColor: palette.slate[400] },
  fixBtnContent: { minHeight: 64, paddingHorizontal: 12 },
  fixBtnLabel: { fontSize: 18, fontWeight: '800' },
});
