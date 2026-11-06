// İş Emirleri — "Okut": DocBatchView (tek belge, tarayıcı hemen açılır) + okuma bitince önizleme kartı.
// Önizleme kaydırmasız tek ekran: büyük karolar; bulunan alan yeşil + onay ikonu, şablonda olup bulunamayan kırmızı +
// uyarı ikonu (renk tek taşıyıcı değil). "Devam et" kartı kapatır (form altta dolu), "Vazgeç" listeye döner.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import ModuleSheet, { moduleSheetWidth } from '../../../components/ModuleSheet';
import type { ProductionRoute } from '../../../services/route.service';
import { colors, radius, spacing, typography } from '../../../theme';
import DocBatchView from '../GelenBelge/woCreate/DocBatchView';
import { useReadResult } from '../GelenBelge/useReadResult';
import { previewTiles, tileLayout, type PreviewTile } from './scanFlow';

const TILE_TONE = {
  found: { bg: colors.successContainer, border: colors.success, fg: colors.successText, icon: 'check-circle' },
  missing: { bg: colors.dangerContainer, border: colors.danger, fg: colors.dangerText, icon: 'alert-circle' },
  unknown: { bg: colors.surfaceMuted, border: colors.border, fg: colors.textSecondary, icon: 'minus-circle-outline' },
} as const;

export default function ScanStage({ route, onCancel }: { route: ProductionRoute; onCancel: () => void }) {
  const [note, setNote] = useState<{ id: string; run: number } | null>(null);
  const [dismissedRun, setDismissedRun] = useState<number | null>(null);
  const { watch } = useReadResult(note?.id ?? null, note?.run ?? 0);
  const summary = watch?.phase === 'done' ? watch.summary : null;
  const open = !!summary && note !== null && dismissedRun !== note.run;

  return (
    <View style={styles.fill}>
      <DocBatchView route={route} multi={false} autoStart onNote={(n, run) => setNote({ id: n.id, run })} />
      {summary && (
        <PreviewSheet
          visible={open}
          title={`Belge okundu · ${summary.noteNo}`}
          subtitle={summary.reason ?? `${summary.lineCount} satır okundu${summary.reviewCount ? ` · ${summary.reviewCount} satır kontrol istiyor` : ''}`}
          tiles={previewTiles(summary)}
          onContinue={() => setDismissedRun(note?.run ?? null)}
          onCancel={onCancel}
        />
      )}
    </View>
  );
}

function PreviewSheet({ visible, title, subtitle, tiles, onContinue, onCancel }: { visible: boolean; title: string; subtitle: string; tiles: PreviewTile[]; onContinue: () => void; onCancel: () => void }) {
  const win = useWindowDimensions();
  // Karo alanı: kart genişliği − yan boşluklar; yükseklik: AppModal tavanı (%88) − başlık − düğme şeridi − boşluk.
  const areaW = moduleSheetWidth(win.width) - spacing.xxl * 2;
  const areaH = Math.round(win.height * 0.88) - 96 - 88 - spacing.lg * 2 - 24;
  const L = useMemo(() => tileLayout(tiles.length, areaW, areaH), [tiles.length, areaW, areaH]);
  const missing = tiles.filter((t) => t.state === 'missing').length;
  const tileW = (areaW - spacing.md * (L.columns - 1)) / L.columns;
  return (
    <ModuleSheet
      visible={visible}
      onDismiss={onContinue}
      title={title}
      subtitle={missing ? `${subtitle} · ${missing} alan bulunamadı — formda tamamlayın` : subtitle}
      footer={
        <>
          <Button mode="outlined" onPress={onCancel} contentStyle={styles.btn} testID="ie-onizleme-vazgec">Vazgeç</Button>
          <Button mode="contained" onPress={onContinue} contentStyle={styles.btn} icon="arrow-right" testID="ie-onizleme-devam">Devam et</Button>
        </>
      }
    >
      <View style={styles.grid} testID="ie-onizleme-karolar">
        {tiles.slice(0, L.shown).map((t) => {
          const tone = TILE_TONE[t.state];
          return (
            <View key={t.key} style={[styles.tile, { width: tileW, height: L.tileHeight, backgroundColor: tone.bg, borderColor: tone.border }]} testID={`ie-karo-${t.key}-${t.state}`}>
              <View style={styles.tileHead}>
                <Icon source={tone.icon} size={L.labelSize + 4} color={tone.fg} />
                <Text style={[styles.tileLabel, { fontSize: L.labelSize, color: tone.fg }]} numberOfLines={1}>{t.label}</Text>
              </View>
              <Text style={[styles.tileValue, { fontSize: L.valueSize, color: t.state === 'found' ? colors.text : tone.fg }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
                {t.value}
              </Text>
            </View>
          );
        })}
        {L.hidden > 0 && (
          <View style={[styles.tile, styles.moreTile, { width: tileW, height: L.tileHeight }]}>
            <Text style={[styles.tileValue, { fontSize: L.valueSize }]}>+{L.hidden} alan</Text>
            <Text style={[styles.tileLabel, { fontSize: L.labelSize }]}>formda görünür</Text>
          </View>
        )}
      </View>
    </ModuleSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  btn: { minHeight: 56, paddingHorizontal: spacing.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { borderWidth: 2, borderRadius: radius.lg, padding: spacing.md, justifyContent: 'space-between' },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tileLabel: { flexShrink: 1, fontWeight: typography.weight.semibold },
  tileValue: { fontWeight: typography.weight.bold },
  moreTile: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
});
