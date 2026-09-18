// =============================================================================
// PAGED SHEET — uzun formun SAYFALI kipi (boarding/sihirbaz): sayfa başına tek konu
// =============================================================================
// KURAL (kullanıcı, 2026-09-18): gövde ekranın %70'inden uzunsa kaydırma DEĞİL sayfa —
// üstte adım göstergesi (`WizardSteps`), "Geri · İleri", son sayfada "Kaydet" ve ÖZET.
// Sayfa geçişinde doğrulama: eksik zorunlu alan İleri'yi KİLİTLEMEZ; İleri'ye basılınca
// hata O SAYFADA yazılır ve sayfa değişmez (operatör neyi eksik bıraktığını görür).
// Geri daima serbest; adım göstergesinden GERİYE dokunarak dönülür, ileri atlanamaz
// (`WizardSteps` sözleşmesi). Klavye/numpad açıkken düğmeler görünür: alt çubuk kartın
// içinde sabit (`ModuleSheet`).
//
// Sayfa durumu bileşenin İÇİNDE; form verisi çağıranın (bu bileşen veriyi bilmez, yalnız
// `validate()`ye sorar). `useEffect` yok: sayfa değişince gövde kaydırıcısı başa alınır.
// =============================================================================
import React, { useRef, useState } from 'react';
import { View, type ScrollView } from 'react-native';
import { Text, Button } from 'react-native-paper';
import ModuleSheet, { sheet, type ModuleSheetProps } from './ModuleSheet';
import WizardSteps from './WizardSteps';

export interface SheetPage {
  key: string;
  /** Adım göstergesindeki kısa ad (2–4 sayfa; dar telefonda 4'ten sonra kırpılır). */
  title: string;
  render: () => React.ReactNode;
  /** Bu sayfadan çıkmak için eksik/yanlış olan; `null` = geçilebilir. Yalnız İLERİ'de sorulur. */
  validate?: () => string | null;
}

/** Saf geçiş: İleri'de doğrulama hatası varsa sayfa DEĞİŞMEZ ve hata döner; Geri daima geçer. */
export function nextPageState(current: number, pageCount: number, direction: 'ileri' | 'geri', error: string | null): { page: number; error: string | null } {
  if (direction === 'geri') return { page: Math.max(0, current - 1), error: null };
  if (error) return { page: current, error };
  return { page: Math.min(pageCount - 1, current + 1), error: null };
}

interface Props extends Omit<ModuleSheetProps, 'children' | 'footer' | 'header' | 'scrollRef'> {
  pages: readonly SheetPage[];
  onSubmit: () => void;
  submitLabel?: string;
  busy?: boolean;
  /** Bağlantı yok gibi dış kilit — son sayfadaki Kaydet'i kapatır, gezinmeyi değil. */
  submitDisabled?: boolean;
  onCancel: () => void;
  /** Çağıranın sunucu hatası — hangi sayfada olsun görünür (özet sayfasında da). */
  externalError?: string | null;
}

export default function PagedSheet({ pages, onSubmit, submitLabel = 'Kaydet', busy = false, submitDisabled = false, onCancel, externalError, ...sheetProps }: Props) {
  const [page, setPage] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const current = pages[Math.min(page, pages.length - 1)]!;
  const last = page >= pages.length - 1;

  const go = (direction: 'ileri' | 'geri') => {
    const err = direction === 'ileri' ? (current.validate?.() ?? null) : null;
    const next = nextPageState(page, pages.length, direction, err);
    setPageError(next.error);
    if (next.page !== page) {
      setPage(next.page);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }
  };

  return (
    <ModuleSheet
      {...sheetProps}
      scrollRef={scrollRef}
      header={<WizardSteps titles={pages.map((p) => p.title)} current={page} onGoTo={(i) => { setPageError(null); setPage(i); }} />}
      footer={
        <>
          <Button onPress={onCancel} disabled={busy} testID="paged-vazgec">Vazgeç</Button>
          <Button onPress={() => go('geri')} disabled={busy || page === 0} testID="paged-geri">Geri</Button>
          {last ? (
            <Button mode="contained" onPress={onSubmit} loading={busy} disabled={busy || submitDisabled} testID="paged-kaydet">{submitLabel}</Button>
          ) : (
            <Button mode="contained-tonal" onPress={() => go('ileri')} disabled={busy} testID="paged-ileri">İleri</Button>
          )}
        </>
      }
    >
      {current.render()}
      {pageError ? <Text style={sheet.error} testID="paged-hata">{pageError}</Text> : null}
      {externalError ? <Text style={sheet.error}>{externalError}</Text> : null}
    </ModuleSheet>
  );
}

/** Özet sayfası satırı — etiket · değer; boş değer "—". */
export function SummaryRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  const v = value == null || value === '' ? '—' : String(value);
  return (
    <View style={sheet.summaryRow}>
      <Text style={sheet.summaryLabel}>{label}</Text>
      <Text style={sheet.summaryValue}>{v}</Text>
    </View>
  );
}
