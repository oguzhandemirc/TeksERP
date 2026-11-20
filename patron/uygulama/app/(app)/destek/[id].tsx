// Talep ayrıntısı: başlıkta numara + durum, yazışma (ekler önizlemeli), yanıt kutusu, onaylı "Çözüldü, kapat".
// Açılışta `okundu` (+ rozet). Yanıtın işlem kimliği YOK (bulut §6.5): gönderirken düğme kilitli; belirsiz hatada
// (ağ/5xx) talep yeniden okunur — yanıtımız işlenmişse kutu temizlenir, çift gönderim olmaz. Kapanıştan 14 gün sonra
// yanıt 409 `REOPEN_WINDOW_EXPIRED` → "Yeni talep aç" önerilir.
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { MESAJ_AZAMI, yanitGecerliMi, yanitIslendiMi } from "../../../src/destek/form";
import { destekHatasiniIsle } from "../../../src/destek/gorunurluk";
import { useTalep } from "../../../src/destek/kancalar";
import { AYDINLATMA, belirsizMi, destekHataMetni, TUR_ETIKET, yeniTalepGerekirMi } from "../../../src/destek/metin";
import { yeniTaslak } from "../../../src/destek/taslak";
import { useSession } from "../../../src/state/session";
import { MesajBalonu, type EkBaglantisiAl } from "../../../src/ui/destek/MesajBalonu";
import { DestekDurumRozeti } from "../../../src/ui/destek/TalepSatiri";
import { Screen } from "../../../src/ui/Frame";
import { haptic } from "../../../src/ui/haptics";
import { Banner, Button, ConfirmButton, Field, Loading } from "../../../src/ui/kit";
import { HataDurumu } from "../../../src/ui/destek/parcalar";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

export default function TalepAyrintisi() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const talepId = String(id ?? "");
  const { api } = useSession();
  const router = useRouter();
  const s = useStyles();
  const d = useTalep(api, talepId);
  const [yanit, setYanit] = useState("");
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const [kapaniyor, setKapaniyor] = useState(false);
  const [hata, setHata] = useState<unknown>(null);
  const kilit = useRef(false);
  const ekAl: EkBaglantisiAl = useCallback((ekId, variant) => api.supportAttachmentLink(ekId, variant), [api]);
  const t = d.talep;

  const gonder = async () => {
    if (kilit.current || !t || !yanitGecerliMi(yanit)) return;
    kilit.current = true;
    setGonderiliyor(true);
    setHata(null);
    const metin = yanit.trim();
    const once = t.messages.length;
    try {
      d.guncelle(await api.supportReply(t.id, { message: metin }));
      setYanit("");
      haptic("success");
    } catch (e) {
      destekHatasiniIsle(e);
      if (belirsizMi(e) && yanitIslendiMi(once, await d.yeniden(), metin)) {
        setYanit("");
      } else {
        setHata(e);
        haptic("error");
      }
    } finally {
      kilit.current = false;
      setGonderiliyor(false);
    }
  };

  const kapat = async () => {
    if (!t || kilit.current) return;
    kilit.current = true;
    setKapaniyor(true);
    setHata(null);
    try {
      d.guncelle(await api.supportClose(t.id));
    } catch (e) {
      destekHatasiniIsle(e);
      setHata(e);
    } finally {
      kilit.current = false;
      setKapaniyor(false);
    }
  };

  const yeniTalep = () => {
    yeniTaslak({ ekran: null, ekranAdi: t ? `Destek talebi ${t.number}` : "Destek", yol: "/destek" });
    router.replace("/destek/yeni" as never);
  };

  if (!t) {
    return (
      <Screen title="Talep">
        {d.hata ? <HataDurumu ekran mesaj={destekHataMetni(d.hata)} onTekrar={d.yenile} testID="talep-hata" /> : <Loading />}
      </Screen>
    );
  }

  const kapali = t.status === "CLOSED";
  return (
    <Screen title={t.number} onRefresh={d.yenile} refreshing={d.yenileniyor}>
      <View style={s.ust}>
        <Text style={s.konu} testID="talep-konu">{t.subject}</Text>
        <View style={s.ustSatir}>
          <DestekDurumRozeti durum={t.status} testID="talep-durum" />
          <Text style={s.tur}>{TUR_ETIKET[t.type] ?? t.type}</Text>
        </View>
      </View>
      <View style={s.yazisma} testID="talep-yazisma">
        {t.messages.map((m) => <MesajBalonu key={m.id} mesaj={m} al={ekAl} />)}
      </View>
      {hata ? <Banner tone="error" text={destekHataMetni(hata)} testID="talep-islem-hata" /> : null}
      {yeniTalepGerekirMi(hata) ? <Button label="Yeni talep aç" tone="secondary" icon="add" onPress={yeniTalep} testID="talep-yeni-ac" /> : null}
      <View style={s.yanit}>
        <Field
          label={kapali ? "Yanıt yazın (talep yeniden açılır)" : "Yanıt yazın"}
          value={yanit}
          onChangeText={setYanit}
          multiline
          maxLength={MESAJ_AZAMI}
          placeholder="Mesajınız"
          style={s.yanitKutusu}
          testID="talep-yanit"
        />
        <Button label="Gönder" icon="send" onPress={() => void gonder()} busy={gonderiliyor} disabled={!yanitGecerliMi(yanit) || kapaniyor} testID="talep-gonder" />
      </View>
      {!kapali ? (
        <View style={s.kapat}>
          <ConfirmButton label="Çözüldü, kapat" question="Talep kapatılsın mı? Gerekirse 14 gün içinde yanıt yazarak yeniden açabilirsiniz." onConfirm={() => void kapat()} busy={kapaniyor} disabled={gonderiliyor} testID="talep-kapat" />
        </View>
      ) : null}
      <Text style={s.aydinlatma}>{AYDINLATMA}</Text>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  ust: { gap: space.s, marginBottom: space.l },
  konu: { ...typography.headline, color: t.text },
  ustSatir: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  tur: { ...typography.caption, color: t.textSecondary },
  yazisma: { marginBottom: space.m },
  yanit: { gap: space.s, marginTop: space.m },
  yanitKutusu: { minHeight: 96, textAlignVertical: "top" as const },
  kapat: { marginTop: space.l },
  aydinlatma: { ...typography.caption, color: t.textSecondary, textAlign: "center" as const, marginTop: space.xl },
}));
