// =============================================================================
// Ayarlar → Güncelleme
// =============================================================================
// Sahadaki "hangi sürüm çalışıyor" sorusunun TEK cevap yeri + elle denetleme.
//
// ⚠️ İKİ AYRI KANAL VARDIR ve FARKLI OLMALARI NORMALDİR (2026-08-26):
//   · ERP        → fabrika ağındaki sunucu, tabletten değiştirilebilir
//   · Güncelleme → internet (VPS), APK'ya gömülü, değiştirilemez
// Bu yüzden ekran ikisini etiketleriyle YAN YANA basar ama "farklılar" diye
// UYARMAZ. Önceki sürümde uyarı vardı; kanallar ayrılınca o uyarı her cihazda
// kalıcı olarak yanacaktı ve hep bağıran bir uyarı, bir süre sonra hiç
// okunmayan bir uyarıdır — gerçek bir sapmada da susardı. Aynı ders bu depoda
// `build-apk.mjs`'in runtimeVersion kapısında yazılı.
// =============================================================================

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Icon } from 'react-native-paper';
import * as Updates from 'expo-updates';

import { useBaseUrlStore } from '../../../store/baseUrlStore';
import {
  apkDurumu,
  apkIndirVeKur,
  apkTemizle,
  bekleyenYazimSayisi,
  guvenliYenile,
  kuruluVersionName,
  otaKimlik,
  otaKontrolEtVeIndir,
  paketEtiketi,
  type ApkDurum,
  type OtaKontrolSonuc,
} from '../../../services/appUpdate.service';
import { SETTINGS_COLORS as COLORS, SettingsPage, settingsStyles } from './settingsUi';

/**
 * `https://guncelleme.etkiliyazilim.com/mobil/ota/54.2/manifest`
 *   → `guncelleme.etkiliyazilim.com`
 *
 * Operatöre gösterilen şey SUNUCUDUR, yol değil: ekranın cevapladığı soru
 * "hangi makineden geliyor".
 */
function sunucuGoster(url: string | null): string {
  if (!url) return '—';
  return url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
}

export default function UpdateSettingsScreen() {
  const baseUrl = useBaseUrlStore((s) => s.baseUrl);
  const kimlik = otaKimlik();
  const { isUpdateAvailable, isUpdatePending, isDownloading } = Updates.useUpdates();

  const [kontrolEdiliyor, setKontrolEdiliyor] = useState(false);
  const [otaSonuc, setOtaSonuc] = useState<OtaKontrolSonuc | null>(null);
  const [apk, setApk] = useState<ApkDurum | null>(null);
  const [apkIsleniyor, setApkIsleniyor] = useState(false);
  const [apkOran, setApkOran] = useState(0);
  const [apkHata, setApkHata] = useState<string | null>(null);

  const apiSunucu = baseUrl.replace(/^https?:\/\//i, '').replace(/\/api\/?$/i, '');
  const otaSunucu = sunucuGoster(kimlik.sunucu);

  useEffect(() => {
    void apkDurumu().then(setApk);
  }, []);

  const otaDenetle = useCallback(async () => {
    setKontrolEdiliyor(true);
    setOtaSonuc(null);
    const s = await otaKontrolEtVeIndir();
    setOtaSonuc(s);
    setKontrolEdiliyor(false);
  }, []);

  const apkKur = useCallback(async () => {
    const url = apk?.kunye?.indirmeUrl;
    if (!url) return;
    setApkIsleniyor(true);
    setApkHata(null);
    setApkOran(0);
    const s = await apkIndirVeKur(url, setApkOran);
    if (s.durum === 'hata') {
      setApkHata(s.mesaj);
      await apkTemizle();
    }
    setApkIsleniyor(false);
  }, [apk]);

  const bekleyen = bekleyenYazimSayisi();

  return (
    <SettingsPage title="Güncelleme">
      {/* ---------------------------------------------------------- Sürüm */}
      <View style={settingsStyles.card}>
        <View style={settingsStyles.headRow}>
          <View style={settingsStyles.iconBox}>
            <Icon source="cellphone-arrow-down" size={26} color={COLORS.accentLight} />
          </View>
          <View style={settingsStyles.headText}>
            <Text style={settingsStyles.title}>Çalışan sürüm</Text>
            <Text style={settingsStyles.subtitle}>
              Sahada &quot;hangi sürüm var&quot; sorusunun cevabı.
            </Text>
          </View>
        </View>

        <Satir etiket="Uygulama" deger={kuruluVersionName()} />
        <Satir etiket="Uzak paket" deger={paketEtiketi(kimlik)} />
        <Satir etiket="Native sürüm" deger={kimlik.runtimeVersion ?? '—'} />
      </View>

      {/* -------------------------------------------------------- Adresler */}
      <View style={settingsStyles.card}>
        <Text style={settingsStyles.label}>BAĞLANTILAR</Text>
        <Satir etiket="ERP (fabrika ağı)" deger={apiSunucu || '—'} />
        <Satir etiket="Güncelleme (internet)" deger={otaSunucu} />
        <Text style={settingsStyles.hint}>
          Bunlar iki ayrı bağlantıdır ve farklı olmaları normaldir. Üretim
          kayıtları fabrika sunucusuna gider; güncellemeler internetten gelir.
        </Text>
        {!kimlik.etkin && (
          <View style={styles.bant}>
            <Icon source="information" size={18} color={COLORS.subtext} />
            <Text style={styles.bantMetin}>
              Bu bir geliştirme kurulumu — uzaktan güncelleme kapalı.
            </Text>
          </View>
        )}
      </View>

      {/* ------------------------------------------------- Uzaktan güncelleme */}
      <View style={settingsStyles.card}>
        <Text style={settingsStyles.label}>UZAKTAN GÜNCELLEME</Text>
        <Text style={settingsStyles.subtitle}>
          Ekran ve kural değişiklikleri. Kurulum gerekmez; uygulama kendini yeniler.
        </Text>

        {isUpdatePending ? (
          <>
            <Text style={styles.durumIyi}>Yeni sürüm indirildi, uygulanmayı bekliyor.</Text>
            {bekleyen > 0 && (
              <Text style={settingsStyles.hint}>
                {bekleyen} kayıt henüz sunucuya gönderilmedi — gönderilir gönderilmez
                uygulanacak.
              </Text>
            )}
            <Button
              mode="contained"
              onPress={() => void guvenliYenile()}
              style={styles.dugme}
              buttonColor={COLORS.accent}
            >
              Şimdi yenile
            </Button>
          </>
        ) : (
          <>
            {otaSonuc?.durum === 'guncel' && <Text style={styles.durumIyi}>Güncel.</Text>}
            {otaSonuc?.durum === 'indirildi' && (
              <Text style={styles.durumIyi}>Yeni sürüm indirildi.</Text>
            )}
            {otaSonuc?.durum === 'kapali' && (
              <Text style={settingsStyles.hint}>Bu kurulumda uzaktan güncelleme kapalı.</Text>
            )}
            {otaSonuc?.durum === 'hata' && (
              <Text style={styles.durumKotu}>Sunucuya ulaşılamadı: {otaSonuc.mesaj}</Text>
            )}
            {isUpdateAvailable && !isDownloading && !otaSonuc && (
              <Text style={styles.durumIyi}>Yeni sürüm var.</Text>
            )}
            <Button
              mode="outlined"
              onPress={() => void otaDenetle()}
              loading={kontrolEdiliyor || isDownloading}
              disabled={kontrolEdiliyor || isDownloading || !kimlik.etkin}
              style={styles.dugme}
              textColor={COLORS.text}
            >
              {isDownloading ? 'İndiriliyor…' : 'Güncellemeleri denetle'}
            </Button>
          </>
        )}
      </View>

      {/* ------------------------------------------------ Kurulum dosyası */}
      <View style={settingsStyles.card}>
        <Text style={settingsStyles.label}>KURULUM DOSYASI</Text>
        <Text style={settingsStyles.subtitle}>
          Yalnız yeni cihaz özelliği/izin geldiğinde gerekir. İndirip &quot;Yükle&quot;ye
          basmanız yeterli — uygulama silinmez, veriler korunur.
        </Text>

        {apk?.yeniVarMi ? (
          <>
            <Satir
              etiket="Yeni sürüm"
              deger={`${apk.kunye?.versionName ?? '?'} (${apk.kunye?.versionCode})`}
            />
            {!!apk.kunye?.boyut && (
              <Satir etiket="Boyut" deger={`${(apk.kunye.boyut / 1048576).toFixed(1)} MB`} />
            )}
            {!!apk.kunye?.notlar && (
              <Text style={settingsStyles.hint}>{apk.kunye.notlar}</Text>
            )}
            {apkHata && <Text style={styles.durumKotu}>{apkHata}</Text>}
            <Button
              mode="contained"
              onPress={() => void apkKur()}
              loading={apkIsleniyor}
              disabled={apkIsleniyor}
              style={styles.dugme}
              buttonColor={COLORS.accent}
            >
              {apkIsleniyor
                ? `İndiriliyor… %${Math.round(apkOran * 100)}`
                : 'İndir ve kur'}
            </Button>
          </>
        ) : (
          <Text style={styles.durumIyi}>
            {apk === null ? 'Kontrol ediliyor…' : 'Kurulum dosyası güncel.'}
          </Text>
        )}
      </View>
    </SettingsPage>
  );
}

function Satir({ etiket, deger }: { etiket: string; deger: string }) {
  return (
    <View style={styles.satir}>
      <Text style={styles.satirEtiket}>{etiket}</Text>
      <Text style={[styles.satirDeger, settingsStyles.mono]} numberOfLines={2}>
        {deger}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  satir: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 7,
  },
  satirEtiket: { color: COLORS.subtext, fontSize: 13, fontWeight: '600' },
  // ⚠️ `flex: 1` + `minWidth: 0` — uzun adres/kimlik satırı etiketi ezmesin
  // (mobil "flex picker taşması" dersi: saran esnek kutuya min genişlik 0).
  satirDeger: { flex: 1, minWidth: 0, fontSize: 13, textAlign: 'right' },
  bant: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: COLORS.bgDarker,
  },
  bantMetin: { flex: 1, minWidth: 0, color: COLORS.text, fontSize: 12, lineHeight: 17 },
  durumIyi: { color: COLORS.success, fontSize: 14, marginTop: 10, fontWeight: '600' },
  durumKotu: { color: COLORS.error, fontSize: 13, marginTop: 10 },
  dugme: { marginTop: 16, borderRadius: 10 },
});
