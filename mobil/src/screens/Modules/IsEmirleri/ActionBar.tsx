// İş Emirleri — altta iki büyük tuş: [Belge Okut] (dolu, birincil; ayar açıksa ikinci satırda "Rota: <ad> ▾" — ▾ bölgesi
// rota seçicisini açar, tuşun geri kalanı okutmayı başlatır) + [Elle Oluştur] (çerçeveli; belgesiz form). Telefonda alt alta.
// Rota seçici iki grup: "Özel" + "Hazır rotalar" (görünümü RoutePickerModal'da; burada yalnız açılış yeri).
import React, { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Icon, Text, TouchableRipple } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  /** Cihazda tek mal sahibi açıksa tuşlarda gösterilen etiket ("Bizim mal" / "Müşteri malı"); ikisi açıksa null. */
  kindTag: { label: string; fason: boolean } | null;
}

const option = (r: ProductionRoute): RouteChoice => ({ id: r.id, title: routeButtonTitle(r.name), steps: routeStepsLine(r) });
const PHONE_MAX = 600;

export default function ActionBar({ groups, type, loading, onSelect, showRoute, onScan, onManual, buttons, kindTag }: Props) {
  const [open, setOpen] = useState(false);
  const bottomInset = useSafeAreaInsets().bottom;
  const narrow = useWindowDimensions().width < PHONE_MAX;
  const special = useMemo(() => groups.special.map(option), [groups.special]);
  const ready = useMemo(() => groups.ready.map(option), [groups.ready]);
  const routeOff = loading || special.length + ready.length === 0;
  const typeLabel = type ? shortcutTitle(type) : loading ? 'Yükleniyor…' : 'Rota yok';
  return (
    // ScreenChrome alt inset'i boşluk olarak bırakır; şerit o boşluğa uzanıp ekranın alt kenarına değer.
    <View style={[styles.bar, { marginBottom: -bottomInset, paddingBottom: spacing.md + bottomInset }]}>
      <View style={[styles.row, narrow && styles.column]}>
        {buttons !== 'manual' && (
        <View style={[styles.scan, !narrow && styles.grow]}>
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
          <TouchableRipple onPress={onManual} rippleColor="rgba(15,23,42,0.08)" style={[styles.manual, !narrow && styles.grow]} testID="ie-elle-olustur" accessibilityRole="button" accessibilityLabel="Elle Oluştur">
            <View style={styles.scanInner}>
              <Icon source="pencil-outline" size={24} color={colors.text} />
              <Text style={styles.manualLabel}>Elle Oluştur</Text>
              {kindTag && <KindTag tag={kindTag} />}
            </View>
          </TouchableRipple>
        )}
      </View>
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
    </View>
  );
}

function KindTag({ tag }: { tag: { label: string; fason: boolean } }) {
  return (
    <View style={[styles.tag, tag.fason ? styles.tagFason : styles.tagOwn]}>
      <Text style={[styles.tagText, { color: tag.fason ? colors.warningDark : colors.infoDark }]}>{tag.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, ...shadow.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'stretch' },
  // Telefon (dar ekran): iki tuş alt alta, tam genişlik.
  column: { flexDirection: 'column' },
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
  // "Malın sahibi" kartıyla aynı tonlar: bizim mal mavi, müşteri malı turuncu.
  tag: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagOwn: { backgroundColor: colors.infoContainer },
  tagFason: { backgroundColor: colors.warningContainer },
  tagText: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.text },
});
