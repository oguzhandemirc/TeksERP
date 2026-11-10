// Canlı etiket önizlemesi kartı: kâğıtta düzenlenebilir alan dokunulabilir, barkod/tarih değil; düzenle → kesimin
// KENDİ yazıcısı çağrılır (metre/kalite/ad); ağ hatasında son görüntü + uyarı. Alt şerit sağ grubu: tek kip düğmesi.
import React from 'react';
import { act, fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import TamburLabelPreviewCard, { dispatchEdit, type TamburLabelPreviewCardProps } from './TamburLabelPreviewCard';
import TamburModeBitirBar from './TamburModeBitirBar';
import CutActionBar from './CutActionBar';
import type { TamburLabelPreview } from '../../../services/tambur.service';

jest.mock('../../../components/NumpadInput', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextInput } = require('react-native');
  return {
    __esModule: true,
    default: (p: { value: string; onChangeText: (v: string) => void; testID?: string }) => (
      <TextInput testID={p.testID} value={p.value} onChangeText={p.onChangeText} />
    ),
  };
});

const flush = () => act(async () => { await Promise.resolve(); });
// Kart solarak kapanır (motion `base`); söküm zamanlayıcısı act içinde dolsun.
const settle = () => act(async () => { await new Promise((res) => setTimeout(res, 320)); });

const preview: TamburLabelPreview = {
  kind: 'FINISHED',
  templateId: 't1',
  templateName: 'İngilizce ihracat etiketi',
  widthMm: 100,
  heightMm: 58,
  rows: null,
  elements: [
    { type: 'text', x: 4, y: 4, hMm: 5, bold: true, align: 'left', rot: 0, wr: null, text: 'HHHH', bind: 'itemName' },
    { type: 'text', x: 4, y: 12, hMm: 3, bold: false, align: 'left', rot: 0, wr: null, text: '07,66 yds / 07,00 mt', bind: 'lengthMeters' },
    { type: 'text', x: 4, y: 18, hMm: 3, bold: false, align: 'left', rot: 0, wr: null, text: '1. Kalite', bind: 'qualityGrade' },
    { type: 'text', x: 4, y: 24, hMm: 3, bold: false, align: 'left', rot: 0, wr: null, text: '10.11.2026', bind: 'printedAt' },
    { type: 'text', x: 4, y: 30, hMm: 3, bold: false, align: 'left', rot: 0, wr: null, text: 'Made in Türkiye', bind: null },
    { type: 'code128', x: 4, y: 40, wMm: 40, hMm: 10, human: true, humanHMm: 2.5, value: null },
  ],
} as unknown as TamburLabelPreview;

function props(over: Partial<TamburLabelPreviewCardProps> = {}): TamburLabelPreviewCardProps {
  return {
    preview,
    stale: false,
    fallbackRows: [],
    ctx: { owner: false, batchEnabled: false, manualLength: true },
    forWhom: 'GAHAHA',
    templateOffer: null,
    selectedTemplateId: null,
    onPickTemplate: jest.fn(),
    onOpenInfo: jest.fn(),
    length: { value: '', set: jest.fn() },
    kg: { value: '', set: jest.fn() },
    width: { value: '', set: jest.fn() },
    itemName: { value: '', set: jest.fn() },
    colorName: { value: '', set: jest.fn() },
    batch: { value: '', set: jest.fn() },
    quality: { grades: [{ code: 'Q1', name: '1. Kalite' }, { code: 'A1', name: 'A1' }], value: 'Q1', pick: jest.fn() },
    onCustomer: jest.fn(),
    ...over,
  };
}

function layout(r: ReturnType<typeof renderWithPaper>) {
  fireEvent(r.getByTestId('tambur-etiket-onizleme'), 'layout', { nativeEvent: { layout: { width: 500, height: 290 } } });
}

describe('TamburLabelPreviewCard', () => {
  it('düzenlenebilir alanlar dokunulur; tarih ve sabit metin dokunulamaz', () => {
    const r = renderWithPaper(<TamburLabelPreviewCard {...props()} />);
    layout(r);
    expect(r.getByTestId('onizleme-alan-itemName')).toBeTruthy();
    expect(r.getByTestId('onizleme-alan-lengthMeters')).toBeTruthy();
    expect(r.queryByTestId('onizleme-alan-printedAt')).toBeNull();
    expect(r.getByText('Made in Türkiye')).toBeTruthy();
    expect(r.getByText('yeni barkod — kesimde verilir')).toBeTruthy();
  });

  it('metreye dokun → kutu YERİNDE açılır (modal yok) → ✓: kesimin uzunluk yazıcısı çağrılır', async () => {
    const p = props();
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    layout(r);
    fireEvent.press(r.getByTestId('onizleme-alan-lengthMeters'));
    await flush();
    expect(r.getByTestId('onizleme-yerinde-kutu')).toBeTruthy();
    fireEvent.changeText(r.getByTestId('onizleme-yerinde'), '12,5');
    await flush();
    fireEvent.press(r.getByTestId('onizleme-onay'));
    await flush();
    expect(p.length.set).toHaveBeenCalledWith('12,5');
    await settle();
    expect(r.queryByTestId('onizleme-yerinde-kutu')).toBeNull();
  });

  it('perdeye (kutunun dışına) dokunmak değişikliği ATAR ve kutuyu kapatır', async () => {
    const p = props();
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    layout(r);
    fireEvent.press(r.getByTestId('onizleme-alan-itemName'));
    await flush();
    fireEvent.changeText(r.getByTestId('onizleme-yerinde'), 'ATILACAK');
    await flush();
    fireEvent.press(r.getByTestId('onizleme-perde'));
    await flush();
    await settle();
    expect(r.queryByTestId('onizleme-yerinde-kutu')).toBeNull();
    expect(p.itemName.set).not.toHaveBeenCalled();
  });

  it('ada dokun → yerinde metin kutusu (pencere açılmaz); klavye "bitti" ad yazıcısını çağırır; ✕ hiçbir şey yazmaz', async () => {
    const p = props();
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    layout(r);
    fireEvent.press(r.getByTestId('onizleme-alan-itemName'));
    await flush();
    expect(p.onOpenInfo).not.toHaveBeenCalled();
    fireEvent.changeText(r.getByTestId('onizleme-yerinde'), 'TÜL PERDE');
    fireEvent(r.getByTestId('onizleme-yerinde'), 'submitEditing');
    await flush();
    expect(p.itemName.set).toHaveBeenCalledWith('TÜL PERDE');
    fireEvent.press(r.getByTestId('onizleme-alan-itemName'));
    await flush();
    fireEvent.press(r.getByTestId('onizleme-vazgec'));
    await flush();
    expect(p.itemName.set).toHaveBeenCalledTimes(1);
    await settle();
    expect(r.queryByTestId('onizleme-yerinde-kutu')).toBeNull();
  });

  it('kaliteye dokun → seç: kalite yazıcısı', async () => {
    const p = props();
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    layout(r);
    fireEvent.press(r.getByTestId('onizleme-alan-qualityGrade'));
    await flush();
    fireEvent.press(r.getByText('A1'));
    await flush();
    expect(p.quality.pick).toHaveBeenCalledWith('A1');
  });

});

describe('TamburLabelPreviewCard — Şablon Değiştir (çoklu etiket seti)', () => {
  it('"Şablon Değiştir" — eski backend (teklif yok): metin + erişilebilirlik adı; dokununca etiket bilgisi penceresi', () => {
    const p = props();
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    expect(r.getByText('Şablon Değiştir')).toBeTruthy();
    expect(r.queryByText('Değiştir')).toBeNull();
    fireEvent.press(r.getByLabelText('Etiket şablonunu değiştir'));
    expect(p.onOpenInfo).toHaveBeenCalledTimes(1);
    expect(r.queryByText('Etiket şablonu')).toBeNull();
  });

  it('"Şablon Değiştir" → PickerModal şablonları sunucu sırasıyla listeler; seçim onPickTemplate (pencere açılmaz)', async () => {
    const offer = {
      kind: 'ROLL_FINISHED',
      defaultTemplateId: 'tr',
      options: [
        { id: 'tr', name: 'Türkçe Etiket', source: 'DEFAULT' as const, isDefault: true },
        { id: 'en', name: 'English Label', source: 'CUSTOMER' as const, isDefault: false },
        { id: 'it', name: 'Etichetta Italiana', source: 'GLOBAL' as const, isDefault: false },
      ],
    };
    const p = props({ templateOffer: offer, selectedTemplateId: 'tr' });
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    expect(r.queryByTestId('tambur-etiket-tek-sablon')).toBeNull();
    fireEvent.press(r.getByTestId('tambur-etiket-degistir'));
    await flush();
    expect(r.getByText('Etiket şablonu')).toBeTruthy();
    expect(r.getByText('★ Türkçe Etiket')).toBeTruthy();
    expect(r.getByText('müşteri')).toBeTruthy();
    expect(r.getByText('herkes için')).toBeTruthy();
    fireEvent.press(r.getByText('English Label'));
    await flush();
    expect(p.onPickTemplate).toHaveBeenCalledWith('en');
    expect(p.onOpenInfo).not.toHaveBeenCalled();
  });

  it('K4: tek seçenekte düğme pasif + "Tek şablon atanmış"; dokunmak hiçbir şey açmaz', async () => {
    const offer = { kind: 'ROLL_FINISHED', defaultTemplateId: 'tr', options: [{ id: 'tr', name: 'Türkçe Etiket', source: 'DEFAULT' as const, isDefault: true }] };
    const p = props({ templateOffer: offer, selectedTemplateId: 'tr' });
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    expect(r.getByTestId('tambur-etiket-tek-sablon')).toHaveTextContent('Tek şablon atanmış');
    expect(r.getByTestId('tambur-etiket-degistir')).toBeDisabled();
    fireEvent.press(r.getByTestId('tambur-etiket-degistir'));
    await flush();
    expect(r.queryByText('Etiket şablonu')).toBeNull();
    expect(p.onOpenInfo).not.toHaveBeenCalled();
    expect(p.onPickTemplate).not.toHaveBeenCalled();
  });
});

describe('TamburLabelPreviewCard — boş alan, otomatik ve ağ hatası', () => {
  it('değeri boş alan önizlemede kırmızı "— boş" olarak görünür ve yine yerinde düzenlenir', async () => {
    const withEmpty = { ...preview, elements: [...(preview.elements ?? []), { type: 'text', x: 60, y: 20, hMm: 3, bold: false, align: 'left', rot: 0, wr: 1, text: '', bind: 'weightKg', empty: true }] } as TamburLabelPreview;
    const p = props({ preview: withEmpty });
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    layout(r);
    expect(r.getByTestId('onizleme-bos-weightKg')).toHaveTextContent('Kg — boş');
    fireEvent.press(r.getByTestId('onizleme-alan-weightKg'));
    await flush();
    fireEvent.changeText(r.getByTestId('onizleme-yerinde'), '12');
    fireEvent.press(r.getByTestId('onizleme-onay'));
    await flush();
    expect(p.kg.set).toHaveBeenCalledWith('12');
  });

  it('otomatik ölçümde metre alanı dokunulamaz', () => {
    const r = renderWithPaper(<TamburLabelPreviewCard {...props({ ctx: { owner: false, batchEnabled: false, manualLength: false } })} />);
    layout(r);
    expect(r.queryByTestId('onizleme-alan-lengthMeters')).toBeNull();
  });

  it('ağ hatası: son görüntü kalır + uyarı (kesim etkilenmez)', () => {
    const r = renderWithPaper(<TamburLabelPreviewCard {...props({ stale: true })} />);
    layout(r);
    expect(r.getByText('HHHH')).toBeTruthy();
    expect(r.getByText('Önizleme güncellenemedi — son görüntü. Kesim etkilenmez.')).toBeTruthy();
  });

  it('dispatchEdit: alıcı/müşteri kendi seçicisini açar', () => {
    const p = { onConsignee: jest.fn(), onCustomer: jest.fn() };
    const open = jest.fn();
    dispatchEdit('consignee', p, open);
    dispatchEdit('customer', p, open);
    dispatchEdit('kg', p, open);
    expect(p.onConsignee).toHaveBeenCalled();
    expect(p.onCustomer).toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith('kg');
  });
});

describe('alt şerit (geniş ana kesim)', () => {
  it('sağ grup: METRE ve KG kip düğmeleri ayrı, her biri kendi geçişini ister; Bitir aynı grupta', () => {
    const meter = jest.fn();
    const kg = jest.fn();
    const r = renderWithPaper(
      <TamburModeBitirBar meter={{ mode: 'manual', onToggle: meter }} kg={{ mode: 'auto', onToggle: kg }} busy={false} onBitir={jest.fn()} bitirLoading={false} />,
    );
    expect(r.getByText('METRE')).toBeTruthy();
    expect(r.getByText('KG')).toBeTruthy();
    expect(r.getByText('Manuel')).toBeTruthy();
    expect(r.getByText('Otomatik')).toBeTruthy();
    expect(r.getByText('Bitir')).toBeTruthy();
    // Otomatik kipte küçük vurgu (yeşil nokta), manuelde yok.
    expect(r.getByTestId('tambur-kg-kip-dugmesi-oto')).toBeTruthy();
    expect(r.queryByTestId('tambur-kip-dugmesi-oto')).toBeNull();
    fireEvent.press(r.getByTestId('tambur-kip-dugmesi'));
    expect(meter).toHaveBeenCalledTimes(1);
    fireEvent.press(r.getByTestId('tambur-kg-kip-dugmesi'));
    expect(kg).toHaveBeenCalledTimes(1);
  });

  it('kg alanı yoksa KG düğmesi çizilmez', () => {
    const r = renderWithPaper(<TamburModeBitirBar meter={{ mode: 'auto', onToggle: jest.fn() }} kg={null} busy={false} onBitir={jest.fn()} bitirLoading={false} />);
    expect(r.queryByTestId('tambur-kg-kip-dugmesi')).toBeNull();
  });

  it('sol grup: Kartela + "Kes & Etiket Bas" ikinci satırıyla; Bitir ve Etiket bilgisi yok', () => {
    const r = renderWithPaper(
      <CutActionBar
        compact={false}
        kartelaOn={false}
        onToggleKartela={jest.fn()}
        kesLabel="Kes & Etiket Bas"
        kesSubLabel="kalanı kes · 170.0 m"
        onKes={jest.fn()}
        kesDisabled={false}
        kesLoading={false}
        onBitir={jest.fn()}
        onOpenLabelInfo={jest.fn()}
        wideLeft
      />,
    );
    expect(r.getByText('Kes & Etiket Bas')).toBeTruthy();
    expect(r.getByText('kalanı kes · 170.0 m')).toBeTruthy();
    expect(r.queryByText('Bitir')).toBeNull();
    expect(r.queryByText('Etiket bilgisi')).toBeNull();
  });
});
