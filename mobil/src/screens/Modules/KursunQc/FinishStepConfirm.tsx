// GK (2026-11-10): "İşi Bitir" özetli onay sayfası — Vazgeç / İşi Bitir. Özet `finishSummary.ts`ten.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import ModuleSheet from '../../../components/ModuleSheet';
import { colors, palette } from '../../../theme/tokens';
import { finishQuestion, uncheckedWarning, type FinishSummary } from './finishSummary';

interface Props {
  summary: FinishSummary | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function FinishStepConfirm({ summary, onConfirm, onCancel }: Props) {
  const warn = summary ? uncheckedWarning(summary) : null;
  return (
    <ModuleSheet
      visible={summary != null}
      onDismiss={onCancel}
      title="İşi bitir"
      size="sm"
      footer={
        <>
          <Button onPress={onCancel} testID="kursun-finish-cancel">Vazgeç</Button>
          <Button mode="contained" icon="flag-checkered" onPress={onConfirm} testID="kursun-finish-confirm">İşi Bitir</Button>
        </>
      }
    >
      {summary && <Text style={styles.question} testID="kursun-finish-question">{finishQuestion(summary)}</Text>}
      {warn && (
        <View style={styles.warn} testID="kursun-finish-unchecked">
          <Icon source="alert-outline" size={20} color={palette.amber[700]} />
          <Text style={styles.warnText}>{warn}</Text>
        </View>
      )}
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  question: { fontSize: 18, fontWeight: '700', color: colors.text },
  warn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.amber[50], borderColor: palette.amber[300], borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  warnText: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: palette.amber[900] },
});
