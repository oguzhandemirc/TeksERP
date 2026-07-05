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

import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
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
        await performSwitch({ user: next, token, fullName: next.fullName });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      unlock();
    },
    [unlock],
  );

  const doLogout = useCallback(() => {
    void (async () => {
      await performLogout();
      unlock();
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
