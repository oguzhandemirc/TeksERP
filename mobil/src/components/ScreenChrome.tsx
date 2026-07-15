import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Appbar, Text, Menu, TouchableRipple, Icon, Divider } from 'react-native-paper';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { useLockStore } from '../store/lockStore';
import { usePermissions } from '../hooks/usePermission';
import { useDeviceType, useIsPortrait } from '../hooks/useDeviceType';
import { useLogout } from '../hooks/useLogout';
import LogoutModals from './LogoutModals';
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
  /** true: 2. kat uçlara-yaslı (space-between) — caller sol/sağ yerleşimi verir
   *  (bkz. HeaderSecondRow `spread`). false (varsayılan): doğal genişlik + kayar. */
  secondRowSpread?: boolean;
  /** true: makine adı çipini (PlaceChip) HİÇ gösterme — makine adını ekranın
   *  kendisi başka yerde (ör. subtitle) gösteriyorsa. */
  hidePlaceChip?: boolean;
  children: React.ReactNode;
}

export default function ScreenChrome({
  title,
  subtitle,
  onBack,
  onStepBack,
  headerExtras,
  secondRow,
  secondRowSpread,
  hidePlaceChip,
  children,
}: Props) {
  const user = useAuthStore((s) => s.user);
  const lock = useLockStore((s) => s.lock);
  const { hasMultipleMobileScreens } = usePermissions();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const rootNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const [menuVisible, setMenuVisible] = useState(false);
  // Çıkış akışı (offline-onay + "çıkış yapılıyor" göstergesi) paylaşımlı hook'ta.
  const { confirm, setConfirm, busy, runLogout, requestLogout } = useLogout();
  // Tablet: "Makine değiştir / Bölüm değiştir" profil menüsünde (nadir/arıza-durumu
  // işlemleri — açık yerde durmasın). Modal, menü kapansa da yaşasın diye burada.
  const placeActions = usePlaceActions();
  const [machinePickerOpen, setMachinePickerOpen] = useState(false);

  // Zaten ana sayfadaysak (Modül Seçimi) ev tuşu çıkmasın — kendine gitmek anlamsız.
  // TABLETTE ev ikonu hiç çıkmaz: bölüm değiştirme, profil menüsünde
  // ("Bölüm değiştir" — Ayarlar'ın altında). Telefon eski davranışı korur.
  const isTablet = useDeviceType() === 'tablet';
  const isPortrait = useIsPortrait();
  const onHomeScreen = route.name === 'ModuleSelect';
  const showHome = hasMultipleMobileScreens && !onBack && !onHomeScreen && !isTablet;
  // Telefonda ana sayfada (dashboard = ModuleSelect) profil tuşunda isim GİZLİ —
  // dar ekranda modül grid'i başlığıyla sıkışmasın; yalnız ikon kalır. Aynı sebeple
  // Fason Sevk'te de dikey konumdayken gizli (form alanları + header pill'leri dar
  // ekranda sıkışıyor); yatayda veya tablette isim yazılır (isim menüde tekrarlanmaz).
  const onFasonSevkScreen = route.name === 'FasonSevk';
  const showUserName = !(
    (!isTablet && onHomeScreen) ||
    (!isTablet && onFasonSevkScreen && isPortrait)
  );
  // popTo, navigate DEĞİL: v7'de navigate() stack'teki mevcut ekrana geri sarmaz,
  // hep YENİ kopya push eder — her bölüm değişimi eski istasyon ekranlarını mount
  // bırakıp stack'i sınırsız büyütüyordu (arka planda canlı gate/effect yükü).
  // popTo: ModuleSelect stack'te varsa ona geri sarar (üstteki istasyon ekranları
  // unmount olur), yoksa mevcut ekranın yerine açar — stack hep küçük kalır.
  const goHome = () => navigation.popTo('ModuleSelect');
  const insets = useSafeAreaInsets();

  const openSettings = () => {
    setMenuVisible(false);
    rootNav.navigate('Settings');
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
            {/* Bulunulan makine ADI (salt gösterge — PlaceChip kendi kendini
                gate'ler). Ekranın 2. katı VARSA (dar telefon) oraya iner —
                başlığın yanında sıkışmasın; yoksa (tablet) burada, başlığın
                hemen yanında kalır. hidePlaceChip → hiç gösterilmez (makine adı
                subtitle'a taşınmışsa). */}
            {!secondRow && !hidePlaceChip && <PlaceChip />}
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
                {/* Kullanıcı adı — telefonda dashboard'da gizli (yalnız ikon);
                    tablet + diğer ekranlarda yazılır. */}
                {showUserName && (
                  <Text style={styles.userTriggerName} numberOfLines={1}>
                    {operatorName}
                  </Text>
                )}
              </View>
            </TouchableRipple>
          }
        >
          {/* İlk satır — HANGİ KULLANICI olduğun. YALNIZ tetik butonunda ad gizliyken
              (telefon dashboard / Fason Sevk dikey — orada sadece ikon var). Ad zaten
              butonda yazıyorsa menüde TEKRAR ETME (çift isim olmasın). */}
          {!showUserName && (
            <>
              <View style={styles.menuHeader}>
                <Icon source="account-circle" size={22} color="#4f46e5" />
                <View style={styles.menuHeaderText}>
                  <Text style={styles.menuHeaderName} numberOfLines={1}>
                    {operatorName}
                  </Text>
                  {user?.fullName?.trim() && user?.username && user.fullName.trim() !== user.username && (
                    <Text style={styles.menuHeaderSub} numberOfLines={1}>
                      @{user.username}
                    </Text>
                  )}
                </View>
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
            onPress={() => {
              setMenuVisible(false);
              requestLogout();
            }}
            title="Çıkış"
            style={styles.menuItem}
            titleStyle={styles.menuItemTitle}
          />
        </Menu>
      </Appbar.Header>

      {/* 2. kat — makine adı çipi (hidePlaceChip değilse) İLK öğe olarak eklenir,
          ekranın secondRow içeriği devamına gelir. hidePlaceChip → yalnız ekranın
          kendi içeriği (KK1: "Bu oturum" / "Son Kayıtlar" uçlara yaslı). */}
      {secondRow && (
        <HeaderSecondRow spread={secondRowSpread}>
          {!hidePlaceChip && <PlaceChip />}
          {secondRow}
        </HeaderSecondRow>
      )}

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

      {/* Çıkış akışı modalları (offline-onay + "çıkış yapılıyor") — paylaşımlı. */}
      <LogoutModals
        confirm={confirm}
        busy={busy}
        onCancelConfirm={() => setConfirm(null)}
        onConfirmLogout={() => {
          setConfirm(null);
          void runLogout();
        }}
      />
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
  // Menü ilk satırı — giriş yapan operatörün adı (kim olduğun). Menü yüzeyi beyaz →
  // koyu metin. Ad + (varsa) @kullanıcı-adı alt satır.
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    maxWidth: 340,
  },
  menuHeaderText: { flexShrink: 1 },
  menuHeaderName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  menuHeaderSub: { fontSize: 13, color: '#64748b', marginTop: 1 },
  // Menü maddeleri — saha dokunma hedefi (min 56dp kuralı) + büyük yazı.
  menuItem: { height: 58, maxWidth: 340 },
  menuItemTitle: { fontSize: 17 },
  // Menü penceresi barın alt kenarından başlasın (tetik bar içinde yukarıda bitiyor).
  menu: { marginTop: 12 },
  content: { flex: 1 },
});
