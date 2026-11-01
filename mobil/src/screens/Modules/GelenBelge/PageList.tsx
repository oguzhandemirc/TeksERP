// Belge Tara — çekilen sayfaların küçük resimleri (yüklenen ✓, yüklenmeyen silinebilir) + "Sayfa çek" kutusu.
import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { IconButton, Text, TouchableRipple } from 'react-native-paper';
import { colors, spacing, typography } from '../../../theme';
import { MAX_PAGES, type ScanPage } from './docScan';

interface Props {
  pages: readonly ScanPage[];
  uploaded: ReadonlySet<string>;
  onRemove: (index: number) => void;
  onAdd: () => void;
  /** Küçük resme dokununca tam ekran önizleme. */
  onOpen: (index: number) => void;
}

export default function PageList({ pages, uploaded, onRemove, onAdd, onOpen }: Props) {
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
          <TouchableRipple style={[styles.thumbBox, styles.addBox]} onPress={onAdd} testID="belge-tara-sayfa-ekle">
            <Text style={styles.addText}>+ Sayfa çek</Text>
          </TouchableRipple>
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
  addText: { fontSize: typography.size.base, color: colors.textSecondary },
});
