// Şifreli bağlantı (LAN TLS) kartı — API Sunucusu ayarı. Sabit yalnız sabitli panelin gösterdiği QR'dan
// gelir (docs/design/LAN-TLS.md §4c). Native zorlama katmanı olmayan sürümde ve sabit yokken kart hiç görünmez:
// bugünkü tabletler için görünür değişiklik yok.
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import ConfirmDialog from './ConfirmDialog';
import {
  DEFAULT_PORT,
  getPinnedInstallationId,
  parseUrlParts,
  setPinnedInstallationId,
  useBaseUrlStore,
} from '../store/baseUrlStore';
import { decideQrPin, formatFingerprintGroups, httpFallbackUrl, type TlsPin } from '../lib/lan-tls';
import { addTlsPin, getTlsPins, lanTlsNativeAvailable, removeTlsPins } from '../services/lanTlsPins';
import { probeServer } from '../services/discovery.service';
import { SETTINGS_COLORS as COLORS, SettingsActionButton, settingsStyles } from '../screens/Common/settings/settingsUi';

function activePin(pins: readonly TlsPin[], url: string): TlsPin | null {
  const p = parseUrlParts(url);
  if (p.scheme !== 'https') return null;
  return pins.find((x) => String(x.port) === p.port) ?? null;
}

function useLanTlsActions() {
  const baseUrl = useBaseUrlStore((s) => s.baseUrl);
  const recentUrls = useBaseUrlStore((s) => s.recentUrls);
  const setCustomUrl = useBaseUrlStore((s) => s.setCustomUrl);
  const [pins, setPins] = useState<TlsPin[]>([]);
  const native = lanTlsNativeAvailable();

  useEffect(() => {
    void getTlsPins().then(setPins);
  }, []);

  const onScan = useCallback(
    async (text: string) => {
      const parts = parseUrlParts(baseUrl);
      const host = parts.host || null;
      const server = host ? await probeServer(host, Number(parts.port) || DEFAULT_PORT, null, 4000) : null;
      const decision = decideQrPin({
        qrText: text,
        nativeAvailable: native,
        host,
        serverInstallationId: server?.identity?.installationId ?? null,
        serverAdvert: server?.tls ?? null,
        now: new Date().toISOString(),
      });
      if (!decision.ok) {
        Toast.show({ type: 'error', text1: 'Şifreli bağlantı kurulamadı', text2: decision.reason });
        return;
      }
      setPins(await addTlsPin(decision.pin));
      if (decision.pin.installationId && !(await getPinnedInstallationId())) {
        await setPinnedInstallationId(decision.pin.installationId);
      }
      await setCustomUrl(decision.baseUrl);
      Toast.show({ type: 'success', text1: 'Şifreli bağlantıya geçildi', text2: decision.baseUrl });
    },
    [baseUrl, native, setCustomUrl],
  );

  const active = activePin(pins, baseUrl);
  const unpin = useCallback(async () => {
    if (!active) return;
    setPins(await removeTlsPins(active.installationId));
    const fallback = httpFallbackUrl(parseUrlParts(baseUrl).host, recentUrls, DEFAULT_PORT);
    await setCustomUrl(fallback);
    Toast.show({ type: 'success', text1: 'Şifreli bağlantı kaldırıldı', text2: `Şifresiz adres: ${fallback}` });
  }, [active, baseUrl, recentUrls, setCustomUrl]);

  return { native, hasPins: pins.length > 0, active, onScan, unpin };
}

function ActivePinView({ pin, onRemove }: { pin: TlsPin; onRemove: () => void }) {
  return (
    <>
      <Text style={settingsStyles.subtitle}>Tablet sunucuyu bu sertifika koduyla tanıyor:</Text>
      <Text style={styles.fp} testID="lan-tls-active-fp">
        {formatFingerprintGroups(pin.fingerprint)}
      </Text>
      <SettingsActionButton
        testID="lan-tls-kaldir"
        tone="neutral"
        icon="lock-open-variant"
        label="Şifreli bağlantıyı kaldır"
        onPress={onRemove}
      />
    </>
  );
}

export function LanTlsCard() {
  const { native, hasPins, active, onScan, unpin } = useLanTlsActions();
  const [scanning, setScanning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (!native && !hasPins) return null;

  return (
    <View style={settingsStyles.card} testID="lan-tls-card">
      <View style={styles.head}>
        <Icon source={active ? 'lock' : 'lock-open-variant'} size={20} color={active ? COLORS.success : COLORS.subtext} />
        <Text style={settingsStyles.title}>Şifreli bağlantı {active ? 'açık' : 'kapalı'}</Text>
      </View>
      {active ? (
        <ActivePinView pin={active} onRemove={() => setConfirmOpen(true)} />
      ) : (
        <>
          <Text style={settingsStyles.subtitle}>
            Paneldeki Cihazlar ekranında “Tablet için şifreli bağlantı” QR&apos;ını okutun. Önce sunucuya bağlı olun.
          </Text>
          <SettingsActionButton
            testID="lan-tls-qr-okut"
            tone="action"
            icon="qrcode-scan"
            label="Şifreli bağlantı QR'ı okut"
            disabled={!native}
            onPress={() => setScanning(true)}
          />
        </>
      )}
      <BarcodeScannerModal
        visible={scanning}
        onDismiss={() => setScanning(false)}
        onScan={(t) => {
          setScanning(false);
          void onScan(t);
        }}
        title="Şifreli bağlantı QR"
        barcodeTypes={['qr']}
      />
      <ConfirmDialog
        kind="simple"
        visible={confirmOpen}
        onDismiss={() => setConfirmOpen(false)}
        title="Şifreli bağlantı kaldırılsın mı?"
        description="Tablet sunucuya yeniden şifresiz (HTTP) bağlanacak. Yeniden şifreli bağlantı için QR'ı tekrar okutmanız gerekir."
        confirmLabel="Kaldır"
        onConfirm={() => {
          setConfirmOpen(false);
          void unpin();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  fp: { color: COLORS.text, fontFamily: 'monospace', fontSize: 14, marginVertical: 10, letterSpacing: 1 },
});
