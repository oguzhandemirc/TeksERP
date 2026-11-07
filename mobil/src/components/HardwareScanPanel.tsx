// =============================================================================
// HardwareScanPanel — BarcodeScannerModal'ın donanım okuyucu yüzü (el terminali, D2)
// =============================================================================
// Donanım modunda kamera BAĞLANMAZ (Point Mobile kamera açılınca okuyucuyu kapatır). Panel yalnız
// "okuyucu tuşuna basın" der; okuma `useHardwareScanTarget` ile gelir ve kameranın `onScan`'ine aynen düşer.
// =============================================================================

import { palette } from '../theme/tokens';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import type { ScanFlash } from './BarcodeScannerView';

interface Props {
  title?: string;
  notice?: string;
  counter?: { scanned: number; expected: number };
  flash?: ScanFlash | null;
  continuous?: boolean;
  onClose: () => void;
  onPickFromList?: () => void;
}

export default function HardwareScanPanel({ title, notice, counter, flash, continuous, onClose, onPickFromList }: Props) {
  const over = !!counter && counter.scanned > counter.expected;
  return (
    <View style={styles.root} testID="hardware-scan-panel">
      <View style={styles.head}>
        <Text style={styles.title} numberOfLines={2}>
          {title ?? 'Barkod / QR Okut'}
        </Text>
        <IconButton icon="close" iconColor={palette.white} size={26} onPress={onClose} accessibilityLabel="Kapat" />
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {counter ? (
        <Text style={[styles.counter, over && styles.counterOver]}>
          {`${counter.scanned} / ${counter.expected} m`}
        </Text>
      ) : null}
      <View style={styles.body}>
        {flash ? <ScanFlashCard flash={flash} /> : <TriggerHint continuous={!!continuous} />}
      </View>
      {onPickFromList ? (
        <Button
          mode="contained-tonal"
          icon="format-list-bulleted"
          style={styles.pick}
          contentStyle={styles.pickContent}
          onPress={() => {
            onClose();
            onPickFromList();
          }}
        >
          Listeden Seç
        </Button>
      ) : null}
    </View>
  );
}

function TriggerHint({ continuous }: { continuous: boolean }) {
  return (
    <>
      <MaterialCommunityIcons name="barcode-scan" size={64} color={palette.indigo[200]} />
      <Text style={styles.hint}>Okuyucu tuşuna basın</Text>
      <Text style={styles.sub}>
        {continuous ? 'Topları arka arkaya okutun; bitince kapatın.' : 'Kamera kullanılmaz — tepedeki okuyucu okur.'}
      </Text>
    </>
  );
}

export function ScanFlashCard({ flash }: { flash: ScanFlash }) {
  return (
    <View
      style={[styles.flash, flash.kind === 'duplicate' ? styles.flashDuplicate : styles.flashReject]}
      testID="scan-flash"
    >
      <MaterialCommunityIcons
        name={flash.kind === 'duplicate' ? 'content-duplicate' : 'close-octagon'}
        size={42}
        color={palette.white}
      />
      <Text style={styles.flashTitle}>{flash.title}</Text>
      {flash.detail ? (
        <Text style={styles.flashDetail} numberOfLines={2}>
          {flash.detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: palette.white, fontSize: 18, fontWeight: '800' },
  notice: {
    color: palette.amber[100],
    backgroundColor: 'rgba(180,83,9,0.35)',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    fontWeight: '600',
  },
  counter: { color: palette.slate[300], fontSize: 20, fontWeight: '800', textAlign: 'center' },
  counterOver: { color: palette.amber[500] }, // bakım hattının paletinde amber-300 yok
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  hint: { color: palette.white, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  sub: { color: palette.slate[400], fontSize: 14, textAlign: 'center' },
  pick: { alignSelf: 'center' },
  pickContent: { minHeight: 56, paddingHorizontal: 12 },
  flash: { borderRadius: 16, borderWidth: 2, padding: 18, alignItems: 'center', gap: 6, minWidth: 220 },
  flashDuplicate: { backgroundColor: 'rgba(180,83,9,0.95)', borderColor: palette.amber[500] },
  flashReject: { backgroundColor: 'rgba(153,27,27,0.95)', borderColor: palette.red[500] },
  flashTitle: { color: palette.white, fontSize: 21, fontWeight: '800', textAlign: 'center' },
  flashDetail: { color: palette.red[100], fontSize: 14, textAlign: 'center' },
});
