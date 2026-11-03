// Önizleme kartı: bu şablonla bu belge nasıl okunur (sunucu `POST /sablonlar/oneri`; yazmaz). Panel `TeachPreview` ikizi.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { colors, radius, spacing, typography } from '../../../../theme';
import type { SuggestResult } from '../../../../types/inboundDocTeach';
import { FIELD_OPTIONS } from './teachDraft';

const FIELD_LABEL: Record<string, string> = Object.fromEntries(FIELD_OPTIONS.map((f) => [f.key, f.label]));
const DIRECTION: Record<string, string> = { right: 'sağında', below: 'altında' };

/** Açıklama satırı: "Parti No ← 'Ham PartiNo' sağında" ya da konumdan. */
export function explainText(e: SuggestResult['explain'][number]): string {
  const label = FIELD_LABEL[e.field] ?? e.field;
  if (e.strategy === 'anchor' && e.label) return `${label} ← "${e.label}" ${DIRECTION[e.direction ?? ''] ?? 'yanında'}`;
  return `${label} ← sayfadaki konumundan (yanında basılı etiket bulunamadı)`;
}

export default function TeachPreview({ result, stale }: { result: SuggestResult; stale: boolean }) {
  const p = result.preview;
  return (
    <View style={styles.box} testID="tanit-onizleme">
      <Text style={styles.title}>Önizleme — bu şablonla bu belge</Text>
      {stale && (
        <Text style={styles.warn} testID="tanit-onizleme-bayat">
          İşaretleme değişti; kaydetmeden önce yeniden önizleyin.
        </Text>
      )}
      {result.errors.map((e) => (
        <Text key={e} style={styles.error}>
          {e}
        </Text>
      ))}
      {p && (
        <>
          <Text style={p.matched ? styles.ok : styles.warn} testID="tanit-onizleme-eslesme">
            {p.matched
              ? `Belge bu tip olarak tanınıyor (puan ${Math.round(p.score * 100)}).`
              : `Belge bu kimlik yazılarıyla tanınmıyor (puan ${Math.round(p.score * 100)}); daha belirgin kimlik yazıları seçin.`}
          </Text>
          <View testID="tanit-onizleme-alanlar">
            {Object.entries(p.fields).map(([k, v]) => (
              <View key={k} style={styles.row}>
                <Text style={styles.label}>{FIELD_LABEL[k] ?? k}</Text>
                <Text style={styles.value}>{v ?? '— okunamadı'}</Text>
              </View>
            ))}
          </View>
          {(p.blocks?.length ?? 0) > 1 &&
            p.blocks!.map((b) => (
              <Text key={b.blockNo} style={styles.small} testID={`tanit-onizleme-bolum-${b.blockNo}`}>
                Bölüm {b.blockNo}: parti {b.batchNo ?? '—'} · yazan top {b.topCount ?? b.count ?? '—'}
              </Text>
            ))}
          <Text style={styles.small} testID="tanit-onizleme-satir">
            Top satırı: {p.lineCount}
          </Text>
          {p.warnings.map((w) => (
            <Text key={w} style={styles.warn}>
              {w}
            </Text>
          ))}
        </>
      )}
      {result.explain.map((e) => (
        <Text key={e.field} style={styles.small}>
          {explainText(e)}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  ok: { fontSize: typography.size.base, color: colors.successText },
  warn: { fontSize: typography.size.sm, color: colors.warningText },
  error: { fontSize: typography.size.sm, color: colors.dangerText },
  row: { flexDirection: 'row', gap: spacing.sm },
  label: { width: 120, fontSize: typography.size.sm, color: colors.textSecondary },
  value: { flex: 1, fontSize: typography.size.base, color: colors.text },
  small: { fontSize: typography.size.sm, color: colors.textSecondary },
});
