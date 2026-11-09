// Tek İE formunun sol sütunu ("belgeden gelenler"): belge yokken tek büyük "Belgeyi okut" + tek satır yardım;
// belge varken satır kartı tek form kipinde (yeniden okutma belge satırında ikon, dev düğme yok).
// Kamera sayfaları verince gönderim kendiliğinden başlar: o sırada yalnız kompakt "Belge okunuyor…" (küçük resim + ilerleme);
// sayfa listesi + gönder/vazgeç paneli (`ScannerSection`) YALNIZ gönderim düştüğünde (yeniden dene / klasik kamera / vazgeç) çizilir.
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { Button, ProgressBar, Text } from 'react-native-paper';
import type { ScanPage, SubmitProgress } from '../docScan';
import { colors, radius, spacing, typography } from '../../../../theme';
import { ScannerSection } from './DocBatchView';
import DocRowCard, { FoldField, type DocRowOpenRequest } from './DocRowCard';
import type { useUnifiedWoForm } from './useUnifiedWoForm';

type FormModel = ReturnType<typeof useUnifiedWoForm>;

export default function DocColumn({ u, openRequest }: { u: FormModel; openRequest: DocRowOpenRequest | null }) {
  const { wo, row, scan, done, fields } = u;
  if (row) {
    // Önizleme yalnız bu satırın notu bu cihazda okutulduysa (sayfaların yerel kopyası `done.sent`).
    const sent = scan.b.done?.note.id === row.noteId ? scan.b.done.sent : [];
    // Kat tipi gramajın altında (üstte görünürse); gizlenmişse sağdaki "Diğer alanlar"da kalır.
    const fold = u.hasTambur && fields.isTop('katTipi')
      ? <FoldField values={u.foldValues} value={u.form.extras.foldType} locked={done || wo.saving} onChange={(v) => u.edit({ foldType: v })} />
      : null;
    return (
      <DocRowCard row={row} wo={wo} customers={u.customers} customersLoading={u.customersLoading} hideGramaj={fields.isOther('gramaj') || u.partyGramaj} afterGramaj={fold}
        variant="single" onReread={u.manual ? u.addDoc : u.okut} manual={u.manual && wo.isManual(row.noteId)} onDraftCancelled={u.dropDoc} openRequest={openRequest} partyPlan={u.partyPlan}
        onPreview={sent.length > 0 ? () => scan.setSentIndex(0) : undefined} />
    );
  }
  if (scan.b.sending) return <ReadingStatus pages={scan.b.pages} progress={scan.b.progress} />;
  return (
    <>
      {u.manual && !done && (
        <Button mode="outlined" icon="pencil-outline" onPress={u.draft.start} loading={u.draft.busy} disabled={u.draft.busy || wo.saving}
          contentStyle={styles.bigBtn} labelStyle={styles.bigLabel} testID="ie-belgesiz-baslat">
          {u.draft.busy ? 'Belgesiz form hazırlanıyor…' : 'Belgesiz devam et'}
        </Button>
      )}
      {!done && (
        <Button mode="contained" icon="file-document-outline" onPress={u.okut} disabled={wo.saving || scan.source.busy}
          contentStyle={styles.bigBtn} labelStyle={styles.bigLabel} testID="ie-belge-okut">
          Belgeyi okut
        </Button>
      )}
      {/* Yer tutucu tek satır: müşteri/parti/metre okutunca burada belirir (ayrı sönük şeritler yok). */}
      <View testID="ie-form-belge-yer-tutucu">
        <Text style={styles.help}>Kamerayı belgeye tutun; müşteri, parti ve metre kendiliğinden dolar.</Text>
      </View>
      {/* Gönderim düştü (ağ / okunamadı): bekleyen sayfalar + "Yeniden dene" / "Vazgeç" / klasik kamera. */}
      {(scan.b.pages.length > 0 || scan.b.headerLocked) && (
        <ScannerSection b={scan.b} hasRows={false} onAdd={scan.source.add} busy={scan.source.busy} onClassic={scan.openCamera} onRemove={scan.remove} onOpen={scan.setPreviewIndex} />
      )}
    </>
  );
}

/** Gönderim sürerken tek kompakt satır: ilk sayfanın küçük resmi + "Belge okunuyor…" + yüklenen sayfa ilerlemesi. */
export function ReadingStatus({ pages, progress }: { pages: readonly ScanPage[]; progress: SubmitProgress }) {
  const total = pages.length;
  const done = pages.filter((p) => progress.uploaded.has(p.sha256)).length;
  const first = pages[0];
  return (
    <View style={styles.reading} testID="ie-belge-okunuyor" accessibilityLabel="Belge okunuyor" accessibilityLiveRegion="polite">
      {first ? <Image source={{ uri: first.uri }} style={styles.thumb} resizeMode="cover" /> : null}
      <View style={styles.readingBody}>
        <View style={styles.readingHead}>
          <ActivityIndicator size="small" color={colors.brand} />
          <Text style={styles.readingTitle}>Belge okunuyor…</Text>
        </View>
        <ProgressBar progress={total > 0 ? Math.max(0.1, done / total) : 0.1} color={colors.brand} style={styles.bar} />
        {total > 1 ? <Text style={styles.readingSub}>{`${done}/${total} sayfa gönderildi`}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bigBtn: { minHeight: 80 },
  bigLabel: { fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  help: { fontSize: typography.size.base, color: colors.textSecondary },
  reading: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 80, padding: spacing.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  thumb: { width: 64, height: 80, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  readingBody: { flex: 1, gap: spacing.xs },
  readingHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  readingTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold, color: colors.text },
  readingSub: { fontSize: typography.size.sm, color: colors.textSecondary },
  bar: { height: 6, borderRadius: 3 },
});
