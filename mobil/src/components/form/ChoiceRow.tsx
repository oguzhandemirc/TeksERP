// Seçenek satırı kalıbı (kullanıcı kararı 2026-11-09, her genişlikte): soru kutu/çip DEĞİL — üstte küçük soluk başlık satırı
// (etiket · ek · kısa durum, sonda küçük ? ikonu), altında seçenekler tam genişlikte. `ChoiceRow` = başlık + eşit genişlikte
// düğmeler (ChoiceChips `fill`); seçenek olmayan gövde (not, çoklu etiket bulutu) `InlineField`e çocuk olarak verilir.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';
import { ChoiceChips, type ChoiceChipsProps } from './ChoiceChips';
import { colors, spacing, typography } from '../../theme';

interface Props {
  label: string;
  aside?: string | null;
  /** Ek metnin testID'si (vars. yok). */
  asideTestID?: string;
  status?: string | null;
  testID: string;
  children?: React.ReactNode;
}

export function InlineField({ label, aside, asideTestID, status, testID, children }: Props) {
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.caption} testID={`${testID}-baslik`}>
        <Text style={styles.label}>{label}</Text>
        {aside ? <><Text style={styles.aside}>·</Text><Text style={styles.aside} testID={asideTestID}>{aside}</Text></> : null}
        {status ? <><Text style={styles.aside}>·</Text><Text style={styles.aside} testID={`${testID}-durum`}>{status}</Text></> : null}
        <Icon source="help-circle-outline" size={16} color={colors.textMuted} />
      </View>
      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

type ChoiceRowProps = Omit<Props, 'children' | 'testID'> & { rowTestID: string } & ChoiceChipsProps;

/** Etiket + seçenek düğmeleri: tek ortak satır (Kumaş nasıl geldi? · Gramaj · Kat tipi · Makine seç). */
export function ChoiceRow({ label, aside, asideTestID, status, rowTestID, ...chips }: ChoiceRowProps) {
  return (
    <InlineField label={label} aside={aside} asideTestID={asideTestID} status={status} testID={rowTestID}>
      <ChoiceChips {...chips} fill />
    </InlineField>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  caption: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.xs },
  label: { fontSize: 13, fontWeight: typography.weight.semibold, color: colors.textSecondary },
  aside: { fontSize: 13, color: colors.textMuted },
  body: { alignSelf: 'stretch' },
});
