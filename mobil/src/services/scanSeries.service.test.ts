// =============================================================================
// BEKÇİ — TABLET BİÇİM BİLMEZ: barkod türü sunucu tablosundan çözülür
// =============================================================================
// Fabrikanın kuralı zaten yazılıydı ("numarayı sunucu üretir, tablet hiç
// hesaplamaz"); okutma tarafı bu kuraldan muaf kalmıştı — üç ekranda ön ek
// REGEX olarak sabitti. Bu dosya üç şeyi kilitler:
//   ① tablo neyi söylüyorsa sınıflandırma onu yapar (ön ek DEĞİŞEBİLİR),
//   ② tablo yoksa / bozuksa YEDEK devreye girer ve okutma ÇALIŞIR
//     (fail-safe; fail-closed olsaydı ağsız tablet hiçbir kod okutamazdı),
//   ③ YEDEK tablo backend kataloğunun aynasıdır ve ayna MEKANİK birebirlenir.
// Ayrıca çevrimdışı sözleşme: tablo anahtarı BOOTSTRAP listesinde olmalı, yoksa
// diske yazılmaz ve ağsız açılışta tablet yedeğe düşer.
//
// ⭐ NEGATİF SONDA ✓B4 (2026-09-22, ölçüldü): `FALLBACK_SCAN_SERIES`ten
//    `roll.infix` silinince ❌3 · `scanSeriesService.get` bozuk yanıtta boş dizi
//    dönünce ❌1 · `resolve` ağ hatasında `ROLL` uydurunca ❌1 · `persistPolicy`den
//    `['scan-series']` çıkınca ❌1 · ön ek çapası ÇIPLAK ön eke düşürülünce ❌2
//    (fason FİRMA kodu `FSN…` sevk belgesi sanılıyor). Hepsi geri alındı, temiz
//    ağaçta 24/24.
// =============================================================================
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import {
  FALLBACK_SCAN_SERIES,
  classifyOrAskWithTable,
  classifyWithTable,
  matchesFullFormatWithTable,
  scanSeriesService,
  type ScanSeriesRow,
} from './scanSeries.service';
import { apiClient } from './api';
import { isBootstrapQueryKey, isPersistedQueryKey } from '../offline/persistPolicy';

jest.mock('./api', () => ({ apiClient: { get: jest.fn() } }));
const getMock = apiClient.get as jest.Mock;

beforeEach(() => getMock.mockReset());

describe('② YEDEK tablo = bugünkü davranış', () => {
  const T = FALLBACK_SCAN_SERIES;

  it('bugünkü kodları bugünkü türlerine ayırır', () => {
    expect(classifyWithTable(T, 'T120726H0001').kind).toBe('ROLL');
    expect(classifyWithTable(T, 'IE1207260001').kind).toBe('TRAVELER_CARD');
    expect(classifyWithTable(T, 'RK1207260001').kind).toBe('TRAVELER_CARD');
    expect(classifyWithTable(T, 'KRT1207260042').kind).toBe('SWATCH');
    expect(classifyWithTable(T, 'CV1207260001').kind).toBe('SACK');
    expect(classifyWithTable(T, 'SVK2109260003').kind).toBe('SHIPMENT');
    for (const c of ['FS1207260123', 'FK1207260089', 'KS1207260045', 'KK1207260089']) {
      expect(classifyWithTable(T, c).kind).toBe('DISPATCH_DOC');
    }
  });

  it('uzun ön ek kısa olandan ÖNCE denenir (KRT ↔ KK/KS)', () => {
    expect(classifyWithTable(T, 'KRT1207260001').key).toBe('swatch');
    expect(classifyWithTable(T, 'KS1207260001').key).toBe('kartelaDispatch');
  });

  it('küçük harf ve boşluk normalize edilir', () => {
    const c = classifyWithTable(T, '  cv1207260001 ');
    expect(c.kind).toBe('SACK');
    expect(c.code).toBe('CV1207260001');
  });

  it('tanınmayan kod UNKNOWN (tahmin yürütülmez)', () => {
    for (const c of ['RAF-A12', '', '12345', 'SIP1207260001', 'A-17']) {
      expect(classifyWithTable(T, c).kind).toBe('UNKNOWN');
    }
  });

  it('⭐ fason FİRMA kodu (FSN…) sevk belgesi (FS…) sanılmıyor', () => {
    // Ön ek içinde ön ek; ayıran tek şey çapanın ön ekten sonra RAKAM istemesi.
    expect(classifyWithTable(T, 'FSN2209260001').kind).toBe('UNKNOWN');
    expect(classifyWithTable(T, 'FS2209260001').key).toBe('subcontractorDispatch'); // kontrol grubu
  });

  it('⭐ ön ekten sonra RAKAM ya da AYRAÇ ister ("TEKSTİL BEYAZ" top sayılmaz)', () => {
    expect(classifyWithTable(T, 'TEKSTİL BEYAZ').kind).toBe('UNKNOWN');
    expect(classifyWithTable(T, 'KRTX0001').kind).toBe('UNKNOWN');
    expect(classifyWithTable(T, 'T120726H0001').kind).toBe('ROLL');
  });

  it('⭐ bozuk/boş yanıtta YEDEK döner — okutma yolu fail-closed DEĞİL', async () => {
    getMock.mockResolvedValueOnce({ data: { success: true, data: [] } });
    expect(await scanSeriesService.get()).toEqual([...FALLBACK_SCAN_SERIES]);
    getMock.mockResolvedValueOnce({ data: { success: true, data: [{ key: 'x' }] } });
    expect(await scanSeriesService.get()).toEqual([...FALLBACK_SCAN_SERIES]);
  });
});

describe('① Sunucu tablosu sınıflandırmayı BELİRLER', () => {
  const degisik: ScanSeriesRow[] = [
    { key: 'sack', kind: 'SACK', prefixes: ['CX', 'CV'], dateSegment: 'DDMMYY', digits: 4, separator: '' },
    { key: 'roll', kind: 'ROLL', prefixes: ['TP'], dateSegment: 'DDMMYY', digits: 5, separator: '-', infix: '[HF]' },
  ];

  it('yeni ön ek tanınır, emekli ön ek tanınmaya devam eder', () => {
    expect(classifyWithTable(degisik, 'CX1207260001').key).toBe('sack');
    expect(classifyWithTable(degisik, 'CV1207260001').key).toBe('sack');
  });

  it('tabloda OLMAYAN ön ek artık tanınmaz (sabit regex olsaydı tanırdı)', () => {
    expect(classifyWithTable(degisik, 'KRT1207260042').kind).toBe('UNKNOWN');
  });

  it('tam-format testi tablodan kurulur (ayraç · hane · infix)', () => {
    expect(matchesFullFormatWithTable(degisik, 'ROLL', 'TP-120726-H00001')).toBe(true);
    expect(matchesFullFormatWithTable(degisik, 'ROLL', 'TP-120726-H0001')).toBe(false);
    expect(matchesFullFormatWithTable(degisik, 'ROLL', 'TP-120726-X00001')).toBe(false);
  });

  it('geçerli tablo olduğu gibi döner', async () => {
    getMock.mockResolvedValueOnce({ data: { success: true, data: degisik } });
    expect(await scanSeriesService.get()).toEqual(degisik);
  });
});

describe('Tam format — hane ESNEK, gevşek çapadan AYRI', () => {
  const T = FALLBACK_SCAN_SERIES;
  it('⭐ 9999 aşılınca üretilen 5 haneli kod GEÇER', () => {
    expect(matchesFullFormatWithTable(T, 'SACK', 'CV12072610000')).toBe(true);
    expect(matchesFullFormatWithTable(T, 'ROLL', 'T120726H10000')).toBe(true);
  });
  it('bozuk/eski biçim geçmez', () => {
    expect(matchesFullFormatWithTable(T, 'ROLL', 'T1207260001')).toBe(false); // faz harfi yok
    expect(matchesFullFormatWithTable(T, 'SACK', 'CV-260615-001')).toBe(false);
  });
  it('gevşek çapa tanır ama tam format REDDEDER', () => {
    expect(classifyWithTable(T, 'CV12').kind).toBe('SACK');
    expect(matchesFullFormatWithTable(T, 'SACK', 'CV12')).toBe(false);
  });
});

describe('Sunucuya tek kod sorma', () => {
  it('sunucunun cevabı kullanılır', async () => {
    getMock.mockResolvedValueOnce({ data: { data: { code: 'ZZ1207260001', kind: 'SACK', key: 'sack' } } });
    expect(await scanSeriesService.resolve('zz1207260001')).toEqual({
      kind: 'SACK',
      key: 'sack',
      code: 'ZZ1207260001',
    });
  });
  it('⭐ ağ düşerse UNKNOWN — TAHMİN YÜRÜTÜLMEZ', async () => {
    getMock.mockRejectedValueOnce(new Error('ağ yok'));
    const r = await scanSeriesService.resolve('ZZ1207260001');
    expect(r.kind).toBe('UNKNOWN');
    expect(r.key).toBeNull();
  });
});

describe('Tablo → sunucu → UNKNOWN zinciri (iki dalı seçen ekranlar için)', () => {
  const T = FALLBACK_SCAN_SERIES;

  it('tablo tanıyorsa SUNUCUYA HİÇ SORULMAZ (gereksiz ağ turu yok)', async () => {
    const r = await classifyOrAskWithTable(T, 'CV1207260001');
    expect(r.key).toBe('sack');
    expect(getMock).not.toHaveBeenCalled();
  });

  it('⭐ tablo tanımıyorsa SUNUCUYA sorulur ve cevabı kullanılır', async () => {
    getMock.mockResolvedValueOnce({ data: { data: { code: 'ZZ1207260001', kind: 'SWATCH', key: 'swatch' } } });
    const r = await classifyOrAskWithTable(T, 'ZZ1207260001');
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe('SWATCH');
  });

  it('⭐ sunucu da çözemezse UNKNOWN — tahmin YOK', async () => {
    getMock.mockRejectedValueOnce(new Error('ağ yok'));
    expect((await classifyOrAskWithTable(T, 'A-17')).kind).toBe('UNKNOWN');
  });
});

describe('Çevrimdışı sözleşme — tablo diske yazılır', () => {
  it('⭐ tablo anahtarı BOOTSTRAP + PERSIST listesinde (ağsız açılış)', () => {
    expect(isBootstrapQueryKey(['scan-series'])).toBe(true);
    expect(isPersistedQueryKey(['scan-series'])).toBe(true);
  });
  it('körlük zemini: politika her anahtarı kabul etmiyor', () => {
    expect(isPersistedQueryKey(['rolls', 'list'])).toBe(false);
  });
});

describe('③ YEDEK tablo ↔ backend kataloğu AYNASI', () => {
  const BACKEND = readFileSync(
    resolvePath(__dirname, '../../../Teks-Erp/src/constants/number-series-catalog.ts'),
    'utf8',
  );

  function backendScanned(): Map<string, { prefix: string; digits: number; retired: string[] }> {
    const out = new Map<string, { prefix: string; digits: number; retired: string[] }>();
    for (const blok of BACKEND.split(/\n\s*\{\s*\n?/).slice(1)) {
      const govde = blok.split(/\n\s*\},?\s*\n/)[0] ?? blok;
      if (!/\bkind:\s*"/.test(govde)) continue;
      const key = /key:\s*"([^"]+)"/.exec(govde)?.[1];
      const prefix = /seedPrefix:\s*"([^"]*)"/.exec(govde)?.[1];
      const digits = /seedDigits:\s*(\d+)/.exec(govde)?.[1];
      if (!key || prefix === undefined || !digits) continue;
      const retiredRaw = /seedRetiredPrefixes:\s*\[([^\]]*)\]/.exec(govde)?.[1] ?? '';
      out.set(key, {
        prefix,
        digits: Number(digits),
        retired: [...retiredRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string),
      });
    }
    return out;
  }

  it('⭐ körlük zemini: ayrıştırıcı backend dosyasını GERÇEKTEN okudu', () => {
    expect(BACKEND.length).toBeGreaterThan(3000);
    expect(backendScanned().size).toBe(FALLBACK_SCAN_SERIES.length);
  });

  it('⭐ her okutulan serinin ön eki · emeklileri · hanesi birebir aynı', () => {
    const backend = backendScanned();
    for (const row of FALLBACK_SCAN_SERIES) {
      const b = backend.get(row.key);
      expect(b).toBeDefined();
      expect(row.prefixes).toEqual([(b as { prefix: string }).prefix, ...(b as { retired: string[] }).retired]);
      expect(row.digits).toBe((b as { digits: number }).digits);
    }
  });

  it('⭐ top serisinin infix\'i aynada da var', () => {
    expect(/infix:\s*\{\s*re:\s*"\[HF\]"/.test(BACKEND)).toBe(true);
    expect(FALLBACK_SCAN_SERIES.find((r) => r.key === 'roll')?.infix).toBe('[HF]');
  });
});
