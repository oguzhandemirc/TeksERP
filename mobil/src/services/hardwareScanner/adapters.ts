// El terminali okuyucu adaptörleri — marka bilgisi YALNIZ burada (OTA ile düzeltilebilir).
// Point Mobile cihazda doğrulandı (PM68, 2026-11-07); Zebra ve Honeywell SAHADA DOĞRULANMADI — sözleşme
// adaptör testleriyle kilitli (hardwareScanner.adapters.test.ts). Kaynak: docs/plan/EL-TERMINALI-OKUYUCU-PLAN.md §1.
import type { BroadcastSpec, NativeCapabilities, NativeIntentEvent } from './native';
import { X, decodeBytesExtra, numberExtra, stringExtra } from './extras';
import { compactUpper } from './resolveScanMethod';

export type AdapterId = 'pointmobile' | 'zebra' | 'honeywell';

/** Okuyucudan gelen ham okuma — boğaz normalize eder. */
export interface RawScan {
  data: string;
  symbology: string | null;
}

export interface AdapterContext {
  /** Uygulamanın paket adı — Zebra/Honeywell çıkış eylemi ve profil bağı bundan türer. */
  packageName: string;
}

/** Adaptörün oturum durumu (ör. Point Mobile'ın önceki çıkış modu). */
export interface AdapterState {
  previousResultType?: number;
}

export interface IntentOutcome {
  scan?: RawScan;
  state?: AdapterState;
}

export type SettingsLauncher =
  | { kind: 'activity'; action: string; package?: string }
  | { kind: 'package'; package: string };

export interface ScannerAdapter {
  id: AdapterId;
  /** Ekranda görünen marka adı. */
  vendorLabel: string;
  /** Sahada doğrulandı mı (ayar ekranı "doğrulanmadı" notu basar). */
  fieldVerified: boolean;
  matches: (caps: NativeCapabilities) => boolean;
  receiveActions: (ctx: AdapterContext) => string[];
  foreground: (ctx: AdapterContext, state: AdapterState) => BroadcastSpec[];
  background: (ctx: AdapterContext, state: AdapterState) => BroadcastSpec[];
  handleIntent: (e: NativeIntentEvent, ctx: AdapterContext, state: AdapterState) => IntentOutcome | null;
  settings?: SettingsLauncher;
}

/** Yetenek sorgusunda sorulan paketler — native manifest `<queries>` ile AYNI küme (bekçi ölçer). */
export const QUERIED_PACKAGES = ['device.settings.scanner', 'com.symbol.datawedge', 'com.intermec.datacollectionservice'] as const;

// ─── Point Mobile ────────────────────────────────────────────────────────────
export const PM = {
  SET_RESULT_TYPE: 'device.common.SET_RESULT_TYPE',
  GET_RESULT_TYPE: 'device.common.GET_RESULT_TYPE',
  STATE_RESULT_TYPE: 'device.common.STATE_RESULT_TYPE',
  EXTRA_RESULT_TYPE: 'EXTRA_RESULT_TYPE',
  EVENT: 'device.scanner.EVENT',
  EXTRA_VALUE: 'EXTRA_EVENT_DECODE_VALUE',
  EXTRA_LENGTH: 'EXTRA_EVENT_DECODE_LENGTH',
  EXTRA_SYMBOL: 'EXTRA_EVENT_SYMBOL_NAME',
  LAUNCH_SETTINGS: 'device.common.LAUNCH_SCAN_SETTING',
  SETTINGS_PACKAGE: 'device.settings.scanner',
  /** Okuma zaman aşımında okuyucu bu sabiti VERİ olarak yollar (semboloji adı da aynı) — okutma değildir. */
  READ_FAIL: 'READ_FAIL',
  /** ResultType: USERMSG=0 · KBDMSG=1 · COPYPASTE=2 · EVENT=3 (yalnız 3'te veri intent'te gelir). */
  RESULT_EVENT: 3,
  RESULT_COPYPASTE: 2,
} as const;

const setResultType = (v: number): BroadcastSpec => ({
  action: PM.SET_RESULT_TYPE,
  extras: { [PM.EXTRA_RESULT_TYPE]: X.int(v) },
});

export const pointMobileAdapter: ScannerAdapter = {
  id: 'pointmobile',
  vendorLabel: 'Point Mobile',
  fieldVerified: true,
  matches: (caps) =>
    compactUpper(caps.manufacturer) === 'POINTMOBILE' ||
    caps.sharedLibraries.includes('device.sdk') ||
    caps.packages[PM.SETTINGS_PACKAGE] === true,
  receiveActions: () => [PM.EVENT, PM.STATE_RESULT_TYPE],
  // Önce önceki modu sor (geri yüklemek için), sonra olay moduna al.
  foreground: () => [{ action: PM.GET_RESULT_TYPE }, setResultType(PM.RESULT_EVENT)],
  // Arka planda önceki moda dön: başka uygulamalarda wedge çalışsın. Bilinmiyorsa COPYPASTE (cihaz varsayılanı).
  background: (_ctx, state) => [setResultType(state.previousResultType ?? PM.RESULT_COPYPASTE)],
  handleIntent: (e, _ctx, state) => {
    if (e.action === PM.EVENT) {
      const data = decodeBytesExtra(e.extras[PM.EXTRA_VALUE], e.extras[PM.EXTRA_LENGTH]);
      if (data == null) return null;
      const symbology = stringExtra(e.extras[PM.EXTRA_SYMBOL]);
      // Okunamayan tetik: barkod değil; ekrana "EKLENMEDİ · READ_FAIL" basmasın.
      if (data.trim() === PM.READ_FAIL || symbology === PM.READ_FAIL) return null;
      return { scan: { data, symbology } };
    }
    if (e.action === PM.STATE_RESULT_TYPE) {
      const t = numberExtra(e.extras[PM.EXTRA_RESULT_TYPE]);
      // İlk görülen 3-dışı değer "önceki mod"dur; 3 bizim ayarımızın yankısı (ya da önceki çökmenin artığı).
      if (t == null || t === PM.RESULT_EVENT || state.previousResultType !== undefined) return null;
      return { state: { ...state, previousResultType: t } };
    }
    return null;
  },
  settings: { kind: 'activity', action: PM.LAUNCH_SETTINGS, package: PM.SETTINGS_PACKAGE },
};

// ─── Zebra DataWedge (SAHADA DOĞRULANMADI) ──────────────────────────────────
export const ZEBRA = {
  PACKAGE: 'com.symbol.datawedge',
  API_ACTION: 'com.symbol.datawedge.api.ACTION',
  SET_CONFIG: 'com.symbol.datawedge.api.SET_CONFIG',
  DATA_STRING: 'com.symbol.datawedge.data_string',
  LABEL_TYPE: 'com.symbol.datawedge.label_type',
  PROFILE: 'TeksERP',
} as const;

export const scanAction = (ctx: AdapterContext): string => `${ctx.packageName}.DONANIM_OKUMA`;

export function zebraSetConfig(ctx: AdapterContext): BroadcastSpec {
  return {
    action: ZEBRA.API_ACTION,
    extras: {
      [ZEBRA.SET_CONFIG]: X.bundle({
        PROFILE_NAME: X.str(ZEBRA.PROFILE),
        PROFILE_ENABLED: X.str('true'),
        CONFIG_MODE: X.str('CREATE_IF_NOT_EXIST'),
        PLUGIN_CONFIG: X.bundleList([
          {
            PLUGIN_NAME: X.str('INTENT'),
            RESET_CONFIG: X.str('true'),
            PARAM_LIST: X.bundle({
              intent_output_enabled: X.str('true'),
              intent_action: X.str(scanAction(ctx)),
              intent_delivery: X.str('2'), // 2 = yayın (broadcast)
            }),
          },
          {
            // Klavye çıkışı kapalı: aynı okuma bir de odaktaki kutuya yazılmasın.
            PLUGIN_NAME: X.str('KEYSTROKE'),
            RESET_CONFIG: X.str('true'),
            PARAM_LIST: X.bundle({ keystroke_output_enabled: X.str('false') }),
          },
        ]),
        APP_LIST: X.bundleArray([{ PACKAGE_NAME: X.str(ctx.packageName), ACTIVITY_LIST: X.stringArray(['*']) }]),
      }),
    },
  };
}

export const zebraAdapter: ScannerAdapter = {
  id: 'zebra',
  vendorLabel: 'Zebra',
  fieldVerified: false,
  matches: (caps) => caps.packages[ZEBRA.PACKAGE] === true,
  receiveActions: (ctx) => [scanAction(ctx)],
  // Profil uygulamaya bağlı: DataWedge ön plandaki uygulamaya göre profili kendisi değiştirir, arka plan işi yok.
  foreground: (ctx) => [zebraSetConfig(ctx)],
  background: () => [],
  handleIntent: (e, ctx) => {
    if (e.action !== scanAction(ctx)) return null;
    const data = stringExtra(e.extras[ZEBRA.DATA_STRING]);
    if (data == null) return null;
    const label = stringExtra(e.extras[ZEBRA.LABEL_TYPE]);
    return { scan: { data, symbology: label ? label.replace(/^LABEL-TYPE-/, '') : null } };
  },
  settings: { kind: 'package', package: ZEBRA.PACKAGE },
};

// ─── Honeywell (SAHADA DOĞRULANMADI) ────────────────────────────────────────
export const HONEYWELL = {
  SERVICE_PACKAGE: 'com.intermec.datacollectionservice',
  CLAIM: 'com.honeywell.aidc.action.ACTION_CLAIM_SCANNER',
  RELEASE: 'com.honeywell.aidc.action.ACTION_RELEASE_SCANNER',
  EXTRA_SCANNER: 'com.honeywell.aidc.extra.EXTRA_SCANNER',
  EXTRA_PROFILE: 'com.honeywell.aidc.extra.EXTRA_PROFILE',
  EXTRA_PROPERTIES: 'com.honeywell.aidc.extra.EXTRA_PROPERTIES',
  SCANNER_IMAGER: 'dcs.scanner.imager',
} as const;

export const honeywellAdapter: ScannerAdapter = {
  id: 'honeywell',
  vendorLabel: 'Honeywell',
  fieldVerified: false,
  matches: (caps) => caps.packages[HONEYWELL.SERVICE_PACKAGE] === true,
  receiveActions: (ctx) => [scanAction(ctx)],
  foreground: (ctx) => [
    {
      action: HONEYWELL.CLAIM,
      package: HONEYWELL.SERVICE_PACKAGE,
      extras: {
        [HONEYWELL.EXTRA_SCANNER]: X.str(HONEYWELL.SCANNER_IMAGER),
        [HONEYWELL.EXTRA_PROFILE]: X.str('DEFAULT'),
        [HONEYWELL.EXTRA_PROPERTIES]: X.bundle({
          DPR_DATA_INTENT: X.bool(true),
          DPR_DATA_INTENT_ACTION: X.str(scanAction(ctx)),
        }),
      },
    },
  ],
  // Okuyucuyu bırak: başka uygulama (ve sistem wedge'i) kullanabilsin.
  background: () => [{ action: HONEYWELL.RELEASE, package: HONEYWELL.SERVICE_PACKAGE }],
  handleIntent: (e, ctx) => {
    if (e.action !== scanAction(ctx)) return null;
    const data = stringExtra(e.extras.data);
    if (data == null) return null;
    return { scan: { data, symbology: stringExtra(e.extras.codeId) ?? stringExtra(e.extras.aimId) } };
  },
};

/** Öncelik sırası: ilk eşleşen kazanır. */
export const ADAPTERS: readonly ScannerAdapter[] = [pointMobileAdapter, zebraAdapter, honeywellAdapter];

export function findAdapter(caps: NativeCapabilities | null): ScannerAdapter | null {
  if (!caps) return null;
  return ADAPTERS.find((a) => a.matches(caps)) ?? null;
}

export function adapterById(id: AdapterId | null | undefined): ScannerAdapter | null {
  return ADAPTERS.find((a) => a.id === id) ?? null;
}
