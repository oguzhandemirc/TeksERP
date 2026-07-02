import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Appbar, Text, Menu, TouchableRipple, Icon, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import { usePermissions } from '../hooks/usePermission';
import PlaceChip from './session/PlaceChip';
import type { MainStackParamList, RootStackParamList } from '../navigation/types';

interface Props {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Ekran-içi "önceki adıma dön" — home'u GİZLEMEZ; home'un yanında ok olarak
   *  çıkar. Modül içi alt-adım (örn. paketleme → sipariş seçimi) için. */
  onStepBack?: () => void;
  /** Appbar.Content'ten sonra, sağdaki sistem aksiyonlarından önce render edilir.
   *  Ekran-spesifik tetikler (örn. Tambur'da "Açık İşler") için. */
  headerExtras?: React.ReactNode;
  children: React.ReactNode;
}

export default function ScreenChrome({
  title,
  subtitle,
  onBack,
  onStepBack,
  headerExtras,
  children,
}: Props) {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const { hasMultipleMobileScreens } = usePermissions();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [menuVisible, setMenuVisible] = useState(false);

  const showHome = hasMultipleMobileScreens && !onBack;
  const goHome = () => navigation.navigate('ModuleSelect');
  const insets = useSafeAreaInsets();

  const openSettings = () => {
    setMenuVisible(false);
    rootNav.navigate('Settings');
  };
  const doLogout = () => {
    setMenuVisible(false);
    void (async () => {
      // Önce çalışma oturumunu kapat (LOGOUT — ayak izi temiz biter; token henüz
      // geçerliyken). Offline'da best-effort: yerel state yine sıfırlanır.
      await useSessionStore.getState().closeSession();
      useSessionStore.getState().reset();
      await clearAuth();
    })();
  };

  return (
    <View style={styles.root}>
      <Appbar.Header style={styles.appbar} elevated statusBarHeight={insets.top}>
        {onBack && <Appbar.BackAction onPress={onBack} color="#fff" />}
        {/* Önceki adım (geri) — ev ikonunun SOLUNDA, hep aynı yerde. */}
        {onStepBack && (
          <Appbar.BackAction onPress={onStepBack} color="#fff" accessibilityLabel="Önceki adım" />
        )}
        {showHome && (
          <Appbar.Action icon="home" onPress={goHome} color="#fff" accessibilityLabel="Ana sayfa" />
        )}
        <View style={styles.appbarContent}>
          {title ? (
            <Text variant="titleLarge" style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {subtitle && (
            <Text variant="labelMedium" style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

        {/* Yer çipi — yalnız oturumlu ekranlarda görünür (route'a göre kendisi karar
            verir); dokununca yer değiştirme modalı (PlaceConfirmView) açılır. */}
        <PlaceChip />

        {/* Ekran-spesifik tetikleyici — profilden önce, profil en sağda kalsın */}
        {headerExtras}

        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchorPosition="bottom"
          anchor={
            <TouchableRipple
              onPress={() => setMenuVisible(true)}
              rippleColor="rgba(255,255,255,0.15)"
              style={styles.userTrigger}
              accessibilityLabel="Kullanıcı menüsü"
            >
              <View style={styles.userTriggerInner}>
                <Icon source="account-circle" size={26} color="#cbd5e1" />
              </View>
            </TouchableRipple>
          }
        >
          {/* Menü başlığı — tıklayınca kim giriş yaptıysa adı görünür. */}
          <View style={styles.menuHeader}>
            <Icon source="account-circle" size={22} color="#475569" />
            <Text style={styles.menuHeaderName} numberOfLines={1}>
              {user?.username ?? '—'}
            </Text>
          </View>
          <Divider />
          <Menu.Item
            leadingIcon="cog"
            onPress={openSettings}
            title="Ayarlar"
          />
          <Divider />
          <Menu.Item leadingIcon="logout" onPress={doLogout} title="Çıkış" />
        </Menu>
      </Appbar.Header>
      {/* paddingBottom: Android nav bar (gesture/buton) + dock içeriğin üstüne
          binmesin diye alt safe-area inset'i bırakılır. Tüm ScreenChrome
          ekranları (sticky footer'lar dahil) bundan faydalanır. */}
      <View style={[styles.content, { paddingBottom: insets.bottom }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  appbar: { backgroundColor: '#0f172a' },
  // RN Paper Appbar.Content title bazı sürümlerde center hizalar; sola sabitle.
  title: { color: '#fff', fontWeight: '700', textAlign: 'left' },
  subtitle: { textAlign: 'left', color: '#cbd5e1' },
  // Content view'i sola hizala — title kenara dayalı. paddingLeft 4: ufak nefes
  // payı, ev/back ikonuna yakın dursun (telefonda sağdaki aksiyon butonları için yer açar).
  // flex: 1 de vererek available space'i kaplamasını garanti edelim.
  // justifyContent: 'center' ekleyerek dikeyde ortalayalım.
  appbarContent: { alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 4, flex: 1 },
  userTrigger: { borderRadius: 8, marginHorizontal: 4 },
  userTriggerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 170,
  },
  menuHeaderName: { fontWeight: '700', color: '#0f172a', fontSize: 14, flexShrink: 1 },
  content: { flex: 1 },
});
