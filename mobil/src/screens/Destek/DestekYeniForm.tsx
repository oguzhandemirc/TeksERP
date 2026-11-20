// Yeni talep formu — görünüm. Tür üç büyük düğme (seçici modal değil, tek
// dokunuş); konu + mesaj; ekran görüntüsü önizlemesi (çiz / kaldır); aydınlatma.
// Bağlam (ekran, sürüm, cihaz) kullanıcıya SORULMAZ, yalnız bilgi olarak yazılır.
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput, TouchableRipple } from 'react-native-paper';

import { colors, radius, spacing } from '../../theme';
import type { DestekTur } from '../../services/destek.service';
import type { YakalananEkran, DrawingResult } from '../../store/destekTaslakStore';
import { KONU_AZAMI, type DestekFormValue, type FormErrors } from './destekForm';
import { AYDINLATMA, TUR_ETIKET } from './destekMetin';

const TURLER: { tur: DestekTur; simge: string }[] = [
  { tur: 'BUG', simge: 'bug-outline' },
  { tur: 'QUESTION', simge: 'help-circle-outline' },
  { tur: 'REQUEST', simge: 'lightbulb-on-outline' },
];

export function TurSecici({
  secili,
  onSec,
  hata,
}: {
  secili: DestekTur | null;
  onSec: (t: DestekTur) => void;
  hata?: string;
}) {
  return (
    <View>
      <View style={styles.turSatir}>
        {TURLER.map(({ tur, simge }) => (
          <Button
            key={tur}
            mode={secili === tur ? 'contained' : 'outlined'}
            icon={simge}
            onPress={() => onSec(tur)}
            style={styles.turDugme}
            contentStyle={styles.turIcerik}
            labelStyle={styles.turEtiket}
            accessibilityState={{ selected: secili === tur }}
          >
            {TUR_ETIKET[tur]}
          </Button>
        ))}
      </View>
      {hata ? <HelperText type="error">{hata}</HelperText> : null}
    </View>
  );
}

export function EkranOnizleme({
  ekran,
  result,
  onCiz,
  onKaldir,
}: {
  ekran: YakalananEkran | null;
  result: DrawingResult | null;
  onCiz: () => void;
  onKaldir: () => void;
}) {
  if (!ekran) {
    return <Text style={styles.bilgi}>Ekran görüntüsü eklenmeyecek (yalnız yazılı talep).</Text>;
  }
  return (
    <View style={styles.onizlemeKutu}>
      <TouchableRipple onPress={onCiz} accessibilityLabel="Ekran görüntüsünün üzerine çiz">
        <Image
          source={{ uri: result?.onizlemeUri ?? ekran.uri }}
          style={[styles.onizleme, { aspectRatio: ekran.width / Math.max(1, ekran.height) }]}
          resizeMode="contain"
        />
      </TouchableRipple>
      <View style={styles.onizlemeDugmeler}>
        <Button mode="contained-tonal" icon="draw" onPress={onCiz} contentStyle={styles.buyuk}>
          {result ? 'Çizimi düzenle' : 'Üzerine çiz / gizle'}
        </Button>
        <Button mode="text" icon="image-remove" onPress={onKaldir} contentStyle={styles.buyuk}>
          Görüntüyü çıkar
        </Button>
      </View>
    </View>
  );
}

export function MetinAlanlari({
  form,
  setForm,
  hatalar,
}: {
  form: DestekFormValue;
  setForm: (f: DestekFormValue) => void;
  hatalar: FormErrors;
}) {
  return (
    <View style={styles.alanlar}>
      <TextInput
        mode="outlined"
        label="Konu"
        value={form.konu}
        onChangeText={(konu) => setForm({ ...form, konu })}
        maxLength={KONU_AZAMI}
        error={!!hatalar.konu}
      />
      {hatalar.konu ? <HelperText type="error">{hatalar.konu}</HelperText> : null}
      <TextInput
        mode="outlined"
        label="Ne oldu? Ne bekliyordunuz?"
        value={form.mesaj}
        onChangeText={(mesaj) => setForm({ ...form, mesaj })}
        multiline
        numberOfLines={5}
        style={styles.mesaj}
        error={!!hatalar.mesaj}
      />
      {hatalar.mesaj ? <HelperText type="error">{hatalar.mesaj}</HelperText> : null}
    </View>
  );
}

export function Aydinlatma({ ekranAdi }: { ekranAdi: string | null }) {
  return (
    <View style={styles.aydinlatma}>
      {ekranAdi ? <Text style={styles.bilgi}>Ekran: {ekranAdi} · sürüm ve cihaz bilgisi otomatik eklenir.</Text> : null}
      <Text style={styles.bilgi}>{AYDINLATMA}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  turSatir: { flexDirection: 'row', gap: spacing.sm },
  turDugme: { flex: 1, borderRadius: radius.md },
  turIcerik: { height: 56 },
  turEtiket: { fontSize: 16, fontWeight: '700', marginHorizontal: 4 },
  onizlemeKutu: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  onizleme: { width: '100%', maxHeight: 260, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  onizlemeDugmeler: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  buyuk: { height: 56 },
  alanlar: { gap: spacing.xs },
  mesaj: { minHeight: 120 },
  aydinlatma: { gap: spacing.xs },
  bilgi: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
});
