// =============================================================================
// İstasyonda belgeden iş emri bulma (Gülkesim K17; fabrika cevabı 23 / 23-ek) — kurşun / tambur ortak kartı
// =============================================================================
// "Belge okut": belge tarayıcısı (galeri açık) → yoksa klasik kamera → sunucu EŞLEME OKUMASI (kayıt doğmaz).
// Tek iş emri → doğrudan açılır (`onOpen`); çok → listeden seçilir; yok → sunucunun cümlesi + elle arama
// (fiş / evrak / parti / İE no). Kart çözümü ekranın mevcut yolundan (`cardBarcode` → getByCardBarcode).
// Çok İE: ekran (`screen`) sunucuya gider; burada bekleyen TEK İE açılır (kardeşler şerit için `onOpen`a), birden
// çoğu burada / hiçbiri burada ise liste: büyük parti no, işlem, top/metre, müşteri İE no, nerede.
// Doğrulama (2026-11-06): eşiği geçemeyen aday KENDİLİĞİNDEN AÇILMAZ — "Emin değilim" listesi ne tuttuğunu/tutmadığını
// gösterir, görevli "Eminim, aç" derse açılır; açılan İE okutma izine bildirilir (AUTO · CHOSEN · CONFIRMED).
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
import { stationDocLookupService, type LookupScreen, type OpenedHow, type StationLookupResult, type StationLookupWorkOrder } from '../../services/stationDocLookup.service';
import { colors, spacing, typography } from '../../theme';
import { decideLookup, isHere, partyLabel, rowDetail, rowWhere, searchable } from './decide';
import VerifyBadges from './VerifyBadges';

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
/** Liste satırından açma: nasıl açıldığı okutma izine gider. */
type PickFn = (workOrder: StationLookupWorkOrder, siblings: StationLookupWorkOrder[], how: OpenedHow) => void;
type ListKind = 'choose' | 'unsure';
type SheetState = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: ListKind; items: StationLookupWorkOrder[]; message: string } | { kind: 'empty'; message: string };

/** Sorgu durumu: son istek kazanır (kapanıp açılınca geç gelen yanıt yeni oturumu ezmez). */
function useLookupRun(onOpen: OpenFn) {
  const [view, setView] = useState<SheetState>({ kind: 'idle' });
  const [q, setQ] = useState('');
  const seq = useRef(0);
  const checkId = useRef<string | null>(null);
  const reset = () => {
    seq.current++;
    setView({ kind: 'idle' });
    setQ('');
  };
  const pick: PickFn = (w, siblings, how) => {
    if (checkId.current) void stationDocLookupService.reportOpened(checkId.current, w.workOrderNumber, how);
    checkId.current = null;
    onOpen(w, siblings);
  };
  const apply = (r: StationLookupResult) => {
    checkId.current = r.checkId ?? null;
    const d = decideLookup(r);
    if (d.kind === 'open') {
      reset();
      pick(d.workOrder, d.siblings, 'AUTO');
    } else if (d.kind === 'empty') setView({ kind: 'empty', message: d.message });
    else setView({ kind: d.kind, items: d.workOrders, message: d.message });
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
  return { view, q, setQ, reset, run, pick };
}

export default function StationDocLookupSheet({ visible, onDismiss, onOpen, readerConfigured, screen }: Props) {
  const { view, q, setQ, reset, run, pick } = useLookupRun(onOpen);
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
          <Button mode="outlined" icon="magnify" onPress={search} disabled={busy || !searchable(q)} contentStyle={styles.big} testID="belge-okut-ara">
            Ara
          </Button>
        </View>
        <ResultView view={view} onPick={pick} />
      </View>
    </ModuleSheet>
  );
}

/** Sonuç alanı: bekleme · "yok" cümlesi · çok İE listesi · "Emin değilim" listesi. */
function ResultView({ view, onPick }: { view: SheetState; onPick: PickFn }) {
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
    {view.kind === 'unsure' && <UnsureList items={view.items} message={view.message} onPick={onPick} />}
    {view.kind === 'choose' && (
      <View style={styles.list} testID="belge-okut-liste">
        <Text style={styles.muted}>{view.message}</Text>
        {view.items.map((w) => (
          <TouchableRipple
            key={w.id}
            onPress={() => onPick(w, view.items, 'CHOSEN')}
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

/**
 * Eşik altı adaylar: satıra dokunmak AÇMAZ (yanlış İE asla kazara açılmasın) — yalnız "Eminim, aç" düğmesi açar.
 * Her satır puanı ve ne tuttuğunu / ne tutmadığını söyler.
 */
function UnsureList({ items, message, onPick }: { items: StationLookupWorkOrder[]; message: string; onPick: PickFn }) {
  return (
    <View style={styles.list} testID="belge-okut-emin-degil">
      <Text style={styles.warn}>{message}</Text>
      {items.map((w) => (
        <View key={w.id} style={[styles.item, isHere(w) && styles.itemHere]}>
          <View style={styles.itemBody}>
            <Text style={styles.itemTitle}>{partyLabel(w)}</Text>
            <Text style={styles.itemDetail}>{rowDetail(w)}</Text>
            {!!rowWhere(w) && <Text style={isHere(w) ? styles.whereHere : styles.muted}>{rowWhere(w)}</Text>}
          </View>
          <VerifyBadges w={w} />
          <Button mode="outlined" onPress={() => onPick(w, items, 'CONFIRMED')} contentStyle={styles.big} testID={`belge-okut-onayla-${w.workOrderNumber}`}>
            Eminim, bu {TERIM.terbiyeIsEmri.tekilKucuk} — aç
          </Button>
        </View>
      ))}
      <Text style={styles.muted}>Emin değilseniz yukarıdan fiş / parti no yazıp arayın.</Text>
    </View>
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
  // Eşik altı bir hata değil, dikkat çağrısıdır: amber.
  warn: { color: colors.warningText, fontSize: typography.size.base, fontWeight: typography.weight.semibold },
  list: { gap: spacing.sm },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, minHeight: 56, gap: spacing.sm },
  itemHere: { borderWidth: 2, borderColor: colors.success },
  itemBody: { gap: 2 },
  itemTitle: { color: colors.text, fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  itemDetail: { color: colors.text, fontSize: typography.size.base },
  whereHere: { color: colors.successText, fontSize: typography.size.base, fontWeight: typography.weight.bold },
});
