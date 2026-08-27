import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SurumNotuKarti } from '../../../components/SurumNotuKarti';
import { kuruluVersionName } from '../../../services/appUpdate.service';
import { tumYayinlar } from '../../../services/surumNotlari';
import { SETTINGS_COLORS as C, SettingsPage } from './settingsUi';

/**
 * Ayarlar → Sürüm Notları — güncellemelerde neyin değiştiğinin kalıcı arşivi.
 *
 * Açılış modalı yalnız YENİ notları gösterir ve bir kez çıkar; burada tableti
 * ilgilendiren TÜM geçmiş durur (kullanıcı kararı: "her zaman erişilebilir olsun").
 */
export function SurumNotlariScreen() {
  const yayinlar = tumYayinlar();
  const surum = kuruluVersionName();

  return (
    <SettingsPage title="Sürüm Notları">
      <ScrollView contentContainerStyle={s.govde}>
        <Text style={s.ust}>Kurulu sürüm {surum ?? '—'}</Text>
        {yayinlar.length === 0 ? (
          <View style={s.bos}>
            <Text style={s.bosMetin}>Henüz sürüm notu yok.</Text>
          </View>
        ) : (
          yayinlar.map((y) => <SurumNotuKarti key={y.id} yayin={y} />)
        )}
      </ScrollView>
    </SettingsPage>
  );
}

const s = StyleSheet.create({
  govde: { padding: 16, paddingBottom: 32 },
  ust: { color: C.subtext, fontSize: 12, marginBottom: 12 },
  bos: { padding: 32, alignItems: 'center' },
  bosMetin: { color: C.subtext, fontSize: 14 },
});
