// Destek ekranlarının ortak başlığı — geri + başlık (+ isteğe bağlı sağ eylem).
// ScreenChrome KULLANILMAZ: onun profil menüsünde "Sorun bildir" var; destek
// ekranının içinden yeni destek akışı başlatmak döngü olurdu.
import React from 'react';
import { StyleSheet } from 'react-native';
import { Appbar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../../theme';

export default function DestekHeader({
  baslik,
  altBaslik,
  sag,
  onGeri,
}: {
  baslik: string;
  altBaslik?: string;
  sag?: React.ReactNode;
  onGeri?: () => void;
}) {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const geri = onGeri ?? (() => (nav.canGoBack() ? nav.goBack() : undefined));
  return (
    <Appbar.Header style={styles.bar} elevated statusBarHeight={insets.top}>
      <Appbar.BackAction onPress={geri} color={colors.textOnDark} />
      <Appbar.Content
        title={baslik}
        subtitle={altBaslik}
        titleStyle={styles.baslik}
        subtitleStyle={styles.alt}
      />
      {sag}
    </Appbar.Header>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.headerBg },
  baslik: { color: colors.textOnDark, fontWeight: '700' },
  alt: { color: colors.textOnDarkMuted },
});
