// İş Emirleri — altta iki büyük tuş: [Belge Okut] (dolu, birincil; ayar açıksa ikinci satırda "Rota: <ad> ▾" — ▾ bölgesi
// rota seçicisini açar, tuşun geri kalanı okutmayı başlatır) + [Elle Oluştur] (çerçeveli; belgesiz form). 600–720dp'de alt alta;
// dar ekranda (<600dp, el terminali) TEK İNCE ŞERİT: iki tuş yan yana, rota tuşun alt yazısı + ayrı ▾ bölgesi, tür rozeti küçük.
// Rota seçici iki grup: "Özel" + "Hazır rotalar" (görünümü RoutePickerModal'da; burada yalnız açılış yeri).
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TruncatedText from '../../../components/TruncatedText';
import { useIsCompact } from '../../../hooks/useDeviceType';
import RoutePickerModal, { type RouteChoice } from './RoutePickerModal';
import { routeButtonTitle, routeStepsLine } from './routePickerView';
import type { ProductionRoute } from '../../../services/route.service';
import { TERIM } from '../../../lib/terim';
import { colors, palette, radius, shadow, spacing, typography } from '../../../theme';
import { shortcutTitle } from '../GelenBelge/woCreate/woFromDoc';
import type { TypeGroups } from './scanFlow';
import type { WoButtons } from '../../../store/deviceSettingsStore';

interface Props {
  groups: TypeGroups;
  type: ProductionRoute | null;
  loading: boolean;
  onSelect: (id: string) => void;
  /** "Rota seçimini Belge Okut tuşunda göster" (cihaz ayarı). */
  showRoute: boolean;
  onScan: () => void;
  onManual: () => void;
  /** Seçeneklerdeki "Alttaki tuşlar": ikisi ya da yalnız biri. */
  buttons: WoButtons;
  /** Cihazda tek mal sahibi açıksa tuşlarda gösterilen etiket ("Kendi üretim" / "Fason"); ikisi açıksa null. */
  kindTag: { label: string; fason: boolean } | null;
}

const option = (r: ProductionRoute): RouteChoice => ({ id: r.id, title: routeButtonTitle(r.name), steps: routeStepsLine(r) });

export default function ActionBar({ groups, type, loading, onSelect, showRoute, onScan, onManual, buttons, kindTag }: Props) {
  const [open, setOpen] = useState(false);
  const bottomInset = useSafeAreaInsets().bottom;
  const compact = useIsCompact();
  const special = useMemo(() => groups.special.map(option), [groups.special]);
  const ready = useMemo(() => groups.ready.map(option), [groups.ready]);
  const routeOff = loading || special.length + ready.length === 0;
  const typeLabel = type ? shortcutTitle(type) : loading ? 'Yükleniyor…' : 'Rota yok';
  const picker = (
    <RoutePickerModal
      visible={open}
      title={`${TERIM.terbiyeIsEmri.tekil} Rotası`}
      special={special}
      ready={ready}
      specialLabel={`Özel ${TERIM.terbiyeIsEmri.cogulKucuk}`}
      readyLabel="Hazır rotalar"
      selectedId={type?.id ?? null}
      onSelect={(v) => { onSelect(v); setOpen(false); }}
      onDismiss={() => setOpen(false)}
    />
  );
  if (compact) {
    return <CompactActionBar {...{ type, typeLabel, routeOff, showRoute, onScan, onManual, buttons, kindTag, bottomInset }} onRoute={() => setOpen(true)} picker={picker} />;
  }
  return (
    // ScreenChrome alt inset'i boşluk olarak bırakır; şerit o boşluğa uzanıp ekranın alt kenarına değer.
    <View style={[styles.bar, { marginBottom: -bottomInset, paddingBottom: spacing.md + bottomInset }]}>
      <View style={styles.row}>
        {buttons !== 'manual' && (
        <View style={[styles.scan, styles.grow]}>
          <TouchableRipple onPress={onScan} rippleColor="rgba(255,255,255,0.2)" style={styles.scanMain} testID="ie-okut" accessibilityRole="button" accessibilityLabel="Belge Okut">
            <View style={styles.scanInner}>
              <Icon source="camera-outline" size={26} color={colors.textOnDark} />
              <Text style={styles.scanLabel}>Belge Okut</Text>
              {kindTag && <KindTag tag={kindTag} />}
            </View>
          </TouchableRipple>
          {showRoute && (
            <TouchableRipple onPress={() => setOpen(true)} disabled={routeOff} rippleColor="rgba(255,255,255,0.2)" style={[styles.routePart, routeOff && styles.off]} testID="ie-tur-sec" accessibilityRole="button" accessibilityLabel={`Rota: ${typeLabel}`}>
              <View style={styles.routeInner}>
                <Text style={styles.routeText} numberOfLines={2}>{`Rota: ${typeLabel}`}</Text>
                <View style={styles.chevron}>
                  <Icon source="chevron-down" size={22} color={colors.textOnDark} />
                </View>
              </View>
            </TouchableRipple>
          )}
        </View>
        )}
        {buttons !== 'scan' && (
          <TouchableRipple onPress={onManual} rippleColor="rgba(15,23,42,0.08)" style={[styles.manual, styles.grow]} testID="ie-elle-olustur" accessibilityRole="button" accessibilityLabel="Elle Oluştur">
            <View style={styles.scanInner}>
              <Icon source="pencil-outline" size={24} color={colors.text} />
              <Text style={styles.manualLabel}>Elle Oluştur</Text>
              {kindTag && <KindTag tag={kindTag} />}
            </View>
          </TouchableRipple>
        )}
      </View>
      {picker}
    </View>
  );
}

interface CompactProps {
  type: ProductionRoute | null;
  typeLabel: string;
  routeOff: boolean;
  showRoute: boolean;
  onScan: () => void;
  onManual: () => void;
  onRoute: () => void;
  buttons: WoButtons;
  kindTag: { label: string; fason: boolean } | null;
  bottomInset: number;
  picker: React.ReactNode;
}

/** Dar ekran (<600dp) tek ince şerit. */
function CompactActionBar({ type, typeLabel, routeOff, showRoute, onScan, onManual, onRoute, buttons, kindTag, bottomInset, picker }: CompactProps) {
  const scanOn = buttons !== 'manual';
  // Dar şeritte rota yalnız adıyla ("… iş emri" eki düşer).
  const routeShort = type ? routeButtonTitle(type.name) : typeLabel;
  return (
    <View style={[styles.bar, styles.barCompact, { marginBottom: -bottomInset, paddingBottom: spacing.sm + bottomInset }]} testID="ie-eylem-dar">
      <View style={styles.row}>
        {scanOn && (
          <View style={[styles.scan, styles.scanCompact]}>
            <TouchableRipple onPress={onScan} rippleColor="rgba(255,255,255,0.2)" style={styles.grow} testID="ie-okut" accessibilityRole="button" accessibilityLabel={showRoute ? `Belge Okut, rota: ${typeLabel}` : 'Belge Okut'}>
              <View style={styles.compactInner}>
                <Icon source="camera-outline" size={22} color={colors.textOnDark} />
                <View style={styles.compactText}>
                  <Text style={styles.compactLabel}>Belge Okut</Text>
                  {(showRoute || kindTag) && (
                    <View style={styles.compactSub}>
                      {kindTag && <KindTag tag={kindTag} small />}
                      {showRoute && <TruncatedText style={styles.compactRoute}>{routeShort}</TruncatedText>}
                    </View>
                  )}
                </View>
              </View>
            </TouchableRipple>
            {showRoute && (
              <TouchableRipple onPress={onRoute} disabled={routeOff} rippleColor="rgba(255,255,255,0.2)" style={[styles.routeCompact, routeOff && styles.off]} testID="ie-tur-sec" accessibilityRole="button" accessibilityLabel={`Rota: ${typeLabel}`}>
                <Icon source="chevron-down" size={24} color={colors.textOnDark} />
              </TouchableRipple>
            )}
          </View>
        )}
        {buttons !== 'scan' && (
          <TouchableRipple onPress={onManual} rippleColor="rgba(15,23,42,0.08)" style={[styles.manual, styles.manualCompact, !scanOn && styles.grow]} testID="ie-elle-olustur" accessibilityRole="button" accessibilityLabel="Elle Oluştur">
            <View style={styles.compactInner}>
              <Icon source="pencil-outline" size={20} color={colors.text} />
              <Text style={styles.compactManualLabel}>Elle Oluştur</Text>
              {!scanOn && kindTag && <KindTag tag={kindTag} small />}
            </View>
          </TouchableRipple>
        )}
      </View>
      {picker}
    </View>
  );
}

function KindTag({ tag, small = false }: { tag: { label: string; fason: boolean }; small?: boolean }) {
  return (
    <View style={[styles.tag, small && styles.tagSmall, tag.fason ? styles.tagFason : styles.tagOwn]}>
      <Text style={[styles.tagText, small && styles.tagTextSmall, { color: tag.fason ? colors.warningDark : colors.infoDark }]}>{tag.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, ...shadow.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'stretch' },
  grow: { flex: 1 },
  scan: { borderRadius: radius.lg, backgroundColor: colors.headerBg, overflow: 'hidden' },
  scanMain: { minHeight: 56, justifyContent: 'center' },
  scanInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  scanLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.textOnDark },
  // Ayrı dokunma bölgesi olduğu belli olsun: gövdeden açık ton + yuvarlak ▾ rozeti.
  routePart: { minHeight: 52, justifyContent: 'center', backgroundColor: palette.slate[700] },
  routeInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  chevron: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)' },
  routeText: { flexShrink: 1, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.textOnDark },
  off: { opacity: 0.5 },
  manual: { minHeight: 64, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted, justifyContent: 'center' },
  manualLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text },
  // "Malın sahibi" kartıyla aynı tonlar: kendi üretim mavi, fason turuncu.
  tag: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagOwn: { backgroundColor: colors.infoContainer },
  tagFason: { backgroundColor: colors.warningContainer },
  tagSmall: { paddingHorizontal: spacing.xs, paddingVertical: 0 },
  tagTextSmall: { fontSize: typography.size.xs },
  // Dar ekran şeridi: tek sıra, 56dp tuşlar; Belge Okut birincil (geniş pay), Elle Oluştur ikincil.
  barCompact: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  scanCompact: { flex: 1.5, flexDirection: 'row', minHeight: 56 },
  compactInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, minHeight: 56 },
  compactText: { flexShrink: 1, alignItems: 'flex-start' },
  compactLabel: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.textOnDark },
  compactSub: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: '100%' },
  compactRoute: { flexShrink: 1, fontSize: typography.size.xs, color: colors.textOnDark, opacity: 0.85 },
  routeCompact: { width: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.slate[700] },
  manualCompact: { flex: 1, minHeight: 56 },
  compactManualLabel: { flexShrink: 1, fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  tagText: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.text },
});
