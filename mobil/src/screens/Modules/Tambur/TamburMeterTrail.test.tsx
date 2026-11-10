// Tambur metre şeridi render + uç uyumu: uç hatası sessiz (null), aşım satırı bilgi, kaynak bağları.
import React from 'react';
import fs from 'fs';
import path from 'path';
import { renderWithPaper } from '../../../test/render';
import { TamburMeterTrailView } from './TamburMeterTrail';
import { rollService, type RollMeterTrail } from '../../../services/roll.service';
import { apiClient } from '../../../services/api';

const TRAIL: RollMeterTrail = {
  rollId: 'r1',
  declaredM: 500,
  prior: { kind: 'KURSUN_OUT', stationName: 'Kurşun 1', meters: 548, at: '2026-11-10T08:00:00.000Z' },
  referenceM: 548,
  cutSoFarM: 320,
  remainingM: 228,
  overReference: false,
};

describe('TamburMeterTrailView', () => {
  it('⭐ şerit parçaları, aşım yoksa uyarı yok', () => {
    const r = renderWithPaper(<TamburMeterTrailView trail={TRAIL} pendingM={100} />);
    expect(r.getByTestId('tambur-metre-serit')).toBeOnTheScreen();
    expect(r.getByText('Beyan 500 m')).toBeOnTheScreen();
    expect(r.getByText('· Kurşun 548 m')).toBeOnTheScreen();
    expect(r.getByText('· Kalan ≈ 228 m')).toBeOnTheScreen();
    expect(r.queryByTestId('tambur-metre-asim')).toBeNull();
  });
  it('girilen metre referansı aşınca sarı uyarı satırı', () => {
    const r = renderWithPaper(<TamburMeterTrailView trail={TRAIL} pendingM={240} />);
    expect(r.getByText('Önceki ölçümü aşıyor (+12 m) — kesim kaydedilir, fazlası faturaya girer')).toBeOnTheScreen();
  });
  it('trail null → hiçbir şey çizilmez', () => {
    const r = renderWithPaper(<TamburMeterTrailView trail={null} pendingM={240} />);
    expect(r.queryByTestId('tambur-metre-serit')).toBeNull();
  });
});

describe('rollService.meterTrail — eski backend uyumu', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each([404, 403, 500])('%s → null (şerit gizlenir, hata fırlatmaz)', async (status) => {
    jest.spyOn(apiClient, 'get').mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status } }));
    await expect(rollService.meterTrail('r1')).resolves.toBeNull();
  });
  it('ağ hatası → null', async () => {
    jest.spyOn(apiClient, 'get').mockRejectedValueOnce(new Error('Network Error'));
    await expect(rollService.meterTrail('r1')).resolves.toBeNull();
  });
  it('başarılı yanıt → data', async () => {
    jest.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: { success: true, data: TRAIL } });
    await expect(rollService.meterTrail('r1')).resolves.toEqual(TRAIL);
  });
});

describe('TamburScreen kaynak bağı', () => {
  const src = fs.readFileSync(path.join(__dirname, 'TamburScreen.tsx'), 'utf8');
  it('şerit açık kumaş başlığında, manuelde girilen metreyle', () => {
    expect(src).toMatch(/<TamburMeterTrail\s+rollId=\{selectedRoll\.rollId\}/);
    expect(src).toMatch(/pendingM=\{cutMode === 'manual' \? parseCutInput\(work\.voluntaryEntry\.length\) : 0\}/);
  });
});
