import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import WorkOrderFixSheet from './WorkOrderFixSheet';
import { renderWithPaper } from '../../../test/render';

const mockPreview = jest.fn();
const mockColor = jest.fn();
const mockWidth = jest.fn();
const mockGramaj = jest.fn();
const mockGramajSave = jest.fn();
// Parti Ekle kartı okutma geri bildirimini (expo-audio) yükler — jest'te ses modülü yok.
jest.mock('../../../services/scanFeedback', () => ({ signalScan: jest.fn() }));
jest.mock('../../../services/workOrder.service', () => ({
  workOrderService: {
    previewTargetColor: (...a: unknown[]) => mockPreview(...a),
    changeTargetColor: (...a: unknown[]) => mockColor(...a),
    changeWidth: (...a: unknown[]) => mockWidth(...a),
    reprintTravelerCard: jest.fn(),
  },
}));
jest.mock('../../../services/workOrderGramaj.service', () => ({
  workOrderGramajService: {
    kursunGramaj: (...a: unknown[]) => mockGramaj(...a),
    changeKursunGramaj: (...a: unknown[]) => mockGramajSave(...a),
  },
}));
jest.mock('../../../services/travelerCardPrint', () => ({ printTravelerCardForWorkOrder: jest.fn() }));
jest.mock('../../../hooks/useReasonPresets', () => ({
  useReasonPresets: () => ({
    presets: [
      { id: '1', kind: 'WORK_ORDER_PLAN_CHANGE', code: 'MUSTERI_DEGISTIRDI', label: 'Müşteri değiştirdi', fullText: 'Müşteri isteği değiştirdi', requiresText: false, sortOrder: 0, isActive: true, isSystem: true },
      { id: '2', kind: 'WORK_ORDER_PLAN_CHANGE', code: 'DIGER', label: 'Diğer', fullText: null, requiresText: true, sortOrder: 1, isActive: true, isSystem: true },
    ],
    isLoading: false,
    isFallback: false,
  }),
}));
// Renk seçici ağ ister — tek dokunuşla "c2" seçen düğmeyle değiştirilir.
jest.mock('../../../components/ColorSelectField', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ onChange }: { onChange: (id: string | null) => void }) => (
      <RN.TouchableOpacity onPress={() => onChange('c2')}><RN.Text>renk-sec</RN.Text></RN.TouchableOpacity>
    ),
  };
});

const WO = { id: 'wo-1', workOrderNumber: 'IE-1', targetColorId: 'c1', targetColor: { name: 'Mavi' }, width: 180 };

function renderIt(kind: 'color' | 'width' | 'gramaj') {
  const onDone = jest.fn();
  renderWithPaper(<WorkOrderFixSheet kind={kind} wo={WO} onDismiss={() => {}} onDone={onDone} />);
  return { onDone };
}

// Portal içeriği efektle güncellenir: okumadan önce bekleyen güncellemeler boşaltılır (bayat okuma yeşil yanıltır).
async function saveDisabled(): Promise<boolean> {
  await act(async () => {});
  return screen.getByRole('button', { name: 'Kaydet' }).props.accessibilityState?.disabled === true;
}

describe('WorkOrderFixSheet — en', () => {
  beforeEach(() => mockWidth.mockReset().mockResolvedValue({ data: { previousWidth: 180 } }));

  it('değişiklik ve sebep olmadan kaydedilmez; ikisi girilince sebep kodu + tam metinle gider', async () => {
    const { onDone } = renderIt('width');
    expect(await saveDisabled()).toBe(true);
    fireEvent.changeText(screen.getByPlaceholderText('örn. 180'), '200');
    expect(await saveDisabled()).toBe(true);
    fireEvent.press(screen.getByText('Müşteri değiştirdi'));
    expect(await saveDisabled()).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockWidth).toHaveBeenCalledWith('wo-1', { width: 200, reason: 'Müşteri isteği değiştirdi', reasonCode: 'MUSTERI_DEGISTIRDI' });
  });
});

describe('WorkOrderFixSheet — renk', () => {
  beforeEach(() => {
    mockColor.mockReset().mockResolvedValue({ data: { warnings: [] } });
    mockPreview.mockReset().mockResolvedValue({
      data: { blocked: null, partial: { dyedCount: 2, pendingCount: 3 }, warnings: [], cardWillBeStale: true },
    });
  });

  it('kısmi boyada onay kartta istenir; onaysız kapalı, onaylı confirmPartial ile gider', async () => {
    const { onDone } = renderIt('color');
    fireEvent.press(screen.getByText('renk-sec'));
    await waitFor(() => expect(screen.getByText(/2 top zaten boyanmış/)).toBeTruthy());
    expect(mockPreview).toHaveBeenCalledWith('wo-1', 'c2');
    fireEvent.press(screen.getByText('Müşteri değiştirdi'));
    expect(await saveDisabled()).toBe(true);
    fireEvent.press(screen.getByText(/2 top zaten boyanmış/));
    expect(await saveDisabled()).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockColor).toHaveBeenCalledWith('wo-1', expect.objectContaining({ colorId: 'c2', confirmPartial: true, reasonCode: 'MUSTERI_DEGISTIRDI' }));
  });

  it('önizleme engeli mesajı gösterir ve kaydı kapatır', async () => {
    mockPreview.mockResolvedValue({ data: { blocked: { code: 'COLOR_DYED_BLOCKED', message: 'Mal boyandı — Tebdil gerekir' }, partial: null, warnings: [], cardWillBeStale: false } });
    renderIt('color');
    fireEvent.press(screen.getByText('renk-sec'));
    await waitFor(() => expect(screen.getByText('Mal boyandı — Tebdil gerekir')).toBeTruthy());
    fireEvent.press(screen.getByText('Müşteri değiştirdi'));
    expect(await saveDisabled()).toBe(true);
  });
});

describe('WorkOrderFixSheet — gramaj (2026-11-06)', () => {
  beforeEach(() => {
    mockGramaj.mockReset().mockResolvedValue({
      propertyId: 'p-k', target: { valueId: 'v40', valueName: '40 gr' },
      options: [{ id: 'v40', name: '40 gr', isDefault: true }, { id: 'v45', name: '45 gr', isDefault: false }],
      appliedRollCount: 3, pendingRollCount: 5,
    });
    mockGramajSave.mockReset().mockResolvedValue({ warnings: ['3 topa kurşun eski gramajla uygulandı (geçmiş değişmez); yeni gramaj kalan 5 topa işler.'] });
  });

  it('⭐ önizleme uygulanmış/kalan top sayısını söyler; aynı gramaj ve sebepsiz kaydedilmez; yeni gramaj sebeple gider', async () => {
    const { onDone } = renderIt('gramaj');
    expect(await screen.findByText('3 topa kurşun eski gramajla (40 gr) uygulandı — bu geçmiş değişmez. Yeni gramaj kalan 5 topa işler.')).toBeTruthy();
    expect(await saveDisabled()).toBe(true);
    fireEvent.press(screen.getByTestId('gramaj-v40'));
    fireEvent.press(screen.getByText('Müşteri değiştirdi'));
    expect(await saveDisabled()).toBe(true);
    fireEvent.press(screen.getByTestId('gramaj-v45'));
    expect(await saveDisabled()).toBe(false);
    fireEvent.press(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(mockGramajSave).toHaveBeenCalledWith('wo-1', { propertyId: 'p-k', valueId: 'v45', reason: 'Müşteri isteği değiştirdi' });
  });

  it('kurşun özelliği tanımsız → seçici yok, kaydedilmez', async () => {
    mockGramaj.mockResolvedValue({ propertyId: null, target: null, options: [], appliedRollCount: 0, pendingRollCount: 0 });
    renderIt('gramaj');
    expect(await screen.findByText('Kurşun gramajı özelliği tanımlı değil.')).toBeTruthy();
    expect(await saveDisabled()).toBe(true);
  });
});
