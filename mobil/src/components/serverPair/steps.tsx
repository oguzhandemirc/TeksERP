// Sunucu ekleme akışının adım görünümleri (durum `useServerPair`'de).
import React from 'react';
import { View } from 'react-native';
import { ActivityIndicator, Icon, Text, TextInput } from 'react-native-paper';

import { ServerDiscoveryList } from '../ServerDiscoveryList';
import { LAN_TLS_DEFAULT_PORT, formatFingerprintGroups } from '../../lib/lan-tls';
import type { DiscoveredServer } from '../../lib/discovery';
import type { TlsProbed } from '../../services/tlsProbe';
import { SettingsActionButton } from '../../screens/Common/settings/settingsUi';
import { C, styles } from './styles';

/** Keşif listesi sunucu ekleme kipinde (sabit yönlendirmesi kapalı, şifreli port). Sabit nesne: arama yeniden kurulmasın. */
const PAIRING_DISCOVERY = {};

interface AddressFieldProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}

function AddressField({ value, onChange, onSubmit }: AddressFieldProps) {
  return (
    <TextInput
      testID="sunucu-adres-input"
      mode="outlined"
      label="IP adresi ya da sunucu adı"
      value={value}
      onChangeText={onChange}
      onSubmitEditing={onSubmit}
      placeholder="192.168.1.10"
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      returnKeyType="go"
      style={styles.input}
      contentStyle={styles.inputContent}
      outlineColor={C.border}
      activeOutlineColor={C.accentLight}
      textColor={C.text}
      theme={{ colors: { background: C.bgDarker, onSurfaceVariant: C.subtext } }}
      left={<TextInput.Icon icon="ip-network" color={C.subtext} />}
    />
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <SettingsActionButton testID="sunucu-ekle-geri" tone="neutral" icon="arrow-left" label="Geri" onPress={onPress} />;
}

export function ChooseStep({ wide, onQr, onAddress }: { wide: boolean; onQr: () => void; onAddress: () => void }) {
  return (
    <View style={[styles.choices, wide && styles.choicesWide]}>
      <View style={[styles.choice, wide && styles.choiceWide]}>
        <Icon source="qrcode-scan" size={40} color={C.accentLight} />
        <Text style={styles.choiceTitle}>Paneldeki QR&apos;ı okut</Text>
        <Text style={styles.choiceBody}>
          Yönetim panelinde Cihazlar → “Tablet için şifreli bağlantı” QR&apos;ını okutun. Doğrulama QR&apos;dan gelir.
        </Text>
        <SettingsActionButton testID="sunucu-ekle-qr" tone="action" icon="qrcode-scan" label="QR okut" onPress={onQr} />
      </View>
      <View style={[styles.choice, wide && styles.choiceWide]}>
        <Icon source="keyboard-outline" size={40} color={C.accentLight} />
        <Text style={styles.choiceTitle}>IP adresini yaz</Text>
        <Text style={styles.choiceBody}>
          Tablet sunucunun doğrulama kodunu gösterir; kodu sunucu kurulumunun son sayfasındaki ya da paneldeki kodla
          karşılaştırırsınız.
        </Text>
        <SettingsActionButton testID="sunucu-ekle-adres" tone="primary" icon="keyboard-outline" label="Adresi yaz" onPress={onAddress} />
      </View>
    </View>
  );
}

interface AddressStepProps extends AddressFieldProps {
  busy: boolean;
  recentUrls: string[];
  onPick: (srv: DiscoveredServer) => void;
  onBack: () => void;
}

export function AddressStep({ value, onChange, onSubmit, busy, recentUrls, onPick, onBack }: AddressStepProps) {
  return (
    <View style={styles.panel}>
      <Text style={styles.stepTitle}>Sunucunun IP adresi</Text>
      <Text style={styles.body}>
        Port yazmazsanız şifreli bağlantı portu {LAN_TLS_DEFAULT_PORT} kullanılır. Tablet sunucuya yalnız şifreli bağlanır.
      </Text>
      <AddressField value={value} onChange={onChange} onSubmit={onSubmit} />
      <SettingsActionButton testID="sunucu-adres-devam" tone="primary" icon="arrow-right" label="Devam" disabled={busy} onPress={onSubmit} />
      <View style={styles.divider} />
      <Text style={styles.hint}>Adresi bilmiyorsanız ağda arayın; bulunan sunucuya dokununca doğrulama kodu gösterilir.</Text>
      <ServerDiscoveryList
        pairing={PAIRING_DISCOVERY}
        recentUrls={recentUrls}
        disabled={busy}
        emptyHint="Ağda şifreli bağlantı sunan sunucu bulunamadı. Tablet fabrika Wi-Fi'sinde mi, sunucu açık mı? Adresi biliyorsanız yukarıya yazın."
        onPick={onPick}
      />
      <BackButton onPress={onBack} />
    </View>
  );
}

export function QrSearchStep({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.stepTitle}>QR okundu</Text>
      <View style={styles.row}>
        <ActivityIndicator size={18} color={C.accentLight} />
        <Text style={styles.body}>Bu QR&apos;ın sunucusu ağda aranıyor…</Text>
      </View>
      <BackButton onPress={onBack} />
    </View>
  );
}

export function QrAddressStep({ value, onChange, onSubmit, busy, port, onBack }: AddressFieldProps & { busy: boolean; port: number; onBack: () => void }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.stepTitle}>Sunucu ağda bulunamadı</Text>
      <Text style={styles.body}>
        Sunucunun IP adresini yazın. Tablet yalnız QR&apos;daki koda sahip sunucuya bağlanır (port {port}).
      </Text>
      <AddressField value={value} onChange={onChange} onSubmit={onSubmit} />
      <SettingsActionButton testID="sunucu-adres-devam" tone="primary" icon="arrow-right" label="Bağlan" disabled={busy} onPress={onSubmit} />
      <BackButton onPress={onBack} />
    </View>
  );
}

interface ConfirmStepProps {
  server: TlsProbed;
  wide: boolean;
  busy: boolean;
  onSame: () => void;
  onDifferent: () => void;
}

export function ConfirmStep({ server, wide, busy, onSame, onDifferent }: ConfirmStepProps) {
  return (
    <View style={styles.panel}>
      <Text style={styles.stepTitle}>Doğrulama kodu</Text>
      <Text style={styles.body}>
        Bu kodu sunucu kurulumunun son sayfasındaki “ŞİFRELİ BAĞLANTI KODU” ile (ya da sunucu bilgisayarındaki durum
        sayfasında, panelde gösterilen kodla) karşılaştırın. Birebir aynıysa onaylayın.
      </Text>
      <Text style={styles.code} testID="dogrulama-kodu" selectable>
        {formatFingerprintGroups(server.fingerprint)}
      </Text>
      <Text style={styles.hint}>
        {server.host}:{server.port}
        {server.identity?.companyName ? ` · sunucunun bildirdiği ad: ${server.identity.companyName}` : ''}
      </Text>
      <View style={[styles.confirmRow, wide && styles.confirmRowWide]}>
        <View style={wide ? styles.flex1 : undefined}>
          <SettingsActionButton testID="kod-ayni" tone="success" icon="check-decagram" label="Kodlar aynı — bağlan" disabled={busy} onPress={onSame} />
        </View>
        <View style={wide ? styles.flex1 : undefined}>
          <SettingsActionButton testID="kod-farkli" tone="neutral" icon="close-octagon" label="Kodlar farklı — vazgeç" disabled={busy} onPress={onDifferent} />
        </View>
      </View>
    </View>
  );
}

export function NoticeBox({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <View style={styles.notice}>
      <Icon source="lock-alert" size={20} color={C.warning} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

export function StatusLines({ busy, error }: { busy: string | null; error: string | null }) {
  return (
    <>
      {busy ? (
        <View style={styles.row} testID="sunucu-ekle-mesgul">
          <ActivityIndicator size={18} color={C.accentLight} />
          <Text style={styles.body}>{busy}</Text>
        </View>
      ) : null}
      {error ? (
        <View style={styles.error} testID="sunucu-ekle-hata">
          <Icon source="alert-circle" size={20} color={C.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </>
  );
}
