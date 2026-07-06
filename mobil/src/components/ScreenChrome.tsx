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
import { useDeviceType } from '../hooks/useDeviceType';
import { performLogout, pendingStationOpsCount, isOnline } from '../offline/sessionSwitch';
import AppModal from './AppModal';
import PlaceChip from './session/PlaceChip';
import { usePlaceActions, MachinePickerModal } from './session/PlaceActions';
import HeaderSecondRow from './HeaderSecondRow';
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
  /** Appbar'ın ALTINDA opsiyonel 2. satır — birincil bara sığmayan aksiyonlar
   *  (dar telefon ekranı) için. Bkz. HeaderSecondRow. Verilmezse render edilmez. */
  secondRow?: React.ReactNode;
  children: React.ReactNode;
}

export default function ScreenChrome({
  title,
  subtitle,
  onBack,
  onStepBack,
  headerExtras,
  secondRow,
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
  // Tablet: "Makine değiştir / Bölüm değiştir" profil menüsünde (nadir/arıza-durumu
  // işlemleri — açık yerde durmasın). Modal, menü kapansa da yaşasın diye burada.
  const placeActions = usePlaceActions();
  const [machinePickerOpen, setMachinePickerOpen] = useState(false);

  // Zaten ana sayfadaysak (Modül Seçimi) ev tuşu çıkmasın — kendine gitmek anlamsız.
  // TABLETTE ev ikonu hiç çıkmaz: bölüm değiştirme, profil menüsünde
  // ("Bölüm değiştir" — Ayarlar'ın altında). Telefon eski davranışı korur.
  const isTablet = useDeviceType() === 'tablet';
  const onHomeScreen = route.name === 'ModuleSelect';
  const showHome = hasMultipleMobileScreens && !onBack && !onHomeScreen && !isTablet;
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
            accessibilityLabel="Bölüm değiştir"
          />
        )}
        <View
          style={[
            styles.appbarContent,
            // Solda ikon yoksa (tablet: ev ikonu kalktı) başlık kenara yapışmasın —
            // içerik kolonuyla (ör. Manuel Giriş kutusu, 16px) aynı hizaya gelsin.
            !onBack && !onStepBack && !showHome && styles.appbarContentNoLead,
          ]}
        >
          <View style={styles.titleRow}>
            {title ? (
              <Text variant="titleLarge" style={styles.title} numberOfLines={1}>
                {title}
              </Text>
            ) : null}
            {/* Bulunulan makine ADI — başlığın hemen yanında. Yalnız oturumlu
                istasyon ekranlarında görünür (PlaceChip kendi kendini gate'ler).
                Tablette SALT GÖSTERGE (değiştirme profil menüsünde); telefonda
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
          // Tetik (profil ikonu) barın içinde birkaç px yukarıda biter — menüyü
          // barın ALT KENARINDAN başlat (üstüne binmesin).
          style={styles.menu}
          anchor={
            <TouchableRipple
              onPress={() => setMenuVisible(true)}
              rippleColor="rgba(255,255,255,0.15)"
              style={styles.userTrigger}
              accessibilityLabel="Kullanıcı menüsü"
            >
              <View style={styles.userTriggerInner}>
                {/* size 18: pill iç yüksekliği yazı satırıyla (13px→~18) eş kalsın —
                    diğer header pill'leriyle piksel-eş boy. */}
                <Icon source="account-circle" size={18} color="#fff" />
                {/* Kullanıcı adı — tablette görünür (telefonda yer dar, yalnız ikon). */}
                {isTablet && (
                  <Text style={styles.userTriggerName} numberOfLines={1}>
                    {operatorName}
                  </Text>
                )}
              </View>
            </TouchableRipple>
          }
        >
          {/* Menü başlığı (kim giriş yaptı) — YALNIZ telefonda: tablette ad zaten
              tetik butonunda yazıyor, menüde tekrar etmesin. */}
          {!isTablet && (
            <>
              <View style={styles.menuHeader}>
                <Icon source="account-circle" size={22} color="#475569" />
                <Text style={styles.menuHeaderName} numberOfLines={1}>
                  {operatorName}
                </Text>
              </View>
              <Divider />
            </>
          )}
          <Menu.Item
            leadingIcon="cog"
            onPress={openSettings}
            title="Ayarlar"
            style={styles.menuItem}
            titleStyle={styles.menuItemTitle}
          />
          {/* Tablet: nadir yer-değiştirme işlemleri — Ayarlar'ın ALTINDA.
              Görünürlük kuralları usePlaceActions'ta (tek makine / tek bölüm → gizli). */}
          {(placeActions.showMachine || placeActions.showStation) && (
            <>
              <Divider />
              {placeActions.showMachine && (
                <Menu.Item
                  leadingIcon="swap-horizontal"
                  onPress={() => {
                    setMenuVisible(false);
                    setMachinePickerOpen(true);
                  }}
                  title="Makine değiştir"
                  style={styles.menuItem}
                  titleStyle={styles.menuItemTitle}
                />
              )}
              {placeActions.showStation && (
                <Menu.Item
                  leadingIcon="view-grid"
                  onPress={() => {
                    setMenuVisible(false);
                    goHome();
                  }}
                  title="Bölüm değiştir"
                  style={styles.menuItem}
                  titleStyle={styles.menuItemTitle}
                />
              )}
            </>
          )}
          <Divider />
          <Menu.Item
            leadingIcon="lock"
            onPress={doLock}
            title="Kilitle / operatör değiştir"
            style={styles.menuItem}
            titleStyle={styles.menuItemTitle}
          />
          <Divider />
          <Menu.Item
            leadingIcon="logout"
            onPress={doLogout}
            title="Çıkış"
            style={styles.menuItem}
            titleStyle={styles.menuItemTitle}
          />
        </Menu>
      </Appbar.Header>

      {secondRow && <HeaderSecondRow>{secondRow}</HeaderSecondRow>}

      {/* paddingBottom: Android nav bar (gesture/buton) + dock içeriğin üstüne
          binmesin diye alt safe-area inset'i bırakılır. Tüm ScreenChrome
          ekranları (sticky footer'lar dahil) bundan faydalanır. */}
      <View style={[styles.content, { paddingBottom: insets.bottom }]}>{children}</View>

      {/* Makine seçme modalı (profil menüsü → Makine değiştir). Menü kapansa da
          yaşasın diye burada — menü içinde olsaydı kapanınca unmount olurdu. */}
      {placeActions.expectedKind && (
        <MachinePickerModal
          visible={machinePickerOpen}
          expectedKind={placeActions.expectedKind}
          onClose={() => setMachinePickerOpen(false)}
        />
      )}

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
  // Baştaki ikonsuz düzen (tablet): içerik padding'iyle (16) hizalı başlık.
  appbarContentNoLead: { paddingLeft: 16 },
  // Profil tetiği — kendini belli eden DOLU marka-indigo buton (diğer soluk
  // pill'lerden ayrışır); ölçüler aynı (radius 10 + paddingV 9 → eş boy).
  userTrigger: {
    borderRadius: 10,
    backgroundColor: '#4f46e5',
    borderWidth: 1,
    borderColor: '#818cf8',
    overflow: 'hidden',
    marginHorizontal: 4,
  },
  userTriggerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  userTriggerName: { color: '#fff', fontWeight: '700', fontSize: 13, maxWidth: 160 },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 170,
  },
  menuHeaderName: { fontWeight: '700', color: '#0f172a', fontSize: 15, flexShrink: 1 },
  // Menü maddeleri — saha dokunma hedefi (min 56dp kuralı) + büyük yazı.
  menuItem: { height: 58, maxWidth: 340 },
  menuItemTitle: { fontSize: 17 },
  // Menü penceresi barın alt kenarından başlasın (tetik bar içinde yukarıda bitiyor).
  menu: { marginTop: 12 },
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
