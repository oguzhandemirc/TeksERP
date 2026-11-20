// Çizim tuvali — ekran görüntüsü + SVG katmanı + tek parmak jesti (RN `PanResponder`; bu pakette gesture-handler yok).
// Durum saf `destek/cizim.ts`te; burada yalnız dokunma → eylem çevirisi ve çizim. Kap `collapsable={false}`: view-shot
// `captureRef` bu kabı yakalar (görüntü + çizim tek JPEG). Karartma kutusu TAM örtüdür (saydam değil).
import { useMemo, useRef, type RefObject } from "react";
import { Image, PanResponder, StyleSheet, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { dikdortgen, kalemYolu, okYolu, type CizimAraci, type CizimEylemi, type CizimRengi, type Sekil } from "../../destek/cizim";
import { CIZIM_PALETI } from "../tokens";

export const CIZIM_RENKLERI: Readonly<Record<CizimRengi, string>> = { kirmizi: CIZIM_PALETI.kirmizi, sari: CIZIM_PALETI.sari, yesil: CIZIM_PALETI.yesil, mavi: CIZIM_PALETI.mavi };
export const RENK_ADI: Readonly<Record<CizimRengi, string>> = { kirmizi: "Kırmızı", sari: "Sarı", yesil: "Yeşil", mavi: "Mavi" };
const KARARTMA = CIZIM_PALETI.karartma;
const KALINLIK = 5;

function SekilCiz({ s }: { readonly s: Sekil }) {
  const renk = CIZIM_RENKLERI[s.renk];
  const [a, b] = s.noktalar;
  if (s.arac === "kalem") return <Path d={kalemYolu(s.noktalar)} stroke={renk} strokeWidth={KALINLIK} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
  if (!a || !b) return null;
  if (s.arac === "ok") return <Path d={okYolu(a, b)} stroke={renk} strokeWidth={KALINLIK} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
  const r = dikdortgen(a, b);
  if (s.arac === "karart") return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill={KARARTMA} />;
  return <Rect x={r.x} y={r.y} width={r.w} height={r.h} stroke={renk} strokeWidth={KALINLIK} fill="none" />;
}

export interface CizimTuvaliProps {
  readonly tuvalRef: RefObject<View | null>;
  readonly goruntuUri: string;
  readonly boyut: { readonly width: number; readonly height: number };
  readonly sekiller: readonly Sekil[];
  readonly aktif: Sekil | null;
  readonly arac: CizimAraci;
  readonly renk: CizimRengi;
  readonly dispatch: (e: CizimEylemi) => void;
}

export function CizimTuvali(p: CizimTuvaliProps) {
  // Jest bir kez kurulur; güncel araç/renk ref'ten okunur (jest ortasında yeniden kurulmasın).
  const guncel = useRef({ arac: p.arac, renk: p.renk, dispatch: p.dispatch });
  guncel.current = { arac: p.arac, renk: p.renk, dispatch: p.dispatch };
  const jest = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          const g = guncel.current;
          g.dispatch({ tip: "basla", arac: g.arac, renk: g.renk, nokta: { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY } });
        },
        onPanResponderMove: (e) => guncel.current.dispatch({ tip: "ilerle", nokta: { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY } }),
        onPanResponderRelease: () => guncel.current.dispatch({ tip: "bitir" }),
        onPanResponderTerminate: () => guncel.current.dispatch({ tip: "bitir" }),
      }),
    [],
  );
  return (
    <View ref={p.tuvalRef} collapsable={false} style={[s.tuval, p.boyut]} testID="cizim-tuvali" {...jest.panHandlers}>
      <Image source={{ uri: p.goruntuUri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
      {/* SVG dokunmayı yutmasın: olaylar kaptaki jeste gider ve `locationX/Y` kaba göredir. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={p.boyut.width} height={p.boyut.height}>
          {p.sekiller.map((x) => <SekilCiz key={x.id} s={x} />)}
          {p.aktif ? <SekilCiz s={p.aktif} /> : null}
        </Svg>
      </View>
    </View>
  );
}

const s = StyleSheet.create({ tuval: { overflow: "hidden", backgroundColor: CIZIM_PALETI.tuvalZemini } });
