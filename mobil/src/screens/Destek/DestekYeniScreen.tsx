// Yeni destek talebi — ince kabuk. Mantık `useDestekYeni`, görünüm `DestekYeniForm`.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, HelperText } from 'react-native-paper';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '../../theme';
import { useDestekTaslakStore } from '../../store/destekTaslakStore';
import { useAuthStore } from '../../store/authStore';
import type { RootStackParamList } from '../../navigation/types';
import DestekHeader from './DestekHeader';
import { Aydinlatma, EkranOnizleme, MetinAlanlari, TurSecici } from './DestekYeniForm';
import { useDestekYeni } from './useDestekYeni';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function DestekYeniScreen() {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const oturumVar = useAuthStore((s) => !!s.user);
  const ekran = useDestekTaslakStore((s) => s.ekran);
  const result = useDestekTaslakStore((s) => s.result);
  const ekranAdi = useDestekTaslakStore((s) => s.ekranAdi);
  const ekraniKaldir = useDestekTaslakStore((s) => s.ekraniKaldir);
  const { form, setForm, hatalar, gonderHatasi, gonderiliyor, gonder } = useDestekYeni();

  return (
    <View style={styles.kok}>
      <DestekHeader baslik="Sorun bildir" />
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.icerik, { paddingBottom: spacing.xxxl + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
      >
        <TurSecici secili={form.tur} onSec={(tur) => setForm({ ...form, tur })} hata={hatalar.tur} />
        <MetinAlanlari form={form} setForm={setForm} hatalar={hatalar} />
        <EkranOnizleme
          ekran={ekran}
          result={result}
          onCiz={() => nav.navigate('DestekCizim')}
          onKaldir={ekraniKaldir}
        />
        {gonderHatasi ? (
          <HelperText type="error" style={styles.hata}>
            {gonderHatasi}
          </HelperText>
        ) : null}
        <Button
          mode="contained"
          icon="send"
          onPress={gonder}
          loading={gonderiliyor}
          disabled={gonderiliyor || !oturumVar}
          contentStyle={styles.gonderIcerik}
          labelStyle={styles.gonderEtiket}
        >
          {gonderiliyor ? 'Gönderiliyor…' : gonderHatasi ? 'Tekrar gönder' : 'Gönder'}
        </Button>
        <Aydinlatma ekranAdi={ekranAdi} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  kok: { flex: 1, backgroundColor: colors.appBg },
  icerik: { padding: spacing.lg, gap: spacing.md, maxWidth: 760, width: '100%', alignSelf: 'center' },
  hata: { fontSize: 15 },
  gonderIcerik: { height: 60 },
  gonderEtiket: { fontSize: 18, fontWeight: '700' },
});
