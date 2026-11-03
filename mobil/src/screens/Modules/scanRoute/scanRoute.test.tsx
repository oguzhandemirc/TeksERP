// K29 okutmayla rota — tablet kararı + diyalog + ekran bağlantısı.
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderWithPaper } from '../../../test/render';
import { decideScanRoutePrompt, readScanRouteView, type ScanRouteView } from './scanRoute';
import { ScanRouteDialog } from './useScanRoute';

const base: ScanRouteView = {
  kind: 'INSERT', workOrderId: 'wo', stationId: 'st', stationName: 'Detaylı KK', targetStepId: null,
  skipped: [], warnings: [], block: null, message: 'm',
};
const err = (scanRoute: unknown, code = 'SCAN_ROUTE_AVAILABLE') => ({ message: 'x', details: { code, scanRoute } });

describe('okutmayla rota kararı', () => {
  it('yalnız SCAN_ROUTE_AVAILABLE hatası okunur; başka hata bugünkü yola düşer', () => {
    expect(readScanRouteView(err(base))?.kind).toBe('INSERT');
    expect(readScanRouteView(err(base, 'OTHER'))).toBeNull();
    expect(readScanRouteView(new Error('düz'))).toBeNull();
    expect(readScanRouteView(err(null))).toBeNull();
  });
  it('uyarısız ekleme/taşıma sessiz uygulanır, atlananlar tostta söylenir', () => {
    const p = decideScanRoutePrompt({ ...base, kind: 'MOVE', skipped: [{ stepId: 's1', stationName: 'Kurşun' }] });
    expect(p.kind).toBe('SILENT');
    expect(p.kind === 'SILENT' && p.toast).toContain('Atlandı: Kurşun');
  });
  it('yeniden işlem uyarısı onay ister', () => {
    const p = decideScanRoutePrompt({ ...base, warnings: ['Bu istasyon daha önce atlanmıştı — yeniden işlem olarak eklendi.'] });
    expect(p.kind).toBe('CONFIRM');
    expect(p.kind === 'CONFIRM' && p.closeOpenStepId).toBeNull();
  });
  it('başka istasyonda açık iş: kapatılabiliyorsa "bitmiş say ve geç" (adım kimliğiyle), değilse engel', () => {
    const block = { code: 'SCAN_ROUTE_OPEN_ELSEWHERE', stepId: 'k1', stationName: 'Kurşun', rollCount: 3, message: 'iş sürüyor', closable: true };
    const p = decideScanRoutePrompt({ ...base, kind: 'BLOCKED', block });
    expect(p.kind === 'CONFIRM' && p.closeOpenStepId).toBe('k1');
    expect(p.kind === 'CONFIRM' && p.confirmLabel).toContain('bitmiş say ve geç');
    expect(decideScanRoutePrompt({ ...base, kind: 'BLOCKED', block: { ...block, closable: false } }).kind).toBe('BLOCK');
  });
  it('atlanamaz adım engeldir', () => {
    const p = decideScanRoutePrompt({ ...base, kind: 'BLOCKED', block: { code: 'SCAN_ROUTE_MANDATORY_STEP', stepId: 'm', stationName: 'Detaylı KK', rollCount: 2, message: 'atlanamaz', closable: false } });
    expect(p).toEqual({ kind: 'BLOCK', title: 'Bu adım atlanamaz', body: 'atlanamaz' });
  });
});

describe('ScanRouteDialog', () => {
  it('onay: Vazgeç / onay düğmeleri doğru eylemi çağırır', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const r = renderWithPaper(
      <ScanRouteDialog pending={{ prompt: { kind: 'CONFIRM', title: 'T', body: 'B', confirmLabel: '"Kurşun" bitmiş say ve geç', closeOpenStepId: 'k1' } }} busy={false} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(r.getByText('"Kurşun" bitmiş say ve geç')).toBeTruthy();
    fireEvent.press(r.getByTestId('scan-route-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(r.getByTestId('scan-route-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('engel: yalnız Tamam, onay düğmesi yok', () => {
    const r = renderWithPaper(<ScanRouteDialog pending={{ prompt: { kind: 'BLOCK', title: 'Bu adım atlanamaz', body: 'B' } }} busy={false} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(r.getByTestId('scan-route-ok')).toBeTruthy();
    expect(r.queryByTestId('scan-route-confirm')).toBeNull();
  });
});

describe('ekran bağlantısı', () => {
  const fs = jest.requireActual<typeof import('fs')>('fs');
  it('Tambur: okutmayla rota kurşun bypass kapanışından ÖNCE denenir', () => {
    const src = fs.readFileSync(require.resolve('../Tambur/TamburScreen.tsx'), 'utf8');
    const i = src.indexOf('scanRoute.intercept(err, barcode');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(src.indexOf('await completeKursunBypassSilently(barcode)'));
    expect(src).toContain('{scanRoute.dialog}');
  });
  it('Kurşun/KK: catch ret sinyalinden önce araya girer', () => {
    const src = fs.readFileSync(require.resolve('../KursunQc/KursunQcScreen.tsx'), 'utf8');
    const i = src.indexOf('scanRoute.intercept(err, barcode');
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(src.indexOf("signalScan('reject');", i));
    expect(src).toContain('{scanRoute.dialog}');
  });
});
