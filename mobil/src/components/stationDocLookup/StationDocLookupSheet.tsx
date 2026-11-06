// =============================================================================
// İstasyonda belgeden iş emri bulma (Gülkesim K17; fabrika cevabı 23 / 23-ek) — kurşun / tambur ortak kartı
// =============================================================================
// "Belge okut": belge tarayıcısı (galeri açık) → yoksa klasik kamera → sunucu EŞLEME OKUMASI (kayıt doğmaz).
// Tek iş emri → doğrudan açılır (`onOpen`); çok → listeden seçilir; yok → sunucunun cümlesi + elle arama
// (fiş / evrak / parti / İE no). Kart çözümü ekranın mevcut yolundan (`cardBarcode` → getByCardBarcode).
// Çok İE: ekran (`screen`) sunucuya gider; burada bekleyen TEK İE açılır (kardeşler şerit için `onOpen`a), birden
// çoğu burada / hiçbiri burada ise liste: büyük parti no, işlem, top/metre, müşteri İE no, nerede.
// =============================================================================
import React, { useRef, useState } from 'react';
import { TERIM } from '../../lib/terim';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, TouchableRipple } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import ModuleSheet from '../ModuleSheet';
import ModalTextInput from '../ModalTextInput';
import MultiPageCameraModal from '../../screens/Modules/GelenBelge/MultiPageCameraModal';
import { usePageSource } from '../../screens/Modules/GelenBelge/usePageSource';
import { MAX_PAGES, type ScanPage } from '../../screens/Modules/GelenBelge/docScan';
import { stationDocLookupService, type LookupScreen, type StationLookupResult, type StationLookupWorkOrder } from '../../services/stationDocLookup.service';
import { colors, spacing, typography } from '../../theme';
import { decideLookup, isHere, partyLabel, rowDetail, rowWhere, searchable } from './decide';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /**
   * Seçilen / açılan iş emri — ekran kart çözümüne `cardBarcode` verir. `siblings`: aynı belgenin bütün İE'leri
   * (birden çoksa ekran "diğerine geç" şeridini çizer); tek İE'de boş.
   */
  onOpen: (workOrder: StationLookupWorkOrder, siblings: StationLookupWorkOrder[]) => void;
  /** Okuma servisi kurulu mu (yoksa yalnız elle arama). */
  readerConfigured: boolean;
  /** Soran ekran: sunucu "burada bekliyor mu"yu bu ekranın açık kart listesine göre söyler. */
  screen?: LookupScreen;
}

type OpenFn = Props['onOpen'];
type SheetState = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'choose'; items: StationLookupWorkOrder[]; message: string } | { kind: 'empty'; message: string };

/** Sorgu durumu: son istek kazanır (kapanıp açılınca geç gelen yanıt yeni oturumu ezmez). */
function useLookupRun(onOpen: OpenFn) {
  const [view, setView] = useState<SheetState>({ kind: 'idle' });
  const [q, setQ] = useState('');
  const seq = useRef(0);
  const reset = () => {
    seq.current++;
    setView({ kind: 'idle' });
    setQ('');
  };
  const apply = (r: StationLookupResult) => {
    const d = decideLookup(r);
    if (d.kind === 'open') {
      reset();
      onOpen(d.workOrder, d.siblings);
    } else if (d.kind === 'choose') setView({ kind: 'choose', items: d.workOrders, message: d.message });
    else setView({ kind: 'empty', message: d.message });
  };
  const run = async (text: string, call: () => Promise<StationLookupResult>) => {
    const my = ++seq.current;
    setView({ kind: 'busy', text });
    try {
      const r = await call();
      if (my === seq.current) apply(r);
    } catch (e) {
      if (my !== seq.current) return;
      setView({ kind: 'idle' });
      Toast.show({ type: 'error', text1: 'Belge okutulamadı', text2: e instanceof Error ? e.message : undefined });
    }
  };
  return { view, q, setQ, reset, run };
}

export default function StationDocLookupSheet({ visible, onDismiss, onOpen, readerConfigured, screen }: Props) {
  const { view, q, setQ, reset, run } = useLookupRun(onOpen);
  const close = () => {
    reset();
    onDismiss();
  };

  const fromPage = (p: ScanPage) => void run('Belge okunuyor…', () => stationDocLookupService.byPhoto(p.base64, p.sha256, screen));
  // Tek sayfa yeter: belge no ilk sayfanın başlığında (tarayıcı sınırı MAX_PAGES − 1 → 1 sayfa).
  const source = usePageSource(MAX_PAGES - 1, (pages) => pages[0] && fromPage(pages[0]));
  const search = () => {
    if (searchable(q)) void run('Aranıyor…', () => stationDocLookupService.bySearch(q.trim(), screen));
  };
  const busy = view.kind === 'busy' || source.busy;

  return (
    <ModuleSheet
      visible={visible}
      onDismiss={close}
      title="Belgeden iş bul"
      subtitle="Boyahane belgesini okutun ya da fiş / evrak / parti no yazın"
      footer={
        <Button mode="text" onPress={close} testID="belge-okut-kapat">
          Kapat
        </Button>
      }
      overlays={
        <MultiPageCameraModal {...source.camera} onError={(m) => Toast.show({ type: 'error', text1: m })} />
      }
    >
      <View style={styles.body}>
        {readerConfigured && (
          <Button mode="contained" icon="file-document-outline" onPress={source.add} disabled={busy} contentStyle={styles.big} testID="belge-okut-cek">
            Belge okut
          </Button>
        )}
        <View style={styles.searchRow}>
          <ModalTextInput
            mode="outlined"
            dense
            value={q}
            onChangeText={setQ}
            onSubmitEditing={search}
            returnKeyType="search"
            placeholder={`Fiş / evrak / parti / ${TERIM.terbiyeIsEmri.tekilKucuk} no`}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.searchInput}
            testID="belge-okut-ara-metin"
          />
          <Button mode="outlined" onPress={search} disabled={busy || !searchable(q)} testID="belge-okut-ara">
            Ara
          </Button>
        </View>
        <ResultView view={view} onOpen={onOpen} />
      </View>
    </ModuleSheet>
  );
}

/** Sonuç alanı: bekleme · "yok" cümlesi · çok İE listesi. */
function ResultView({ view, onOpen }: { view: SheetState; onOpen: OpenFn }) {
  return (
    <>
    {view.kind === 'busy' && (
      <View style={styles.row} testID="belge-okut-bekle">
        <ActivityIndicator />
        <Text style={styles.muted}>{view.text}</Text>
      </View>
    )}
    {view.kind === 'empty' && (
      <Text style={styles.empty} testID="belge-okut-yok">
        {view.message}
      </Text>
    )}
    {view.kind === 'choose' && (
      <View style={styles.list} testID="belge-okut-liste">
        <Text style={styles.muted}>{view.message}</Text>
        {view.items.map((w) => (
          <TouchableRipple
            key={w.id}
            onPress={() => onOpen(w, view.items)}
            style={[styles.item, isHere(w) && styles.itemHere]}
            accessibilityRole="button"
            testID={`belge-okut-ie-${w.workOrderNumber}`}
          >
            <View style={styles.itemBody}>
              <Text style={styles.itemTitle}>{w.rollCount === undefined ? w.workOrderNumber : partyLabel(w)}</Text>
              <Text style={styles.itemDetail}>{rowDetail(w)}</Text>
              {!!rowWhere(w) && (
                <Text style={isHere(w) ? styles.whereHere : styles.muted} testID={`belge-okut-nerede-${w.workOrderNumber}`}>
                  {rowWhere(w)}
                </Text>
              )}
            </View>
          </TouchableRipple>
        ))}
      </View>
    )}
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  big: { minHeight: 56 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  searchInput: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muted: { color: colors.textSecondary, fontSize: typography.size.sm },
  empty: { color: colors.dangerText, fontSize: typography.size.base, fontWeight: typography.weight.semibold },
  list: { gap: spacing.sm },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, minHeight: 56 },
  itemHere: { borderWidth: 2, borderColor: colors.success },
  itemBody: { gap: 2 },
  itemTitle: { color: colors.text, fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  itemDetail: { color: colors.text, fontSize: typography.size.base },
  whereHere: { color: colors.success, fontSize: typography.size.sm, fontWeight: typography.weight.semibold },
});
