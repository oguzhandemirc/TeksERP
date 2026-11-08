// İş Emirleri — altta iki büyük tuş: [Belge Okut] (dolu, birincil; ayar açıksa ikinci satırda "Rota: <ad> ▾" — ▾ bölgesi
// rota seçicisini açar, tuşun geri kalanı okutmayı başlatır) + [Elle Oluştur] (çerçeveli; belgesiz form). Telefonda alt alta.
// Rota seçici iki grup: "Özel" + "Hazır rotalar" (görünümü RoutePickerModal'da; burada yalnız açılış yeri).
import React, { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import RoutePickerModal, { type RouteChoice } from './RoutePickerModal';
import { routeButtonTitle, routeStepsLine } from './routePickerView';
import type { ProductionRoute } from '../../../services/route.service';
import { TERIM } from '../../../lib/terim';
import { colors, radius, shadow, spacing, typography } from '../../../theme';
import { shortcutTitle } from '../GelenBelge/woCreate/woFromDoc';
import type { TypeGroups } from './scanFlow';

interface Props {
  groups: TypeGroups;
  type: ProductionRoute | null;
  loading: boolean;
  onSelect: (id: string) => void;
  /** "Rota seçimini Belge Okut tuşunda göster" (cihaz ayarı). */
  showRoute: boolean;
  onScan: () => void;
  onManual: () => void;
}

const option = (r: ProductionRoute): RouteChoice => ({ id: r.id, title: routeButtonTitle(r.name), steps: routeStepsLine(r) });
const PHONE_MAX = 600;

export default function ActionBar({ groups, type, loading, onSelect, showRoute, onScan, onManual }: Props) {
  const [open, setOpen] = useState(false);
  const narrow = useWindowDimensions().width < PHONE_MAX;
  const special = useMemo(() => groups.special.map(option), [groups.special]);
  const ready = useMemo(() => groups.ready.map(option), [groups.ready]);
  const routeOff = loading || special.length + ready.length === 0;
  const typeLabel = type ? shortcutTitle(type) : loading ? 'Yükleniyor…' : 'Rota yok';
  return (
    <View style={styles.bar}>
      <View style={[styles.row, narrow && styles.column]}>
        <View style={[styles.scan, !narrow && styles.grow]}>
          <TouchableRipple onPress={onScan} rippleColor="rgba(255,255,255,0.2)" style={styles.scanMain} testID="ie-okut" accessibilityRole="button" accessibilityLabel="Belge Okut">
            <View style={styles.scanInner}>
              <Icon source="camera-outline" size={26} color={colors.textOnDark} />
              <Text style={styles.scanLabel}>Belge Okut</Text>
            </View>
          </TouchableRipple>
          {showRoute && (
            <TouchableRipple onPress={() => setOpen(true)} disabled={routeOff} rippleColor="rgba(255,255,255,0.2)" style={[styles.routePart, routeOff && styles.off]} testID="ie-tur-sec" accessibilityRole="button" accessibilityLabel={`Rota: ${typeLabel}`}>
              <View style={styles.routeInner}>
                <Text style={styles.routeText} numberOfLines={2}>{`Rota: ${typeLabel}`}</Text>
                <Icon source="menu-down" size={26} color={colors.textOnDark} />
              </View>
            </TouchableRipple>
          )}
        </View>
        <Button mode="outlined" icon="pencil-outline" onPress={onManual} style={[styles.manual, !narrow && styles.grow]} contentStyle={styles.btn} labelStyle={styles.manualLabel} testID="ie-elle-olustur">
          Elle Oluştur
        </Button>
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

const styles = StyleSheet.create({
  bar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, ...shadow.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'stretch' },
  // Telefon (dar ekran): iki tuş alt alta, tam genişlik.
  column: { flexDirection: 'column' },
  grow: { flex: 1 },
  scan: { borderRadius: radius.lg, backgroundColor: colors.brand, overflow: 'hidden' },
  scanMain: { minHeight: 56, justifyContent: 'center' },
  scanInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  scanLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.textOnDark },
  routePart: { minHeight: 48, justifyContent: 'center', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.3)' },
  routeInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  routeText: { flexShrink: 1, fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.textOnDark },
  off: { opacity: 0.5 },
  manual: { borderRadius: radius.lg, borderWidth: 2, borderColor: colors.brand, justifyContent: 'center' },
  btn: { minHeight: 64 },
  manualLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
});
