// "Son Çıkan Toplar" sütun seçimi (2026-11-10): varsayılan = bugünkü görünüm (verisiz renk/en kapalı), barkod zorunlu,
// seçim cihazda ekran kimliğiyle kalıcı; satır yalnız seçili sütunları çizer.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { DEFAULT_OUTPUT_COLUMNS, RECENT_OUTPUT_SCREEN_KEY, resolveOutputColumns, toggleOutputColumn } from './recentOutputColumns';
import { OutputColumnsPicker } from './OutputColumnsPicker';
import { RelabelRollRow } from './TamburScreen';
import { parseListColumns, useDeviceSettingsStore } from '../../../store/deviceSettingsStore';
import { storage } from '../../../utils/storage';
import type { Roll } from '../../../types/models';

jest.mock('../../../utils/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), deleteItem: jest.fn() },
}));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(), setAudioModeAsync: jest.fn() }));
const mem = storage as jest.Mocked<typeof storage>;

const withData = { width: 150, color: { name: 'EKRU' } };
const noData = { width: null, color: null };

describe('resolveOutputColumns / toggleOutputColumn', () => {
  it('kayıt yok + veri var → bugünkü görünüm', () => {
    expect([...resolveOutputColumns(null, [withData])].sort()).toEqual([...DEFAULT_OUTPUT_COLUMNS].sort());
  });
  it('kayıt yok + renk/en hiç yok → o iki sütun kapalı başlar', () => {
    const c = resolveOutputColumns(null, [noData, noData]);
    expect(c.has('color')).toBe(false);
    expect(c.has('width')).toBe(false);
    expect(c.has('date')).toBe(true);
  });
  it('kayıt varsa o geçerli; bilinmeyen anahtar düşer; barkod kayıtta olmasa da görünür', () => {
    const c = resolveOutputColumns(['item', 'kg', 'bozuk'], [withData]);
    expect([...c].sort()).toEqual(['barcode', 'item', 'kg']);
  });
  it('barkod kapatılamaz; diğerleri aç/kapa', () => {
    const cur = resolveOutputColumns(null, [withData]);
    expect(toggleOutputColumn(cur, 'barcode')).toContain('barcode');
    expect(toggleOutputColumn(cur, 'date')).not.toContain('date');
    expect(toggleOutputColumn(cur, 'kg')).toContain('kg');
  });
});

describe('sütun seçimi cihazda kalıcı, ekran kimliğine göre', () => {
  it('yazılır, yeniden açılışta gelir; diğer ekranın kaydı korunur; null varsayılana döndürür', async () => {
    const disk: Record<string, string> = { device_list_columns: JSON.stringify({ 'baska.ekran': ['barcode'] }) };
    mem.getItem.mockImplementation(async (k: string) => disk[k] ?? null);
    mem.setItem.mockImplementation(async (k: string, v: string) => { disk[k] = v; });
    await useDeviceSettingsStore.getState().init();
    await useDeviceSettingsStore.getState().setListColumns(RECENT_OUTPUT_SCREEN_KEY, ['barcode', 'qty']);
    useDeviceSettingsStore.setState({ listColumns: {} });
    await useDeviceSettingsStore.getState().init();
    expect(useDeviceSettingsStore.getState().listColumns).toEqual({ 'baska.ekran': ['barcode'], [RECENT_OUTPUT_SCREEN_KEY]: ['barcode', 'qty'] });
    await useDeviceSettingsStore.getState().setListColumns(RECENT_OUTPUT_SCREEN_KEY, null);
    expect(parseListColumns(disk.device_list_columns)).toEqual({ 'baska.ekran': ['barcode'] });
  });
  it('bozuk kayıt → boş (her ekran varsayılanında)', () => {
    expect(parseListColumns('{bozuk')).toEqual({});
    expect(parseListColumns(JSON.stringify({ a: [1] }))).toEqual({});
  });
});

describe('seçici ve satır', () => {
  it('barkod satırı devre dışı; diğer satıra dokunmak onToggle çağırır', () => {
    const onToggle = jest.fn();
    const r = renderWithPaper(
      <OutputColumnsPicker visible value={new Set(['barcode', 'item'])} onToggle={onToggle} onReset={jest.fn()} onClose={jest.fn()} />,
    );
    expect(r.getByTestId('son-cikan-sutun-barcode').props.accessibilityState).toMatchObject({ disabled: true, checked: true });
    fireEvent.press(r.getByTestId('son-cikan-sutun-kg'));
    expect(onToggle).toHaveBeenCalledWith('kg');
  });

  it('satır yalnız seçili sütunları çizer (kapalı ürün/tarih yok, barkod var)', () => {
    const roll = {
      id: 'r1', barcode: 'T1', qualityGrade: '1K', currentQty: 11, width: null, weightKg: 4.5, createdAt: '2026-11-10T08:00:00Z',
      item: { id: 'i', code: 'I', name: 'MÜŞTERİ KUMAŞI' }, color: null, labelBatchNo: 'P9',
    } as unknown as Roll;
    const r = renderWithPaper(
      <RelabelRollRow grades={[]} roll={roll} onPress={jest.fn()} cols={new Set(['barcode', 'qty', 'kg', 'labelBatch'])} />,
    );
    expect(r.getByText('T1')).toBeTruthy();
    expect(r.queryByText('MÜŞTERİ KUMAŞI')).toBeNull();
    expect(r.queryByText('1K')).toBeNull();
    expect(r.getByText('4.5 kg')).toBeTruthy();
    expect(r.getByText('P9')).toBeTruthy();
  });
});
