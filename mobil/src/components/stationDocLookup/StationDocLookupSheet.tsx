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
// Cihaz okuması (2026-11-09): çekilen sayfa tablette ML Kit ile okunur (+ barkod), gövdeye `clientOcr` olarak gider; sunucu
// okuyucusu kapalıyken de kamera açılır (sunucu `deviceOcrAccepted` + cihazda OCR). Eski sunucu 400 → alansız tekrar.
// =============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, TouchableRipple } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import ModuleSheet from '../ModuleSheet';
import MultiPageCameraModal from '../../screens/Modules/GelenBelge/MultiPageCameraModal';
import { usePageSource } from '../../screens/Modules/GelenBelge/usePageSource';
import { MAX_PAGES, readPageExtras, sendWithExtras, type ScanPage } from '../../screens/Modules/GelenBelge/docScan';
import { deviceOcrAvailable } from '../../services/deviceOcr';
import { stationDocLookupService, type LookupScreen, type OpenedHow, type StationLookupResult, type StationLookupWorkOrder } from '../../services/stationDocLookup.service';
import { colors, spacing, typography } from '../../theme';
import { decideLookup, isHere, partyLabel, rowDetail, rowWhere, verifyBadges } from './decide';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /**
   * Seçilen / açılan iş emri — ekran kart çözümüne `cardBarcode` verir. `siblings`: aynı belgenin bütün İE'leri
   * (birden çoksa ekran "diğerine geç" şeridini çizer); tek İE'de boş.
   */
  onOpen: (workOrder: StationLookupWorkOrder, siblings: StationLookupWorkOrder[]) => void;
  /** Sunucu okuyucusu kullanılabilir mi. */
  readerConfigured: boolean;
  /** Sunucu cihaz okumasını kabul ediyor mu (eski sunucu: false). Okuyucu kapalıysa kamera buna + cihaz OCR'ına bakar. */
  deviceOcrAccepted?: boolean;
  /** Soran ekran: sunucu "burada bekliyor mu"yu bu ekranın açık kart listesine göre söyler. */
  screen?: LookupScreen;
}

type OpenFn = Props['onOpen'];
/** Liste satırından açma: nasıl açıldığı okutma izine gider. */
type PickFn = (workOrder: StationLookupWorkOrder, siblings: StationLookupWorkOrder[], how: OpenedHow) => void;
type ListKind = 'choose' | 'unsure';
/** Cihaz okuması yok/başarısız + sunucu okuyucu kapalı (409 SERVER_OCR_DISABLED): kısa cümle, toast değil. */
const UNREADABLE_TEXT = 'Belge okunamadı — tekrar çekin ya da fiş no ile arayın.';
const isServerOcrOff = (e: unknown) => (e as { details?: { code?: string } } | null)?.details?.code === 'SERVER_OCR_DISABLED';
type SheetState = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: ListKind; items: StationLookupWorkOrder[]; message: string } | { kind: 'empty'; message: string };

/** Sorgu durumu: son istek kazanır (kapanıp açılınca geç gelen yanıt yeni oturumu ezmez). */
function useLookupRun(onOpen: OpenFn) {
  const [view, setView] = useState<SheetState>({ kind: 'idle' });
  const seq = useRef(0);
  const checkId = useRef<string | null>(null);
  const reset = () => {
    seq.current++;
    setView({ kind: 'idle' });
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
      if (isServerOcrOff(e)) {
        setView({ kind: 'empty', message: UNREADABLE_TEXT });
        return;
      }
      setView({ kind: 'idle' });
      Toast.show({ type: 'error', text1: 'Belge okutulamadı', text2: e instanceof Error ? e.message : undefined });
    }
  };
  return { view, reset, run, pick };
}

export default function StationDocLookupSheet({ visible, onDismiss, onOpen, readerConfigured, deviceOcrAccepted = false, screen }: Props) {
  const { view, reset, run, pick } = useLookupRun(onOpen);
  const close = () => {
    reset();
    onDismiss();
  };

  // Okutma yapılabilir: sunucu okuyucusu açık YA DA sunucu cihaz okumasını kabul ediyor ve bu tablet okuyabiliyor.
  const canRead = readerConfigured || (deviceOcrAccepted && deviceOcrAvailable());
  const fromPage = (p: ScanPage) =>
    void run('Belge okunuyor…', async () => {
      const { clientOcr, barcodes } = await readPageExtras(p);
      return sendWithExtras((extras) => stationDocLookupService.byPhoto(p.base64, p.sha256, screen, extras), clientOcr, barcodes);
    });
  // Tek sayfa yeter: belge no ilk sayfanın başlığında (tarayıcı sınırı MAX_PAGES − 1 → 1 sayfa).
  const source = usePageSource(MAX_PAGES - 1, (pages) => pages[0] && fromPage(pages[0]));
  const busy = view.kind === 'busy' || source.busy;

  // Pencere açılınca doğrudan kamera (elle giriş yok; elle arama ekranın Liste yolunda).
  const addRef = useRef(source.add);
  addRef.current = source.add;
  useEffect(() => {
    if (visible && canRead) addRef.current();
  }, [visible, canRead]);

  return (
    <ModuleSheet
      visible={visible}
      onDismiss={close}
      title="Belgeden iş bul"
      footer={
        <>
          {canRead && (
            <Button mode="outlined" icon="camera" onPress={source.add} disabled={busy} contentStyle={styles.big} testID="belge-okut-cek">
              Tekrar okut
            </Button>
          )}
          <Button mode="contained" buttonColor={colors.danger} textColor={colors.textOnDark} onPress={close} contentStyle={styles.big} testID="belge-okut-kapat">
            İptal
          </Button>
        </>
      }
      overlays={
        <MultiPageCameraModal {...source.camera} onError={(m) => Toast.show({ type: 'error', text1: m })} />
      }
    >
      <View style={styles.body}>
        {!canRead && (
          <Text style={styles.empty} testID="belge-okut-okunamaz">
            Belge okunamıyor — fiş no ile elle arayın
          </Text>
        )}
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
    {view.kind === 'unsure' && (
      <View style={styles.list} testID="belge-okut-emin-degil">
        <Text style={styles.warn}>{view.message}</Text>
        {view.items.map((w) => (
          <JobCard key={w.id} w={w} onPress={() => onPick(w, view.items, 'CONFIRMED')} testID={`belge-okut-onayla-${w.workOrderNumber}`} />
        ))}
      </View>
    )}
    {view.kind === 'choose' && (
      <View style={styles.list} testID="belge-okut-liste">
        <Text style={styles.muted}>{view.message}</Text>
        {view.items.map((w) => (
          <JobCard key={w.id} w={w} onPress={() => onPick(w, view.items, 'CHOSEN')} testID={`belge-okut-ie-${w.workOrderNumber}`} />
        ))}
      </View>
    )}
    </>
  );
}

/** Büyük dokunulabilir iş emri kartı: parti no büyük, tek satır ayrıntı, kısa konum; tutmayan alan varsa kırmızı tek satır. */
function JobCard({ w, onPress, testID }: { w: StationLookupWorkOrder; onPress: () => void; testID: string }) {
  const where = rowWhere(w);
  const misses = verifyBadges(w).filter((b) => b.tone === 'miss').map((b) => b.label);
  return (
    <TouchableRipple onPress={onPress} style={[styles.item, isHere(w) && styles.itemHere]} accessibilityRole="button" testID={testID}>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle}>{w.rollCount === undefined && w.batchNumbers.length === 0 ? w.workOrderNumber : partyLabel(w)}</Text>
        <Text style={styles.itemDetail}>{rowDetail(w)}</Text>
        {!!where && (
          <Text style={isHere(w) ? styles.whereHere : styles.muted} testID={`belge-okut-nerede-${w.workOrderNumber}`}>
            {where}
          </Text>
        )}
        {misses.length > 0 && (
          <Text style={styles.miss} testID={`belge-okut-uyusmaz-${w.workOrderNumber}`}>
            Uyuşmayan: {misses.join(', ')}
          </Text>
        )}
      </View>
    </TouchableRipple>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  big: { minHeight: 56 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muted: { color: colors.textSecondary, fontSize: typography.size.sm },
  empty: { color: colors.dangerText, fontSize: typography.size.base, fontWeight: typography.weight.semibold },
  // Eşik altı bir hata değil, dikkat çağrısıdır: amber.
  warn: { color: colors.warningText, fontSize: typography.size.base, fontWeight: typography.weight.semibold },
  miss: { color: colors.dangerText, fontSize: typography.size.sm },
  list: { gap: spacing.sm },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, minHeight: 72, gap: spacing.sm },
  itemHere: { borderWidth: 2, borderColor: colors.success },
  itemBody: { gap: 2 },
  itemTitle: { color: colors.text, fontSize: typography.size.xl, fontWeight: typography.weight.bold },
  itemDetail: { color: colors.text, fontSize: typography.size.base },
  whereHere: { color: colors.successText, fontSize: typography.size.base, fontWeight: typography.weight.bold },
});
