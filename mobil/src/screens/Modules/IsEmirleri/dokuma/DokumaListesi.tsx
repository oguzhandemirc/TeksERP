// İş Emirleri › Dokuma listesi (salt izleme): arama + durum süzgeci (SUNUCUDA), cursor + sonsuz kaydırma, satır → ayrıntı.
// Sütunlar: no · kumaş/desen · tezgah (açık koşum) · üretilen / planlanan metre · durum. Oluşturma yok (panelden açılır).
import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { FlashList } from '@shopify/flash-list';
import PickerModal from '../../../../components/PickerModal';
import TruncatedText from '../../../../components/TruncatedText';
import { TERIM } from '../../../../lib/terim';
import { QUERY_PROBLEM_TEXT } from '../../../../utils/queryState';
import { WORK_ORDER_STATUS_LABEL, trLabel } from '../../../../utils/labels';
import type { WeavingOrderListRow } from '../../../../services/weavingOrder.service';
import { colors, radius, spacing, typography } from '../../../../theme';
import DokumaIsEmriDetaySheet from './DokumaIsEmriDetaySheet';
import { DOKUMA_DURUM_SECENEKLERI, DOKUMA_MIN_ARAMA, DOKUMA_VARSAYILAN_FILTRE, dokumaBosDurum, kumasMetni, metreMetni, tezgahMetni, type DokumaDurum, type DokumaFiltre } from './dokumaListe';
import { useDokumaListesi } from './useDokumaListesi';

const WIDE_MIN = 720;

/** Durum noktası rengi — tema token'ları (renk tek taşıyıcı değil, durum adı yanında yazar). */
const DURUM_RENK: Record<string, string> = {
  PLANNED: colors.info,
  IN_PROGRESS: colors.success,
  COMPLETED: colors.textMuted,
  CANCELLED: colors.danger,
};

const SUTUNLAR: { key: string; label: string; flex: number }[] = [
  { key: 'no', label: 'No', flex: 1.1 },
  { key: 'kumas', label: 'Kumaş / desen', flex: 2.2 },
  { key: 'tezgah', label: 'Tezgah', flex: 1.5 },
  { key: 'metre', label: 'Üretilen / plan', flex: 1.5 },
  { key: 'durum', label: 'Durum', flex: 1.2 },
];

export default function DokumaListesi() {
  const [f, setF] = useState<DokumaFiltre>(DOKUMA_VARSAYILAN_FILTRE);
  const [durumAcik, setDurumAcik] = useState(false);
  const [acik, setAcik] = useState<WeavingOrderListRow | null>(null);
  const list = useDokumaListesi(f);
  const wide = useWindowDimensions().width >= WIDE_MIN;
  const bos = dokumaBosDurum(f);
  const durumEtiket = DOKUMA_DURUM_SECENEKLERI.find((o) => o.value === f.durum)?.label.replace(/ \(.*\)$/, '') ?? 'Durum';
  const kisaArama = f.search.trim().length > 0 && f.search.trim().length < DOKUMA_MIN_ARAMA;

  return (
    <View style={styles.fill}>
      <View style={[styles.bar, wide && styles.barWide]}>
        <TextInput
          mode="outlined"
          placeholder="Ara: no, kumaş, fasoncu"
          accessibilityLabel={`${TERIM.dokumaIsEmri.tekil} ara: no, kumaş, fasoncu`}
          value={f.search}
          onChangeText={(search) => setF({ ...f, search })}
          left={<TextInput.Icon icon={list.searching ? 'timer-sand' : 'magnify'} />}
          right={f.search ? <TextInput.Icon icon="close" onPress={() => setF({ ...f, search: '' })} accessibilityLabel="Aramayı temizle" /> : undefined}
          style={[styles.search, wide && styles.searchWide]}
          testID="dokuma-liste-arama"
        />
        <TouchableRipple onPress={() => setDurumAcik(true)} style={[styles.filterBtn, f.durum !== 'OPEN' && styles.filterBtnOn]} borderless accessibilityRole="button" accessibilityLabel={`Durum: ${durumEtiket}`} testID="dokuma-liste-durum">
          <View style={styles.filterInner}>
            <Icon source="list-status" size={22} color={f.durum !== 'OPEN' ? colors.brand : colors.textSecondary} />
            <View>
              <Text style={styles.caption}>Durum</Text>
              <Text style={[styles.filterLabel, f.durum !== 'OPEN' && styles.filterLabelOn]} numberOfLines={1}>{durumEtiket}</Text>
            </View>
            <Icon source="chevron-down" size={20} color={colors.textMuted} />
          </View>
        </TouchableRipple>
      </View>
      <Text style={styles.total} testID="dokuma-liste-toplam">
        {list.total != null ? `${list.total.toLocaleString('tr-TR')} kayıt` : ' '}
        {kisaArama ? ` · aramak için en az ${DOKUMA_MIN_ARAMA} harf` : ''}
      </Text>

      <ListBody list={list} wide={wide} bos={bos} onBosEylem={(a) => setF(a === 'clearFilters' ? { ...f, search: '' } : { ...f, durum: 'ALL' })} onOpen={setAcik} />

      <PickerModal
        visible={durumAcik}
        title="Durum"
        options={DOKUMA_DURUM_SECENEKLERI.map((o) => ({ value: o.value, label: o.label }))}
        selectedValue={f.durum}
        onSelect={(v) => { setF({ ...f, durum: v as DokumaDurum }); setDurumAcik(false); }}
        onDismiss={() => setDurumAcik(false)}
        disableSort
      />
      <DokumaIsEmriDetaySheet id={acik?.id ?? null} baslik={acik?.weavingOrderNumber ?? ''} onClose={() => setAcik(null)} />
    </View>
  );
}

type ListState = ReturnType<typeof useDokumaListesi>;
type EmptyState = ReturnType<typeof dokumaBosDurum>;

/** Yükleniyor · sorun (çevrimdışı/hata) · boş (çıkış eylemiyle) · tablo. */
function ListBody({ list, wide, bos, onBosEylem, onOpen }: { list: ListState; wide: boolean; bos: EmptyState; onBosEylem: (a: Exclude<EmptyState['action'], null>) => void; onOpen: (r: WeavingOrderListRow) => void }) {
  return (
    <>
      {list.loading ? (
        <View style={styles.center} testID="dokuma-liste-yukleniyor">
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={styles.centerText}>{TERIM.dokumaIsEmri.cogul} yükleniyor…</Text>
        </View>
      ) : list.problem ? (
        <View style={styles.center} testID="dokuma-liste-hata">
          <Icon source={list.problem === 'offline' ? 'wifi-off' : 'alert-circle-outline'} size={48} color={colors.dangerText} />
          <Text style={styles.centerTitle}>{list.problem === 'offline' ? 'Çevrimdışısınız' : 'ListState alınamadı'}</Text>
          <Text style={styles.centerText}>{QUERY_PROBLEM_TEXT[list.problem]}</Text>
          <Button mode="contained" onPress={() => void list.refetch()} contentStyle={styles.bigBtn} icon="refresh">Tekrar dene</Button>
        </View>
      ) : list.rows.length === 0 ? (
        <View style={styles.center} testID="dokuma-liste-bos">
          <Icon source="clipboard-search-outline" size={52} color={colors.textMuted} />
          <Text style={styles.centerTitle}>{bos.title}</Text>
          <Text style={styles.centerText}>{bos.text}</Text>
          {bos.action && (
            <Button mode="outlined" onPress={() => bos.action && onBosEylem(bos.action)} contentStyle={styles.bigBtn} testID="dokuma-liste-bos-eylem">
              {bos.action === 'clearFilters' ? 'Aramayı temizle' : 'Tüm durumları göster'}
            </Button>
          )}
        </View>
      ) : (
        <View style={styles.fill}>
          {wide && (
            <View style={styles.headRow}>
              {SUTUNLAR.map((c) => <Text key={c.key} style={[styles.headCell, { flex: c.flex }]} numberOfLines={1}>{c.label}</Text>)}
              <View style={styles.chevronSpace} />
            </View>
          )}
          <FlashList
            data={list.rows}
            keyExtractor={(r) => r.id}
            renderItem={({ item }) => <OrderRow row={item} wide={wide} onOpen={onOpen} />}
            onEndReachedThreshold={0.6}
            onEndReached={list.loadMore}
            refreshing={list.refreshing}
            onRefresh={() => void list.refetch()}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={list.fetchingMore ? <ActivityIndicator style={styles.more} color={colors.brand} /> : null}
          />
        </View>
      )}
    </>
  );
}

function OrderRow({ row, wide, onOpen }: { row: WeavingOrderListRow; wide: boolean; onOpen: (r: WeavingOrderListRow) => void }) {
  const k = kumasMetni(row);
  const statusCell = (
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: DURUM_RENK[row.status] ?? colors.textMuted }]} />
      <Text style={styles.statusText} numberOfLines={1}>{trLabel(WORK_ORDER_STATUS_LABEL, row.status)}</Text>
    </View>
  );
  const kumas = (
    <View>
      <TruncatedText style={styles.text}>{k.ana}</TruncatedText>
      {k.alt ? <TruncatedText style={styles.sub}>{k.alt}</TruncatedText> : null}
    </View>
  );
  const tezgah = <TruncatedText style={styles.loom}>{tezgahMetni(row)}</TruncatedText>;
  const metre = <Text style={styles.text} numberOfLines={1}>{metreMetni(row)}</Text>;
  return (
    <TouchableRipple onPress={() => onOpen(row)} style={styles.row} testID={`dokuma-satir-${row.id}`} accessibilityRole="button" accessibilityLabel={`${row.weavingOrderNumber} ayrıntısı`}>
      {wide ? (
        <View style={styles.rowWide}>
          <View style={[styles.cell, { flex: SUTUNLAR[0].flex }]}><Text style={styles.no} numberOfLines={1}>{row.weavingOrderNumber}</Text></View>
          <View style={[styles.cell, { flex: SUTUNLAR[1].flex }]}>{kumas}</View>
          <View style={[styles.cell, { flex: SUTUNLAR[2].flex }]}>{tezgah}</View>
          <View style={[styles.cell, { flex: SUTUNLAR[3].flex }]}>{metre}</View>
          <View style={[styles.cell, { flex: SUTUNLAR[4].flex }]}>{statusCell}</View>
          <Icon source="chevron-right" size={22} color={colors.textMuted} />
        </View>
      ) : (
        <View style={styles.rowNarrow}>
          <View style={styles.narrowTop}>
            <Text style={styles.no} numberOfLines={1}>{row.weavingOrderNumber}</Text>
            {statusCell}
          </View>
          {kumas}
          <View style={styles.narrowLine}><Text style={styles.narrowLabel}>Tezgah</Text><View style={styles.fill}>{tezgah}</View></View>
          <View style={styles.narrowLine}><Text style={styles.narrowLabel}>Üretilen / plan</Text><View style={styles.fill}>{metre}</View></View>
        </View>
      )}
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  barWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  search: { backgroundColor: colors.surface, fontSize: typography.size.base, minHeight: 56 },
  searchWide: { flex: 1, minWidth: 260 },
  filterBtn: { minHeight: 56, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, justifyContent: 'center', alignSelf: 'flex-start' },
  filterBtnOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  filterInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  caption: { fontSize: typography.size.sm, color: colors.textMuted },
  filterLabel: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  filterLabelOn: { color: colors.brandDark },
  total: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xs, fontSize: typography.size.sm, color: colors.textSecondary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xxl },
  centerTitle: { fontSize: typography.size.lg, fontWeight: typography.weight.bold, color: colors.text, textAlign: 'center' },
  centerText: { fontSize: typography.size.base, color: colors.textSecondary, textAlign: 'center' },
  bigBtn: { minHeight: 56, paddingHorizontal: spacing.lg },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  headCell: { fontSize: typography.size.sm, fontWeight: typography.weight.bold, color: colors.textMuted, textTransform: 'uppercase' },
  chevronSpace: { width: 22 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  row: { borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  rowWide: { flexDirection: 'row', alignItems: 'center', minHeight: 72, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.md },
  rowNarrow: { paddingHorizontal: spacing.sm, paddingVertical: spacing.md, gap: spacing.sm },
  narrowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  narrowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  narrowLabel: { width: 120, fontSize: typography.size.sm, color: colors.textMuted },
  cell: { justifyContent: 'center' },
  no: { fontSize: typography.size.base, fontWeight: typography.weight.bold, color: colors.text },
  text: { fontSize: typography.size.sm, color: colors.text },
  sub: { fontSize: typography.size.sm, color: colors.textSecondary },
  loom: { fontSize: typography.size.base, fontWeight: typography.weight.semibold, color: colors.text },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  statusText: { fontSize: typography.size.sm, color: colors.text, fontWeight: typography.weight.medium },
  more: { marginVertical: spacing.lg },
});
