import React from 'react';
import { View } from 'react-native';
import { Text, TouchableRipple, ActivityIndicator } from 'react-native-paper';

import { SettingsPage, settingsStyles } from './settingsUi';
import { useSubcontractorDefault, type SubcontractorDefaultMode } from '../../../hooks/useSubcontractorDefault';

// =============================================================================
// ÇALIŞMA TERCİHLERİ — kişisel (2026-08-09)
// =============================================================================
// ⚠️ Bu ekrandakiler YALNIZ giriş yapan kullanıcıyı etkiler ve backend'in
// `UserPreference` blob'unda yaşar. "Bu Yerin Donanımı" / "API Sunucusu" gibi
// CİHAZ ayarlarıyla karıştırma — onlar makineye, bunlar kişiye bağlıdır ve
// kullanıcı başka bir tablete geçtiğinde bu tercih ONUNLA gelir.
//
// Electron'un "Ayarlar → Çalışma Tercihleri" kartıyla AYNI anahtarları yazar.
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

  return (
    <SettingsPage title="Çalışma Tercihleri">
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
    </SettingsPage>
  );
}
