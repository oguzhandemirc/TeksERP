// K30-D ⚙ Alanlar: kapatılan alan "Diğer alanlar"a iner, zorunlular kapanmaz, gizli ama dolu alan sessiz gitmez;
// hedef kumaş/renk görünürlüğü. (UnifiedWoForm.test'ten bölündü — ortak taklitler test/unifiedWoFormFixture.)
import React from 'react';
// Taklitler önce kaydolmalı (fikstür UnifiedWoForm'u kendisi yükler).
import { mockFx, mockPrefSave, route, colorRoute, row, ui } from '../../../../test/unifiedWoFormFixture';
import { fireEvent, waitFor, within } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import type { DocRow } from './useWoRows';
import UnifiedWoForm from './UnifiedWoForm';
import { SCAN_ROUTE } from './woFromDoc';

const openSheet = async (s: ReturnType<typeof renderWithPaper>) => {
  fireEvent.press(s.getByTestId('ie-alanlar'));
  return s.findByTestId('ie-alan-en');
};

describe('UnifiedWoForm — ⚙ Alanlar (K30-D)', () => {
  it('⭐ kapat → alan "Diğer alanlar (n)"e iner → dokununca açılır → geri aç → üste döner; blob diğer anahtarları korur', async () => {
    const s = renderWithPaper(ui());
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    fireEvent.press(await openSheet(s));
    fireEvent.press(s.getByTestId('ie-alanlar-tamam'));
    await waitFor(() => expect(mockPrefSave).toHaveBeenCalledTimes(1));
    expect(mockPrefSave.mock.calls[0][0]).toEqual({ theme: 'dark', tabletIeForm: { gizli: ['en'] } });
    expect(s.queryByTestId('ie-form-en')).toBeNull();
    expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (1)');
    fireEvent.press(s.getByTestId('ie-diger-alanlar'));
    expect(s.getByTestId('ie-form-alanlari-diger')).toContainElement(s.getByTestId('ie-form-en'));
    fireEvent.press(await openSheet(s));
    await waitFor(() => expect(mockPrefSave).toHaveBeenCalledTimes(2));
    expect(mockFx.blob).toEqual({ theme: 'dark', tabletIeForm: { gizli: [] } });
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    expect(s.getByTestId('ie-form-alanlari')).toContainElement(s.getByTestId('ie-form-en'));
  });

  it('⭐ zorunlular kapatılamaz ("zorunlu" etiketi, anahtar pasif); Varsayılana dön hepsini açar', async () => {
    mockFx.blob = { theme: 'dark', tabletIeForm: { gizli: ['not', 'planBaslangic', 'rota', 'bilinmeyen'] } };
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (2)'));
    expect(s.getByTestId('ie-rota-yolu')).toBeTruthy();
    await openSheet(s);
    for (const k of ['musteri', 'partiNo', 'kursunMetresi', 'rota']) {
      expect(s.getByTestId(`ie-alan-zorunlu-${k}`)).toBeTruthy();
      expect(s.getByTestId(`ie-alan-anahtar-${k}`)).toBeDisabled();
    }
    expect(s.getByTestId('ie-alan-hedefOzellik')).toBeTruthy();
    fireEvent.press(s.getByTestId('ie-alan-rota'));
    expect(mockPrefSave).not.toHaveBeenCalled();
    fireEvent.press(s.getByTestId('ie-alanlar-varsayilan'));
    await waitFor(() => expect(mockFx.blob).toEqual({ theme: 'dark', tabletIeForm: { gizli: [] } }));
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    expect(s.getByTestId('ie-form-not')).toBeTruthy();
    // Not kutusunun adı "Üretim notu" (form + ⚙ listesi).
    expect(within(s.getByTestId('ie-form-alanlari')).getAllByText('Üretim notu').length).toBeGreaterThan(0);
    expect(within(s.getByTestId('ie-form-alanlari')).queryAllByText('Not')).toHaveLength(0);
  });

  it('⭐ gizli alanı belge DEĞERLE doldurursa üstte "belgeden" rozetiyle görünür; yalnız öneri gelen gizli alan altta kalır', async () => {
    mockFx.qty = true;
    mockFx.blob = { tabletIeForm: { gizli: ['en', 'hedefKumas', 'planBitis'], hedefDoldur: true } };
    mockFx.rows = [row()];
    const s = renderWithPaper(ui());
    // En (değer dolar) üste çıkar; hedef kumaş (yalnız öneri) ve Planlı bitiş "Diğer alanlar"da kalır.
    await waitFor(() => expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (2)'));
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.getByTestId('ie-form-alanlari')).toContainElement(s.getByTestId('ie-form-en'));
    expect(s.getByTestId('belgeden-width')).toBeTruthy();
    expect(s.queryByTestId('ie-form-desen-oneri')).toBeNull();
    fireEvent.press(s.getByTestId('ie-diger-alanlar'));
    expect(s.getByTestId('ie-form-alanlari-diger')).toContainElement(s.getByTestId('ie-form-desen-oneri'));
  });

  it('⭐ gizli hedef renk: belgede yazan renk varken "Diğer alanlar"da kalır, "Belgede yazan renk" yazısı da onunla altta', async () => {
    mockFx.blob = { tabletIeForm: { gizli: ['hedefRenk'] } };
    const base = row();
    mockFx.rows = [row({ detail: { ...base.detail!, formFields: { renkText: '58 KOYU BEJ FULAR' }, suggestions: {} } as DocRow['detail'] })];
    const s = renderWithPaper(ui(colorRoute));
    await waitFor(() => expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (1)'));
    expect(s.queryByTestId('ie-form-renk-metni')).toBeNull();
    expect(s.queryByText(/Belgede yazan renk/)).toBeNull();
    fireEvent.press(s.getByTestId('ie-diger-alanlar'));
    expect(s.getByTestId('ie-form-alanlari-diger')).toContainElement(s.getByTestId('ie-form-renk-metni'));
  });
});

describe('UnifiedWoForm — ⚙ Alanlar (K30-D): gizli alanın değeri', () => {

  it('⭐ ⚙ "Diğer alanlar" anahtarı kapalıyken bölüm çizilmez; blob\'un diğer anahtarları korunur', async () => {
    mockFx.blob = { theme: 'dark', tabletIeForm: { gizli: ['planBitis', 'en'] } };
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-diger-alanlar-baslik')).toHaveTextContent('Diğer alanlar (2)'));
    await openSheet(s);
    fireEvent.press(s.getByTestId('ie-diger-alanlar-goster'));
    await waitFor(() => expect(mockFx.blob).toEqual({ theme: 'dark', tabletIeForm: { gizli: ['planBitis', 'en'], digerGizli: true } }));
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
  });

  it('⭐ "Diğer alanlar" kapalı ama gizli alanda kayda girecek değer var → bölüm yine çizilir (sessiz gönderim yok)', async () => {
    mockFx.qty = true;
    mockFx.blob = { tabletIeForm: { gizli: ['planBitis', 'en'], digerGizli: true } };
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.queryByTestId('ie-diger-alanlar')).toBeNull());
    // Değerli gizli alan: en'i ⚙'tan açıp doldurup yeniden gizleyerek kurarız.
    fireEvent.press(await openSheet(s));
    await waitFor(() => expect(s.getByTestId('ie-form-en')).toBeTruthy());
    fireEvent.changeText(s.getByTestId('ie-form-en'), '170');
    fireEvent.press(s.getByTestId('ie-alan-en'));
    await waitFor(() => expect(s.getByTestId('ie-diger-alanlar-dolu')).toHaveTextContent('Dolu, kayda girecek: En (cm)'));
  });

  it('⭐ belgeden üste çıkan gizli alan düzeltilince yerinde kalır (rozet düşer, değer gövdeye gider)', async () => {
    mockFx.qty = true;
    mockFx.blob = { tabletIeForm: { gizli: ['en'], hedefDoldur: true } };
    mockFx.rows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    fireEvent.changeText(s.getByTestId('ie-form-en'), '170');
    expect(s.queryByTestId('belgeden-width')).toBeNull();
    expect(s.getByTestId('ie-form-alanlari')).toContainElement(s.getByTestId('ie-form-en'));
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    expect(mockFx.opts?.extraBody?.(mockFx.rows[0])).toMatchObject({ width: 170 });
  });

  it('tercih okunamazsa hepsi açık; yazılamayan seçim yerelde kalır ve "kaydedilecek" ipucu görünür', async () => {
    mockFx.blob = null as unknown as Record<string, unknown>;
    mockPrefSave.mockRejectedValueOnce(new Error('ağ yok'));
    const s = renderWithPaper(ui());
    expect(s.queryByTestId('ie-diger-alanlar')).toBeNull();
    fireEvent.press(await openSheet(s));
    await waitFor(() => expect(s.getByTestId('ie-alanlar-bekliyor')).toBeTruthy());
    expect(s.queryByTestId('ie-form-en')).toBeNull();
  });

});

describe('UnifiedWoForm — ⚙ Alanlar: hedef kumaş / renk görünürlüğü', () => {
  const fasonOwners = ['STANDARD', 'CUSTOMER_GOODS'] as const;
  const pickFason = async (s: ReturnType<typeof renderWithPaper>) => fireEvent.press(await s.findByTestId('ie-mal-sahibi-CUSTOMER_GOODS'));
  const withDeclared = () => row({ detail: { ...row().detail, suggestions: {}, incomingDeclared: { itemText: 'DSN-7', colorText: 'Ekru', suggestedItem: { id: 'i9', name: 'Eşlenen Tül' }, suggestedColor: null } } as never });

  it('⭐ Fason: "Hedef kumaş" sorulmaz; kendi üretimin dışındaki (kart boş / bugünkü) formda görünür', async () => {
    mockFx.rows = [row()];
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={[...fasonOwners]} />);
    expect(await s.findByTestId('ie-form-hedef-kumas')).toBeTruthy();
    await pickFason(s);
    expect(s.queryByTestId('ie-form-hedef-kumas')).toBeNull();
    s.unmount();
    expect(renderWithPaper(ui()).getByTestId('ie-form-hedef-kumas')).toBeTruthy();
  });
  it('⭐ Fason: belgenin eşlenen kartı hedef kumaşa gizlice yazılır (en öne); eşleme yoksa anahtar gitmez', async () => {
    mockFx.rows = [withDeclared()];
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={[...fasonOwners]} />);
    await pickFason(s);
    await waitFor(() => expect(mockFx.opts?.extraBody?.(mockFx.rows[0])).toMatchObject({ targetItemId: 'i9', type: 'CUSTOMER_GOODS_SERVICE' }));
    s.unmount();
    mockFx.rows = [row({ detail: { ...row().detail, suggestions: {} } as never })];
    const t = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} ownerKinds={[...fasonOwners]} />);
    await pickFason(t);
    expect(mockFx.opts?.extraBody?.(mockFx.rows[0])).not.toHaveProperty('targetItemId');
  });
  it('⭐ hedef renk: renk veren adım yoksa gizli; veren adım varsa ve rotasızda görünür', async () => {
    mockFx.rows = [row()];
    expect(renderWithPaper(ui(route)).queryByTestId('renk-alani')).toBeNull();
    expect(renderWithPaper(ui(colorRoute)).getByTestId('renk-alani')).toBeTruthy();
    expect(renderWithPaper(ui(SCAN_ROUTE)).getByTestId('renk-alani')).toBeTruthy();
  });
});
