// =============================================================================
// LockScreen — hareketsizlik kilidi ekranı
// =============================================================================
// Kilit ekranı = login ekranının AYNISI (operatör tanıdık düzenle karşılaşsın);
// tek fark: operatör HAZIR seçili gelir ve başarıda "giriş" değil KİLİT AÇMA /
// operatör GEÇİŞİ yapılır. Bu yüzden ekran LoginScreen'i `lock` prop'uyla
// render eder; tüm giriş yöntemleri (şifre / hızlı-PIN / QR kart) LoginScreen'in
// kendi akışından gelir.
//
// Unlock semantiği:
//   - Dönen user == mevcut user  → token tazele + kilidi aç (kick eski oturumu
//     düşürdüğü için yeni token benimsenir; fullName korunur).
//   - Farklı user → performSwitch (A flush→kapat→cache düş→B setAuth→init),
//     SessionGate yeni operatöre yeri yeniden sordurur.
// "Çıkış" (login'e dön) her zaman kaçış yolu olarak durur (LockHeader'da kırmızı).
// SESSION_EXISTS (409) çakışma onayı LoginScreen içinde ele alınır — wrapper'ın
// ayrıca useSessionConflict'e ihtiyacı yok.
// =============================================================================

import React, { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import LoginScreen from '../../screens/Auth/LoginScreen';
import { useAuthStore } from '../../store/authStore';
import { useLockStore } from '../../store/lockStore';
import { performLogout, performSwitch } from '../../offline/sessionSwitch';
import type { LoginResponse } from '../../types/auth';

export default function LockScreen() {
  const user = useAuthStore((s) => s.user);
  const unlock = useLockStore((s) => s.unlock);

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
        const outcome = await performSwitch({ user: next, token, fullName: next.fullName });
        if (outcome.pendingCount > 0) {
          // A'nın gönderilemeyen kayıtları cihazda bekliyor — B'nin oturumunda
          // bağlantı gelince otomatik akar; operatör değişimi bilgiden mahrum kalmasın.
          Toast.show({
            type: 'info',
            text1: `${outcome.pendingCount} kayıt bekletildi`,
            text2: 'Bağlantı gelince otomatik gönderilecek.',
            visibilityTime: 6000,
          });
        }
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      unlock();
    },
    [unlock],
  );

  // Re-entrancy guard: tavanlı çıkış (≤9sn) sürerken çift dokunuş ikinci bir
  // flush akışı başlatmasın (adımlar idempotent ama çift POST/toast gereksiz).
  const logoutInFlight = useRef(false);
  const doLogout = useCallback(() => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    void (async () => {
      try {
        const outcome = await performLogout();
        if (outcome.pendingCount > 0) {
          Toast.show({
            type: 'info',
            text1: `${outcome.pendingCount} kayıt bekletildi`,
            text2: 'Kayıtlar cihazda güvende — girişten sonra otomatik gönderilecek.',
            visibilityTime: 6000,
          });
        }
        unlock();
      } catch {
        // clearAuth (SecureStore) hatası — kilitte kalmak güvenli taraf;
        // operatör tekrar dener. Sessiz unhandled rejection bırakma.
        Toast.show({
          type: 'error',
          text1: 'Çıkış tamamlanamadı',
          text2: 'Lütfen tekrar deneyin.',
          visibilityTime: 6000,
        });
      } finally {
        logoutInFlight.current = false;
      }
    })();
  }, [unlock]);

  if (!user) return null;

  return (
    // onStartShouldSetResponder: kilit ekranının BOŞ alanlarına yapılan dokunmalar
    // arkadaki (gizli) app'e sızmasın — kök View responder'ı yutar; iç bileşenler
    // daha derin oldukları için kendi dokunmalarını yine alır.
    <View style={styles.root} onStartShouldSetResponder={() => true}>
      <LoginScreen lock={{ user, onAuthenticated: applyUnlock, onLogout: doLogout }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0f172a', zIndex: 9999, elevation: 9999 },
});
