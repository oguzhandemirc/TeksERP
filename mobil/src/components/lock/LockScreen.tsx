// =============================================================================
// LockScreen — hareketsizlik kilidi ekranı (kart/PIN ile hızlı aç / geçiş)
// =============================================================================
// App.tsx'te PaperProvider'DAN SONRA (Toast slotu) mount edilir → Paper Portal
// modallarının bile ÜSTÜNde tam ekran kaplar. Çalışma oturumu AÇIK kalır; unlock
// sadece kimliği doğrular:
//   - Dönen user == mevcut user  → token tazele + kilidi aç (kick eski oturumu
//     düşürdüğü için yeni token benimsenir; fullName korunur).
//   - Farklı user → performSwitch (A flush→kapat→cache düş→B setAuth→init),
//     SessionGate yeni operatöre yeri yeniden sordurur.
// Unlock yöntemleri login ayarına göre: quick-PIN ve/veya QR kart. Hiçbiri yoksa
// "Çıkış yap" (login ekranına dön) fallback'i her zaman var.
// =============================================================================

import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { BarcodeScannerModal } from '../BarcodeScannerModal';
import { useAuthStore } from '../../store/authStore';
import { useLockStore } from '../../store/lockStore';
import { authService } from '../../services/auth.service';
import { authActions } from '../../services/authActions';
import { performLogout, performSwitch } from '../../offline/sessionSwitch';
import { useSessionConflict } from '../../hooks/useSessionConflict';
import { operatorColor, operatorInitials } from '../../utils/operatorColor';
import type { LoginResponse } from '../../types/auth';

const PIN_LENGTH = 6;
const C = {
  bg: '#0f172a',
  soft: '#1e293b',
  border: '#334155',
  text: '#f1f5f9',
  sub: '#94a3b8',
  accent: '#6366f1',
  error: '#ef4444',
};

export default function LockScreen() {
  const user = useAuthStore((s) => s.user);
  const unlock = useLockStore((s) => s.unlock);
  const { requestConfirm, modal: conflictModal } = useSessionConflict();

  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const busyRef = useRef(false);

  const methodsQ = useQuery({
    queryKey: ['auth', 'login-methods'],
    queryFn: authService.getLoginMethods,
    staleTime: 60_000,
  });
  const methods = methodsQ.data?.enabled ?? ['list'];
  const pinEnabled = methods.includes('pin');
  const cardEnabled = methods.includes('card');

  const name = user?.fullName || user?.username || '';
  const color = operatorColor(user?.userId);

  const applyUnlock = useCallback(
    async (res: LoginResponse) => {
      const next = res.data.user;
      const token = res.data.token;
      const curId = useAuthStore.getState().user?.userId;
      if (next.userId === curId) {
        // Aynı operatör — token'ı tazele (fullName'i koru), kilidi aç.
        const keepName = useAuthStore.getState().user?.fullName ?? next.fullName;
        await useAuthStore.getState().setAuth(next, token, keepName);
      } else {
        // Farklı operatör — devir: A flush/kapat → B setAuth/init.
        await performSwitch({ user: next, token, fullName: next.fullName });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      unlock();
    },
    [unlock],
  );

  const runUnlock = useCallback(
    async (fn: () => Promise<LoginResponse>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        const res = await fn();
        await applyUnlock(res);
      } catch (e) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(e instanceof Error ? e.message : 'Kilit açılamadı.');
        setPin('');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [applyUnlock],
  );

  const submitPin = useCallback(
    (full: string) => void runUnlock(() => authActions.quickPin(full, requestConfirm)),
    [runUnlock, requestConfirm],
  );

  const submitCard = useCallback(
    (code: string) => void runUnlock(() => authActions.card(code.trim(), requestConfirm)),
    [runUnlock, requestConfirm],
  );

  const press = useCallback(
    (d: string) => {
      if (busyRef.current) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setError('');
      setPin((p) => {
        if (d === 'back') return p.slice(0, -1);
        if (p.length >= PIN_LENGTH) return p;
        const next = p + d;
        if (next.length === PIN_LENGTH) submitPin(next);
        return next;
      });
    },
    [submitPin],
  );

  const doLogout = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      try {
        await performLogout();
        unlock();
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [unlock]);

  return (
    // onStartShouldSetResponder: kilit ekranının BOŞ alanlarına yapılan dokunmalar
    // arkadaki (gizli) app'e sızmasın — kök View responder'ı yutar; numpad/butonlar
    // daha derin oldukları için kendi dokunmalarını yine alır.
    <View style={styles.root} onStartShouldSetResponder={() => true}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: color }]}>
            <Text style={styles.avatarText}>{operatorInitials(name)}</Text>
          </View>
          <View style={styles.headerText}>
            <View style={styles.lockRow}>
              <Icon source="lock" size={18} color={C.sub} />
              <Text style={styles.lockLabel}>Ekran kilitli</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {name || '—'}
            </Text>
          </View>
        </View>

        <Text style={styles.prompt}>
          {pinEnabled
            ? 'Devam etmek için PIN gir veya kartını okut'
            : cardEnabled
              ? 'Devam etmek için kartını okut'
              : 'Devam etmek için tekrar giriş yap'}
        </Text>

        {pinEnabled && (
          <>
            <View style={styles.dots}>
              {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i < pin.length && styles.dotFilled,
                    !!error && styles.dotError,
                  ]}
                />
              ))}
            </View>
            <Numpad onPress={press} disabled={busy} pinLen={pin.length} />
          </>
        )}

        <View style={styles.status}>
          {busy ? (
            <>
              <ActivityIndicator size={16} color={C.accent} />
              <Text style={styles.statusText}>Kontrol ediliyor…</Text>
            </>
          ) : error ? (
            <>
              <Icon source="alert-circle" size={18} color={C.error} />
              <Text style={styles.errorText}>{error}</Text>
            </>
          ) : null}
        </View>

        <View style={styles.actions}>
          {cardEnabled && (
            <Button
              mode="contained"
              icon="qrcode-scan"
              disabled={busy}
              onPress={() => setScanOpen(true)}
              style={styles.cardBtn}
              contentStyle={styles.cardBtnContent}
            >
              Kartla Aç
            </Button>
          )}
          <Button
            mode="text"
            icon="logout"
            textColor={C.sub}
            disabled={busy}
            onPress={doLogout}
          >
            Farklı kullanıcı / Çıkış
          </Button>
        </View>
      </SafeAreaView>

      <BarcodeScannerModal
        visible={scanOpen}
        onDismiss={() => setScanOpen(false)}
        onScan={(code) => {
          setScanOpen(false);
          submitCard(code);
        }}
        title="Personel kartını okut"
        notice="Kilidi açmak / operatör değiştirmek için QR'ı göster"
      />
      {conflictModal}
    </View>
  );
}

// Hidden real input kullanmadan, sade dokunmatik numpad — kilit ekranı için yeterli.
const KEYS: { k: string; d: string }[][] = [
  [{ k: '1', d: '1' }, { k: '2', d: '2' }, { k: '3', d: '3' }],
  [{ k: '4', d: '4' }, { k: '5', d: '5' }, { k: '6', d: '6' }],
  [{ k: '7', d: '7' }, { k: '8', d: '8' }, { k: '9', d: '9' }],
  [{ k: '', d: '' }, { k: '0', d: '0' }, { k: '⌫', d: 'back' }],
];

function Numpad({
  onPress,
  disabled,
  pinLen,
}: {
  onPress: (d: string) => void;
  disabled: boolean;
  pinLen: number;
}) {
  return (
    <View style={styles.numpad}>
      {KEYS.map((row, ri) => (
        <View key={ri} style={styles.numRow}>
          {row.map((cell, ci) => {
            if (cell.d === '') return <View key={ci} style={styles.numKeyGhost} />;
            const isBack = cell.d === 'back';
            const keyDisabled = disabled || (isBack && pinLen === 0);
            return (
              <TouchableRipple
                key={ci}
                onPress={() => onPress(cell.d)}
                disabled={keyDisabled}
                rippleColor="rgba(99,102,241,0.3)"
                style={[styles.numKey, isBack && styles.numKeyBack, keyDisabled && styles.numKeyOff]}
              >
                <View style={styles.numKeyInner}>
                  {isBack ? (
                    <Icon source="backspace-outline" size={28} color="#fecaca" />
                  ) : (
                    <Text style={styles.numKeyText}>{cell.k}</Text>
                  )}
                </View>
              </TouchableRipple>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: C.bg, zIndex: 9999, elevation: 9999 },
  safe: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, alignSelf: 'stretch', justifyContent: 'center' },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerText: { alignItems: 'flex-start' },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lockLabel: { color: C.sub, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  name: { color: C.text, fontSize: 22, fontWeight: '800' },
  prompt: { color: C.sub, fontSize: 15, textAlign: 'center', marginTop: 4 },
  dots: { flexDirection: 'row', gap: 14, marginTop: 8 },
  dot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: C.border },
  dotFilled: { backgroundColor: C.accent, borderColor: C.accent },
  dotError: { borderColor: C.error },
  numpad: { gap: 12, maxWidth: 360, width: '100%', marginTop: 6 },
  numRow: { flexDirection: 'row', gap: 12 },
  numKey: {
    flex: 1,
    height: 68,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
    overflow: 'hidden',
  },
  numKeyBack: { backgroundColor: '#3f1d1f', borderColor: '#7f1d1d' },
  numKeyOff: { opacity: 0.4 },
  numKeyGhost: { flex: 1, height: 68 },
  numKeyInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  numKeyText: { color: C.text, fontSize: 30, fontWeight: '700' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  statusText: { color: C.sub, fontSize: 14 },
  errorText: { color: C.error, fontSize: 14, fontWeight: '600' },
  actions: { alignItems: 'center', gap: 6, marginTop: 4 },
  cardBtn: { borderRadius: 12 },
  cardBtnContent: { minHeight: 52, paddingHorizontal: 12 },
});
