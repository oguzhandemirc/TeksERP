// Çizim tuvali — ekran görüntüsü + SVG katmanı + parmak jesti.
// Durum saf `cizim.ts`te; burada yalnız dokunma → eylem çevirisi ve çizim.
// Tuval kabı `collapsable={false}`: view-shot `captureRef` bu kabı yakalar
// (görüntü + çizim tek JPEG olur).
import React, { useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path, Rect } from 'react-native-svg';

import { palette } from '../../theme';
import {
  dikdortgen,
  kalemYolu,
  okYolu,
  type CizimAraci,
  type CizimEylemi,
  type CizimRengi,
  type Sekil,
} from './cizim';

export const CIZIM_RENKLERI: Record<CizimRengi, string> = {
  kirmizi: palette.red[600],
  sari: palette.amber[500],
  yesil: palette.emerald[600],
  mavi: palette.blue[600],
};

const KALINLIK = 5;

function SekilCiz({ s }: { s: Sekil }) {
  const renk = CIZIM_RENKLERI[s.renk];
  const [a, b] = s.noktalar;
  if (s.arac === 'kalem') {
    return (
      <Path
        d={kalemYolu(s.noktalar)}
        stroke={renk}
        strokeWidth={KALINLIK}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    );
  }
  if (!a || !b) return null;
  if (s.arac === 'ok') {
    return (
      <Path d={okYolu(a, b)} stroke={renk} strokeWidth={KALINLIK} strokeLinecap="round" fill="none" />
    );
  }
  const r = dikdortgen(a, b);
  if (s.arac === 'karart') {
    // Hassas veri: TAM örtü (saydam değil) — görüntüden geri okunamaz.
    return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill={palette.black} />;
  }
  return (
    <Rect x={r.x} y={r.y} width={r.w} height={r.h} stroke={renk} strokeWidth={KALINLIK} fill="none" />
  );
}

export interface CizimTuvaliProps {
  tuvalRef: React.RefObject<View | null>;
  goruntuUri: string;
  boyut: { width: number; height: number };
  sekiller: readonly Sekil[];
  aktif: Sekil | null;
  arac: CizimAraci;
  renk: CizimRengi;
  dispatch: (e: CizimEylemi) => void;
}

export default function CizimTuvali(p: CizimTuvaliProps) {
  const { arac, renk, dispatch } = p;
  const jest = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .maxPointers(1)
        .onBegin((e) => dispatch({ tip: 'basla', arac, renk, nokta: { x: e.x, y: e.y } }))
        .onUpdate((e) => dispatch({ tip: 'ilerle', nokta: { x: e.x, y: e.y } }))
        .onFinalize(() => dispatch({ tip: 'bitir' })),
    [arac, renk, dispatch],
  );
  return (
    <GestureDetector gesture={jest}>
      <View ref={p.tuvalRef} collapsable={false} style={[styles.tuval, p.boyut]}>
        <Image source={{ uri: p.goruntuUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
        <Svg style={StyleSheet.absoluteFill} width={p.boyut.width} height={p.boyut.height}>
          {p.sekiller.map((s) => (
            <SekilCiz key={s.id} s={s} />
          ))}
          {p.aktif ? <SekilCiz s={p.aktif} /> : null}
        </Svg>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  tuval: { overflow: 'hidden', backgroundColor: palette.slate[200] },
});
