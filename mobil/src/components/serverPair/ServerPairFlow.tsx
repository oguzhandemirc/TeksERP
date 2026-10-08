// =============================================================================
// Sunucuyu ekle — iki EŞİT yol (kullanıcı kararı 2026-10-08)
// =============================================================================
// (a) Paneldeki şifreli bağlantı QR'ı: iz ve port QR'dan gelir, sunucu ağda o izle aranır (bulunamazsa adres
//     yazılır). (b) IP adresi: tablet sunucunun sertifika izinden doğrulama kodunu gösterir; kullanıcı kurulum
//     sonundaki / durum sayfasındaki / paneldeki kodla karşılaştırıp onaylar. İki yolun sonucu da sabitlenmiş
//     şifreli bağlantıdır (`serverPairing.completePairing`). Tam ekran sayfanın GÖVDESİDİR; kabuk çağıranda.
// =============================================================================

import React, { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';

import { BarcodeScannerModal } from '../BarcodeScannerModal';
import { decideCodePin } from '../../lib/lan-tls';
import { AddressStep, ChooseStep, ConfirmStep, NoticeBox, QrAddressStep, QrSearchStep, StatusLines } from './steps';
import { styles } from './styles';
import { useServerPair } from './useServerPair';

export interface ServerPairFlowProps {
  /** Bağlantı kuruldu (adres + sabit yazıldı). */
  onDone: () => void;
  /** Akışın üstünde gösterilecek açıklama (ör. eski şifresiz adres). */
  notice?: string | null;
}

export function ServerPairFlow({ onDone, notice }: ServerPairFlowProps) {
  const wide = useWindowDimensions().width >= 720;
  const p = useServerPair(onDone);
  const [scanning, setScanning] = useState(false);
  const { step } = p;
  const busy = !!p.busy;
  const toChoose = () => p.go({ kind: 'choose' });
  const field = { value: p.address, onChange: p.setAddress };

  return (
    <View style={styles.root} testID="sunucu-ekle">
      <NoticeBox text={notice} />
      {step.kind === 'choose' && <ChooseStep wide={wide} onQr={() => setScanning(true)} onAddress={() => p.go({ kind: 'address' })} />}
      {step.kind === 'address' && (
        <AddressStep
          {...field}
          onSubmit={p.submitAddress}
          busy={busy}
          recentUrls={p.recentUrls}
          onPick={(srv) => void p.probeAddress(srv.host, srv.port)}
          onBack={toChoose}
        />
      )}
      {step.kind === 'qrSearch' && <QrSearchStep onBack={toChoose} />}
      {step.kind === 'qrAddress' && (
        <QrAddressStep {...field} onSubmit={() => void p.submitQrAddress(step.qrText, step.port)} busy={busy} port={step.port} onBack={toChoose} />
      )}
      {step.kind === 'confirm' && (
        <ConfirmStep
          server={step.server}
          wide={wide}
          busy={busy}
          onSame={() => void p.finish(decideCodePin({ observed: step.server, confirmed: true, now: new Date().toISOString() }))}
          onDifferent={() => {
            toChoose();
            const d = decideCodePin({ observed: step.server, confirmed: false, now: '' });
            if (!d.ok) p.setError(d.reason);
          }}
        />
      )}
      <StatusLines busy={p.busy} error={p.error} />
      <BarcodeScannerModal
        visible={scanning}
        onDismiss={() => setScanning(false)}
        onScan={(t) => {
          setScanning(false);
          void p.onQr(t);
        }}
        title="Şifreli bağlantı QR"
        barcodeTypes={['qr']}
      />
    </View>
  );
}
