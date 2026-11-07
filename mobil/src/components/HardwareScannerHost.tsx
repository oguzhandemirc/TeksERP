import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, TextInput } from 'react-native';
import Constants from 'expo-constants';
import Toast from 'react-native-toast-message';

import { useScanMethod } from '../hooks/useScanMethod';
import { donanimOkuyucuNative } from '../services/hardwareScanner/native';
import { startHardwareAdapter, stopHardwareAdapter } from '../services/hardwareScanner/controller';
import { emitScan, setUnhandledScanListener } from '../services/hardwareScanner/scanBus';
import { WEDGE_IDLE_MS, onWedgeChange, onWedgeFlush } from '../services/hardwareScanner/wedgeBuffer';
import { signalScan } from '../services/scanFeedback';
import { recordActivity } from '../store/lockStore';

/** Klavye kaması kutusunun odak yoklaması — başka kutu odakta değilse geri alır. */
const REFOCUS_MS = 800;

/**
 * El terminali okuyucusunun uygulama geneli sahibi (App.tsx'te BİR kez): etkin yönteme göre yerel adaptörü
 * kurar/kaldırır ya da görünmez klavye kaması kutusunu çizer; hedefsiz okumayı sesli uyarır.
 * Okumanın kendisi `scanBus` boğazından `useHardwareScanTarget` hedeflerine gider.
 */
export default function HardwareScannerHost() {
  const { method, device } = useScanMethod();
  const adapter = method.kind === 'intent' ? device.adapter : null;

  useEffect(() => {
    const native = donanimOkuyucuNative();
    if (!adapter || !native) {
      stopHardwareAdapter();
      return;
    }
    // Bakım hattında expo-application yok (yeni paket yasak): paket adı derlemede gömülen yapılandırmadan.
    startHardwareAdapter(adapter, native, { packageName: Constants.expoConfig?.android?.package ?? 'com.teks.erp.mobil' });
    return () => stopHardwareAdapter();
  }, [adapter]);

  useEffect(() => {
    if (method.kind === 'camera') {
      setUnhandledScanListener(null);
      return;
    }
    // Hedefsiz okuma sessiz kalmaz: operatör "okudu ama bir şey olmadı" sanmasın.
    setUnhandledScanListener((_scan, reason) => {
      recordActivity();
      signalScan('reject');
      Toast.show({
        type: 'info',
        text1: reason === 'covered' ? 'Önce açık pencereyi kapatın' : 'Bu ekranda okutma beklenmiyor',
        visibilityTime: 1800,
      });
    });
    return () => setUnhandledScanListener(null);
  }, [method.kind]);

  return method.kind === 'wedge' ? <WedgeInput /> : null;
}

/**
 * Görünmez, klavye AÇMAYAN odaklı kutu: okuyucunun klavye/yapıştırma çıkışını yakalar. Kullanıcı gerçek bir
 * kutuya dokunursa odak oraya geçer (okuyucu da oraya yazar); boşta kalınca odak geri alınır.
 */
function WedgeInput() {
  const ref = useRef<TextInput>(null);
  const [value, setValue] = useState('');
  const valueRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deliver = useCallback((text: string | null) => {
    if (!text) return;
    recordActivity();
    emitScan({ data: text, symbology: null, source: 'wedge' });
  }, []);

  const apply = useCallback((next: string) => {
    valueRef.current = next;
    setValue(next);
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const step = onWedgeFlush(valueRef.current);
    apply(step.value);
    deliver(step.emit);
  }, [apply, deliver]);

  const onChangeText = useCallback(
    (next: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const step = onWedgeChange(next);
      apply(step.value);
      deliver(step.emit);
      if (step.armTimer) timer.current = setTimeout(flush, WEDGE_IDLE_MS);
    },
    [apply, deliver, flush],
  );

  useEffect(() => {
    const refocus = () => {
      const focused = TextInput.State.currentlyFocusedInput?.();
      if (!focused) ref.current?.focus();
    };
    const iv = setInterval(refocus, REFOCUS_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refocus();
    });
    refocus();
    return () => {
      clearInterval(iv);
      sub.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <TextInput
      ref={ref}
      testID="hardware-scanner-wedge"
      value={value}
      onChangeText={onChangeText}
      onSubmitEditing={flush}
      submitBehavior="submit"
      showSoftInputOnFocus={false}
      caretHidden
      contextMenuHidden
      autoCorrect={false}
      autoCapitalize="none"
      importantForAutofill="no"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={styles.hidden}
    />
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0, padding: 0 },
});
