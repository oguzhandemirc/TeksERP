// =============================================================================
// GK-H1b bekçisi — brode ADET/VURUŞ fiyatlamasında tablet "Brode adedi" girişi
// =============================================================================
// Adet alanı yalnız adım özeti `pieceInput` (PIECE | STITCH) gelince çizilir; değer gramaj/desen
// dokunuşunun ÇIKIŞ okumasına (`meterOut.pieceCount`) girer. METER/eski backend: alan yok, gövde
// bayt-aynı (anahtar yok). Boş adette istek hiç gitmez. Bağlantı ekranla aynı fonksiyonlardan.
// Negatif sonda: pieceGatedTap attach'ı atlayınca §1 kırmızı; pieceInputOf hep 'PIECE' dönünce §2 kırmızı.
import React, { useState } from 'react';
import { fireEvent } from '@testing-library/react-native';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { renderWithPaper } from '../../../test/render';
import { STATION_MUT } from '../../../offline/mutations';
import GramajTapPanel from './GramajTapPanel';
import BrodePieceField from './BrodePieceField';
import { useGramajTap } from './useGramajTap';
import { useMeasuredWidth } from './useMeasuredWidth';
import { widthGatedTap } from './widthGatedTap';
import { pieceGatedTap, useBrodePieceCount } from './useBrodePieceCount';
import { composeStationPanels } from './stationPanels';
import { parsePieceCount, pieceInputOf, withPieceCount } from './brodePiece';
import type { MeterReadingBody } from '../../../services/kursunQc.service';
import type { KursunStepSummary } from '../../../types/models';

jest.mock('react-native-toast-message', () => ({ __esModule: true, default: { show: jest.fn() } }));

const summaryOf = (pieceInput?: 'PIECE' | 'STITCH') =>
  ({
    workOrderStepId: 'step-1',
    inspectionEnabled: false,
    properties: [
      { propertyId: 'brode', code: 'BRODE', name: 'Brode', mode: 'AUTO', valueType: 'FLAG', values: [] },
      {
        propertyId: 'desen',
        code: 'BRODE-DESEN',
        name: 'Brode deseni',
        mode: 'REQUIRED',
        valueType: 'CHOICE',
        values: [{ code: 'GUL', name: 'Gül' }],
        variantOfPropertyId: 'brode',
      },
    ],
    targetValues: [],
    meter: { capture: 'OUT', policy: { thresholdM: null, thresholdPct: null, basis: 'DECLARED_IN', approvalMode: 'NONE' } },
    ...(pieceInput ? { pieceInput } : {}),
    rolls: [],
  }) as unknown as KursunStepSummary;

const METER_OUT: MeterReadingBody = { meters: 80, source: 'OPERATOR', peripheralId: null, rawCounter: null, clientToken: 'tok-1' };

/** Ekranın kurduğu düzen: sayaç açıkken adet alanı + desen paneli; kapı zinciri ekranla aynı. */
function Harness({ summary, complete }: { summary: KursunStepSummary; complete: jest.Mock }) {
  const qc = useQueryClient();
  useState(() => {
    qc.setMutationDefaults(STATION_MUT.QC2_COMPLETE, { mutationFn: jest.fn(), retry: false });
    return true;
  });
  const width = useMeasuredWidth(false, 'roll-1');
  const piece = useBrodePieceCount(pieceInputOf(summary), 'roll-1');
  const panels = composeStationPanels({ inspectionEnabled: false, properties: summary.properties ?? [] });
  const meter = {
    outOn: true,
    captureOut: (_r: unknown, _s: string, enqueue: (m: MeterReadingBody) => void): undefined => {
      enqueue(METER_OUT);
      return undefined;
    },
  };
  const tap = useGramajTap({
    cfg: panels.tap,
    summary,
    roll: { rollId: 'roll-1', barcode: 'T000123456' },
    operator: 'Ayşe',
    ...pieceGatedTap(piece, widthGatedTap(width, complete)),
    refresh: jest.fn(),
    meter,
  });
  return (
    <>
      {meter.outOn && <BrodePieceField state={piece} />}
      <GramajTapPanel state={tap} hasRoll />
    </>
  );
}

function render(pieceInput?: 'PIECE' | 'STITCH') {
  const complete = jest.fn();
  const r = renderWithPaper(<Harness summary={summaryOf(pieceInput)} complete={complete} />);
  return { ...r, complete };
}

describe('Brode adedi — tablet girişi (GK-H1b)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('§1 PIECE: adet alanı görünür, girilen adet çıkış okumasına girer', () => {
    const r = render('PIECE');
    expect(r.getByTestId('brode-adet-alani')).toBeTruthy();
    fireEvent.changeText(r.getByTestId('brode-adet-giris'), '12');
    fireEvent.press(r.getByTestId('gramaj-tap-GUL'));
    expect(r.complete).toHaveBeenCalledTimes(1);
    expect(r.complete.mock.calls[0][0].meterOut).toEqual({ ...METER_OUT, pieceCount: 12 });
  });

  it('§1b STITCH: aynı giriş, açıklama vuruşu söyler', () => {
    const r = render('STITCH');
    expect(r.getByText(/adet × desen vuruşu/)).toBeTruthy();
    fireEvent.changeText(r.getByTestId('brode-adet-giris'), '5');
    fireEvent.press(r.getByTestId('gramaj-tap-GUL'));
    expect(r.complete.mock.calls[0][0].meterOut.pieceCount).toBe(5);
  });

  it('§2 METER / eski backend: alan YOK, gövde bayt-aynı (pieceCount anahtarı yok)', () => {
    const r = render();
    expect(r.queryByTestId('brode-adet-alani')).toBeNull();
    fireEvent.press(r.getByTestId('gramaj-tap-GUL'));
    expect(r.complete).toHaveBeenCalledTimes(1);
    expect(r.complete.mock.calls[0][0].meterOut).toEqual(METER_OUT);
    expect('pieceCount' in r.complete.mock.calls[0][0].meterOut).toBe(false);
  });

  it('§3 boş ya da geçersiz adet: istek gitmez, Türkçe uyarı', () => {
    const r = render('PIECE');
    fireEvent.press(r.getByTestId('gramaj-tap-GUL'));
    expect(r.complete).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ text1: 'Brode adedi eksik' }));
    fireEvent.changeText(r.getByTestId('brode-adet-giris'), '0');
    fireEvent.press(r.getByTestId('gramaj-tap-GUL'));
    expect(r.complete).not.toHaveBeenCalled();
  });

  it('§4 saf yardımcılar: tanınmayan kip null, ayrıştırma, okumasız gövde aynen', () => {
    expect(pieceInputOf({ pieceInput: 'KG' as never })).toBeNull();
    expect(pieceInputOf(null)).toBeNull();
    expect(parsePieceCount('7')).toEqual({ ok: true, value: 7 });
    expect(parsePieceCount('2,5').ok).toBe(false);
    expect(parsePieceCount('10000001').ok).toBe(false);
    const vars = { rollId: 'r', stepId: 's', properties: [] };
    expect(withPieceCount(vars, 3)).toBe(vars);
  });

  it('§5 ekran bağlantısı: KursunQcScreen adet alanını sayaç açıkken çizer, kapıyı pieceGatedTap ile kurar', () => {
    // Ekran render edilmez (2800+ satır); kaynakta bağlantı ölçülür — davranışı §1–§3 sınar.
    const src = jest.requireActual<typeof import('fs')>('fs').readFileSync(require.resolve('./KursunQcScreen.tsx'), 'utf8');
    expect(src).toMatch(/useBrodePieceCount\(pieceInputOf\(activeJob\?\.stepSummary\)/);
    expect(src).toMatch(/\.\.\.pieceGatedTap\(brodePiece, /);
    expect(src).toMatch(/meter\.outOn && <BrodePieceField state=\{brodePiece\}/);
  });
});
