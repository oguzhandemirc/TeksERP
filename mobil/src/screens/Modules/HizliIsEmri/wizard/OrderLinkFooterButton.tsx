// El terminali düzeni: "Sipariş Bağla" adım ①'in gövdesinden alt çubuğa, İLERİ'nin yanına taşınır —
// dikey telefonda gövde okutulan top tablosuna kalır, bağ düğmesi başparmak hizasında durur.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';

import { colors, radius } from '../../../../theme';

export default function OrderLinkFooterButton({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <TouchableRipple
      onPress={onPress}
      style={[styles.btn, count > 0 && styles.active]}
      rippleColor="rgba(79,70,229,0.12)"
      accessibilityLabel="Sipariş bağla"
      testID="order-link-footer"
    >
      <View style={styles.inner}>
        <Icon source="link-variant" size={22} color={colors.brand} />
        <Text style={styles.text} numberOfLines={1}>
          {count > 0 ? `${count} sipariş` : 'Sipariş Bağla'}
        </Text>
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  btn: {
    // İLERİ ile EŞİT genişlik ve yükseklik (NewWorkOrderView navBtnPrimary flex 7, minHeight 62) — 4:7 orantısız duruyordu.
    flex: 7,
    minHeight: 62,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  active: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  text: { color: colors.brand, fontSize: 15, fontWeight: '700' },
});
