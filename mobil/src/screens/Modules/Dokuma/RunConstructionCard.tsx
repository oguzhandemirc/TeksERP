// =============================================================================
// İŞ KARTI — ETKİN YAPI (Seyitoğlu SY-M4), SALT-OKUNUR
// =============================================================================
// Koşum bir dokuma işine bağlıysa ustanın tezgâha girdiği yapıyı gösterir: desen + armür dosya adı,
// atkı sırası (varyant değişimi işaretli), sıklık, ek çözgü katmanları. Operatör hiçbir şey yazmaz.
// Yapısız iş (`null`), eski sunucu (404) ya da ağ hatası → hiçbir şey çizilmez (bugünkü ekran).
// Sunucu armür gönderiyorsa mini armür + seçici (dokununca tam ekran); göndermiyorsa yalnız metin.
// =============================================================================
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import { machineRunService, type RunConstruction } from '../../../services/machineRun.service';
import TruncatedText from '../../../components/TruncatedText';
import { WeaveMini, canShowWeave } from './WeaveGridSheet';
import { colors, palette, spacing, typography } from '../../../theme';

const LAYER_ROLE: Record<string, string> = { LENO: 'Döner çözgü', SECONDARY: 'Ek çözgü' };

const fmt = (n: number): string => n.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

export function ConstructionDetails({ c }: { c: RunConstruction }) {
  const d = c.design;
  const w = c.weft;
  // Görsel çizilmişse kenar çerçeveleri yeşil sütun + lejantla görünür; çizilmemişse metinle söylenir.
  const selvedge = d?.selvedgeFrames ?? [];
  const designBits = d ? [d.code, d.loomFileName ? `Tezgâh dosyası ${d.loomFileName}` : null, d.frameCount != null ? `${d.frameCount} çerçeve` : null, d.repeatCm != null ? `Desen raporu ${fmt(d.repeatCm)} cm` : null] : [];
  const weftBits = w ? [w.picksPerCm != null ? `${fmt(w.picksPerCm)} atkı/cm` : null, w.sequenceCode ? `Atkı raporu ${w.sequenceCode}` : null, w.weftProgramNo ? `Program ${w.weftProgramNo}` : null] : [];
  return (
    <View style={styles.box} testID="run-construction">
      <Text style={styles.title}>Etkin yapı{c.variantCode ? ` · Varyant ${c.variantCode}` : ''}</Text>
      {d ? <Text style={styles.line}>Desen: {designBits.filter(Boolean).join(' · ')}</Text> : null}
      <WeaveMini c={c} />
      {selvedge.length > 0 && !canShowWeave(c) ? (
        <Text style={[styles.line, styles.selvedge]} testID="run-construction-selvedge">Kenar çerçeveleri: {selvedge.join(', ')}</Text>
      ) : null}
      {w ? <Text style={styles.line}>Atkı: {weftBits.filter(Boolean).join(' · ') || w.code}</Text> : null}
      {w?.yarns.map((y) => (
        <TruncatedText key={y.letter} style={[styles.yarn, y.swapped && styles.swapped]}>
          {`${y.letter} × ${y.picksInRepeat} — ${y.yarnCode} ${y.yarnName}${y.colorChannel != null ? ` — Kanal ${y.colorChannel}` : ''}${y.swapped ? ' (varyant)' : ''}`}
        </TruncatedText>
      ))}
      {c.warpLayers.map((l) => (
        <TruncatedText key={`${l.role}-${l.warpCode}`} style={styles.line}>{`${LAYER_ROLE[l.role] ?? l.role}: ${l.warpCode} ${l.warpName}`}</TruncatedText>
      ))}
    </View>
  );
}

function useRunConstruction(weavingOrderId: string) {
  return useQuery({
    queryKey: ['machine-runs', 'construction', weavingOrderId],
    queryFn: () => machineRunService.construction(weavingOrderId),
    staleTime: 60_000,
    retry: false,
  });
}

export default function RunConstructionCard({ weavingOrderId }: { weavingOrderId: string }) {
  const q = useRunConstruction(weavingOrderId);
  return q.data ? <ConstructionDetails c={q.data} /> : null;
}

/** İş emri detayında yalnız armür görseli (metin özeti orada zaten var); armür yoksa / eski sunucu → hiçbir şey. */
export function WeavingOrderWeave({ weavingOrderId }: { weavingOrderId: string }) {
  const q = useRunConstruction(weavingOrderId);
  return q.data && canShowWeave(q.data) ? (
    <View style={styles.weaveSection} testID="dokuma-detay-armur">
      {/* Bölüm başlığı yok: mini kartın kendi "Desen örgüsü" başlığı var (çift başlık). */}
      <WeaveMini c={q.data} />
    </View>
  ) : null;
}

const styles = StyleSheet.create({
  box: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  title: { fontSize: typography.size.sm, fontWeight: typography.weight.semibold, color: colors.text },
  line: { fontSize: typography.size.sm, color: colors.textSecondary },
  yarn: { fontSize: typography.size.sm, color: colors.text },
  swapped: { fontWeight: typography.weight.semibold },
  selvedge: { color: palette.emerald[700] },
  weaveSection: { gap: spacing.xs, marginTop: spacing.sm },
});
