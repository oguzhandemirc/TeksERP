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
    onOpenInfo: jest.fn(),
    length: { value: '', set: jest.fn() },
    kg: { value: '', set: jest.fn() },
    width: { value: '', set: jest.fn() },
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

  it('metreye dokun → düzenle → Kaydet: kesimin uzunluk yazıcısı çağrılır', async () => {
    const p = props();
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    layout(r);
    fireEvent.press(r.getByTestId('onizleme-alan-lengthMeters'));
    await flush();
    fireEvent.changeText(r.getByTestId('onizleme-sayi'), '12,5');
    await flush();
    fireEvent.press(r.getByTestId('onizleme-kaydet'));
    await flush();
    expect(p.length.set).toHaveBeenCalledWith('12,5');
  });

  it('kaliteye dokun → seç: kalite yazıcısı; ada dokun → etiket bilgisi penceresi', async () => {
    const p = props();
    const r = renderWithPaper(<TamburLabelPreviewCard {...p} />);
    layout(r);
    fireEvent.press(r.getByTestId('onizleme-alan-qualityGrade'));
    await flush();
    fireEvent.press(r.getByText('A1'));
    await flush();
    expect(p.quality.pick).toHaveBeenCalledWith('A1');
    fireEvent.press(r.getByTestId('onizleme-alan-itemName'));
    expect(p.onOpenInfo).toHaveBeenCalled();
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
    const p = { onOpenInfo: jest.fn(), onConsignee: jest.fn(), onCustomer: jest.fn() };
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
  it('sağ grup: kip düğmesi o anki kipi gösterir, dokununca geçiş ister; Bitir aynı grupta', () => {
    const onToggle = jest.fn();
    const onBitir = jest.fn();
    const r = renderWithPaper(<TamburModeBitirBar mode="manual" onToggle={onToggle} busy={false} onBitir={onBitir} bitirLoading={false} />);
    expect(r.getByText('ÖLÇÜM')).toBeTruthy();
    expect(r.getByText('Manuel')).toBeTruthy();
    fireEvent.press(r.getByTestId('tambur-kip-dugmesi'));
    expect(onToggle).toHaveBeenCalledTimes(1);
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
