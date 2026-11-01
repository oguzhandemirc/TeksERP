// Belge Tara — çekilen sayfaların küçük resimleri (yüklenen ✓, yüklenmeyen silinebilir) + "Sayfa çek" kutusu.
import React from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { IconButton, Text, TouchableRipple } from 'react-native-paper';
import { colors, spacing, typography } from '../../../theme';
import { MAX_PAGES, type ScanPage } from './docScan';

interface Props {
  pages: readonly ScanPage[];
  uploaded: ReadonlySet<string>;
  onRemove: (index: number) => void;
  onAdd: () => void;
  /** Klasik kamera (ML Kit tarayıcısı yerine); verilmezse düğme çizilmez. */
  onAddClassic?: () => void;
  /** Tarayıcı açılırken/sayfalar işlenirken ekleme kutusu kilitlenir. */
  busy?: boolean;
  /** Küçük resme dokununca tam ekran önizleme. */
  onOpen: (index: number) => void;
}

export default function PageList({ pages, uploaded, onRemove, onAdd, onAddClassic, busy = false, onOpen }: Props) {
  return (
    <View>
      <Text style={styles.section}>Sayfalar ({pages.length})</Text>
      <View style={styles.pages}>
        {pages.map((p, i) => (
          <View key={p.sha256} style={styles.thumbBox}>
            <TouchableRipple
              style={styles.thumb}
              onPress={() => onOpen(i)}
              testID={`belge-tara-sayfa-${i + 1}`}
              accessibilityLabel={`Sayfa ${i + 1} önizle`}
            >
              <Image source={{ uri: p.uri }} style={styles.thumbImage} resizeMode="cover" />
            </TouchableRipple>
            <View style={styles.thumbBar}>
              <Text style={styles.thumbText}>
                Sayfa {i + 1}
                {uploaded.has(p.sha256) ? ' ✓' : ''}
              </Text>
              {!uploaded.has(p.sha256) && (
                <IconButton icon="delete-outline" size={24} onPress={() => onRemove(i)} accessibilityLabel={`Sayfa ${i + 1} sil`} />
              )}
            </View>
          </View>
        ))}
        {pages.length < MAX_PAGES && (
          <View style={styles.thumbBox}>
            <TouchableRipple style={[styles.addBox, styles.addMain]} onPress={onAdd} disabled={busy} testID="belge-tara-sayfa-ekle">
              {busy ? <ActivityIndicator color={colors.textSecondary} /> : <Text style={styles.addText}>+ Sayfa çek</Text>}
            </TouchableRipple>
            {onAddClassic && (
              <TouchableRipple style={styles.classic} onPress={onAddClassic} disabled={busy} testID="belge-tara-klasik-kamera" accessibilityLabel="Klasik kamera ile çek">
                <Text style={styles.classicText}>Klasik kamera</Text>
              </TouchableRipple>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.md, marginBottom: spacing.xs },
  pages: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  thumbBox: { width: 150, height: 200, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  thumb: { flex: 1 },
  thumbImage: { width: '100%', height: '100%' },
  thumbBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: spacing.sm, minHeight: 56 },
  thumbText: { fontSize: typography.size.sm, color: colors.text },
  addBox: { justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: colors.textMuted },
  addMain: { flex: 1, borderRadius: 8 },
  classic: { minHeight: 56, justifyContent: 'center', alignItems: 'center' },
  classicText: { fontSize: typography.size.sm, color: colors.textSecondary, textDecorationLine: 'underline' },
  addText: { fontSize: typography.size.base, color: colors.textSecondary },
});
