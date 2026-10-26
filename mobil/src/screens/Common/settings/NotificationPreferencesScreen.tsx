// Ayarlar → Bildirim tercihleri (N4-TABLET). Tür bazında "uygulamada göster" ve "tablet sesi";
// masaüstü/özet/kapsam panelde ayarlanır ve kayıtta aynen korunur. Yeni MobileScreenKey AÇILMAZ.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { SettingsActionButton, SettingsPage, settingsStyles, SETTINGS_COLORS as C } from './settingsUi';
import PreferenceKindRow from './notifications/PreferenceKindRow';
import { useNotificationPreferences, type PreferenceScreenState } from './notifications/useNotificationPreferences';
import { cellValue } from '../../../lib/bildirim/preferenceDraft';
import type { CatalogKind } from '../../../services/bildirim/types';

const EMPTY_TEXT: Record<Exclude<PreferenceScreenState, 'yukleniyor'>, string> = {
  kapali: 'Bildirim gelen kutusu bu kurulumda kapalı. Yönetici Genel Ayarlar → Bildirimler\'den açar.',
  'surumde-yok': 'Bağlı sunucunun bu sürümünde bildirim tercihleri yok.',
  hata: 'Tercihler alınamadı. Bağlantı gelince yeniden deneyin.',
  hazir: 'Tercihler alınamadı.',
};

function groupKinds(kinds: CatalogKind[]): [string, CatalogKind[]][] {
  const m = new Map<string, CatalogKind[]>();
  for (const k of kinds) m.set(k.grup, [...(m.get(k.grup) ?? []), k]);
  return [...m.entries()];
}

export default function NotificationPreferencesScreen() {
  const p = useNotificationPreferences();
  if (p.state !== 'hazir' || !p.prefs) {
    return (
      <SettingsPage title="Bildirim tercihleri">
        <View style={settingsStyles.card} testID="bildirim-tercih-bos">
          {p.state === 'yukleniyor' ? <ActivityIndicator /> : <Text style={settingsStyles.subtitle}>{EMPTY_TEXT[p.state]}</Text>}
          {p.state === 'hata' && <SettingsActionButton label="Yeniden dene" icon="refresh" tone="neutral" onPress={p.refetch} />}
        </View>
      </SettingsPage>
    );
  }
  const prefs = p.prefs;
  const lockedOf = (kod: string) => prefs.hucreler.find((h) => h.kind === kod)?.kanallar.find((c) => c.kanal === 'UYGULAMA')?.kilit ?? false;
  return (
    <SettingsPage title="Bildirim tercihleri">
      {groupKinds(p.catalog).map(([grup, kinds]) => (
        <View key={grup} style={settingsStyles.card}>
          <Text style={settingsStyles.title}>{grup}</Text>
          {kinds.map((k, i) => (
            <View key={k.kod} style={i > 0 ? styles.divided : undefined}>
              <PreferenceKindRow
                kind={k}
                locked={lockedOf(k.kod)}
                value={(ch) => cellValue(prefs, p.edits, k.kod, ch)}
                onToggle={(ch, v) => p.toggle(k.kod, ch, v)}
              />
            </View>
          ))}
        </View>
      ))}
      {p.queued && <Text style={styles.queued} testID="bildirim-tercih-kuyrukta">Ağ yok — tercih kuyrukta, bağlantı gelince kaydedilecek.</Text>}
      <SettingsActionButton label="Kaydet" icon="content-save" tone="primary" onPress={p.submit} disabled={!p.dirty && !p.saving} busy={p.saving} busyLabel="Kaydediliyor…" testID="bildirim-tercih-kaydet" />
      <Text style={settingsStyles.hint}>Sessiz saat ve masaüstü bildirimleri panelden (Kullanıcı Tercihleri) ayarlanır.</Text>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  queued: { color: C.warning, fontSize: 14, marginVertical: 8 },
});
