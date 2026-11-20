// =============================================================================
// Destek girişleri — destek KAPALIYSA hiçbiri render edilmez (null).
// =============================================================================
//  · DestekMenuOgeleri: profil menüsündeki "Sorun bildir" + "Taleplerim".
//    Okutma akışını bölmemek için kasıtlı olarak MENÜDE durur: ekranda kalıcı
//    düğme yok, okutma kutularının odağını çalmaz, iki dokunuş ister
//    (yanlışlıkla basılmaz). Her ScreenChrome ekranında aynı yerde.
//  · DestekRozetNoktasi: profil düğmesinin köşesinde okunmamış noktası.
//  · DestekCipi: Bölüm Seçimi başlığında "Destek" + okunmamış sayısı.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Divider, Icon, Text, TouchableRipple } from 'react-native-paper';

import AppMenu from '../../components/AppMenu';
import { rootNavigationRef } from '../../navigation/navigationRef';
import { colors, radius, spacing } from '../../theme';
import { rozetMetni } from './destekGorunurluk';
import { useDestekEtkin, useDestekOkunmamis } from './useDestek';
import { useSorunBildir } from './useSorunBildir';

function taleplerimeGit(): void {
  if (rootNavigationRef.isReady()) rootNavigationRef.navigate('DestekTaleplerim');
}

export function DestekMenuOgeleri({ menuyuKapat }: { menuyuKapat: () => void }) {
  const etkin = useDestekEtkin();
  const rozet = rozetMetni(useDestekOkunmamis());
  const sorunBildir = useSorunBildir();
  if (!etkin) return null;
  return (
    <>
      <Divider />
      <AppMenu.Item
        leadingIcon="message-alert-outline"
        title="Sorun bildir"
        onPress={() => {
          menuyuKapat();
          sorunBildir();
        }}
        style={styles.menuItem}
        titleStyle={styles.menuItemTitle}
      />
      <AppMenu.Item
        leadingIcon="lifebuoy"
        title={rozet ? `Taleplerim (${rozet} yeni)` : 'Taleplerim'}
        onPress={() => {
          menuyuKapat();
          taleplerimeGit();
        }}
        style={styles.menuItem}
        titleStyle={styles.menuItemTitle}
      />
    </>
  );
}

export function DestekRozetNoktasi() {
  const rozet = rozetMetni(useDestekOkunmamis());
  if (!rozet) return null;
  return <View style={styles.nokta} accessibilityLabel="Yeni destek yanıtı var" />;
}

export function DestekCipi({ yalnizSimge }: { yalnizSimge: boolean }) {
  const etkin = useDestekEtkin();
  const rozet = rozetMetni(useDestekOkunmamis());
  if (!etkin) return null;
  return (
    <TouchableRipple
      onPress={taleplerimeGit}
      rippleColor="rgba(255,255,255,0.15)"
      style={styles.cip}
      accessibilityLabel={rozet ? `Destek, ${rozet} yeni yanıt` : 'Destek'}
    >
      <View style={styles.cipIc}>
        <Icon source="lifebuoy" size={18} color={colors.textOnDark} />
        {!yalnizSimge && <Text style={styles.cipMetin}>Destek</Text>}
        {rozet && (
          <View style={styles.sayi}>
            <Text style={styles.sayiMetin}>{rozet}</Text>
          </View>
        )}
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  menuItem: { height: 58, maxWidth: 340 },
  menuItemTitle: { fontSize: 17 },
  nokta: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 10,
    height: 10,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    borderWidth: 1,
    borderColor: colors.textOnDark,
  },
  cip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.textOnDarkMuted,
    overflow: 'hidden',
    marginRight: spacing.sm,
  },
  cipIc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  cipMetin: { color: colors.textOnDark, fontWeight: '700', fontSize: 13 },
  sayi: {
    minWidth: 20,
    paddingHorizontal: 5,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sayiMetin: { color: colors.textOnDark, fontSize: 12, fontWeight: '700' },
});
