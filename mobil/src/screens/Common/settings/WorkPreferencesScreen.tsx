import React from 'react';
import { View } from 'react-native';
import { Text, TouchableRipple, ActivityIndicator } from 'react-native-paper';

import { SettingsPage, settingsStyles } from './settingsUi';
import { useSubcontractorDefault, type SubcontractorDefaultMode } from '../../../hooks/useSubcontractorDefault';
import { usePermissions } from '../../../hooks/usePermission';
import { useDeviceSettingsStore } from '../../../store/deviceSettingsStore';

// =============================================================================
// ÇALIŞMA TERCİHLERİ — kişisel (2026-08-09)
// =============================================================================
// ⚠️ Bu ekrandakiler YALNIZ giriş yapan kullanıcıyı etkiler ve backend'in
// `UserPreference` blob'unda yaşar. "Bu Yerin Donanımı" / "API Sunucusu" gibi
// CİHAZ ayarlarıyla karıştırma — onlar makineye, bunlar kişiye bağlıdır ve
// kullanıcı başka bir tablete geçtiğinde bu tercih ONUNLA gelir.
//
// Electron'un "Ayarlar → Çalışma Tercihleri" kartıyla AYNI anahtarları yazar.
//
// ⚠️ BÖLÜMLER YETKİYE GÖRE ÇİZİLİR (2026-08-17): herkes YALNIZ kendi
// kullandığı ekranların ayarını görür. Tambur operatörüne planlamacının fason
// varsayılanını göstermek, ayarı "benimle ilgili değil" diye okutup gerçek
// tercihini gölgeler. Yeni bölüm eklerken yetkisini de yaz.
//
// ⚠️ İKİ AYRI SAKLAMA YERİ, bilinçli: fason varsayılanı KİŞİYE bağlı (sunucu,
// `UserPreference` — kullanıcı başka tablete geçince onunla gelir); Tambur
// kalite sıfırlaması CİHAZA bağlı (yerel depo, sunucuya gitmez) çünkü tercih
// "bu tamburda nasıl çalışıyoruz" gerçeğini yansıtır, kişiyi değil.
// =============================================================================

const OPTIONS: Array<{ value: SubcontractorDefaultMode; label: string; desc: string }> = [
  {
    value: 'favorite',
    label: 'Kategorinin favorisi',
    desc: 'Bugünkü davranış — ⭐ işaretli firma hazır gelir.',
  },
  {
    value: 'lastUsed',
    label: 'En son seçtiğim',
    desc: 'O kategoride en son kullandığın firma gelir. Geçmiş yoksa favoriye düşer.',
  },
];

export default function WorkPreferencesScreen() {
  const { mode, setMode, saving } = useSubcontractorDefault();
  const { has } = usePermissions();
  const canPlan = has('mobile:hizli-is-emri');
  const canTambur = has('mobile:tambur');
  const resetQuality = useDeviceSettingsStore((s) => s.tamburResetQualityAfterCut);
  const setResetQuality = useDeviceSettingsStore((s) => s.setTamburResetQualityAfterCut);

  return (
    <SettingsPage title="Çalışma Tercihleri">
      {canTambur && (
        <View style={{ gap: 10, marginBottom: 20 }}>
          <Text style={settingsStyles.label}>TAMBUR — ÇIKTIDAN SONRA KALİTE</Text>
          <Text style={settingsStyles.hint}>
            Bir çıktı aldıktan sonra kalite seçimi ne olsun?
          </Text>
          {[
            { value: true, label: '1. Kaliteye dön', desc: 'Her çıktıdan sonra sıfırlanır — yanlış kalite basma riski düşer.' },
            { value: false, label: 'Son seçtiğim kalsın', desc: 'Bugünkü davranış — arka arkaya A1 keserken hızlıdır.' },
          ].map((o) => {
            const active = resetQuality === o.value;
            return (
              <TouchableRipple
                key={String(o.value)}
                onPress={() => void setResetQuality(o.value)}
                style={[
                  settingsStyles.card,
                  {
                    borderWidth: active ? 2 : 1,
                    borderColor: active ? '#6366f1' : '#334155',
                    minHeight: 64,
                    justifyContent: 'center',
                  },
                ]}
              >
                <View>
                  <Text
                    style={{
                      fontSize: 16,
                      fontWeight: active ? '800' : '600',
                      color: active ? '#c7d2fe' : '#e2e8f0',
                    }}
                  >
                    {o.label}
                    {active ? '  ✓' : ''}
                  </Text>
                  <Text style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>{o.desc}</Text>
                </View>
              </TouchableRipple>
            );
          })}
          <Text style={settingsStyles.hint}>Bu ayar yalnız BU CİHAZDA geçerlidir.</Text>
        </View>
      )}

      {!canPlan ? null : (
      <View style={{ gap: 10 }}>
        <Text style={settingsStyles.label}>İŞ EMRİNDE FASON FİRMA VARSAYILANI</Text>
        <Text style={settingsStyles.hint}>
          Rotaya fason adımı eklendiğinde hangi firma hazır gelsin? Bu ayar yalnız
          HAZIR GELEN firmayı değiştirir — listeden her zaman başka firma seçebilirsin
          ve favori yıldızı yerinde kalır.
        </Text>

        {OPTIONS.map((o) => {
          const active = mode === o.value;
          return (
            <TouchableRipple
              key={o.value}
              onPress={() => setMode(o.value)}
              disabled={saving}
              style={[
                settingsStyles.card,
                {
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? '#6366f1' : '#334155',
                  minHeight: 64,
                  justifyContent: 'center',
                },
              ]}
            >
              <View>
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: active ? '800' : '600',
                    color: active ? '#c7d2fe' : '#e2e8f0',
                  }}
                >
                  {o.label}
                  {active ? '  ✓' : ''}
                </Text>
                <Text style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>{o.desc}</Text>
              </View>
            </TouchableRipple>
          );
        })}

        {saving && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <ActivityIndicator size={16} color="#94a3b8" />
            <Text style={settingsStyles.hint}>Kaydediliyor…</Text>
          </View>
        )}

        <Text style={[settingsStyles.hint, { marginTop: 12 }]}>
          Bu tercih hesabına kaydedilir — başka bir tablete geçtiğinde seninle gelir.
          Diğer kullanıcıların ekranı değişmez.
        </Text>
      </View>
      )}

      {!canPlan && !canTambur && (
        <Text style={settingsStyles.hint}>
          Bu ekranlarda ayarlanabilir bir tercihin yok.
        </Text>
      )}
    </SettingsPage>
  );
}
