// İş Emirleri — altta sabit büyük düğmeler: "İş Emri Rotası" (seçili rota düğmede yazar) + tür başına okut düğmesi ("Belge Okut",
// "Fason Belge Okut"; cihazın Seçenekler'inden) — her biri doğrudan okutmaya gider. Rota seçici iki grup: "Özel" + "Hazır rotalar".
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import type { ProductionRoute } from '../../../services/route.service';
import { TERIM } from '../../../lib/terim';
import { colors, radius, shadow, spacing, typography } from '../../../theme';
import { shortcutSub, shortcutTitle } from '../GelenBelge/woCreate/woFromDoc';
import type { WoCreateKind } from '../../../store/woCreateKinds';
import { KIND_BUTTON, type TypeGroups } from './scanFlow';

interface Props {
  groups: TypeGroups;
  type: ProductionRoute | null;
  loading: boolean;
  onSelect: (id: string) => void;
  kinds: readonly WoCreateKind[];
  onScan: (kind: WoCreateKind) => void;
}

const option = (r: ProductionRoute, group: string): PickerOption => ({ value: r.id, label: shortcutTitle(r), sublabel: shortcutSub(r) ?? group });

export default function ActionBar({ groups, type, loading, onSelect, kinds, onScan }: Props) {
  const [open, setOpen] = useState(false);
  const special = useMemo(() => groups.special.map((r) => option(r, 'Özel')), [groups.special]);
  const ready = useMemo(() => groups.ready.map((r) => option(r, 'Hazır rota')), [groups.ready]);
  const routeOff = loading || special.length + ready.length === 0;
  const typeLabel = type ? shortcutTitle(type) : loading ? 'Yükleniyor…' : 'Tür yok';
  return (
    <View style={styles.bar}>
      {!type && !loading && (
        <Text style={styles.hint} testID="ie-tur-yok">Okutmak için yönetim panelinde en az bir rota tanımlanmalı; şimdilik yalnız liste açık.</Text>
      )}
      <View style={styles.row}>
        {/* İki satırlı kutu: ad üstte, seçim altta — üç düğmeli çubukta da seçim kesilmeden okunur. */}
        <TouchableRipple onPress={() => setOpen(true)} disabled={routeOff} rippleColor={colors.brandSoft} style={[styles.grow, styles.route, routeOff && styles.routeOff]} testID="ie-tur-sec" accessibilityRole="button" accessibilityLabel={`${TERIM.terbiyeIsEmri.tekil} rotası: ${typeLabel}`}>
          <View style={styles.routeInner}>
            <Icon source="shape-outline" size={24} color={colors.brand} />
            <View style={styles.routeText}>
              <Text style={styles.routeCaption} numberOfLines={1}>{`${TERIM.terbiyeIsEmri.tekil} Rotası`}</Text>
              <Text style={styles.routeValue} numberOfLines={2}>{typeLabel}</Text>
            </View>
            <Icon source="chevron-up" size={22} color={colors.textSecondary} />
          </View>
        </TouchableRipple>
        {kinds.map((k) => (
          <Button key={k} mode="contained" icon={k === 'CUSTOMER_GOODS' ? 'account-arrow-down-outline' : 'file-document-outline'} onPress={() => onScan(k)} disabled={!type} style={styles.grow} contentStyle={styles.btn} labelStyle={styles.scanLabel} testID={k === 'STANDARD' ? 'ie-okut' : 'ie-okut-fason'}>
            {KIND_BUTTON[k]}
          </Button>
        ))}
      </View>
      <PickerModal
        visible={open}
        title={`${TERIM.terbiyeIsEmri.tekil} Rotası`}
        pinnedOptions={special}
        pinnedLabel={`Özel ${TERIM.terbiyeIsEmri.cogulKucuk}`}
        options={ready}
        selectedValue={type?.id ?? null}
        emptyText="Hazır rota yok."
        onSelect={(v) => { onSelect(v); setOpen(false); }}
        onDismiss={() => setOpen(false)}
        disableSort
        numColumns={2}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, ...shadow.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  // Telefon dikeyde dört düğme sığmazsa alt satıra sarar (kesik etiket yok).
  grow: { flexGrow: 1, flexBasis: 180 },
  btn: { minHeight: 64 },
  route: { minHeight: 64, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface, justifyContent: 'center', overflow: 'hidden' },
  routeOff: { opacity: 0.5 },
  routeInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  routeText: { flex: 1 },
  routeCaption: { fontSize: typography.size.sm, color: colors.textMuted },
  routeValue: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  scanLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  hint: { fontSize: typography.size.sm, color: colors.warningText },
});
