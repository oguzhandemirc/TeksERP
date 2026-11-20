// Ekran görüntüsü üzerine çizim — ince kabuk (mantık `useDestekCizim`).
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '../../theme';
import DestekHeader from './DestekHeader';
import CizimAracCubugu from './CizimAracCubugu';
import CizimTuvali from './CizimTuvali';
import { useDestekCizim } from './useDestekCizim';

export default function DestekCizimScreen() {
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const c = useDestekCizim(() => nav.goBack());

  const bittiDugmesi = (
    <Button
      mode="contained"
      icon="check"
      onPress={() => void c.bitti()}
      loading={c.kaydediliyor}
      disabled={c.kaydediliyor || !c.ekran}
      contentStyle={styles.bittiIcerik}
      style={styles.bitti}
    >
      Bitti
    </Button>
  );

  return (
    <View style={[styles.kok, { paddingBottom: insets.bottom }]}>
      <DestekHeader baslik="Üzerine çiz" sag={bittiDugmesi} />
      <View style={styles.alan} onLayout={c.onAlan}>
        {c.ekran && c.boyut.width > 0 ? (
          <CizimTuvali
            tuvalRef={c.tuvalRef}
            goruntuUri={c.ekran.uri}
            boyut={c.boyut}
            sekiller={c.durum.sekiller}
            aktif={c.durum.aktif}
            arac={c.arac}
            renk={c.renk}
            dispatch={c.dispatch}
          />
        ) : !c.ekran ? (
          <Text style={styles.bos}>Ekran görüntüsü yok.</Text>
        ) : null}
      </View>
      <View style={styles.cubuk}>
        <CizimAracCubugu
          arac={c.arac}
          renk={c.renk}
          bosMu={c.durum.sekiller.length === 0}
          onArac={c.setArac}
          onRenk={c.setRenk}
          onGeriAl={() => c.dispatch({ tip: 'geriAl' })}
          onTemizle={() => c.dispatch({ tip: 'temizle' })}
        />
        <Text style={styles.ipucu}>Gizlemek istediğiniz bilgiyi göz simgesiyle karartın.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  kok: { flex: 1, backgroundColor: colors.headerBg },
  alan: { flex: 1, margin: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  bos: { color: colors.textOnDark },
  cubuk: { padding: spacing.sm, gap: spacing.xs, alignItems: 'center' },
  ipucu: { color: colors.textOnDarkMuted, fontSize: 13, textAlign: 'center' },
  bitti: { marginRight: spacing.sm },
  bittiIcerik: { height: 48 },
});
