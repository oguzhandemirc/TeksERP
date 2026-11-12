// "Boş bırakılırsa" ipucu: istek müşteriyi taşır (sıra sunucuda: elle > müşteri > İE varsayılanı > fabrika), seçili hedefte
// ipucu yok, kullanılamaz kart uyarı olur. Negatif sonda: WoTargetFields'te `!e.targetItemId` koşulu kaldırılınca 3. vaka kırmızı;
// `customerId` sorgudan düşürülünce 1. vaka kırmızı.
import React from 'react';
import { renderWithPaper } from '../../../../test/render';
import { defaultTargetHintText, fetchDefaultTargetItem } from './defaultTargetHint';
import { TargetFields } from './WoTargetFields';
import { EMPTY_EXTRAS, initialFormState } from './woForm';

const mockGet = jest.fn();
jest.mock('../../../../services/api', () => ({ apiClient: { get: (...a: unknown[]) => mockGet(...a) } }));
let mockHint: { name: string; problem: boolean } | null = null;
const mockHintArgs: [string | null, boolean][] = [];
jest.mock('./defaultTargetHint', () => {
  const real = jest.requireActual('./defaultTargetHint');
  return { ...real, useDefaultTargetHint: (c: string | null, en: boolean) => { mockHintArgs.push([c, en]); return mockHint; } };
});
jest.mock('../../../../components/ColorSelectField', () => () => null);

beforeEach(() => { mockGet.mockReset(); mockHint = null; mockHintArgs.length = 0; });

describe('defaultTargetHint', () => {
  it('sorgu belge yoludur ve müşteriyi taşır', async () => {
    mockGet.mockResolvedValue({ data: { data: { item: null, source: null } } });
    await fetchDefaultTargetItem('c1');
    expect(mockGet).toHaveBeenCalledWith('/work-orders/default-target-item?forNote=true&customerId=c1');
    await fetchDefaultTargetItem(null);
    expect(mockGet).toHaveBeenLastCalledWith('/work-orders/default-target-item?forNote=true');
  });

  it('metin kaynağı söyler; kullanılamaz kart uyarıdır; boşsa null', () => {
    expect(defaultTargetHintText({ item: { id: 'i', code: 'K', name: 'Ham Tül', problem: null }, source: 'CUSTOMER' })).toBe('Boş bırakılırsa: Ham Tül (müşteri varsayılanı)');
    expect(defaultTargetHintText({ item: { id: 'i', code: 'K', name: 'Ham Tül', problem: null }, source: 'WORK_ORDER' })).toBe('Boş bırakılırsa: Ham Tül (İE varsayılanı)');
    expect(defaultTargetHintText({ item: { id: 'i', code: 'K', name: 'X', problem: 'pasif' }, source: 'FACTORY' })).toMatch(/kullanılamıyor/);
    expect(defaultTargetHintText({ item: null, source: null })).toBeNull();
    expect(defaultTargetHintText(undefined)).toBeNull();
  });

  const props = (targetItemId: string | null) => ({
    state: { ...initialFormState(), extras: { ...EMPTY_EXTRAS, targetItemId, targetItemLabel: targetItemId ? 'Seçili' : null } },
    edit: jest.fn(), locked: false, show: () => true, showQuantity: false, hasTambur: false, foldValues: [], onPickItem: jest.fn(), customerId: 'c7',
  });

  it('hedef boşken varsayılan kumaş kutuya "varsayılan" ekiyle yazılır, müşteri hook\'a gider', () => {
    mockHint = { name: 'Ham Tül', problem: false };
    const r = renderWithPaper(<TargetFields {...props(null)} />);
    expect(r.getByText('Ham Tül (varsayılan)')).toBeTruthy();
    expect(r.queryByText(/Boş bırakılırsa/)).toBeNull();
    expect(mockHintArgs[0]).toEqual(['c7', true]);
  });

  it('hedef seçiliyse seçilen yazar (elle seçim yener)', () => {
    mockHint = { name: 'Ham Tül', problem: false };
    const r = renderWithPaper(<TargetFields {...props('i9')} />);
    expect(r.getByText('Seçili')).toBeTruthy();
    expect(r.queryByText(/varsayılan/)).toBeNull();
  });
});
