// Öneri çipi (K4P-TABLET, plan §4.1 md. 5): kalite seçicinin yanında; tek dokunuş öneriyi
// kalite alanına yazar. Otomatik doldurma YOK (öneri ≠ kilit) — operatör seçmezse alan bugünkü gibi.
import React from 'react';
import { StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import * as Haptics from 'expo-haptics';
import { palette } from '../../../theme/tokens';
import { fmtPer100 } from '../../../components/inspection/InspectionSummaryStrip';
import type { PreviewState } from '../../../components/inspection/useInspectionPreview';
import type { QualityGrade } from '../../../types/models';

interface Props {
  preview: PreviewState;
  grades: QualityGrade[];
  selectedCode: string;
  onApply: (code: string) => void;
}

/** Çip metni + uygulanabilir kod (saf). Öneri yoksa null. */
export function suggestionChipModel(preview: PreviewState, grades: QualityGrade[]): { text: string; code: string | null } | null {
  const s = preview.data?.suggested;
  if (preview.status !== 'ok' || !s) return null;
  const grade = s.code ? grades.find((g) => g.code === s.code) : undefined;
  const parts = [grade?.name ?? s.code ?? null, s.label, fmtPer100(preview.data?.pointsPer100M2)].filter((p): p is string => !!p);
  return { text: `ÖNERİ: ${parts.join(' · ')}`, code: grade ? grade.code : null };
}

export default function InspectionSuggestionChip({ preview, grades, selectedCode, onApply }: Props) {
  const model = suggestionChipModel(preview, grades);
  if (!model) return null;
  const applied = model.code != null && model.code === selectedCode;
  return (
    <TouchableRipple
      testID="kk1-inspection-suggestion"
      disabled={model.code == null || applied}
      onPress={() => {
        if (!model.code) return;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onApply(model.code);
      }}
      style={[styles.chip, applied && styles.applied]}
    >
      <Text style={[styles.text, applied && styles.appliedText]}>{applied ? `${model.text} ✓` : model.text}</Text>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', minHeight: 56, justifyContent: 'center', borderRadius: 12, paddingHorizontal: 16, backgroundColor: palette.amber[100], borderWidth: 2, borderColor: palette.amber[600], marginTop: 8 },
  applied: { backgroundColor: palette.emerald[50], borderColor: palette.emerald[600] },
  text: { fontSize: 20, fontWeight: '900', color: palette.amber[900] },
  appliedText: { color: palette.emerald[800] },
});
