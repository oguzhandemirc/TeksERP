import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { usePermissions } from '../../../hooks/usePermission';
import { LICENSE_STATUS_KEY, useLicenseStatus } from '../../../hooks/useLicenseStatus';
import { licenseService } from '../../../services/license.service';
import { signalScan } from '../../../services/scanFeedback';
import { licenseSummaryRows, normalizeScannedResponse } from '../../../lib/license';
import type { LicensePermission } from '../../../types/permissions';
import {
  SETTINGS_COLORS as C,
  SettingsActionButton,
  SettingsPage,
  settingsStyles,
} from './settingsUi';

/**
 * Ayarlar → Lisans. Herkese: görünür filigran (lisans no · sahip · sunucu sürümü).
 * `license:manage` taşıyana: çevrimdışı yenilemenin DÖNÜŞ ayağı — panelin gösterdiği
 * istek QR'ı telefonla satıcıya gider, telefonda çıkan YANIT QR'ı burada okutulur ve
 * backend'e AYNEN iletilir (`POST /api/license/cevrimdisi-yanit`; imza backend'de).
 */
/** Çevrimdışı yanıtı iletme yetkisi — backend ucunun guard'ıyla aynı kod (`has()` düz string alır). */
const MANAGE_PERMISSION: LicensePermission = 'license:manage';

/** QR okutma → süzgeç → backend. Kamera aynı kareyi art arda verebilir: okuma başına tek gönderim. */
function useResponseScanner() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const handlingRef = useRef(false);

  const submit = useMutation({
    mutationFn: licenseService.submitOfflineResponse,
    onSuccess: () => {
      signalScan('accept');
      Toast.show({ type: 'success', text1: 'Lisans yanıtı kabul edildi', visibilityTime: 5000 });
      void queryClient.invalidateQueries({ queryKey: LICENSE_STATUS_KEY });
    },
    onError: (err: Error) => {
      signalScan('reject');
      Toast.show({ type: 'error', text1: 'Lisans yanıtı kabul edilmedi', text2: err.message, visibilityTime: 7000 });
    },
    onSettled: () => {
      handlingRef.current = false;
    },
  });

  const onScan = (raw: string) => {
    if (handlingRef.current) return;
    handlingRef.current = true;
    setOpen(false);
    const yanit = normalizeScannedResponse(raw);
    if (!yanit) {
      handlingRef.current = false;
      signalScan('reject');
      Toast.show({
        type: 'error',
        text1: 'Bu QR bir lisans yanıtı değil',
        text2: 'Telefondaki lisans sayfasında çıkan yanıt QR\'ını okutun.',
        visibilityTime: 6000,
      });
      return;
    }
    submit.mutate(yanit);
  };

  return { open, setOpen, onScan, busy: submit.isPending };
}

function LicenseSummaryCard({ loading, rows }: { loading: boolean; rows: { label: string; value: string }[] }) {
  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.headRow}>
        <View style={settingsStyles.iconBox}>
          <Icon source="certificate-outline" size={28} color={C.accentLight} />
        </View>
        <View style={settingsStyles.headText}>
          <Text style={settingsStyles.title}>Lisans bilgisi</Text>
          <Text style={settingsStyles.subtitle}>Bu tabletin bağlı olduğu sunucunun lisansı.</Text>
        </View>
      </View>
      {loading ? (
        <ActivityIndicator color={C.accentLight} />
      ) : rows.length === 0 ? (
        <Text style={styles.muted} testID="lisans-bilgi-yok">
          Sunucudan lisans bilgisi alınamadı.
        </Text>
      ) : (
        rows.map((r) => (
          <View key={r.label} style={styles.row}>
            <Text style={styles.rowLabel}>{r.label}</Text>
            <Text style={styles.rowValue}>{r.value}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function OfflineResponseCard({ busy, onOpen }: { busy: boolean; onOpen: () => void }) {
  return (
    <View style={settingsStyles.card} testID="lisans-cevrimdisi-karti">
      <Text style={settingsStyles.label}>ÇEVRİMDIŞI YENİLEME</Text>
      <Text style={styles.body}>
        Sunucunun internet bağlantısı yoksa: paneldeki Lisans ekranında çevrimdışı istek
        QR'ını telefonla okutun, telefonda açılan sayfadaki YANIT QR'ını buradan okutun.
      </Text>
      <SettingsActionButton
        label="Yanıt QR'ını okut"
        busyLabel="Gönderiliyor…"
        icon="qrcode-scan"
        busy={busy}
        onPress={onOpen}
        testID="lisans-qr-okut"
        style={styles.button}
      />
    </View>
  );
}

export default function LicenseSettingsScreen() {
  const status = useLicenseStatus();
  const { has } = usePermissions();
  const canManage = has(MANAGE_PERMISSION);
  const scanner = useResponseScanner();

  return (
    <SettingsPage title="Lisans">
      <LicenseSummaryCard loading={status.isLoading} rows={licenseSummaryRows(status.data)} />
      {canManage ? <OfflineResponseCard busy={scanner.busy} onOpen={() => scanner.setOpen(true)} /> : null}
      <BarcodeScannerModal
        visible={scanner.open}
        onDismiss={() => scanner.setOpen(false)}
        onScan={scanner.onScan}
        title="Lisans yanıtı QR"
        barcodeTypes={['qr']}
        captureHaptic={false}
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  rowLabel: { color: C.subtext, fontSize: 14 },
  rowValue: { color: C.text, fontSize: 15, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  muted: { color: C.subtext, fontSize: 14 },
  body: { color: C.text, fontSize: 14, lineHeight: 20 },
  button: { marginTop: 16 },
});
