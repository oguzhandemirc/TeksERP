// Tek tür satırı: "Uygulamada" ve (tür taşıyorsa) "Tablet sesi" anahtarları. Kilitli tür uygulamada
// kapatılamaz — anahtar yerine kilit rozeti, kilit nedeni satırda yazılı (sunucu da 409 ile reddeder).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Switch, Text } from 'react-native-paper';
import { SETTINGS_COLORS as C } from '../settingsUi';
import { TABLET_CHANNELS } from '../../../../lib/bildirim/preferenceDraft';
import type { CatalogKind, PreferenceChannel } from '../../../../services/bildirim/types';

const CHANNEL_LABEL: Record<string, string> = { UYGULAMA: 'Uygulamada', TABLET_SES: 'Tablet sesi' };

export interface PreferenceKindRowProps {
  kind: CatalogKind;
  value: (channel: PreferenceChannel) => boolean | null;
  locked: boolean;
  onToggle: (channel: PreferenceChannel, value: boolean) => void;
}

export default function PreferenceKindRow({ kind, value, locked, onToggle }: PreferenceKindRowProps) {
  return (
    <View style={styles.row} testID={`tercih-${kind.kod}`}>
      <View style={styles.text}>
        <Text style={styles.name}>{kind.ad}</Text>
        {locked && (
          <View style={styles.lockRow}>
            <Icon source="lock" size={14} color={C.warning} />
            <Text style={styles.lockText}>{kind.kilitGerekcesi ?? 'Yönetici kilitledi; uygulamada kapatılamaz.'}</Text>
          </View>
        )}
      </View>
      {TABLET_CHANNELS.map((ch) => {
        const v = value(ch);
        if (v === null) return <View key={ch} style={styles.cell} />;
        const label = `${kind.ad} — ${CHANNEL_LABEL[ch]}`;
        if (ch === 'UYGULAMA' && locked) {
          // Pasif Switch koyu temada griye boyanıp "kapalı" okunuyordu; kilitli kanal anahtar değil, rozet.
          return (
            <View key={ch} style={styles.cell}>
              <Text style={styles.cellLabel}>{CHANNEL_LABEL[ch]}</Text>
              <View
                style={styles.lockedBadge}
                accessible
                accessibilityRole="switch"
                accessibilityLabel={label}
                accessibilityState={{ checked: v, disabled: true }}
              >
                <Icon source="lock" size={14} color={C.accentLight} />
                <Text style={styles.lockedText}>{v ? 'Hep açık' : 'Kapalı'}</Text>
              </View>
            </View>
          );
        }
        return (
          <View key={ch} style={styles.cell}>
            <Text style={styles.cellLabel}>{CHANNEL_LABEL[ch]}</Text>
            <Switch
              value={v}
              disabled={false}
              onValueChange={(nv) => onToggle(ch, nv)}
              color={C.accentLight}
              accessibilityLabel={label}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: 8, gap: 8 },
  text: { flex: 1 },
  name: { color: C.text, fontSize: 16, fontWeight: '600' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  lockText: { color: C.subtext, fontSize: 12, flexShrink: 1 },
  cell: { width: 96, alignItems: 'center' },
  cellLabel: { color: C.subtext, fontSize: 12, marginBottom: 2 },
  lockedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40 },
  lockedText: { color: C.accentLight, fontSize: 13, fontWeight: '600' },
});
