import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { contrastRatio, hslToHex, readableOn, stationToneFor, stationToneKeyForKind } from './stationTone';
import { colors, stationTonesHsl } from './tokens';

// İKİZ: mobil Electron'u import edemez; değerler ve tür eşlemesi Electron kaynağından metin olarak okunup kıyaslanır.
const CSS = resolve(__dirname, '../../../Electron/src/index.css');
const TS = resolve(__dirname, '../../../Electron/src/lib/station-colors.ts');

describe('ikiz: Electron istasyon renkleri', () => {
  it('Electron kaynakları bulunur (yoksa GÜRÜLTÜLÜ düşer)', () => {
    expect(existsSync(CSS)).toBe(true);
    expect(existsSync(TS)).toBe(true);
  });

  it('açık tema --station-* HSL değerleri tokens.stationTonesHsl ile birebir', () => {
    const css = readFileSync(CSS, 'utf8');
    const seen: Record<string, number[]> = {};
    for (const m of css.matchAll(/--station-(\w+):\s*(\d+)\s+(\d+)%\s+(\d+)%;/g)) {
      if (!(m[1] in seen)) seen[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])]; // ilk blok = açık tema (:root)
    }
    expect(seen).toEqual(Object.fromEntries(Object.entries(stationTonesHsl).map(([k, v]) => [k, [...v]])));
  });

  it('StationKind → ton eşlemesi Electron stationToneForKind ile birebir', () => {
    const src = readFileSync(TS, 'utf8');
    const body = src.slice(src.indexOf('export function stationToneForKind'), src.indexOf('export interface ToneClasses'));
    const pairs = [...body.matchAll(/case "(\w+)":\s*(?:\/\/[^\n]*\n\s*)*return "(\w+)"/g)].map((m) => [m[1], m[2]]);
    const def = /default:\s*return "(\w+)"/.exec(body)?.[1];
    expect(pairs.length).toBeGreaterThanOrEqual(5);
    for (const [kind, tone] of pairs) expect([kind, stationToneKeyForKind(kind)]).toEqual([kind, tone]);
    expect(stationToneKeyForKind('BILINMEYEN')).toBe(def);
  });

  it('toneFor kuralı: dış → fason, tür → ton, türsüz iç → marka', () => {
    expect(stationToneFor(true, 'RAW_QC').key).toBe('fason');
    expect(stationToneFor(false, 'RAW_QC').key).toBe('kk1');
    expect(stationToneFor(false, 'TAMBUR').key).toBe('tambur');
    expect(stationToneFor(false, null)).toEqual(expect.objectContaining({ key: 'brand', bg: colors.brand }));
  });
});

describe('renk yardımcıları', () => {
  it('hslToHex bilinen değerler', () => {
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
    expect(hslToHex(120, 100, 25)).toBe('#008000');
  });

  it('her istasyon tonunda yazı ≥3:1 (büyük kalın yazı AA)', () => {
    for (const k of Object.keys(stationTonesHsl) as (keyof typeof stationTonesHsl)[]) {
      const t = stationToneFor(k === 'fason', k === 'fason' ? null : { kk1: 'RAW_QC', process: 'PROCESS_QC', tambur: 'TAMBUR', depo: 'SHIPPING', fason: '' }[k]);
      expect(t.key).toBe(k);
      expect(contrastRatio(t.bg, t.fg)).toBeGreaterThanOrEqual(3);
      expect(t.fg).toBe(readableOn(t.bg));
    }
  });
});
