import { base64Bytes, newRejectDraft, photoAddBlock, rejectBlockText, rejectFields, rejectFingerprint, rejectPhotosBody, REJECT_PHOTO_MAX_BYTES, type RejectDraft } from './rejectPayload';
import type { RejectLookup } from '../../../services/devereKabul.service';
import type { ReasonPreset } from '../../../services/reasonPreset.service';

const target: RejectLookup = {
  beam: { id: 'wb1', beamNo: 'LV-7', status: 'READY', physicalBeamNo: null, bodyNo: 'LG-3', lengthM: '950.000' },
  order: { id: 'o1', orderNo: 'FDV-1', subcontractor: { id: 's1', name: 'Yılmaz Devere' } },
};
const preset = (code: string, requiresText = false): ReasonPreset => ({ id: code, kind: 'WARP_BEAM_REJECT', code, label: code, fullText: null, requiresText, sortOrder: 0, isActive: true, isSystem: true });
const PRESETS = [preset('KOPUK'), preset('OTHER', true)];
const draft = (p: Partial<RejectDraft> = {}): RejectDraft => ({ ...newRejectDraft(target), ...p });

describe('rejectPayload — tablette kusurlu levent reddi (ek-2 r)', () => {
  it('alanlar: tek sarım, sebep kodu, metin/not kırpılır, varsayılan kip yeniden sarım', () => {
    expect(rejectFields(draft({ reason: { code: 'KOPUK', text: ' ' }, notes: '  kenar kopuk ' }))).toEqual({
      warpingOrderId: 'o1', beamIds: ['wb1'], reasonCode: 'KOPUK', reasonText: null, notes: 'kenar kopuk', expectRework: true,
    });
    expect(rejectFields(draft({ expectRework: false })).reasonCode).toBe('');
    expect(rejectFields(draft({ expectRework: false })).expectRework).toBe(false);
  });

  it('gönder kapısı: sebep yok · metin isteyen sebep · foto zorunlu', () => {
    expect(rejectBlockText(draft(), PRESETS, false)).toMatch(/sebebini/);
    expect(rejectBlockText(draft({ reason: { code: 'OTHER', text: '' } }), PRESETS, false)).toMatch(/yazın/);
    expect(rejectBlockText(draft({ reason: { code: 'OTHER', text: 'leke' } }), PRESETS, false)).toBeNull();
    expect(rejectBlockText(draft({ reason: { code: 'KOPUK', text: '' } }), PRESETS, true)).toMatch(/fotoğraf zorunlu/);
    expect(rejectBlockText(draft({ reason: { code: 'KOPUK', text: '' }, photos: [{ uri: 'u', base64: 'QUJD' }] }), PRESETS, true)).toBeNull();
  });

  it('foto: en çok 3, 5 MB tavanı; gövde adları sıralı', () => {
    const p = { uri: 'u', base64: 'QUJD' };
    expect(base64Bytes('QUJD')).toBe(3);
    expect(base64Bytes('QUI=')).toBe(2);
    expect(photoAddBlock(draft({ photos: [p, p, p] }), 'QUJD')).toMatch(/3 fotoğraf/);
    expect(photoAddBlock(draft(), 'A'.repeat(Math.ceil((REJECT_PHOTO_MAX_BYTES + 10) * 4 / 3)))).toMatch(/5 MB/);
    expect(photoAddBlock(draft(), 'QUJD')).toBeNull();
    expect(rejectPhotosBody(draft({ photos: [p, p] }))).toEqual([{ fileName: 'ret-1.jpg', contentBase64: 'QUJD' }, { fileName: 'ret-2.jpg', contentBase64: 'QUJD' }]);
  });

  it('deneme parmak izi: sunucu replay kimliği; not/metin değişimi aynı deneme, kip değişimi yeni', () => {
    const a = rejectFields(draft({ reason: { code: 'KOPUK', text: '' }, notes: 'x' }));
    const b = rejectFields(draft({ reason: { code: 'KOPUK', text: 'ek' }, notes: 'y' }));
    const c = rejectFields(draft({ reason: { code: 'KOPUK', text: '' }, expectRework: false }));
    expect(rejectFingerprint(a)).toBe(rejectFingerprint(b));
    expect(rejectFingerprint(a)).not.toBe(rejectFingerprint(c));
  });
});
