// Belge Tara — gönderim sonrası okuma sonucu kartı (durum + neden + özet + eylemler).
// Satırlar `flexWrap` ile dizilir: tablet yatayda tek sıra, telefon dikeyde alt alta kırılır.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { colors, radius, spacing, typography } from '../../../theme';
import { readResultView, shouldPoll, type ReadTone, type ReadWatch } from './readResult';

interface Props {
  watch: ReadWatch;
  noteNo: string;
  actions: { onAddPage: () => void; onDone: () => void; onRecheck: () => void };
}

const TONE: Record<ReadTone, { bg: string; fg: string }> = {
  busy: { bg: colors.surfaceMuted, fg: colors.text },
  ok: { bg: colors.successContainer, fg: colors.successText },
  warn: { bg: colors.warningContainer, fg: colors.warningText },
  error: { bg: colors.dangerContainer, fg: colors.dangerText },
};

export default function ReadResultCard({ watch, noteNo, actions }: Props) {
  const v = readResultView(watch, noteNo);
  const tone = TONE[v.tone];
  const canRecheck = watch.phase === 'timeout' || watch.phase === 'error';
  return (
    <View style={[styles.box, { backgroundColor: tone.bg }]} testID="belge-tara-sonuc">
      <View style={styles.head}>
        {shouldPoll(watch) && <ActivityIndicator size="small" testID="belge-tara-sonuc-bekle" />}
        <Text style={[styles.title, { color: tone.fg }]} testID="belge-tara-sonuc-baslik">
          {v.title}
        </Text>
      </View>
      {v.reason && (
        <Text style={styles.reason} testID="belge-tara-sonuc-neden">
          {v.reason}
        </Text>
      )}
      <View style={styles.rows}>
        {v.rows.map((r) => (
          <View key={r.key} style={styles.cell} testID={`belge-tara-sonuc-${r.key}`}>
            <Text style={styles.label}>{r.label}</Text>
            <Text style={[styles.value, r.tone && r.tone !== 'ok' ? { color: TONE[r.tone].fg } : null]}>{r.value}</Text>
          </View>
        ))}
      </View>
      {v.notes.map((n) => (
        <Text key={n} style={styles.note}>
          • {n}
        </Text>
      ))}
      <View style={styles.actions}>
        {canRecheck && (
          <Button mode="text" onPress={actions.onRecheck} contentStyle={styles.btn} testID="belge-tara-sonuc-yeniden">
            Yeniden bak
          </Button>
        )}
        <Button mode="outlined" icon="camera-plus" onPress={actions.onAddPage} contentStyle={styles.btn} testID="belge-tara-sonuc-sayfa">
          Yeni sayfa çek
        </Button>
        <Button mode="contained" icon="check" onPress={actions.onDone} contentStyle={styles.btn} testID="belge-tara-sonuc-bitti">
          Bitti
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: spacing.lg, borderRadius: radius.md, gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  reason: { fontSize: typography.size.base, color: colors.text },
  rows: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  cell: { minWidth: 120 },
  label: { fontSize: typography.size.xs, color: colors.textSecondary },
  value: { fontSize: typography.size.xl, fontWeight: typography.weight.semibold, color: colors.text },
  note: { fontSize: typography.size.sm, color: colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  btn: { minHeight: 56 },
});
