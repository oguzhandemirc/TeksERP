// Yeni destek talebi: tür (Hata · Soru · İstek) · konu · mesaj; "Sorun bildir"den gelindiyse ekran görüntüsü önizlemesi
// (üzerine çiz / kaldır). Bağlam otomatik (ekran, sürüm + yapı, platform, cihaz) — kullanıcıya sorulmaz, sır içermez.
// Formun başında gönderen hesap (ad + kullanıcı adı) görünür (App Store koşulu). clientToken form açılınca BİR KEZ
// üretilir; çift dokunuş ikinci istek atmaz (kilit); ağ/5xx/429 hatasında form
// KAPANMAZ ve aynı token'la yeniden denenir (bulut aynı talebi döner). Başarıda talep ayrıntısına geçilir.
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import type { DestekTur } from "../../../src/api/destek-wire";
import { destekBaglami } from "../../../src/destek/baglam";
import { cihazBilgisi } from "../../../src/destek/cihaz";
import { formuDogrula, hataSonrasiToken, hataYokMu, KONU_AZAMI, MESAJ_AZAMI, talepGovdesi, yeniToken, type FormHatalari } from "../../../src/destek/form";
import { destekHatasiniIsle, destekRozetiniTazele } from "../../../src/destek/gorunurluk";
import { AYDINLATMA, destekHataMetni, TUR_ETIKET, TUR_SIRASI } from "../../../src/destek/metin";
import { ekraniKaldir, gonderilecekGoruntu, taslagiTemizle, useDestekTaslagi } from "../../../src/destek/taslak";
import { useSession } from "../../../src/state/session";
import { Screen } from "../../../src/ui/Frame";
import { haptic } from "../../../src/ui/haptics";
import { Banner, Button, Field } from "../../../src/ui/kit";
import { AlanEtiketi, FormKarti, SecimCipi } from "../../../src/ui/destek/parcalar";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography, radius } from "../../../src/ui/tokens";

export default function YeniDestekTalebi() {
  const { api, facility } = useSession();
  const gonderen = facility?.hesap ? `${facility.hesap.ad} (${facility.hesap.eposta})` : null;
  const router = useRouter();
  const s = useStyles();
  const taslak = useDestekTaslagi();
  const [tur, setTur] = useState<DestekTur | null>("BUG");
  const [konu, setKonu] = useState("");
  const [mesaj, setMesaj] = useState("");
  const [hatalar, setHatalar] = useState<FormHatalari>({});
  const [gonderHatasi, setGonderHatasi] = useState<string | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  // Mantıksal deneme kimliği: form açılınca bir kez; yalnız kesin hatadan sonra yenilenir.
  const token = useRef<string>("");
  if (token.current === "") token.current = yeniToken();
  const kilit = useRef(false);
  const goruntu = taslak.sonuc?.onizlemeUri ?? taslak.ekran?.uri ?? null;

  const gonder = async () => {
    if (kilit.current) return;
    const form = { tur, konu, mesaj };
    const h = formuDogrula(form);
    setHatalar(h);
    if (!hataYokMu(h)) return;
    kilit.current = true;
    setGonderiliyor(true);
    setGonderHatasi(null);
    try {
      const c = cihazBilgisi();
      const govde = talepGovdesi({
        form,
        clientToken: token.current,
        baglam: destekBaglami({ ekranAdi: taslak.ekranAdi, yol: taslak.yol, ...c }),
        ekranJpegBase64: gonderilecekGoruntu(taslak),
      });
      const talep = await api.supportCreate(govde);
      haptic("success");
      taslagiTemizle();
      void destekRozetiniTazele(api);
      router.replace({ pathname: "/destek/[id]", params: { id: talep.id } } as never);
    } catch (e) {
      destekHatasiniIsle(e);
      token.current = hataSonrasiToken(token.current, e);
      setGonderHatasi(destekHataMetni(e));
      haptic("error");
    } finally {
      kilit.current = false;
      setGonderiliyor(false);
    }
  };

  return (
    <Screen title="Sorun bildir" back>
      <FormKarti testID="destek-form">
        {gonderen ? <Text style={s.gonderen} testID="destek-gonderen">Gönderen: {gonderen}</Text> : null}
        <AlanEtiketi>Talep türü</AlanEtiketi>
        <View style={s.cipler} accessibilityRole="radiogroup">
          {TUR_SIRASI.map((k) => <SecimCipi key={k} label={TUR_ETIKET[k]} on={tur === k} rol="radio" onPress={() => setTur(k)} testID={`destek-tur-${k}`} />)}
        </View>
        {hatalar.tur ? <Text style={s.hata}>{hatalar.tur}</Text> : null}
        <Field label="Konu" value={konu} onChangeText={setKonu} maxLength={KONU_AZAMI} placeholder="Kısaca ne oldu?" error={hatalar.konu} testID="destek-konu" />
        <Field label="Mesaj" value={mesaj} onChangeText={setMesaj} maxLength={MESAJ_AZAMI} multiline placeholder="Ne yapıyordunuz, ne bekliyordunuz, ne oldu?" error={hatalar.mesaj} style={s.mesaj} testID="destek-mesaj" />
        {goruntu ? (
          <View style={s.goruntuKutusu} testID="destek-goruntu">
            <AlanEtiketi>Ekran görüntüsü</AlanEtiketi>
            <Image source={{ uri: goruntu }} style={[s.goruntu, taslak.ekran ? { aspectRatio: taslak.ekran.width / taslak.ekran.height } : null]} resizeMode="contain" accessibilityLabel="Eklenecek ekran görüntüsü" />
            <View style={s.dugmeler}>
              <View style={s.esnek}><Button label={taslak.sonuc ? "Çizimi düzenle" : "Üzerine çiz"} icon="brush-outline" tone="secondary" onPress={() => router.push("/destek/ciz" as never)} disabled={gonderiliyor} testID="destek-ciz" /></View>
              <View style={s.esnek}><Button label="Kaldır" icon="trash-outline" tone="plain" onPress={ekraniKaldir} disabled={gonderiliyor} testID="destek-goruntu-kaldir" /></View>
            </View>
          </View>
        ) : null}
        <Text style={s.not}>Ekran adı, uygulama sürümü ve cihaz bilgisi talebe otomatik eklenir.</Text>
      </FormKarti>
      {gonderHatasi ? <Banner tone="error" text={gonderHatasi} testID="destek-gonder-hata" /> : null}
      <View style={s.gonder}>
        <Button label={gonderHatasi ? "Tekrar dene" : "Gönder"} icon="send" onPress={() => void gonder()} busy={gonderiliyor} testID="destek-gonder" />
      </View>
      <Text style={s.aydinlatma} testID="destek-aydinlatma">{AYDINLATMA}</Text>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  gonderen: { ...typography.subhead, color: t.text, fontWeight: "600" as const, marginBottom: space.m },
  cipler: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.s, marginBottom: space.m },
  hata: { ...typography.caption, color: t.status.kritik.fill, marginBottom: space.s },
  mesaj: { minHeight: 120, textAlignVertical: "top" as const },
  goruntuKutusu: { gap: space.s, marginTop: space.s },
  goruntu: { width: "100%" as const, maxHeight: 320, borderRadius: radius.control, backgroundColor: t.surfaceAlt },
  dugmeler: { flexDirection: "row" as const, gap: space.s },
  esnek: { flex: 1 },
  not: { ...typography.caption, color: t.textSecondary, marginTop: space.m },
  gonder: { marginTop: space.l },
  aydinlatma: { ...typography.caption, color: t.textSecondary, textAlign: "center" as const, marginTop: space.l },
}));
