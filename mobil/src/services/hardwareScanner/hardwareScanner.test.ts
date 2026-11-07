// El terminali okuyucu çekirdeği — sözleşme testleri (docs/plan/EL-TERMINALI-OKUYUCU-PLAN.md D1 kabul).
// Point Mobile cihazda doğrulandı; Zebra/Honeywell sözleşmesi YALNIZ burada kilitli (sahada doğrulanmadı).
import { X, base64ToBytes, bytesToText, decodeBytesExtra } from './extras';
import {
  HONEYWELL,
  PM,
  ZEBRA,
  findAdapter,
  honeywellAdapter,
  pointMobileAdapter,
  zebraAdapter,
  zebraSetConfig,
} from './adapters';
import type { NativeCapabilities, DonanimOkuyucuNative, NativeIntentEvent, ReceiverConfig } from './native';
import { resolveScanMethod, isScannerManufacturer, type ScanMethod } from './resolveScanMethod';
import {
  DOUBLE_DELIVERY_MS,
  __resetScanBusForTests,
  emitScan,
  newScanOverlayId,
  openScanOverlay,
  pushScanTarget,
  setUnhandledScanListener,
  type HardwareScan,
} from './scanBus';
import { onWedgeChange, onWedgeFlush } from './wedgeBuffer';
import { startHardwareAdapter, stopHardwareAdapter } from './controller';

const ctx = { packageName: 'com.etkiliyazilim.tekserp' };
const b64 = (s: string) => Buffer.from(s, 'latin1').toString('base64');
const caps = (o: Partial<NativeCapabilities> = {}): NativeCapabilities => ({
  manufacturer: '',
  brand: '',
  model: '',
  sdkInt: 35,
  packages: {},
  sharedLibraries: [],
  ...o,
});

describe('extras çözücü', () => {
  it('base64 → bayt, UTF-8, Latin-1 yedeği', () => {
    expect(base64ToBytes(Buffer.from([0, 255, 16, 65]).toString('base64'))).toEqual([0, 255, 16, 65]);
    expect(bytesToText([...Buffer.from('ÇUVAL-ğ', 'utf8')])).toBe('ÇUVAL-ğ');
    expect(bytesToText([0x41, 0xe7, 0x42])).toBe('AçB'); // geçersiz UTF-8 → Latin-1
  });
  it('uzunluk verilirse tamponun yalnız ilk N baytı', () => {
    expect(decodeBytesExtra({ $bytes: b64('T00123\0\0\0') }, 6)).toBe('T00123');
    expect(decodeBytesExtra({ $bytes: b64('T00123') })).toBe('T00123');
    expect(decodeBytesExtra('T00123')).toBeNull();
  });
});

describe('Point Mobile adaptörü (cihazda doğrulandı)', () => {
  it('tanıma: üretici / device.sdk kütüphanesi / ayar paketi', () => {
    expect(pointMobileAdapter.matches(caps({ manufacturer: 'POINTMOBILE' }))).toBe(true);
    expect(pointMobileAdapter.matches(caps({ manufacturer: 'Point Mobile' }))).toBe(true);
    expect(pointMobileAdapter.matches(caps({ sharedLibraries: ['device.sdk'] }))).toBe(true);
    expect(pointMobileAdapter.matches(caps({ packages: { 'device.settings.scanner': true } }))).toBe(true);
    expect(pointMobileAdapter.matches(caps({ manufacturer: 'samsung' }))).toBe(false);
  });
  it('ön planda önce GET sonra EVENT(3); arka planda önceki mod, bilinmiyorsa COPYPASTE(2)', () => {
    expect(pointMobileAdapter.foreground(ctx, {})).toEqual([
      { action: 'device.common.GET_RESULT_TYPE' },
      { action: 'device.common.SET_RESULT_TYPE', extras: { EXTRA_RESULT_TYPE: { t: 'int', v: 3 } } },
    ]);
    expect(pointMobileAdapter.background(ctx, {})).toEqual([
      { action: 'device.common.SET_RESULT_TYPE', extras: { EXTRA_RESULT_TYPE: { t: 'int', v: 2 } } },
    ]);
    expect(pointMobileAdapter.background(ctx, { previousResultType: 1 })[0].extras?.EXTRA_RESULT_TYPE).toEqual(X.int(1));
    expect(pointMobileAdapter.receiveActions(ctx)).toEqual(['device.scanner.EVENT', 'device.common.STATE_RESULT_TYPE']);
  });
  it('EVENT: bayt + uzunluk + semboloji adı', () => {
    const e: NativeIntentEvent = {
      action: PM.EVENT,
      extras: {
        EXTRA_EVENT_DECODE_VALUE: { $bytes: b64('8690001234567\0\0') },
        EXTRA_EVENT_DECODE_LENGTH: 13,
        EXTRA_EVENT_SYMBOL_NAME: 'EAN-13',
        EXTRA_EVENT_SYMBOL_ID: 9914,
      },
    };
    expect(pointMobileAdapter.handleIntent(e, ctx, {})).toEqual({ scan: { data: '8690001234567', symbology: 'EAN-13' } });
  });
  it('önceki mod: ilk 3-dışı değer yakalanır; 3 (yankı) ve sonraki değerler yok sayılır', () => {
    const st = (v: number) => ({ action: PM.STATE_RESULT_TYPE, extras: { EXTRA_RESULT_TYPE: v } });
    expect(pointMobileAdapter.handleIntent(st(3), ctx, {})).toBeNull();
    expect(pointMobileAdapter.handleIntent(st(2), ctx, {})).toEqual({ state: { previousResultType: 2 } });
    expect(pointMobileAdapter.handleIntent(st(1), ctx, { previousResultType: 2 })).toBeNull();
  });
  it('ayar ekranı: LAUNCH_SCAN_SETTING → device.settings.scanner', () => {
    expect(pointMobileAdapter.settings).toEqual({
      kind: 'activity',
      action: 'device.common.LAUNCH_SCAN_SETTING',
      package: 'device.settings.scanner',
    });
  });
});

describe('Zebra adaptörü (SAHADA DOĞRULANMADI — sözleşme kilidi)', () => {
  it('SET_CONFIG: profil, uygulama bağı, INTENT yayın çıkışı, KEYSTROKE kapalı', () => {
    const spec = zebraSetConfig(ctx);
    expect(spec.action).toBe('com.symbol.datawedge.api.ACTION');
    const cfg = spec.extras?.[ZEBRA.SET_CONFIG];
    expect(cfg?.t).toBe('bundle');
    const v = (cfg as { v: Record<string, { t: string; v: unknown }> }).v;
    expect(v.PROFILE_NAME).toEqual(X.str('TeksERP'));
    expect(v.CONFIG_MODE).toEqual(X.str('CREATE_IF_NOT_EXIST'));
    expect(v.APP_LIST).toEqual(
      X.bundleArray([{ PACKAGE_NAME: X.str(ctx.packageName), ACTIVITY_LIST: X.stringArray(['*']) }]),
    );
    expect(v.PLUGIN_CONFIG.t).toBe('bundleList');
    const plugins = v.PLUGIN_CONFIG.v as Record<string, { t: string; v: unknown }>[];
    const intent = plugins.find((p) => p.PLUGIN_NAME.v === 'INTENT')!;
    expect(intent.PARAM_LIST).toEqual(
      X.bundle({
        intent_output_enabled: X.str('true'),
        intent_action: X.str('com.etkiliyazilim.tekserp.DONANIM_OKUMA'),
        intent_delivery: X.str('2'),
      }),
    );
    const ks = plugins.find((p) => p.PLUGIN_NAME.v === 'KEYSTROKE')!;
    expect(ks.PARAM_LIST).toEqual(X.bundle({ keystroke_output_enabled: X.str('false') }));
  });
  it('okuma: data_string + label_type öneki atılır; başka eylem yok sayılır', () => {
    const e = {
      action: 'com.etkiliyazilim.tekserp.DONANIM_OKUMA',
      extras: { [ZEBRA.DATA_STRING]: 'T001', [ZEBRA.LABEL_TYPE]: 'LABEL-TYPE-CODE128' },
    };
    expect(zebraAdapter.handleIntent(e, ctx, {})).toEqual({ scan: { data: 'T001', symbology: 'CODE128' } });
    expect(zebraAdapter.handleIntent({ ...e, action: 'x' }, ctx, {})).toBeNull();
    expect(zebraAdapter.matches(caps({ packages: { 'com.symbol.datawedge': true } }))).toBe(true);
  });
});

describe('Honeywell adaptörü (SAHADA DOĞRULANMADI — sözleşme kilidi)', () => {
  it('claim (ön plan) / release (arka plan) hizmet paketine', () => {
    const [claim] = honeywellAdapter.foreground(ctx, {});
    expect(claim.action).toBe(HONEYWELL.CLAIM);
    expect(claim.package).toBe('com.intermec.datacollectionservice');
    expect(claim.extras?.[HONEYWELL.EXTRA_PROPERTIES]).toEqual(
      X.bundle({ DPR_DATA_INTENT: X.bool(true), DPR_DATA_INTENT_ACTION: X.str('com.etkiliyazilim.tekserp.DONANIM_OKUMA') }),
    );
    expect(honeywellAdapter.background(ctx, {})).toEqual([
      { action: HONEYWELL.RELEASE, package: 'com.intermec.datacollectionservice' },
    ]);
  });
  it('okuma: data + codeId', () => {
    const e = { action: 'com.etkiliyazilim.tekserp.DONANIM_OKUMA', extras: { data: 'CV01', codeId: 'j', aimId: ']C0' } };
    expect(honeywellAdapter.handleIntent(e, ctx, {})).toEqual({ scan: { data: 'CV01', symbology: 'j' } });
  });
  it('öncelik: Point Mobile > Zebra > Honeywell; hiçbiri yoksa null', () => {
    expect(findAdapter(caps({ manufacturer: 'POINTMOBILE', packages: { 'com.symbol.datawedge': true } }))?.id).toBe('pointmobile');
    expect(findAdapter(caps({ packages: { 'com.intermec.datacollectionservice': true } }))?.id).toBe('honeywell');
    expect(findAdapter(caps({ manufacturer: 'samsung' }))).toBeNull();
  });
});

describe('resolveScanMethod — plan tablosu (12 hücre)', () => {
  const cam: ScanMethod = { kind: 'camera' };
  const wedge: ScanMethod = { kind: 'wedge' };
  const intent: ScanMethod = { kind: 'intent', adapterId: 'pointmobile' };
  const col = {
    adapter: { adapterId: 'pointmobile' as const, scannerVendor: true },
    vendorOnly: { adapterId: null, scannerVendor: true },
    plain: { adapterId: null, scannerVendor: false },
  };
  it.each([
    ['auto', 'auto', col.adapter, intent],
    ['auto', 'auto', col.vendorOnly, wedge],
    ['auto', 'auto', col.plain, cam],
    ['hardware', 'auto', col.adapter, intent],
    ['hardware', 'auto', col.vendorOnly, wedge],
    ['hardware', 'auto', col.plain, wedge],
    ['camera', 'auto', col.adapter, cam],
    ['camera', 'auto', col.vendorOnly, cam],
    ['camera', 'auto', col.plain, cam],
    ['auto', 'wedge', col.adapter, wedge],
    ['auto', 'wedge', col.vendorOnly, wedge],
    ['auto', 'wedge', col.plain, cam],
  ] as const)('%s + %s + %j → %j', (pref, link, c, want) => {
    expect(resolveScanMethod({ pref, link, ...c })).toEqual(want);
  });
  it('model OTA tablosuyla zorlanınca adaptör olsa da wedge; "Donanım"+Klavye okuyucusuzda wedge', () => {
    expect(resolveScanMethod({ pref: 'auto', link: 'auto', ...col.adapter, forcedWedge: true })).toEqual(wedge);
    expect(resolveScanMethod({ pref: 'hardware', link: 'wedge', ...col.plain })).toEqual(wedge);
  });
  it('üretici listesi: boşluk/tire/büyük-küçük harf duyarsız', () => {
    expect(isScannerManufacturer('Zebra Technologies')).toBe(true);
    expect(isScannerManufacturer('POINTMOBILE')).toBe(true);
    expect(isScannerManufacturer('samsung')).toBe(false);
    expect(isScannerManufacturer('')).toBe(false);
  });
});

describe('boğaz: normalize · çift teslim · LIFO hedef', () => {
  beforeEach(() => __resetScanBusForTests());

  it('üstteki hedef alır; çıkınca alttaki; normalize + son ek kırpılır', () => {
    const got: string[] = [];
    const screen = { current: (s: HardwareScan) => got.push(`ekran:${s.data}`) };
    const modal = { current: (s: HardwareScan) => got.push(`modal:${s.data}:${s.source}:${s.symbology}`) };
    pushScanTarget(screen);
    const popModal = pushScanTarget(modal);
    expect(emitScan({ data: ' t001\r\n', symbology: 'QR', source: 'pointmobile' }, 1000)).toBe('delivered');
    popModal();
    emitScan({ data: 'T002', source: 'wedge' }, 2000);
    expect(got).toEqual(['modal:T001:pointmobile:QR', 'ekran:T002']);
  });

  it(`aynı veri ≤${DOUBLE_DELIVERY_MS} ms çift teslim elenir; operatörün yeniden basması GEÇER`, () => {
    const got: number[] = [];
    pushScanTarget({ current: (s) => got.push(s.at) });
    expect(emitScan({ data: 'T1', source: 'pointmobile' }, 1000)).toBe('delivered');
    expect(emitScan({ data: 'T1', source: 'pointmobile' }, 1000 + DOUBLE_DELIVERY_MS)).toBe('duplicate');
    expect(emitScan({ data: 'T1', source: 'pointmobile' }, 1000 + DOUBLE_DELIVERY_MS + 701)).toBe('delivered');
    expect(emitScan({ data: 'T2', source: 'pointmobile' }, 1000 + DOUBLE_DELIVERY_MS + 702)).toBe('delivered');
    expect(got).toHaveLength(3);
  });

  it('hedefsiz okuma bildirilir; boş okuma düşer', () => {
    const lost: string[] = [];
    setUnhandledScanListener((s) => lost.push(s.data));
    expect(emitScan({ data: 'X9', source: 'wedge' }, 1)).toBe('no-target');
    expect(emitScan({ data: ' \r\n', source: 'wedge' }, 2)).toBe('empty');
    expect(lost).toEqual(['X9']);
  });

  it('açık pencere: kapsamadığı arka plan hedefini örter (covered); görünür ve kapsanan hedef alır', () => {
    const got: string[] = [];
    const lost: string[] = [];
    setUnhandledScanListener((s, reason) => lost.push(`${reason}:${s.data}`));
    const bg = { current: true };
    pushScanTarget({ current: (s) => got.push(`ekran:${s.data}`) }, bg);
    const dialog = newScanOverlayId();
    const closeDialog = openScanOverlay(dialog);
    expect(emitScan({ data: 'A1', source: 'wedge' }, 1000)).toBe('covered');
    // Sıra değil kapsama: pencere açıkken bağlanan ekran dinleyicisi de örtülür.
    const popLate = pushScanTarget({ current: (s) => got.push(`gec:${s.data}`) }, { current: true });
    expect(emitScan({ data: 'A2', source: 'wedge' }, 2000)).toBe('covered');
    popLate();
    // Pencerenin İÇİNDEKİ arka plan dinleyicisi (sheet'in kapalı tarayıcısı) alır.
    const popInner = pushScanTarget({ current: (s) => got.push(`ic:${s.data}`) }, { current: true }, [dialog]);
    expect(emitScan({ data: 'A3', source: 'wedge' }, 3000)).toBe('delivered');
    popInner();
    // Aynı hedef görünür olunca (tarayıcı açıldı) pencere onu örtmez.
    bg.current = false;
    expect(emitScan({ data: 'A4', source: 'wedge' }, 4000)).toBe('delivered');
    bg.current = true;
    closeDialog();
    expect(emitScan({ data: 'A5', source: 'wedge' }, 5000)).toBe('delivered');
    expect(got).toEqual(['ic:A3', 'ekran:A4', 'ekran:A5']);
    expect(lost).toEqual(['covered:A1', 'covered:A2']);
  });

  it('hedefsiz yığın pencere açıkken de no-target', () => {
    const lost: string[] = [];
    setUnhandledScanListener((_s, reason) => lost.push(reason));
    openScanOverlay(newScanOverlayId());
    expect(emitScan({ data: 'B1', source: 'wedge' }, 1000)).toBe('no-target');
    expect(lost).toEqual(['no-target']);
  });

  it('GS1 iç ayırıcısı (GS) korunur', () => {
    let raw = '';
    pushScanTarget({ current: (s) => (raw = s.raw) });
    emitScan({ data: '0108690001\u001d10ABC\n', source: 'pointmobile' }, 1);
    expect(raw).toBe('0108690001\u001d10ABC');
  });
});

describe('klavye kaması birleştirici', () => {
  it('yapıştırma + Enter tek okuma; satır sonundan sonrası kalır', () => {
    expect(onWedgeChange('T001\n')).toEqual({ value: '', emit: 'T001', armTimer: false });
    expect(onWedgeChange('T001\nT0')).toEqual({ value: 'T0', emit: 'T001', armTimer: true });
  });
  it('Enter yoksa zamanlayıcı kurulur, zaman aşımı biriken metni bitirir', () => {
    expect(onWedgeChange('T00')).toEqual({ value: 'T00', emit: null, armTimer: true });
    expect(onWedgeFlush('T001')).toEqual({ value: '', emit: 'T001', armTimer: false });
    expect(onWedgeFlush('  ')).toEqual({ value: '', emit: null, armTimer: false });
  });
});

describe('denetleyici: native yapılandırma + önceki mod yakalama', () => {
  beforeEach(() => __resetScanBusForTests());

  function fakeNative() {
    const configs: ReceiverConfig[] = [];
    let listener: ((e: NativeIntentEvent) => void) | null = null;
    const native: DonanimOkuyucuNative = {
      getCapabilities: () => caps(),
      configure: (c) => void configs.push(c),
      sendBroadcast: () => true,
      startActivity: () => true,
      launchPackage: () => true,
      addListener: (_e, cb) => {
        listener = cb;
        return { remove: () => (listener = null) };
      },
    };
    return { native, configs, fire: (e: NativeIntentEvent) => listener?.(e) };
  }

  it('başlat → ön plan uygulanır; STATE(1) → arka plan 1 olur, ön plan TEKRARLANMAZ; okuma boğaza; durdur → boş', () => {
    const f = fakeNative();
    const got: string[] = [];
    pushScanTarget({ current: (s) => got.push(s.data) });
    startHardwareAdapter(pointMobileAdapter, f.native, ctx);
    expect(f.configs[0].applyForeground).toBe(true);
    expect(f.configs[0].actions).toEqual(['device.scanner.EVENT', 'device.common.STATE_RESULT_TYPE']);

    f.fire({ action: PM.STATE_RESULT_TYPE, extras: { EXTRA_RESULT_TYPE: 1 } });
    expect(f.configs[1].applyForeground).toBe(false);
    expect(f.configs[1].background[0].extras?.EXTRA_RESULT_TYPE).toEqual(X.int(1));

    f.fire({ action: PM.EVENT, extras: { EXTRA_EVENT_DECODE_VALUE: { $bytes: b64('t77') }, EXTRA_EVENT_DECODE_LENGTH: 3 } });
    expect(got).toEqual(['T77']);

    stopHardwareAdapter();
    expect(f.configs[f.configs.length - 1]).toEqual({ actions: [], foreground: [], background: [] });
    f.fire({ action: PM.EVENT, extras: { EXTRA_EVENT_DECODE_VALUE: { $bytes: b64('T78') } } });
    expect(got).toEqual(['T77']);
  });
});
