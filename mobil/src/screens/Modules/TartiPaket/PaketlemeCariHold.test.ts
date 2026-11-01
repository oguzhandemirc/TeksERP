// =============================================================================
// Bekçi: Paketleme "Hemen Sevk Et" 409 CARI_HOLD → Sevk Kapısı'nın tam ekranı (D4-KUC3e)
// =============================================================================
// Kilitlenen sözleşme:
//   • kilitli cari hatası (409 + details.code CARI_HOLD) tam ekranı açar, tost ÇIKMAZ,
//   • başka hata (başka 409, kodsuz, ağ) → bugünkü tost yolu,
//   • shipMut onError bu yardımcıyı bağlar, ekran Sevk Kapısı'nın bileşenini çizer (kopya yok),
//   • istemci kilit metni üretmez (metin sunucunun 409 mesajı).
// =============================================================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openCariHoldBlock, type CariHoldBlock } from '../Sevkiyat/CariHold';

function err(status: number, message: string, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, details });
}

describe('openCariHoldBlock — Hemen Sevk Et hata ayrımı', () => {
  it('409 CARI_HOLD → tam ekran açılır (sunucu mesajı + koyan), true', () => {
    const open = jest.fn<void, [CariHoldBlock]>();
    expect(openCariHoldBlock(err(409, 'Cari kilitli — sevk durduruldu.', { code: 'CARI_HOLD', koyan: 'Ayşe' }), open)).toBe(true);
    expect(open).toHaveBeenCalledWith({ message: 'Cari kilitli — sevk durduruldu.', placedBy: 'Ayşe' });
  });
  it('diğer hatalar → false, tam ekran açılmaz (çağıran tost basar)', () => {
    const open = jest.fn();
    expect(openCariHoldBlock(err(409, 'x', { code: 'SHIPMENT_STATUS_CHANGED' }), open)).toBe(false);
    expect(openCariHoldBlock(err(422, 'x', { code: 'CARI_HOLD' }), open)).toBe(false);
    expect(openCariHoldBlock(new Error('Sunucuya ulaşılamıyor'), open)).toBe(false);
    // body.code okunmaz: kod yalnız details.code'dan
    expect(openCariHoldBlock(Object.assign(new Error('x'), { status: 409, code: 'CARI_HOLD' }), open)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('PaketlemeScreen bağlantısı', () => {
  const src = readFileSync(path.join(__dirname, 'PaketlemeScreen.tsx'), 'utf8');
  const start = src.indexOf('const shipMut = useMutation(');
  const shipBlock = src.slice(start, src.indexOf('\n  });\n', start));

  it('shipMut onError kilitte tam ekranı açar, tostu atlar; diğerinde tost', () => {
    expect(start).toBeGreaterThan(-1);
    const onError = shipBlock.slice(shipBlock.indexOf('onError:'));
    expect(onError).toMatch(/if \(openCariHoldBlock\(e, setHoldBlock\)\) return;\s*showScreenError\(e, 'Sevkiyat kurulamadı'\);/);
  });
  it('tam ekran Sevk Kapısı bileşeniyle çizilir (kopya yok)', () => {
    expect(src).toMatch(/import \{[^}]*CariHoldBlockedScreen[^}]*\} from '\.\.\/Sevkiyat\/CariHold';/);
    expect(src).toMatch(/<CariHoldBlockedScreen block=\{holdBlock\} onClose=\{\(\) => setHoldBlock\(null\)\} \/>/);
  });
  it('istemci cari kilit metni üretmez (kodda "cari … kilit" dize sabiti yok)', () => {
    const code = src.replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(code).not.toMatch(/['"`][^'"`\n]*cari[^'"`\n]*kilit[^'"`\n]*['"`]/i);
  });
});
