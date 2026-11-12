// =============================================================================
// GK bekçisi — düğmeli kipte çıkış metresi + tamamlanmış topa hata = yeniden açma
// =============================================================================
// Metre yalnız kurşun/brode istasyonunda ve sayaç kipi açıkken istenir (DETAYLI KK sormaz); okuma tek dokunuş
// kipiyle aynı `captureOut` yolundan, vazgeçte istek yok. Negatif sonda (2026-11-10): completeWithExitMeter `required`ı
// yok sayınca §2a kırmızı; stationMeasuresService hep true dönünce §1c kırmızı (ikisi ölçüldü, geri alındı).
import { REOPEN_ROLL_QUESTION, completeWithExitMeter, defectNeedsReopen, exitMeterRequired, isRollAlreadyOpen, stationMeasuresService } from './exitMeter';
import type { CompleteQc2Request, MeterReadingBody } from '../../../services/kursunQc.service';
import type { KursunStepSummary } from '../../../types/models';

type Summary = Pick<KursunStepSummary, 'appliesKursun' | 'properties' | 'meter'>;
const prop = (code: string) => ({ propertyId: `p-${code}`, code, name: code, mode: 'AUTO' as const });
const sum = (o: { applies?: boolean; codes?: string[]; capture?: 'OFF' | 'OUT' | 'IN_OUT' }): Summary =>
  ({
    appliesKursun: o.applies ?? false,
    properties: (o.codes ?? []).map(prop),
    meter: o.capture ? ({ capture: o.capture, policy: null } as unknown as KursunStepSummary['meter']) : undefined,
  }) as Summary;

describe('§1 exitMeterRequired — yalnız ölçen hizmet istasyonu', () => {
  it('§1a kurşun istasyonu + OUT → ister', () => {
    expect(exitMeterRequired(sum({ applies: true, codes: ['KURSUN'], capture: 'OUT' }))).toBe(true);
  });
  it('§1b brode istasyonu + IN_OUT → ister', () => {
    expect(exitMeterRequired(sum({ codes: ['BRODE'], capture: 'IN_OUT' }))).toBe(true);
  });
  it('§1c yalnız kalite (DETAYLI KK) + OUT → istemez', () => {
    expect(stationMeasuresService(sum({ codes: ['RENK_HASLIGI'] }))).toBe(false);
    expect(exitMeterRequired(sum({ codes: [], capture: 'OUT' }))).toBe(false);
  });
  it('§1d sayaç OFF / alan yok / özet yok → istemez (bugünkü davranış)', () => {
    expect(exitMeterRequired(sum({ applies: true, codes: ['KURSUN'], capture: 'OFF' }))).toBe(false);
    expect(exitMeterRequired(sum({ applies: true, codes: ['KURSUN'] }))).toBe(false);
    expect(exitMeterRequired(null)).toBe(false);
  });
});

describe('§2 completeWithExitMeter — tek yol captureOut', () => {
  const roll = { rollId: 'r1', barcode: 'B1' };
  const vars: CompleteQc2Request = { rollId: 'r1', stepId: 's1', properties: [] };
  const body = { meters: 98.5, clientToken: 't1' } as MeterReadingBody;
  const passPiece = { precheck: () => true, attach: (v: CompleteQc2Request) => v };

  it('§2a gerekmiyorsa gövde aynen ve hemen gider, sayaç okunmaz', () => {
    const complete = jest.fn();
    const captureOut = jest.fn();
    completeWithExitMeter({ required: false, meter: { captureOut }, piece: passPiece, roll, vars, complete });
    expect(captureOut).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(vars);
  });
  it('§2b gerekiyorsa önce okunur; gövde meterOut ile, okuma bitene dek istek yok', () => {
    const complete = jest.fn();
    let enqueue: ((m: MeterReadingBody) => void) | null = null;
    const captureOut = jest.fn((_r, stepId: string, enq: (m: MeterReadingBody) => void) => {
      expect(stepId).toBe('s1');
      enqueue = enq;
    });
    completeWithExitMeter({ required: true, meter: { captureOut }, piece: passPiece, roll, vars, complete });
    expect(complete).not.toHaveBeenCalled();
    enqueue!(body);
    expect(complete).toHaveBeenCalledWith({ ...vars, meterOut: body });
  });
  it('§2c vazgeç (abort) → istek yok', () => {
    const complete = jest.fn();
    const captureOut = jest.fn((_r, _s, _e, abort: () => void) => abort());
    completeWithExitMeter({ required: true, meter: { captureOut }, piece: passPiece, roll, vars, complete });
    expect(complete).not.toHaveBeenCalled();
  });
  it('§2d brode adedi eksikse sayaç okunmaz; varsa adet okumaya eklenir', () => {
    const complete = jest.fn();
    const captureOut = jest.fn((_r, _s, enq: (m: MeterReadingBody) => void) => enq(body));
    completeWithExitMeter({ required: true, meter: { captureOut }, piece: { precheck: () => false, attach: (v) => v }, roll, vars, complete });
    expect(captureOut).not.toHaveBeenCalled();
    const attach = (v: CompleteQc2Request) => ({ ...v, meterOut: { ...v.meterOut!, pieceCount: 7 } });
    completeWithExitMeter({ required: true, meter: { captureOut }, piece: { precheck: () => true, attach }, roll, vars, complete });
    expect(complete).toHaveBeenCalledWith({ ...vars, meterOut: { ...body, pieceCount: 7 } });
  });
});

describe('§3 tamamlanmış topa hata = yeniden açma onayı', () => {
  it('§3a yalnız kontrolü tamamlanmış barkodlu top onay ister', () => {
    expect(defectNeedsReopen({ qc2Completed: true, barcode: 'B1' })).toBe(true);
    expect(defectNeedsReopen({ qc2Completed: false, barcode: 'B1' })).toBe(false);
    expect(defectNeedsReopen({ qc2Completed: true, barcode: null })).toBe(false);
    expect(defectNeedsReopen(null)).toBe(false);
  });
  it('§3b 409 KURSUN_ROLL_NOT_COMPLETED "zaten açık" sayılır; başka 409 sayılmaz', () => {
    expect(isRollAlreadyOpen({ status: 409, details: { code: 'KURSUN_ROLL_NOT_COMPLETED' } })).toBe(true);
    expect(isRollAlreadyOpen({ status: 409, details: { code: 'SERVICE_ALREADY_BILLED' } })).toBe(false);
    expect(isRollAlreadyOpen({ status: 400 })).toBe(false);
  });
  it('§3c soru metni', () => {
    expect(REOPEN_ROLL_QUESTION).toBe('Bu topun kontrolü tamamlandı. Yeniden açıp hata eklemek istiyor musunuz?');
  });
});
