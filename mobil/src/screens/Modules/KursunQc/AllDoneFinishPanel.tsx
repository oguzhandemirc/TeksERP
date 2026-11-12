// =============================================================================
// Bütün toplar tamam → "Adımı Kapat" paneli (Gülkesim provası 2026-11-06)
// =============================================================================
// Son top tamamlanınca seçim boşalır; "Adımı Kapat" yalnız seçili topun altbilgisinde
// olduğu için operatör "Top seçilmedi" ekranında kalıyor, iş sonraki istasyona hiç
// düşmüyordu. Seçili top yokken kart hazırsa kapanış burada, tek dokunuşla.
// =============================================================================

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { colors, palette } from '../../../theme/tokens';
import TruncatedText from '../../../components/TruncatedText';
import { allDoneHint, finishStepLabel } from './stationPanels';

interface Props {
  rollCount: number;
  /** Sunucunun `nextStepName` alanı (undefined = eski backend → "Tambur"). */
  nextStepName: string | null | undefined;
  onFinish: () => void;
}

export default function AllDoneFinishPanel({ rollCount, nextStepName, onFinish }: Props) {
  return (
    <View style={styles.wrap} testID="kursun-all-done">
      <Icon source="check-circle-outline" size={64} color={palette.emerald[600]} />
      <Text style={styles.title}>Bütün toplar tamamlandı ({rollCount})</Text>
      <TruncatedText style={styles.hint}>{allDoneHint(nextStepName)}</TruncatedText>
      <Button
        mode="contained"
        icon="flag-checkered"
        onPress={onFinish}
        buttonColor={palette.blue[800]}
        style={styles.btn}
        contentStyle={styles.btnContent}
        labelStyle={styles.btnLabel}
        testID="kursun-all-done-finish"
      >
        {finishStepLabel(nextStepName)}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, textAlign: 'center' },
  hint: { fontSize: 16, color: colors.textSecondary, textAlign: 'center' },
  btn: { marginTop: 8, alignSelf: 'center', maxWidth: 520, width: '100%' },
  btnContent: { minHeight: 64 },
  btnLabel: { fontSize: 18, fontWeight: '700' },
});
