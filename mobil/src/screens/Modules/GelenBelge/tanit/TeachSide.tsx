// Tanıtmanın sağ/alt paneli: aşama şeridi (sabit) + kayan aşama içeriği + Kaydet çubuğu (sabit). Serbest işaretleme kipinde
// eski panel + eksikler + önizleme.
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { colors, spacing, typography } from '../../../../theme';
import GuidedPanel from './GuidedPanel';
import StageBar from './StageBar';
import { STAGES, canAdvance, canReach, saveSummary, stageDone, stageIndex, stageIssues } from './stages';
import TeachPanel from './TeachPanel';
import TeachPreview from './TeachPreview';
import type { StageNav } from './useStageNav';
import type { TeachModalState } from './useTeachModal';

export default function TeachSide({ t, nav }: { t: TeachModalState; nav: StageNav }) {
  const state = t.state!;
  const words = t.words.data?.words ?? [];
  const preview = { result: t.preview, fresh: t.previewFresh, error: t.previewError, blocked: t.previewBlocked };
  return (
    <View style={styles.side}>
      {!nav.advanced && (
        <StageBar
          current={nav.stage}
          done={(st) => stageDone(state, words, nav.stage, st)}
          reachable={(st) => canReach(state, words, nav.stage, st)}
          onGo={(st) => nav.goTo(st, state)}
        />
      )}
      <ScrollView style={styles.side} contentContainerStyle={styles.sideBody} keyboardShouldPersistTaps="handled">
        {nav.advanced ? (
          <>
            <TeachPanel state={state} words={words} onChange={t.setState} old={t.existing?.template ?? null} />
            {t.problems.length > 0 && (
              <View testID="tanit-eksikler">
                {t.problems.map((p) => (
                  <Text key={p} style={styles.warn}>
                    • {p}
                  </Text>
                ))}
              </View>
            )}
            {t.preview && <TeachPreview result={t.preview} stale={!t.previewFresh} />}
          </>
        ) : (
          <GuidedPanel
            state={state}
            words={words}
            onChange={t.setState}
            stage={nav.stage}
            target={nav.target}
            onTarget={nav.setTarget}
            preview={preview}
            onAdoptSimilar={t.existing ? undefined : t.adoptSimilar}
          />
        )}
      </ScrollView>
      <SaveBar t={t} nav={nav} />
    </View>
  );
}

/** Kaydet çubuğu: ①② "İleri" (+ hazırsa Kaydet), ③ özet + Kaydet; pasif düğmenin altında tek satır neden. */
function SaveBar({ t, nav }: { t: TeachModalState; nav: StageNav }) {
  const saveLabel = t.existing ? 'Tanımı kaydet' : 'Belge tipini kaydet';
  if (nav.advanced) {
    return (
      <View style={styles.saveBar} testID="tanit-kaydet-cubugu">
        <View style={styles.actions}>
          <Button mode="outlined" icon="eye" onPress={() => void t.runPreview()} disabled={t.problems.length > 0 || t.busy !== null} loading={t.busy === 'preview'} contentStyle={styles.btn} testID="tanit-onizle">
            Önizle
          </Button>
          <Button mode="contained" icon="content-save" onPress={() => void t.save()} disabled={!t.canSave} loading={t.busy === 'save'} contentStyle={styles.btn} testID="tanit-kaydet">
            {saveLabel}
          </Button>
        </View>
      </View>
    );
  }
  const state = t.state!;
  const words = t.words.data?.words;
  const last = nav.stage === 'KURALLAR';
  const stageBlock = stageIssues(state, words, nav.stage)[0]?.text;
  const reason = last ? (t.problems[0] ?? null) : (stageBlock ?? null);
  const next = STAGES[stageIndex(nav.stage) + 1]?.key;
  return (
    <View style={styles.saveBar} testID="tanit-kaydet-cubugu">
      {reason && <Text style={styles.warn} testID="tanit-kaydet-neden">{last ? `Kaydetmek için: ${reason}` : `İlerlemek için: ${reason}`}</Text>}
      {last && <Text style={styles.summary} testID="tanit-ozet">{saveSummary(state)}</Text>}
      <View style={styles.actions}>
        {(last || t.canSave) && (
          <Button mode={last ? 'contained' : 'outlined'} icon="content-save" onPress={() => void t.save()} disabled={!t.canSave} loading={t.busy === 'save'} contentStyle={styles.btn} testID="tanit-kaydet">
            {saveLabel}
          </Button>
        )}
        {next && (
          <Button mode="contained" icon="arrow-right" onPress={() => nav.goTo(next, state)} disabled={!canAdvance(state, words, nav.stage)} contentStyle={styles.btn} testID="tanit-ileri">
            İleri
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  side: { flex: 1 },
  sideBody: { gap: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },
  saveBar: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm },
  btn: { minHeight: 56 },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  summary: { fontSize: typography.size.base, color: colors.text },
});
