// Üst çubuk başlığı = liste anahtarı: "[Terbiye İş Emirleri] / Dokuma İş Emirleri". Seçili ad dolu düğme, diğeri
// pasif (çerçeveli) düğme; dokununca liste değişir, adlar yer DEĞİŞTİRMEZ (yalnız vurgu). Yeni satır açılmaz.
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { colors, radius, spacing, typography } from '../../../../theme';
import { anahtarAdlari, type IsEmriTuru } from './dokumaListe';

interface Props {
  etkin: IsEmriTuru;
  onSec: (t: IsEmriTuru) => void;
}

export default function IsEmriTuruAnahtari({ etkin, onSec }: Props) {
  const adlar = anahtarAdlari();
  const wide = useWindowDimensions().width >= 720;
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {adlar.map((a, i) => {
        const secili = a.tur === etkin;
        return (
          <React.Fragment key={a.tur}>
            {i > 0 && <Text style={styles.slash} importantForAccessibility="no">/</Text>}
            <TouchableRipple
              onPress={() => !secili && onSec(a.tur)}
              style={[styles.btn, secili ? styles.btnOn : styles.btnOff]}
              borderless
              accessibilityRole="tab"
              accessibilityState={{ selected: secili }}
              accessibilityLabel={secili ? `${a.ad}, seçili` : `${a.ad} listesine geç`}
              testID={`ie-tur-${a.tur}`}
            >
              <Text style={[styles.text, secili ? styles.textOn : styles.textOff]} numberOfLines={1}>{wide ? a.ad : a.kisa}</Text>
            </TouchableRipple>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  slash: { color: colors.textOnDarkMuted, fontSize: typography.size.xl, fontWeight: typography.weight.regular },
  btn: { minHeight: 56, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1.5, flexShrink: 1 },
  btnOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  btnOff: { backgroundColor: colors.headerBg, borderColor: colors.textOnDarkMuted },
  text: { fontSize: typography.size.lg },
  textOn: { color: colors.textOnDark, fontWeight: typography.weight.bold },
  textOff: { color: colors.textOnDarkMuted, fontWeight: typography.weight.medium },
});
