import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from 'react-native-paper';
import { SETTINGS_COLORS as C } from '../screens/Common/settings/settingsUi';
import { kuruluVersionName } from '../services/appUpdate.service';
import {
  SURUM_NOTLARI,
  damgalanacakId,
  gosterilecekYayinlar,
  isaretOku,
  isaretYaz,
  type SurumNotuYayini,
} from '../services/surumNotlari';
import { SurumNotuKarti } from './SurumNotuKarti';

/**
 * Güncelleme sonrası "neler değişti" örtüsü — açılışta BİR KEZ.
 *
 * ⚠️ `AppModal` KULLANILMIYOR: onun içeriği SimplePortal ile taşınıyor, portal
 * host `UpdateGate`'in altında duruyor ve portal içeriği çağıran ekranın
 * context'ini görmüyor. Burada `UpdateGate`'in kendi kanıtlanmış deseni var:
 * düz `View` + `StyleSheet.absoluteFill`.
 *
 * ⚠️ Karar AÇILIŞTA verilir. OTA uygulandığında `Updates.reloadAsync()` JS'i
 * öldürüyor — "yenilemeden önce" hiçbir durum taşınamaz. Yeni boot = yeni paket
 * + yeni not dosyası + eski işaret → doğru sonuç kendiliğinden çıkıyor.
 *
 * ⚠️ Yalnız "Tamam" ile kapanır: kazara kapatılan not, okunmamış nottur.
 */
export function SurumNotuGate() {
  const [liste, setListe] = useState<SurumNotuYayini[]>([]);
  const [gizlenen, setGizlenen] = useState(0);
  const [acik, setAcik] = useState(false);

  useEffect(() => {
    let aktif = true;
    (async () => {
      const surum = kuruluVersionName();
      const isaret = await isaretOku();
      if (!aktif) return;

      const sonuc = gosterilecekYayinlar(SURUM_NOTLARI, isaret, surum);
      if (sonuc.liste.length > 0) {
        setListe(sonuc.liste);
        setGizlenen(sonuc.gizlenen);
        setAcik(true);
        return;
      }
      // Gösterilecek bir şey yoksa işareti sessizce ilerlet: bir sonraki
      // güncellemede "aradaki her şey" birden açılmasın.
      const id = damgalanacakId(SURUM_NOTLARI, surum);
      if (id && id !== isaret) await isaretYaz(id);
    })();
    return () => {
      aktif = false;
    };
  }, []);

  // Damga KAPANIŞTA yazılır: açıkken çöken uygulama notu tekrar göstersin.
  const kapat = async () => {
    const id = damgalanacakId(SURUM_NOTLARI, kuruluVersionName());
    if (id) await isaretYaz(id);
    setAcik(false);
  };

  if (!acik) return null;

  return (
    <View style={s.ortu}>
      <View style={s.kutu}>
        <Text style={s.baslik}>Bu güncellemede neler değişti</Text>
        <Text style={s.altBaslik}>Uygulamanın yeni sürümü kuruldu.</Text>

        <ScrollView style={s.kaydir} contentContainerStyle={s.kaydirIc}>
          {liste.map((y) => (
            <SurumNotuKarti key={y.id} yayin={y} />
          ))}
          {gizlenen > 0 && (
            <Text style={s.dipnot}>
              …ve {gizlenen} eski not daha — Ayarlar → Sürüm Notları
            </Text>
          )}
        </ScrollView>

        <Button mode="contained" onPress={kapat} style={s.buton}>
          Tamam
        </Button>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  ortu: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 900,
  },
  kutu: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '86%',
    backgroundColor: C.bg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
  },
  baslik: { color: C.text, fontSize: 20, fontWeight: '800' },
  altBaslik: { color: C.subtext, fontSize: 13, marginTop: 4, marginBottom: 16 },
  kaydir: { flexGrow: 0 },
  kaydirIc: { paddingBottom: 4 },
  dipnot: { color: C.subtext, fontSize: 12, textAlign: 'center', marginTop: 4 },
  buton: { marginTop: 16 },
});
