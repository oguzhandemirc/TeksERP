import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { kuruluVersionName } from '../services/appUpdate.service';

/**
 * Giriş ekranının altındaki sürüm + güncellik satırı.
 *
 * Neden burada: "hangi sürümdeyim / güncel miyim" soruları sahada en sık giriş
 * ekranında sorulur (telefonla destek isteyen kişiye okutulacak ilk bilgi).
 *
 * ⚠️ Kendi kontrolünü BAŞLATMAZ — yalnız `Updates.useUpdates()` durumunu okur.
 * Kontrolü `UpdateGate` yapıyor (açılışta, ön plana dönüşte ve her girişte);
 * ikinci bir tetik aynı işi iki kez yaptırırdı.
 *
 * ⚠️ Hata durumu GÖSTERİLMEZ: internete çıkamayan bir tablet her açılışta
 * kırmızı bir şey görürse gösterge körleşir. O bilgi Ayarlar → Güncelleme'de.
 */
export function SurumRozeti() {
  const { isUpdateAvailable, isUpdatePending, isChecking, isDownloading } = Updates.useUpdates();
  const [surum, setSurum] = useState<string | null>(null);

  useEffect(() => {
    setSurum(kuruluVersionName());
  }, []);

  let durum: { metin: string; renk: string } | null = null;
  if (isChecking) durum = { metin: 'kontrol ediliyor…', renk: '#94a3b8' };
  else if (isDownloading) durum = { metin: 'güncelleme iniyor', renk: '#60a5fa' };
  else if (isUpdatePending) durum = { metin: 'yeniden başlatılacak', renk: '#60a5fa' };
  else if (isUpdateAvailable) durum = { metin: 'güncelleme var', renk: '#60a5fa' };
  else if (Updates.isEnabled) durum = { metin: 'güncel', renk: '#4ade80' };

  return (
    <View style={s.kap} pointerEvents="none">
      <Text style={s.metin}>
        TeksERP{surum ? ` v${surum}` : ''}
        {durum ? <Text style={{ color: durum.renk }}> · {durum.metin}</Text> : null}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  kap: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  metin: { color: '#64748b', fontSize: 11, fontWeight: '600' },
});
