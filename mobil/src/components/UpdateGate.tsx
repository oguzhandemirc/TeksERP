// =============================================================================
// TeksERP Mobil — uzaktan güncelleme kapısı
// =============================================================================
// Görünmez bileşen. İki iş yapar:
//
//  1) Uygulama ÖN PLANA döndüğünde güncelleme sorar (açılışta zaten
//     `checkAutomatically: ON_LOAD` soruyor). Fabrikada tablet vardiya boyunca
//     açık kalır; yalnız açılışta sormak, günler boyunca güncelleme almayan
//     cihazlar üretirdi.
//
//  2) İndirilmiş güncelleme varsa UYGULAR (kullanıcı kararı: "hemen yenilesin").
//     Tek kapı: gönderilmemiş istasyon kaydı varken yenilemez — bkz.
//     `guvenliYenile`. Tavan dolarsa yenileme atlanır, paket kaybolmaz.
//
// ⚠️ Yenileme sırasında kısa bir örtü basılır. Bunun sebebi estetik değil:
// `reloadAsync` uygulamayı aniden yeniden başlatır ve operatör hiçbir açıklama
// olmadan ekranın sıfırlandığını görürse bunu ÇÖKME sanar (sahada "tablet
// kendi kendine kapandı" olarak raporlanır ve gerçek çökme aramasına yol açar).
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { Button } from 'react-native-paper';
import * as Updates from 'expo-updates';

import {
  apkDurumu,
  apkIndirVeKur,
  bekleyenYazimSayisi,
  guvenliYenile,
  kuruluVersionName,
} from '../services/appUpdate.service';
import {
  kilitlenmeliMi,
  politikaDegerlendir,
  politikaOku,
  type PolitikaDurumu,
} from '../services/clientPolicy.service';
import { colors } from '../theme/tokens';

/** Ön plana her dönüşte sormak gereksiz trafik — en az bu kadar ara olsun. */
const SORMA_ARALIGI_MS = 10 * 60 * 1000;

export default function UpdateGate() {
  const { isUpdatePending } = Updates.useUpdates();
  const [politikaDurum, setPolitikaDurum] = useState<PolitikaDurumu>({ eski: false, sebep: null });
  const [apkHazir, setApkHazir] = useState(false);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [kuruluyor, setKuruluyor] = useState(false);
  const [yenileniyor, setYenileniyor] = useState(false);
  const sonSorma = useRef(0);
  const yenilemeBasladi = useRef(false);

  /* --- (1) Ön plana dönüşte sor ------------------------------------ */
  const sor = useCallback(async () => {
    if (!Updates.isEnabled) return;
    if (Date.now() - sonSorma.current < SORMA_ARALIGI_MS) return;
    sonSorma.current = Date.now();
    try {
      const sonuc = await Updates.checkForUpdateAsync();
      if (sonuc.isAvailable) await Updates.fetchUpdateAsync();
    } catch {
      // Sunucuya ulaşılamaması NORMAL bir durumdur (ağ kopması, sunucu
      // yeniden başlıyor). Operatöre gösterilecek bir şey yok.
    }
  }, []);

  /* --- (1b) Sürüm politikası ------------------------------------- */
  const politikaKontrol = useCallback(async () => {
    const politika = await politikaOku();
    const durum = politikaDegerlendir({
      politika,
      apkSurumu: kuruluVersionName(),
      paketTarihi: Updates.createdAt,
    });
    setPolitikaDurum(durum);
    // Kilit KOŞULLU: "düzeltme kurulabilir mi" sorusunun cevabı sebebe göre
    // farklı yerde — paket ekseninde indirilmiş güncelleme, APK ekseninde
    // sunucudaki kurulum dosyası.
    if (durum.sebep === 'apk') {
      const a = await apkDurumu();
      setApkHazir(a.yeniVarMi);
      setApkUrl(a.kunye?.indirmeUrl ?? null);
    }
  }, []);

  useEffect(() => {
    void politikaKontrol();
  }, [politikaKontrol]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (durum) => {
      if (durum === 'active') {
        void sor();
        void politikaKontrol();
      }
    });
    return () => sub.remove();
  }, [sor, politikaKontrol]);

  /* --- (2) İndirilmişi uygula -------------------------------------- */
  useEffect(() => {
    if (!isUpdatePending || yenilemeBasladi.current) return;
    yenilemeBasladi.current = true;
    setYenileniyor(true);
    void (async () => {
      const sonuc = await guvenliYenile();
      if (sonuc !== 'yenilendi') {
        // Ertelendi: kuyruk boşalmadı. Örtüyü kaldır — operatör çalışmaya
        // devam etsin; paket bir sonraki açılışta uygulanır.
        setYenileniyor(false);
        yenilemeBasladi.current = false;
      }
      // 'yenilendi' dalında bu kod zaten çalışmaz (uygulama yeniden başladı).
    })();
  }, [isUpdatePending]);

  /* --- Render ------------------------------------------------------ */

  if (yenileniyor) {
    return (
      <View style={styles.ortu} pointerEvents="auto">
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.baslik}>Yeni sürüm uygulanıyor</Text>
        <Text style={styles.alt}>Uygulama birkaç saniye içinde yeniden açılacak.</Text>
      </View>
    );
  }

  const duzeltmeHazir = politikaDurum.sebep === 'apk' ? apkHazir : isUpdatePending;
  const bekleyen = bekleyenYazimSayisi();
  const kilit = kilitlenmeliMi({ durum: politikaDurum, duzeltmeHazir, bekleyenYazim: bekleyen });

  // KİLİT — yalnız düzeltme gerçekten kurulabilirken ve kuyruk boşken.
  if (kilit) {
    return (
      <View style={styles.ortu} pointerEvents="auto">
        <Text style={styles.baslik}>Güncelleme gerekli</Text>
        <Text style={styles.alt}>
          {politikaDurum.sebep === 'apk'
            ? 'Sunucu daha yeni bir uygulama sürümü bekliyor. Kurulum dosyası hazır.'
            : 'Sunucu daha yeni bir sürüm bekliyor. Güncelleme indirildi, uygulanmayı bekliyor.'}
        </Text>
        <Button
          mode="contained"
          loading={kuruluyor}
          disabled={kuruluyor}
          buttonColor={colors.brand}
          style={styles.dugme}
          onPress={() => {
            if (politikaDurum.sebep === 'apk') {
              if (!apkUrl) return;
              setKuruluyor(true);
              void apkIndirVeKur(apkUrl).finally(() => setKuruluyor(false));
            } else {
              void guvenliYenile();
            }
          }}
        >
          {politikaDurum.sebep === 'apk' ? 'İndir ve kur' : 'Şimdi yenile'}
        </Button>
      </View>
    );
  }

  // ŞERİT — sürüm eski ama düzeltme henüz kurulabilir değil (örn. internet yok)
  // ya da gönderilmemiş kayıt var. Uyarı kaybolmaz, üretim durmaz.
  if (politikaDurum.eski) {
    return (
      <View style={styles.serit} pointerEvents="box-none">
        <Text style={styles.seritMetin}>
          {bekleyen > 0
            ? `Sürümünüz eski · ${bekleyen} kayıt gönderilince güncellenecek`
            : 'Sürümünüz eski · güncelleme indirilir indirilmez uygulanacak'}
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  ortu: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(24,29,49,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 9999,
    elevation: 9999,
  },
  baslik: { color: '#fff', fontSize: 20, fontWeight: '700' },
  alt: { color: '#c7cbe0', fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  dugme: { marginTop: 20, borderRadius: 10, minWidth: 200 },
  // Şerit ekranın ÜSTÜNDE ve dokunmayı geçirir (box-none): operatör çalışmaya
  // devam edebilmeli — bu, kilidin bilinçli olarak yumuşatılmış hâli.
  serit: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#7c5800',
    paddingVertical: 6,
    paddingHorizontal: 12,
    zIndex: 9998,
    elevation: 9998,
  },
  seritMetin: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
