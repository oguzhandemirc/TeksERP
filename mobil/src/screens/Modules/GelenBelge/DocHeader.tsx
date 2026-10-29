// =============================================================================
// Belge Tara — başlık alanları: sahip (müşteri) + gönderen belge no (barkod)
// =============================================================================
// Sahip listesi `GET /gelen-belge/tablet-baglam` (yalnız id+ad; `customer:read` istemez).
// Taslak doğduktan sonra `locked` — yeniden deneme aynı başlıkla aynı taslağa yükler.
// =============================================================================
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { useQuery } from '@tanstack/react-query';
import PickerModal, { type PickerOption } from '../../../components/PickerModal';
import TruncatedText from '../../../components/TruncatedText';
import { BarcodeScannerModal } from '../../../components/BarcodeScannerModal';
import { inboundDocService } from '../../../services/inboundDoc.service';
import { colors, spacing, typography } from '../../../theme';

export const INBOUND_DOC_CONTEXT_KEY = ['gelen-belge', 'tablet-baglam'] as const;

export interface Owner {
  id: string;
  name: string;
}

interface Props {
  owner: Owner | null;
  onOwner: (o: Owner) => void;
  senderDocNo: string | null;
  onBarcode: (raw: string | null) => void;
  locked: boolean;
}

export default function DocHeader({ owner, onOwner, senderDocNo, onBarcode, locked }: Props) {
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const ctx = useQuery({ queryKey: INBOUND_DOC_CONTEXT_KEY, queryFn: inboundDocService.tabletContext, staleTime: 60_000 });
  const options: PickerOption[] = useMemo(
    () => (ctx.data?.data.customers ?? []).map((c) => ({ value: c.id, label: c.name })),
    [ctx.data],
  );

  return (
    <View>
      <Text style={styles.section}>Sahibi (müşteri)</Text>
      <View style={styles.row}>
        {owner ? (
          <TruncatedText style={styles.value}>{owner.name}</TruncatedText>
        ) : (
          <Text style={[styles.value, styles.muted]}>Seçilmedi — panelde de seçilebilir.</Text>
        )}
        <Button mode="outlined" icon="account-outline" onPress={() => setOwnerOpen(true)} disabled={locked} contentStyle={styles.btn}>
          {owner ? 'Değiştir' : 'Müşteri seç'}
        </Button>
      </View>

      <Text style={styles.section}>Gönderen belge no</Text>
      <View style={styles.row}>
        <Text style={[styles.value, !senderDocNo && styles.muted]} testID="belge-tara-belge-no">
          {senderDocNo ?? 'Barkod okutulmadı (isteğe bağlı)'}
        </Text>
        <Button mode="outlined" icon="barcode-scan" onPress={() => setScannerOpen(true)} disabled={locked} contentStyle={styles.btn} testID="belge-tara-barkod">
          Barkod okut
        </Button>
        {senderDocNo && !locked && <Button onPress={() => onBarcode(null)}>Temizle</Button>}
      </View>

      <BarcodeScannerModal
        visible={scannerOpen}
        title="İrsaliye barkodu"
        onDismiss={() => setScannerOpen(false)}
        onScan={(code) => {
          onBarcode(code);
          setScannerOpen(false);
        }}
      />
      <PickerModal
        visible={ownerOpen}
        title="Belgenin sahibi"
        options={options}
        selectedValue={owner?.id ?? null}
        onSelect={(id) => {
          onOwner({ id, name: options.find((o) => o.value === id)?.label ?? '' });
          setOwnerOpen(false);
        }}
        onDismiss={() => setOwnerOpen(false)}
        emptyText={ctx.isError ? 'Liste yüklenemedi — bu bir "müşteri yok" cevabı DEĞİLDİR.' : 'Aktif müşteri yok.'}
        loading={ctx.isLoading}
        onRefresh={ctx.refetch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: typography.size.sm, color: colors.textSecondary, fontWeight: typography.weight.semibold, marginTop: spacing.md, marginBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  value: { flex: 1, minWidth: 160, fontSize: typography.size.base, color: colors.text },
  muted: { color: colors.textMuted },
  btn: { minHeight: 56 },
});
