import React, { useEffect, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Appbar, Text, Menu, TouchableRipple, Icon, Divider } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useAuthStore } from '../store/authStore';
import { usePermissions } from '../hooks/usePermission';
import type { MainStackParamList, RootStackParamList } from '../navigation/types';

function isLandscapeOrientation(o: ScreenOrientation.Orientation): boolean {
  return (
    o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
    o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
  );
}

interface Props {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Appbar.Content'ten sonra, sağdaki sistem aksiyonlarından önce render edilir.
   *  Ekran-spesifik tetikler (örn. Tambur'da "Açık İşler") için. */
  headerExtras?: React.ReactNode;
  children: React.ReactNode;
}

export default function ScreenChrome({ title, subtitle, onBack, headerExtras, children }: Props) {
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
    void clearAuth();
  };

  const { width: winW, height: winH } = useWindowDimensions();
  // Compact portrait (telefon dikey) — kullanıcı tetikleyicisi sadece profil
  // ikonu olur; yer kazancı header'da diğer aksiyonlara nefes aldırır.
  const compactPortrait = winH > winW && winW < 600;

  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    let mounted = true;
    void ScreenOrientation.getOrientationAsync().then((o) => {
      if (mounted) setIsLandscape(isLandscapeOrientation(o));
    });
    const sub = ScreenOrientation.addOrientationChangeListener((evt) => {
      setIsLandscape(isLandscapeOrientation(evt.orientationInfo.orientation));
    });
    return () => {
      mounted = false;
      ScreenOrientation.removeOrientationChangeListener(sub);
    };
  }, []);

  const toggleOrientation = () => {
    void ScreenOrientation.lockAsync(
      isLandscape
        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
        : ScreenOrientation.OrientationLock.LANDSCAPE,
    );
  };

  return (
    <View style={styles.root}>
      <Appbar.Header style={styles.appbar} elevated statusBarHeight={insets.top}>
        {onBack && <Appbar.BackAction onPress={onBack} color="#fff" />}
        {showHome && (
          <Appbar.Action icon="home" onPress={goHome} color="#fff" accessibilityLabel="Ana sayfa" />
        )}
        <Appbar.Content
          title={title}
          subtitle={subtitle}
          titleStyle={styles.title}
          style={styles.appbarContent}
        />

        <Appbar.Action
          icon={isLandscape ? 'phone-rotate-portrait' : 'phone-rotate-landscape'}
          onPress={toggleOrientation}
          color="#fff"
          accessibilityLabel={isLandscape ? 'Dikey yap' : 'Yatay yap'}
        />
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
                {compactPortrait ? (
                  // Compact portrait: sadece profil ikonu (username text yer harcıyor)
                  <Icon source="account-circle" size={24} color="#cbd5e1" />
                ) : (
                  <>
                    <Text variant="bodyMedium" style={styles.userText}>
                      {user?.username ?? ''}
                    </Text>
                    <Icon source="chevron-down" size={18} color="#cbd5e1" />
                  </>
                )}
              </View>
            </TouchableRipple>
          }
        >
          <Menu.Item
            leadingIcon="server-network"
            onPress={openSettings}
            title="Sunucu Ayarları"
          />
          <Divider />
          <Menu.Item leadingIcon="logout" onPress={doLogout} title="Çıkış" />
        </Menu>

        {/* Side-menu / ekran-spesifik tetikleyici en sağda */}
        {headerExtras}
      </Appbar.Header>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  appbar: { backgroundColor: '#0f172a' },
  // RN Paper Appbar.Content title bazı sürümlerde center hizalar; sola sabitle.
  title: { color: '#fff', fontWeight: '700', textAlign: 'left' },
  // Content view'i sola hizala — title kenara dayalı. paddingLeft 15: tamamen
  // yapışık olmasın, ufak nefes payı.
  appbarContent: { alignItems: 'flex-start', paddingLeft: 15 },
  userTrigger: { borderRadius: 8, marginHorizontal: 4 },
  userTriggerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  userText: { color: '#cbd5e1', fontWeight: '600' },
  content: { flex: 1 },
});
