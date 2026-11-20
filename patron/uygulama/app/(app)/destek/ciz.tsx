// Ekran görüntüsü üzerine çizim: kalem · ok · dikdörtgen · karartma (hassas veriyi örter), 4 renk, geri al / temizle.
// "Bitti" → tuval (görüntü + çizim) view-shot ile JPEG (uzun kenar ≤ 1920 px) → taslağa; çizim yoksa ham görüntü kalır.
// Kaydırma kabı YOK (`Screen` kullanılmaz): parmak hareketi kaydırmaya değil çizime gider.
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { useCallback, useReducer, useRef, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cizimReducer, sigdir, uzunKenaraSigdir, type CizimAraci, type CizimRengi } from "../../../src/destek/cizim";
import { cizimiKaydet, taslakAl, useDestekTaslagi } from "../../../src/destek/taslak";
import { JPEG_KALITE, viewShot } from "../../../src/destek/yakala";
import { CIZIM_RENKLERI, CizimTuvali, RENK_ADI } from "../../../src/ui/destek/CizimTuvali";
import type { IconName } from "../../../src/ui/icons";
import { Banner, Button } from "../../../src/ui/kit";
import { makeStyles, useTokens } from "../../../src/ui/theme-context";
import { TOUCH, space, typography, radius } from "../../../src/ui/tokens";

const ARACLAR: readonly { key: CizimAraci; ad: string; icon: IconName }[] = [
  { key: "kalem", ad: "Kalem", icon: "pencil" },
  { key: "ok", ad: "Ok", icon: "arrow-forward" },
  { key: "kutu", ad: "Çerçeve", icon: "square-outline" },
  { key: "karart", ad: "Karart", icon: "eye-off" },
];
const RENKLER: readonly CizimRengi[] = ["kirmizi", "sari", "yesil", "mavi"];

export default function DestekCizim() {
  const router = useRouter();
  const t = useTokens();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { ekran } = useDestekTaslagi();
  const [durum, dispatch] = useReducer(cizimReducer, taslakAl().cizim);
  const [arac, setArac] = useState<CizimAraci>("kalem");
  const [renk, setRenk] = useState<CizimRengi>("kirmizi");
  const [alan, setAlan] = useState({ width: 0, height: 0 });
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const tuvalRef = useRef<View | null>(null);
  const geri = () => (router.canGoBack() ? router.back() : router.replace("/destek/yeni" as never));
  const onAlan = useCallback((e: LayoutChangeEvent) => setAlan({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }), []);
  const boyut = ekran ? sigdir(ekran.width, ekran.height, alan.width, alan.height) : { width: 0, height: 0 };

  const bitti = async () => {
    if (!ekran || kaydediliyor) return;
    if (durum.sekiller.length === 0) {
      cizimiKaydet(durum, null);
      geri();
      return;
    }
    const vs = viewShot();
    if (!vs) {
      setHata("Çizim bu cihazda kaydedilemiyor; görüntü çizimsiz gönderilecek");
      return;
    }
    setKaydediliyor(true);
    setHata(null);
    try {
      const cikti = uzunKenaraSigdir(ekran.width, ekran.height);
      const base64 = await vs.captureRef(tuvalRef, { format: "jpg", quality: JPEG_KALITE, result: "base64", width: cikti.width, height: cikti.height });
      cizimiKaydet(durum, { base64, onizlemeUri: `data:image/jpeg;base64,${base64}` });
      geri();
    } catch {
      setHata("Çizim kaydedilemedi. Tekrar deneyin ya da çizimsiz devam edin");
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <View style={[s.ekran, { paddingTop: insets.top, paddingBottom: insets.bottom }]} testID="destek-cizim">
      <View style={s.ust}>
        <Pressable onPress={geri} accessibilityRole="button" hitSlop={8} style={s.metinDugme} testID="cizim-vazgec">
          <Text style={s.vazgec}>Vazgeç</Text>
        </Pressable>
        <Text style={s.baslik} accessibilityRole="header">Üzerine çiz</Text>
        <View style={s.bitti}><Button label="Bitti" onPress={() => void bitti()} busy={kaydediliyor} testID="cizim-bitti" /></View>
      </View>
      {hata ? <View style={s.hata}><Banner tone="error" text={hata} testID="cizim-hata" /></View> : null}
      <View style={s.alan} onLayout={onAlan}>
        {ekran && boyut.width > 0 ? (
          <CizimTuvali tuvalRef={tuvalRef} goruntuUri={ekran.uri} boyut={boyut} sekiller={durum.sekiller} aktif={durum.aktif} arac={arac} renk={renk} dispatch={dispatch} />
        ) : !ekran ? (
          <Text style={s.bos}>Ekran görüntüsü yok</Text>
        ) : null}
      </View>
      <View style={s.arac}>
        <View style={s.satir} accessibilityRole="radiogroup" accessibilityLabel="Araç">
          {ARACLAR.map((a) => {
            const on = a.key === arac;
            return (
              <Pressable key={a.key} onPress={() => setArac(a.key)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={a.ad} style={[s.aracDugme, on && { backgroundColor: t.tintContainer }]} testID={`cizim-arac-${a.key}`}>
                <Ionicons name={a.icon} size={20} color={on ? t.tint : t.text} />
                <Text style={[s.aracAd, { color: on ? t.tint : t.textSecondary }]}>{a.ad}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={s.satir}>
          <View style={s.renkler} accessibilityRole="radiogroup" accessibilityLabel="Renk">
            {RENKLER.map((r) => {
              const on = r === renk;
              return (
                <Pressable key={r} onPress={() => setRenk(r)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={RENK_ADI[r]} hitSlop={6} style={[s.renk, { backgroundColor: CIZIM_RENKLERI[r] }, on && { borderColor: t.text }]} testID={`cizim-renk-${r}`} />
              );
            })}
          </View>
          <Pressable onPress={() => dispatch({ tip: "geriAl" })} disabled={durum.sekiller.length === 0} accessibilityRole="button" accessibilityLabel="Geri al" style={s.ikonDugme} testID="cizim-geri-al">
            <Ionicons name="arrow-undo" size={22} color={durum.sekiller.length === 0 ? t.textSecondary : t.text} />
          </Pressable>
          <Pressable onPress={() => dispatch({ tip: "temizle" })} disabled={durum.sekiller.length === 0} accessibilityRole="button" accessibilityLabel="Temizle" style={s.ikonDugme} testID="cizim-temizle">
            <Ionicons name="trash-outline" size={22} color={durum.sekiller.length === 0 ? t.textSecondary : t.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  ekran: { flex: 1, backgroundColor: t.surface },
  ust: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: space.l, paddingVertical: space.s, gap: space.s },
  metinDugme: { minHeight: TOUCH, justifyContent: "center" as const },
  vazgec: { ...typography.body, color: t.tint },
  baslik: { ...typography.headline, color: t.text },
  bitti: { minWidth: 96 },
  hata: { paddingHorizontal: space.l },
  alan: { flex: 1, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: t.bg, margin: space.s },
  bos: { ...typography.body, color: t.textSecondary },
  arac: { paddingHorizontal: space.l, paddingTop: space.s, gap: space.s, borderTopWidth: 1, borderTopColor: t.separator },
  satir: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  aracDugme: { flex: 1, minHeight: TOUCH, alignItems: "center" as const, justifyContent: "center" as const, borderRadius: radius.control, gap: 2 },
  aracAd: { ...typography.caption },
  renkler: { flex: 1, flexDirection: "row" as const, gap: space.m },
  renk: { width: 32, height: 32, borderRadius: 16, borderWidth: 3, borderColor: "transparent" },
  ikonDugme: { width: TOUCH, height: TOUCH, alignItems: "center" as const, justifyContent: "center" as const },
}));
