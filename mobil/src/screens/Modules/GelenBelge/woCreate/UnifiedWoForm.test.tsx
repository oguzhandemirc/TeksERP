// S16b tek form: belge okutulmadan "oluştur" kapalı; okuma sonucu inputlara dolar (belgeden sarı vurgu); desen/renk önerisi
// çiple onaylanır; kayıt form ucuna ek alanlarla gider, PER_PARTY'de hedef metraj/kg gitmez. ⚙ Alanlar: UnifiedWoForm.alanlar.test.
import React from 'react';
// Taklitler önce kaydolmalı (fikstür UnifiedWoForm'u kendisi yükler).
import { mockFx, mockSaveAll, mockAdd, mockPrefSave, PAGE, route, colorRoute, form, row, ui, fillOn, highlighted } from '../../../../test/unifiedWoFormFixture';
import { fireEvent, waitFor, within } from '@testing-library/react-native';
import { renderWithPaper } from '../../../../test/render';
import { StyleSheet } from 'react-native';
import type { DocRow } from './useWoRows';
import UnifiedWoForm from './UnifiedWoForm';

// Canlı kamera "Çek ve bitir" (2026-11-09): gönderim sürerken sayfa listesi/gönder paneli çizilmez, tek kompakt "Belge okunuyor…";
// gönderim düşünce (sayfalar bekliyor) bugünkü yeniden dene / vazgeç paneli. Negatif sonda: DocColumn'da `sending` dalı
// kaldırılınca ilk vaka kırmızı.
describe('UnifiedWoForm — belge gönderilirken', () => {
  afterEach(() => { mockFx.scan = { pages: [], sending: false, headerLocked: false, uploaded: new Set() }; });
  it('⭐ gönderim sürerken yalnız "Belge okunuyor…" (sayfa listesi, Vazgeç, gönder düğmesi yok)', () => {
    mockFx.scan = { pages: [PAGE], sending: true, headerLocked: false, uploaded: new Set() };
    const s = renderWithPaper(ui());
    expect(s.getByTestId('ie-belge-okunuyor')).toHaveTextContent(/Belge okunuyor/);
    expect(s.queryByText(/Sayfalar \(/)).toBeNull();
    expect(s.queryByTestId('belge-ie-gonder')).toBeNull();
    expect(s.queryByText('Vazgeç')).toBeNull();
    expect(s.queryByTestId('ie-belge-okut')).toBeNull();
  });
  it('⭐ gönderim düştüyse bekleyen sayfalar + "Yeniden dene" / Vazgeç paneli kalır', () => {
    mockFx.scan = { pages: [PAGE], sending: false, headerLocked: true, uploaded: new Set() };
    const s = renderWithPaper(ui());
    expect(s.queryByTestId('ie-belge-okunuyor')).toBeNull();
    expect(s.getByTestId('belge-ie-gonder')).toHaveTextContent(/Yeniden dene \(1 sayfa\)/);
    expect(s.getByText('Vazgeç')).toBeTruthy();
  });
});

describe('UnifiedWoForm', () => {
  it('⭐ belge okutulmadan "oluştur" KAPALI + ipucu; belge alanları yer tutucu; Belge okut tarayıcıyı açar', () => {
    const s = renderWithPaper(ui());
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
    expect(s.getByTestId('ie-form-ipucu').props.children).toMatch(/Önce belgeyi okutun/);
    expect(s.getByTestId('ie-form-belge-yer-tutucu')).toBeTruthy();
    expect(s.getByTestId('ie-form-en').props.value).toBe('');
    fireEvent.press(s.getByTestId('ie-belge-okut'));
    expect(mockAdd).toHaveBeenCalledTimes(1);
  });

  it('⭐ okuma sonucu inputlara dolar + "belgeden" rozeti; metraj/kg bayrak kapalıyken de belgeden geldiği için görünür', async () => {
    fillOn();
    mockFx.qty = true;
    mockFx.rows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.getByTestId('belgeden-width')).toBeTruthy();
    expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('1200.5');
    expect(s.getByTestId('ie-form-hedef-kg').props.value).toBe('300');
    // T2: formdaki kg HEDEF kg'dir (gelen kg belge satırının kutusunda).
    expect(s.getByTestId('ie-form-hedef-kg').props.accessibilityLabel).toBe('Hedef kg (kg)');
    expect(s.getByTestId('belgeden-targetQuantity')).toBeTruthy();
    expect(s.getByTestId('satir-karti')).toHaveTextContent(/single/);
    // Belge varken dev "Belgeyi okut" düğmesi yok; yeniden okutma kartın Belge şeridinde.
    expect(s.queryByTestId('ie-belge-okut')).toBeNull();
    expect(s.queryByText('Belgeyi değiştir')).toBeNull();
    expect(s.getByTestId('ie-form-olustur')).not.toBeDisabled();
  });

  it('⭐ varsayılan (⚙ anahtarı kapalı): belge hedef kutularına KOPYALANMAZ — kutu boş, silik ipucu "belgede …"; not yine dolar', async () => {
    mockFx.qty = true;
    mockFx.rows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-hedef-metraj').props.placeholder).toBe('belgede 1200,5 m'));
    expect(s.getByTestId('ie-form-en').props.value).toBe('');
    expect(s.getByTestId('ie-form-en').props.placeholder).toBe('belgede 150 cm');
    expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('');
    expect(s.getByTestId('ie-form-hedef-kg').props.placeholder).toBe('belgede 300 kg');
    expect(s.queryByTestId('belgeden-width')).toBeNull();
    expect(s.queryByTestId('gelen-metreden-targetQuantity')).toBeNull();
    expect(mockFx.opts?.extraBody?.(mockFx.rows[0])).not.toHaveProperty('width');
  });

  it('⭐ ⚙ "Belgedeki gelen değerleri hedefe yaz" anahtarı açılır → tercih blob\'una yazılır, hedef kutuları dolar', async () => {
    mockFx.qty = true;
    mockFx.rows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.placeholder).toBe('belgede 150 cm'));
    fireEvent.press(s.getByTestId('ie-alanlar'));
    fireEvent.press(s.getByTestId('ie-hedef-doldur'));
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(mockPrefSave.mock.calls[0][0]).toMatchObject({ theme: 'dark', tabletIeForm: { gizli: [], hedefDoldur: true } });
  });

  it('⭐ hedef metraj/kg ayarı KAPALI: belge değer getirse de kutu çizilmez, gövdeye gitmez (anahtar açık olsa da)', async () => {
    mockFx.blob = { tabletIeForm: { hedefDoldur: true } };
    mockFx.rows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(s.queryByTestId('ie-form-hedef-metraj')).toBeNull();
    expect(s.queryByTestId('ie-form-hedef-kg')).toBeNull();
    const b = mockFx.opts?.extraBody?.(mockFx.rows[0]);
    expect(b).not.toHaveProperty('targetQuantity');
    expect(b).not.toHaveProperty('targetWeight');
  });

  it('⭐ hedef en ayarı KAPALI: En kutusu çizilmez, gövdeye en gitmez', async () => {
    mockFx.width = false;
    mockFx.qty = true;
    mockFx.blob = { tabletIeForm: { hedefDoldur: true } };
    mockFx.rows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-hedef-sayilar')).toBeTruthy());
    expect(s.queryByTestId('ie-form-en')).toBeNull();
    expect(mockFx.opts?.extraBody?.(mockFx.rows[0])).not.toHaveProperty('width');
  });
});

describe('UnifiedWoForm — hedef kutuları, kayıt ve gelen metre', () => {
  it('⭐ öneri çipi: "Evet" → hedef kumaş / renk seçili, çip kalkar; öneri alana kendiliğinden yazılmaz', async () => {
    mockFx.rows = [row()];
    const s = renderWithPaper(ui(colorRoute));
    const chip = await s.findByTestId('ie-form-desen-oneri');
    expect(chip).toHaveTextContent(/Tül Beyaz \(T-1\) mi\?.*belgede “DSN-7”.*Evet/);
    expect(s.getByTestId('renk-alani').props.children).toBe('bos');
    fireEvent.press(chip);
    fireEvent.press(s.getByTestId('ie-form-renk-oneri'));
    expect(s.queryByTestId('ie-form-desen-oneri')).toBeNull();
    expect(s.queryByTestId('ie-form-renk-oneri')).toBeNull();
    expect(s.getByTestId('renk-alani').props.children).toBe('c1');
    expect(s.getByText('Tül Beyaz')).toBeTruthy();
  });

  it('⭐ kayıt: ek alanlar form ucunun gövdesine; PER_PARTY satırda hedef metraj/kg GİTMEZ', async () => {
    fillOn();
    mockFx.qty = true;
    mockFx.rows = [row()];
    const s = renderWithPaper(ui());
    fireEvent.press(await s.findByTestId('ie-form-desen-oneri'));
    fireEvent.changeText(s.getByTestId('ie-form-en'), '160');
    fireEvent.press(s.getByTestId('ie-form-olustur'));
    expect(mockSaveAll).toHaveBeenCalledTimes(1);
    expect(mockFx.opts?.extraBody?.(mockFx.rows[0])).toEqual({ targetItemId: 'i1', width: 160, targetQuantity: 1200.5, targetWeight: 300 });
    const perParty = row({ form: { ...form, multi: { mode: 'PER_PARTY', rows: [] } } } as unknown as Partial<DocRow>);
    const b = mockFx.opts?.extraBody?.(perParty);
    expect(b).not.toHaveProperty('targetQuantity');
    expect(b).not.toHaveProperty('targetWeight');
    expect(b).toMatchObject({ width: 160 });
  });

  it('⭐ hedef metraj ayarı açık + belgede hedef yok → gelen metre kutu içi "gelen metre" etiketiyle; yazınca rozet kalkar, değer gövdeye gider', async () => {
    fillOn();
    mockFx.qty = true;
    const base = row();
    mockFx.rows = [row({ detail: { ...base.detail, formFields: { en: '150' } } } as unknown as Partial<DocRow>)];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('100'));
    expect(s.getByTestId('gelen-metreden-targetQuantity')).toBeTruthy();
    expect(mockFx.opts?.extraBody?.(mockFx.rows[0])).not.toHaveProperty('targetQuantity');
    fireEvent.changeText(s.getByTestId('ie-form-hedef-metraj'), '90');
    expect(s.queryByTestId('gelen-metreden-targetQuantity')).toBeNull();
    expect(mockFx.opts?.extraBody?.(mockFx.rows[0])).toMatchObject({ targetQuantity: 90 });
  });

  it('⭐ toplar ayrı geldi: hedef metraj gelen metresi top toplamı', async () => {
    fillOn();
    mockFx.qty = true;
    const base = row();
    const rolls = [{ key: 'a', meters: 40, weightKg: null, senderRollNo: '' }, { key: 'b', meters: 60.5, weightKg: null, senderRollNo: '' }];
    mockFx.rows = [row({ form: { ...form, rolls }, detail: { ...base.detail, formFields: {} } } as unknown as Partial<DocRow>)];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-hedef-metraj').props.value).toBe('100.5'));
    expect(s.getByTestId('gelen-metreden-targetQuantity')).toBeTruthy();
  });

  it('düz karo (rota seçilmedi): belge okunsa da "Üretim Rotasını seçin." ile kapalı', async () => {
    mockFx.rows = [row()];
    const s = renderWithPaper(ui(null));
    await waitFor(() => expect(s.getByTestId('ie-form-ipucu').props.children).toBe('Üretim Rotasını seçin.'));
    expect(s.getByTestId('ie-form-olustur')).toBeDisabled();
  });
});

describe('UnifiedWoForm — vurgu, yerleşim ve kontrollü Alanlar', () => {
  it('⭐ belgeden dolan En sarı vurgulu, rozet yazısı yok; elle değişince vurgu kalkar', async () => {
    fillOn();
    mockFx.qty = true;
    mockFx.rows = [row()];
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    expect(highlighted(s, 'ie-form-en')).toBe(true);
    expect(highlighted(s, 'ie-form-hedef-kg')).toBe(true);
    expect(s.queryByText('belgeden')).toBeNull();
    fireEvent.changeText(s.getByTestId('ie-form-en'), '160');
    expect(s.queryByTestId('belgeden-width')).toBeNull();
    expect(highlighted(s, 'ie-form-en')).toBe(false);
    expect(highlighted(s, 'ie-form-hedef-kg')).toBe(true);
  });

  it('⭐ tablet yatay (1280×800): iki sütun — solda belge kartı, sağda üretim alanları; dikeyde tek sütun', async () => {
    fillOn();
    mockFx.rows = [row()];
    mockFx.dims = { width: 1280, height: 800, scale: 1, fontScale: 1 };
    const s = renderWithPaper(ui());
    await waitFor(() => expect(s.getByTestId('ie-form-en').props.value).toBe('150'));
    const left = within(s.getByTestId('ie-form-sol'));
    const right = within(s.getByTestId('ie-form-sag'));
    expect(left.getByTestId('satir-karti')).toBeTruthy();
    expect(left.queryByTestId('ie-belge-okut')).toBeNull();
    expect(right.getByTestId('ie-form-en')).toBeTruthy();
    expect(left.queryByTestId('ie-form-en')).toBeNull();
    // Oran içerikten bağımsız: kutular flexBasis 0 + eşit flex (kaydırıcı sarmalayıcısı basis:auto taşır, 69/31'e kaymıştı).
    const box = (id: string) => StyleSheet.flatten(s.getByTestId(id).props.style);
    expect(box('ie-form-sol-kutu')).toMatchObject({ flexBasis: 0, minWidth: 0, flex: 1 });
    expect(box('ie-form-sag-kutu')).toMatchObject({ flexBasis: 0, minWidth: 0, flex: 1 });
    mockFx.dims = { width: 800, height: 1280, scale: 1, fontScale: 1 };
    const d = renderWithPaper(ui());
    expect(d.queryByTestId('ie-form-iki-sutun')).toBeNull();
  });

  it('⭐ kontrollü Alanlar: fieldsOpen verilince gövde tuşu çizilmez, seçici prop ile açılır', () => {
    const onChange = jest.fn();
    const s = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} fieldsOpen={false} onFieldsOpenChange={onChange} />);
    expect(s.queryByTestId('ie-alanlar')).toBeNull();
    expect(s.queryByText('Varsayılana dön')).toBeNull();
    const o = renderWithPaper(<UnifiedWoForm initialRoute={route} routeLocked onNew={jest.fn()} fieldsOpen onFieldsOpenChange={onChange} />);
    expect(o.getByText('Varsayılana dön')).toBeTruthy();
  });
});
