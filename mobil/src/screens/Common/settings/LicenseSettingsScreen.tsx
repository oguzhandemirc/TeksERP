import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { usePermissions } from '../../../hooks/usePermission';
import { LICENSE_STATUS_KEY, useLicenseStatus } from '../../../hooks/useLicenseStatus';
import { licenseService } from '../../../services/license.service';
import { signalScan } from '../../../services/scanFeedback';
import { licenseScanStep, licenseSummaryRows } from '../../../lib/license';
import type { QrPartState } from '../../../lib/qr-parca';
import type { ScanFlash } from '../../../components/BarcodeScannerView';
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

/** Merkez bildiriminin süresi — ret sebebini okumaya yetecek kadar. */
const FLASH_MS = 2400;

/**
 * QR okutma → toplama → backend. Telefondaki sayfa yanıtı 1…4 parça QR olarak döndürür
 * (TKLQ1, `lib/qr-parca.ts`); tarayıcı açık kalır, parçalar toplanır, küme tamamlanınca
 * bütünlüğü doğrulanmış TEK metin gönderilir. Tek parça eski biçim de kabul edilir.
 */
function useResponseScanner() {
  const queryClient = useQueryClient();
  const [open, setOpenState] = useState(false);
  const [progress, setProgress] = useState<QrPartState | null>(null);
  const [flash, setFlash] = useState<ScanFlash | null>(null);
  const progressRef = useRef<QrPartState | null>(null);
  const handlingRef = useRef(false);
  const flashSeq = useRef(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  const showFlash = (next: Omit<ScanFlash, 'seq'>) => {
    flashSeq.current += 1;
    setFlash({ ...next, seq: flashSeq.current });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), FLASH_MS);
  };
  const track = (next: QrPartState | null) => {
    progressRef.current = next;
    setProgress(next);
  };
  const setOpen = (value: boolean) => {
    if (value) track(null);
    setOpenState(value);
  };

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
    const step = licenseScanStep(progressRef.current, raw);
    switch (step.kind) {
      case 'gonder':
        handlingRef.current = true;
        track(null);
        setOpenState(false);
        submit.mutate(step.yanit);
        return;
      case 'parca':
        signalScan('accept');
        track(step.state);
        return;
      case 'tekrar':
        signalScan('duplicate');
        showFlash({ kind: 'duplicate', title: 'BU QR ZATEN OKUNDU', detail: `${step.received} / ${step.total} okundu` });
        return;
      case 'ret':
        signalScan('reject');
        if (step.reset) track(null);
        showFlash({ kind: 'reject', title: 'OKUNMADI', detail: step.reason });
    }
  };

  const received = progress ? progress.parts.filter((p) => p !== null).length : 0;
  const notice = progress
    ? `Yanıt QR'ları: ${received} / ${progress.total} okundu — sıradakini okutun`
    : "Telefondaki lisans sayfasının QR'larını okutun (birden çoksa hepsini)";

  return { open, setOpen, onScan, busy: submit.isPending, notice, flash };
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
        QR'ını telefonla okutun; telefonda açılan sayfa YANIT QR'larını sırayla gösterir —
        hepsini buradan okutun, tablet parçaları birleştirip sunucuya iletir.
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
        continuous
        notice={scanner.notice}
        flash={scanner.flash}
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
