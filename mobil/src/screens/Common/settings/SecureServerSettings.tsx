// Ayarlar → API Sunucusu, yalnız şifreli kip (K3): adres elle yazılmaz; bağlı sunucu, doğrulama kodu ve
// "Sunucuyu değiştir" (tam ekran ekleme akışı) gösterilir. Bağlantıyı kaldırmak tableti "Sunucuyu ekle"ye döndürür.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ConfirmDialog from '../../../components/ConfirmDialog';
import { formatFingerprintGroups, type TlsPin } from '../../../lib/lan-tls';
import { getTlsPins, removeTlsPins } from '../../../services/lanTlsPins';
import { displayUrl, parseUrlParts, useBaseUrlStore } from '../../../store/baseUrlStore';
import type { RootStackParamList } from '../../../navigation/types';
import { SETTINGS_COLORS as C, SettingsActionButton, SettingsPage, settingsStyles } from './settingsUi';

type TestState = { status: 'idle' | 'testing' } | { status: 'ok' | 'fail'; message: string };

async function probeSecureServer(baseUrl: string): Promise<TestState> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/discovery/identity`, { signal: ctrl.signal });
    return res.status === 200
      ? { status: 'ok', message: 'Sunucuya şifreli ve doğrulanmış bağlantıyla ulaşıldı.' }
      : { status: 'fail', message: `Sunucu beklenmeyen yanıt verdi (HTTP ${res.status}).` };
  } catch {
    return {
      status: 'fail',
      message: 'Sunucuya ulaşılamadı. Sunucu kapalı olabilir ya da sertifikası değişmiş olabilir — gerekirse sunucuyu yeniden ekleyin.',
    };
  } finally {
    clearTimeout(t);
  }
}

function ConnectionTest({ baseUrl }: { baseUrl: string }) {
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const run = async () => {
    setTest({ status: 'testing' });
    setTest(await probeSecureServer(baseUrl));
  };
  return (
    <>
      <SettingsActionButton
        testID="sunucu-test"
        tone="info"
        icon="lan-check"
        label="Bağlantıyı test et"
        busy={test.status === 'testing'}
        onPress={() => void run()}
      />
      {test.status === 'ok' || test.status === 'fail' ? (
        <Text style={[styles.result, { color: test.status === 'ok' ? C.success : C.error }]} testID="sunucu-test-sonuc">
          {test.message}
        </Text>
      ) : null}
    </>
  );
}

export default function SecureServerSettings() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const baseUrl = useBaseUrlStore((s) => s.baseUrl);
  const reset = useBaseUrlStore((s) => s.reset);
  const [pin, setPin] = useState<TlsPin | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    const port = parseUrlParts(baseUrl).port;
    void getTlsPins().then((pins) => setPin(pins.find((p) => String(p.port) === port) ?? null));
  }, [baseUrl]);

  const disconnect = async () => {
    if (pin) await removeTlsPins(pin.installationId);
    await reset();
    Toast.show({ type: 'info', text1: 'Sunucu bağlantısı kaldırıldı', text2: 'Sunucuyu yeniden ekleyin.' });
  };

  return (
    <SettingsPage title="API Sunucusu">
      <View style={settingsStyles.card} testID="sunucu-ayar-sifreli">
        <View style={styles.head}>
          <Icon source="lock" size={20} color={C.success} />
          <Text style={settingsStyles.title}>Şifreli bağlantı</Text>
        </View>
        <Text style={settingsStyles.subtitle}>Sunucu: {displayUrl(baseUrl) || '—'}</Text>
        {pin ? (
          <>
            <Text style={settingsStyles.subtitle}>Tablet sunucuyu bu doğrulama koduyla tanıyor:</Text>
            <Text style={styles.code} testID="lan-tls-active-fp">
              {formatFingerprintGroups(pin.fingerprint)}
            </Text>
          </>
        ) : null}
        <ConnectionTest baseUrl={baseUrl} />
        <SettingsActionButton
          testID="sunucu-degistir"
          tone="primary"
          icon="server-plus"
          label="Sunucuyu değiştir / yeniden ekle"
          onPress={() => navigation.navigate('SettingsServerPair')}
        />
        <SettingsActionButton
          testID="sunucu-baglanti-kaldir"
          tone="danger"
          icon="link-variant-off"
          label="Sunucu bağlantısını kaldır"
          onPress={() => setConfirmOpen(true)}
        />
      </View>
      <ConfirmDialog
        kind="simple"
        visible={confirmOpen}
        onDismiss={() => setConfirmOpen(false)}
        title="Sunucu bağlantısı kaldırılsın mı?"
        description="Tablet bu sunucuya bağlanmayı bırakır ve “Sunucuyu ekle” ekranına döner. Yeniden bağlanmak için QR ya da doğrulama kodu gerekir."
        confirmLabel="Kaldır"
        onConfirm={() => {
          setConfirmOpen(false);
          void disconnect();
        }}
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  code: { color: C.text, fontFamily: 'monospace', fontSize: 20, lineHeight: 30, marginVertical: 10, letterSpacing: 1 },
  result: { fontSize: 15, lineHeight: 21 },
});
