// İş Emirleri — altta sabit iki büyük düğme: "İş Emri Türü" (seçili tür düğmede yazar) + "Okut" (birincil).
// Tür seçici iki grup: "Özel iş emirleri" (üstte, sabitlenmiş) ve "Hazır rotalar".
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import type { ProductionRoute } from '../../../services/route.service';
import { TERIM } from '../../../lib/terim';
import { colors, shadow, spacing, typography } from '../../../theme';
import { shortcutSub, shortcutTitle } from '../GelenBelge/woCreate/woFromDoc';
import type { TypeGroups } from './scanFlow';

interface Props {
  groups: TypeGroups;
  type: ProductionRoute | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onScan: () => void;
}

const option = (r: ProductionRoute, group: string): PickerOption => ({ value: r.id, label: shortcutTitle(r), sublabel: shortcutSub(r) ?? group });

export default function ActionBar({ groups, type, loading, onSelect, onScan }: Props) {
  const [open, setOpen] = useState(false);
  const special = useMemo(() => groups.special.map((r) => option(r, 'Özel')), [groups.special]);
  const ready = useMemo(() => groups.ready.map((r) => option(r, 'Hazır rota')), [groups.ready]);
  const typeLabel = type ? shortcutTitle(type) : loading ? 'Yükleniyor…' : 'Tür yok';
  return (
    <View style={styles.bar}>
      {!type && !loading && (
        <Text style={styles.hint} testID="ie-tur-yok">Okutmak için yönetim panelinde en az bir rota tanımlanmalı; şimdilik yalnız liste açık.</Text>
      )}
      <View style={styles.row}>
        <Button mode="outlined" icon="shape-outline" onPress={() => setOpen(true)} disabled={loading || (special.length + ready.length === 0)} style={styles.grow} contentStyle={styles.btn} labelStyle={styles.typeLabel} testID="ie-tur-sec" accessibilityLabel={`${TERIM.terbiyeIsEmri.tekil} türü: ${typeLabel}`}>
          {`Tür: ${typeLabel}`}
        </Button>
        <Button mode="contained" icon="file-document-outline" onPress={onScan} disabled={!type} style={styles.grow} contentStyle={styles.btn} labelStyle={styles.scanLabel} testID="ie-okut">
          Okut
        </Button>
      </View>
      <PickerModal
        visible={open}
        title={`${TERIM.terbiyeIsEmri.tekil} türü`}
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
  row: { flexDirection: 'row', gap: spacing.md },
  grow: { flex: 1 },
  btn: { minHeight: 64 },
  typeLabel: { fontSize: typography.size.base },
  scanLabel: { fontSize: typography.size.lg, fontWeight: typography.weight.bold },
  hint: { fontSize: typography.size.sm, color: colors.warningText },
});
