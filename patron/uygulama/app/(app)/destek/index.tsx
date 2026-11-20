// Taleplerim (patronun sorusu: "Bildirdiğim sorunlar ne durumda, bana cevap geldi mi?"). Patron hesabı firma
// yöneticisidir → "Benim" (kendi talepleri) / "Firmanın" (panelden ve telefondan açılan bütün talepler, açan kişiyle).
// Satır: konu · Türkçe durum rozeti · numara · son hareket · okunmamış noktası. Çek-yenile; odaktayken ~30 sn'de bir.
// "Yeni talep" görüntüsüz yalnız metinli talep açar (ekran görüntülü yol: başlıktaki "Sorun bildir").
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import type { DestekKapsam } from "../../../src/api/destek-wire";
import { useDestekEtkin } from "../../../src/destek/gorunurluk";
import { useTaleplerim } from "../../../src/destek/kancalar";
import { AYDINLATMA, destekHataMetni } from "../../../src/destek/metin";
import { yeniTaslak } from "../../../src/destek/taslak";
import { useSession } from "../../../src/state/session";
import { TalepSatiri } from "../../../src/ui/destek/TalepSatiri";
import { Screen } from "../../../src/ui/Frame";
import { Button, Loading } from "../../../src/ui/kit";
import { AltSekmeler, BosDurum, HataDurumu, KapsulDugme, TamGenislik } from "../../../src/ui/destek/parcalar";
import { makeStyles } from "../../../src/ui/theme-context";
import { space, typography } from "../../../src/ui/tokens";

const SEKMELER: readonly { key: DestekKapsam; etiket: string }[] = [
  { key: "mine", etiket: "Benim" },
  { key: "tenant", etiket: "Firmanın" },
];

export default function Taleplerim() {
  const { api } = useSession();
  const router = useRouter();
  const s = useStyles();
  const etkin = useDestekEtkin();
  const [kapsam, setKapsam] = useState<DestekKapsam>("mine");
  const l = useTaleplerim(api, kapsam);
  const yeniTalep = () => {
    yeniTaslak({ ekran: null, ekranAdi: "Destek talepleri", yol: "/destek" });
    router.push("/destek/yeni" as never);
  };

  if (!etkin) {
    return (
      <Screen title="Destek">
        <BosDurum baslik="Destek şu an kullanılamıyor" aciklama="Biraz sonra tekrar deneyin" icon="help-buoy-outline" testID="destek-kapali" />
      </Screen>
    );
  }

  return (
    <Screen
      title="Destek"
      onRefresh={l.yenile}
      refreshing={l.yenileniyor}
      headerRight={<KapsulDugme label="Talep" erisim="Yeni talep" icon="add" onPress={yeniTalep} testID="destek-yeni-talep" />}
    >
      <AltSekmeler sekmeler={SEKMELER} secili={kapsam} onSec={setKapsam} testID="destek-kapsam" />
      {l.items === null ? (
        l.hata ? <HataDurumu ekran mesaj={destekHataMetni(l.hata)} onTekrar={l.yenile} testID="destek-liste-hata" /> : <Loading />
      ) : l.items.length === 0 ? (
        <BosDurum
          baslik={kapsam === "mine" ? "Henüz talebiniz yok" : "Firmanın talebi yok"}
          aciklama="Bir sorun gördüğünüzde ekranın başlığındaki simgeyle bildirebilirsiniz"
          icon="help-buoy-outline"
          eylem="Yeni talep"
          onEylem={yeniTalep}
          testID="destek-bos"
        />
      ) : (
        <>
          {l.hata ? <Text style={s.hata} testID="destek-liste-uyari">{destekHataMetni(l.hata)}</Text> : null}
          <TamGenislik testID="destek-liste">
            {l.items.map((x, i) => (
              <TalepSatiri key={x.id} talep={x} kisiGoster={kapsam === "tenant"} ayrac={i > 0} onPress={() => router.push({ pathname: "/destek/[id]", params: { id: x.id } } as never)} />
            ))}
          </TamGenislik>
          {/* TeksERP Screen'inde onEndReached yok: sonraki sayfa açık düğmeyle */}
          {l.sonrakiVar ? <View style={s.devam}><Button label="Daha fazla" tone="secondary" onPress={() => void l.devam()} testID="destek-daha-fazla" /></View> : null}
        </>
      )}
      <View style={s.alt}>
        <Text style={s.aydinlatma} testID="destek-aydinlatma">{AYDINLATMA}</Text>
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  hata: { ...typography.caption, color: t.status.kritik.fill, marginVertical: space.s },
  alt: { marginTop: space.l, paddingVertical: space.m },
  devam: { marginTop: space.m, alignItems: "center" as const },
  aydinlatma: { ...typography.caption, color: t.textSecondary, textAlign: "center" as const },
}));
