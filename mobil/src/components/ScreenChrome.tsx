import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Appbar, Text, Menu, TouchableRipple, Icon, Divider, Button } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { useLockStore } from '../store/lockStore';
import { usePermissions } from '../hooks/usePermission';
import { performLogout, pendingStationOpsCount, isOnline } from '../offline/sessionSwitch';
import AppModal from './AppModal';
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
  const lock = useLockStore((s) => s.lock);
  const { hasMultipleMobileScreens } = usePermissions();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const [menuVisible, setMenuVisible] = useState(false);
  // Offline + bekleyen istasyon yazımı varken çıkış: uyar + onay iste.
  const [logoutConfirm, setLogoutConfirm] = useState<{ pending: number } | null>(null);

  // Zaten ana sayfadaysak (Modül Seçimi) ev tuşu çıkmasın — kendine gitmek anlamsız.
  const onHomeScreen = route.name === 'ModuleSelect';
  const showHome = hasMultipleMobileScreens && !onBack && !onHomeScreen;
  const goHome = () => navigation.navigate('ModuleSelect');
  const insets = useSafeAreaInsets();

  const openSettings = () => {
    setMenuVisible(false);
    rootNav.navigate('Settings');
  };

  // Çıkış: ÖNCE A token'ıyla flush → oturum kapat → clearAuth → cache düş
  // (performLogout). Offline + kuyrukta istasyon yazımı varsa: uyar + onay iste
  // (onaysız çıkışta kayıtlar gönderilemez).
  const runLogout = () => void performLogout();
  const doLogout = () => {
    setMenuVisible(false);
    const pending = pendingStationOpsCount();
    if (!isOnline() && pending > 0) {
      Toast.show({
        type: 'error',
        text1: 'İnternet yok — bekleyen kayıtlar var',
        text2: `${pending} istasyon kaydı henüz gönderilmedi. Şimdi çıkarsan gönderilemez.`,
        visibilityTime: 6000,
      });
      setLogoutConfirm({ pending });
      return;
    }
    runLogout();
  };

  // Kilitle → LockScreen açılır (çalışma oturumu açık kalır); farklı operatör
  // kart/PIN ile hızlı geçebilir, aynı operatör kilidi açar.
  const doLock = () => {
    setMenuVisible(false);
    lock();
  };

  const operatorName = user?.fullName || user?.username || '—';

  return (
    <View style={styles.root}>
      <Appbar.Header style={styles.appbar} elevated statusBarHeight={insets.top}>
        {onBack && <Appbar.BackAction onPress={onBack} color="#fff" />}
        {/* Önceki adım (geri) — ev ikonunun SOLUNDA, hep aynı yerde. */}
        {onStepBack && (
          <Appbar.BackAction onPress={onStepBack} color="#fff" accessibilityLabel="Önceki adım" />
        )}
        {showHome && (
          <Appbar.Action
            icon="view-grid"
            onPress={goHome}
            color="#fff"
            accessibilityLabel="İstasyon değiştir"
          />
        )}
        <View style={styles.appbarContent}>
          <View style={styles.titleRow}>
            {title ? (
              <Text variant="titleLarge" style={styles.title} numberOfLines={1}>
                {title}
              </Text>
            ) : null}
            {/* Bulunulan makine ADI — başlığın hemen yanında. Yalnız oturumlu
                istasyon ekranlarında görünür (PlaceChip kendi kendini gate'ler);
                dokununca yer/makine değiştirme açılır. */}
            <PlaceChip />
          </View>
          {subtitle && (
            <Text variant="labelMedium" style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

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
              {operatorName}
            </Text>
          </View>
          <Divider />
          <Menu.Item
            leadingIcon="cog"
            onPress={openSettings}
            title="Ayarlar"
          />
          <Divider />
          <Menu.Item leadingIcon="lock" onPress={doLock} title="Kilitle / operatör değiştir" />
          <Divider />
          <Menu.Item leadingIcon="logout" onPress={doLogout} title="Çıkış" />
        </Menu>
      </Appbar.Header>

      {/* paddingBottom: Android nav bar (gesture/buton) + dock içeriğin üstüne
          binmesin diye alt safe-area inset'i bırakılır. Tüm ScreenChrome
          ekranları (sticky footer'lar dahil) bundan faydalanır. */}
      <View style={[styles.content, { paddingBottom: insets.bottom }]}>{children}</View>

      {/* Offline + bekleyen kayıt varken çıkış onayı — kayıp riski açıkça belirtilir. */}
      <AppModal
        visible={!!logoutConfirm}
        onDismiss={() => setLogoutConfirm(null)}
        swipeToDismiss={false}
      >
        <View style={styles.confirmCard}>
          <Icon source="wifi-off" size={40} color="#ef4444" />
          <Text style={styles.confirmTitle}>Bağlantı yok</Text>
          <Text style={styles.confirmBody}>
            {logoutConfirm?.pending ?? 0} istasyon kaydı gönderilmeyi bekliyor. Şimdi çıkarsan bu
            kayıtlar gönderilemeden silinir. Yine de çıkmak istiyor musun?
          </Text>
          <View style={styles.confirmActions}>
            <Button mode="text" textColor="#475569" onPress={() => setLogoutConfirm(null)}>
              Vazgeç
            </Button>
            <Button
              mode="contained"
              buttonColor="#dc2626"
              onPress={() => {
                setLogoutConfirm(null);
                runLogout();
              }}
            >
              Yine de çık
            </Button>
          </View>
        </View>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  appbar: { backgroundColor: '#0f172a' },
  // RN Paper Appbar.Content title bazı sürümlerde center hizalar; sola sabitle.
  // flexShrink: makine çipi yanına sığsın diye başlık gerekirse kısalır.
  title: { color: '#fff', fontWeight: '700', textAlign: 'left', flexShrink: 1 },
  // Başlık + makine çipi yan yana.
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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

  confirmCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  confirmTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  confirmBody: { fontSize: 15, color: '#475569', textAlign: 'center', lineHeight: 21 },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    alignSelf: 'stretch',
    marginTop: 4,
  },
});
