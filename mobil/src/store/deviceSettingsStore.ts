import { create } from 'zustand';
import { storage } from '../utils/storage';
import { parseHardwareLink, parseScanMethodPref } from '../services/hardwareScanner/resolveScanMethod';
import { parseWoCreateKinds, WO_CREATE_KINDS_DEFAULT } from './woCreateKinds';
import { parseHiddenIncoming, setIncomingShown, type DocIncomingField } from './docIncomingFields';
import {
  DOC_DESK_FRAME_MS_DEFAULT, DOC_TORCH_AUTO_DEFAULT, parseDocDeskFrameMs, parseDocPageSizes,
  parseDocScanEngine, parseDocTorchAuto, parseListColumns, type DeviceSettingsState,
  type DocPageSize,
} from './deviceSettingsTypes';

// =============================================================================
// Cihaz-bazlı operatör ayarları. Sunucudan bağımsız — kamera donanım sorunu
// kullanıcıyla değil cihazla ilgili. Operatör değişse bile flag korunur.
// =============================================================================

const MANUAL_BARCODE_KEY = 'device_manual_barcode_entry';
const LAST_ROUTE_KEY = 'device_quick_wo_last_route';
const KK1_MANUAL_METER_KEY = 'device_kk1_manual_meter';
const TAMBUR_RESET_QUALITY_KEY = 'tambur_reset_quality_after_cut';
const TAMBUR_RESET_KARTELA_KEY = 'tambur_reset_kartela_after_cut';
const TAMBUR_LAST_QUALITY_KEY = 'tambur_last_quality_code';
const LIST_COLUMNS_KEY = 'device_list_columns';
const TAMBUR_CUT_MODE_KEY = 'device_tambur_cut_mode';
const TAMBUR_KG_MODE_KEY = 'device_tambur_kg_mode';
const TAMBUR_MANUAL_MODE_KEY = 'device_tambur_manual_mode';
const TAMBUR_OUTPUT_COLLAPSED_KEY = 'tambur_output_collapsed';
const SCAN_SOUND_KEY = 'device_scan_sound';
const DOC_PAGE_SIZE_KEY = 'device_doc_page_size';
const CAMERA_FACING_KEY = 'device_camera_facing';
const DOC_DESK_KEY = 'device_doc_desk';
const DOC_DESK_CAPTURE_KEY = 'device_doc_desk_capture';
const DOC_SCAN_ENGINE_KEY = 'device_doc_scan_engine';
const DOC_TORCH_AUTO_KEY = 'device_doc_torch_auto';
const DOC_HIDDEN_INCOMING_KEY = 'device_doc_hidden_incoming';
const DOC_DESK_FRAME_MS_KEY = 'device_doc_desk_frame_ms';
const WO_CREATE_KINDS_KEY = 'device_wo_create_kinds';
const WO_ROUTE_ON_BUTTON_KEY = 'device_wo_route_on_button';
const WO_BUTTONS_KEY = 'device_wo_buttons';
const WO_LAST_BATCH_HINT_KEY = 'device_wo_last_batch_hint';
const SCAN_METHOD_KEY = 'device_scan_method';
const HARDWARE_LINK_KEY = 'device_hardware_link';
// ⚠️ 2026-08-19: kısa kesim ayarı MERKEZE taşındı (feature-flags). Cihazda artık
// "bayrak + eşik" değil, ÜÇ DURUMLU override yaşar. Eski anahtarlar
// (`tambur_short_cut_a1_enabled` / `..._threshold`) sahaya HİÇ ÇIKMADI (APK
// dağıtılmadı) → migrasyon/geriye-uyum kodu yok; varsa artık okunmaz.
const TAMBUR_SHORT_CUT_A1_OVERRIDE_KEY = 'tambur_short_cut_a1_override';
const TAMBUR_SHORT_CUT_A1_DEVICE_THRESHOLD_KEY = 'tambur_short_cut_a1_device_threshold';

// Tip ve saf çözücüler deviceSettingsTypes'ta; çağıranlar buradan almaya devam eder.
export {
  DOC_DESK_FRAME_MS_DEFAULT, DOC_DESK_FRAME_MS_OPTIONS, DOC_TORCH_AUTO_DEFAULT,
  effectiveScanEngine, parseDocDeskFrameMs, parseDocPageSizes, parseDocScanEngine,
  parseDocTorchAuto, parseListColumns,
} from './deviceSettingsTypes';
export type {
  CameraFacing, DocDeskCaptureMode, DocPageSize, DocScanEngine, MeterEntryMode,
  ShortCutOverrideMode, WoButtons,
} from './deviceSettingsTypes';

export const useDeviceSettingsStore = create<DeviceSettingsState>((set) => ({
  manualBarcodeEntry: false,
  lastRouteTemplateId: null,
  kk1ManualEntry: false,
  tamburCutMode: 'manual',
  tamburKgMode: 'manual',
  tamburResetQualityAfterCut: false,
  tamburResetKartelaAfterCut: true,
  tamburLastQualityCode: null,
  listColumns: {},
  tamburManualMode: false,
  tamburOutputCollapsed: false,
  scanSoundEnabled: true,
  docPageSize: {},
  cameraFacing: 'back',
  tamburShortCutA1Override: 'server',
  tamburShortCutA1DeviceThresholdM: null,
  docDeskDevice: false,
  docDeskCaptureMode: 'tap',
  docDeskFrameMs: DOC_DESK_FRAME_MS_DEFAULT,
  docScanEngine: 'camera',
  docTorchAuto: DOC_TORCH_AUTO_DEFAULT,
  docHiddenIncoming: [],
  woCreateKinds: [...WO_CREATE_KINDS_DEFAULT],
  woRouteOnButton: true,
  woButtons: 'both',
  woLastBatchHint: true,
  scanMethod: 'auto',
  hardwareLink: 'auto',
  isLoaded: false,

  init: async () => {
    const [stored, lastRoute, kk1Manual, tamburMode, tamburResetQuality, tamburResetKartela, tamburManual, scanSound, docSizes, outputCollapsed, cameraFacing, shortCutOverride, shortCutThreshold, docDesk, docDeskCapture, docDeskFrame, docScanEngine, woKinds, woRouteOnBtn, woBtns, scanMethod, hardwareLink, woLastBatch, docTorchAuto, lastQuality, listColumns, hiddenIncoming, kgMode] =
      await Promise.all([
        storage.getItem(MANUAL_BARCODE_KEY),
        storage.getItem(LAST_ROUTE_KEY),
        storage.getItem(KK1_MANUAL_METER_KEY),
        storage.getItem(TAMBUR_CUT_MODE_KEY),
        storage.getItem(TAMBUR_RESET_QUALITY_KEY),
        storage.getItem(TAMBUR_RESET_KARTELA_KEY),
        storage.getItem(TAMBUR_MANUAL_MODE_KEY),
        storage.getItem(SCAN_SOUND_KEY),
        storage.getItem(DOC_PAGE_SIZE_KEY),
        storage.getItem(TAMBUR_OUTPUT_COLLAPSED_KEY),
        storage.getItem(CAMERA_FACING_KEY),
        storage.getItem(TAMBUR_SHORT_CUT_A1_OVERRIDE_KEY),
        storage.getItem(TAMBUR_SHORT_CUT_A1_DEVICE_THRESHOLD_KEY),
        storage.getItem(DOC_DESK_KEY),
        storage.getItem(DOC_DESK_CAPTURE_KEY),
        storage.getItem(DOC_DESK_FRAME_MS_KEY),
        storage.getItem(DOC_SCAN_ENGINE_KEY),
        storage.getItem(WO_CREATE_KINDS_KEY),
        storage.getItem(WO_ROUTE_ON_BUTTON_KEY),
        storage.getItem(WO_BUTTONS_KEY),
        storage.getItem(SCAN_METHOD_KEY),
        storage.getItem(HARDWARE_LINK_KEY),
        storage.getItem(WO_LAST_BATCH_HINT_KEY),
        storage.getItem(DOC_TORCH_AUTO_KEY),
        storage.getItem(TAMBUR_LAST_QUALITY_KEY),
        storage.getItem(LIST_COLUMNS_KEY),
        storage.getItem(DOC_HIDDEN_INCOMING_KEY),
        storage.getItem(TAMBUR_KG_MODE_KEY),
      ]);
    set({
      manualBarcodeEntry: stored === 'true',
      lastRouteTemplateId: lastRoute || null,
      kk1ManualEntry: kk1Manual === 'true',
      tamburOutputCollapsed: outputCollapsed === 'true',
      // Bilinmeyen/bozuk değer → varsayılan 'manual' (kayıt yoksa da öyle).
      tamburCutMode: tamburMode === 'auto' ? 'auto' : 'manual',
      tamburKgMode: kgMode === 'auto' ? 'auto' : 'manual',
      // Varsayılan KAPALI (bugünkü davranış: kalite korunur) — yalnız birebir
      // 'true' sıfırlamayı açar.
      tamburResetQualityAfterCut: tamburResetQuality === 'true',
      // Varsayılan AÇIK → yalnız birebir 'false' yapışkanlığı geri getirir
      // (scanSoundEnabled ile aynı ters yön; güvenli taraf "sıfırla").
      tamburResetKartelaAfterCut: tamburResetKartela !== 'false',
      tamburLastQualityCode: lastQuality?.trim() ? lastQuality.trim() : null,
      listColumns: parseListColumns(listColumns),
      // Güvenli varsayılan KAPALI: yalnız birebir 'true' modu açar (bozuk değer
      // kart-atlayan modu sessizce açmasın).
      tamburManualMode: tamburManual === 'true',
      // Varsayılan AÇIK → yalnız birebir 'false' sesi kapatır. Diğer bayraklarla
      // ters yön: burada güvenli taraf "sinyal ver", "sessiz kal" değil.
      scanSoundEnabled: scanSound !== 'false',
      docPageSize: parseDocPageSizes(docSizes),
      // Yalnız birebir 'front' ön kamerayı açar; kayıt yok / bozuk değer →
      // 'back' (barkod okumanın güvenli tarafı: ön kamerayla okuyamayan bir
      // operatör "kamera bozuk" der, arka kamerayla okuyamayan yönü çevirir).
      cameraFacing: cameraFacing === 'front' ? 'front' : 'back',
      // Bilinmeyen/eksik değer → 'server' (fabrika ayarını izle). 'on'/'off'
      // AÇIK BEYANDIR; bozuk bir kayıt yüzünden cihaz sessizce fabrikadan
      // ayrılmaz. Eşik: pozitif sonlu sayı değilse null (kural inert).
      tamburShortCutA1Override:
        shortCutOverride === 'on' ? 'on' : shortCutOverride === 'off' ? 'off' : 'server',
      tamburShortCutA1DeviceThresholdM: (() => {
        const n = shortCutThreshold == null ? NaN : Number(shortCutThreshold);
        return Number.isFinite(n) && n > 0 ? n : null;
      })(),
      // Yalnız birebir 'true' / 'auto' açar: bozuk kayıt cihazı sessizce masa kipine ya da deneysel çekime almaz.
      docDeskDevice: docDesk === 'true',
      docDeskCaptureMode: docDeskCapture === 'auto' ? 'auto' : 'tap',
      docDeskFrameMs: parseDocDeskFrameMs(docDeskFrame),
      docScanEngine: parseDocScanEngine(docScanEngine),
      docTorchAuto: parseDocTorchAuto(docTorchAuto),
      docHiddenIncoming: parseHiddenIncoming(hiddenIncoming),
      woCreateKinds: parseWoCreateKinds(woKinds),
      // Varsayılan AÇIK: yalnız birebir 'false' kapatır.
      woRouteOnButton: woRouteOnBtn !== 'false',
      woButtons: woBtns === 'scan' || woBtns === 'manual' ? woBtns : 'both',
      // Varsayılan AÇIK: yalnız birebir 'false' gizler.
      woLastBatchHint: woLastBatch !== 'false',
      // Bilinmeyen/bozuk kayıt → 'auto' (bugünkü davranış okuyucusuz cihazda kamera).
      scanMethod: parseScanMethodPref(scanMethod),
      hardwareLink: parseHardwareLink(hardwareLink),
      isLoaded: true,
    });
  },

  setScanMethod: async (v) => {
    set({ scanMethod: v });
    await storage.setItem(SCAN_METHOD_KEY, v);
  },

  setHardwareLink: async (v) => {
    set({ hardwareLink: v });
    await storage.setItem(HARDWARE_LINK_KEY, v);
  },

  setManualBarcodeEntry: async (v) => {
    await storage.setItem(MANUAL_BARCODE_KEY, v ? 'true' : 'false');
    set({ manualBarcodeEntry: v });
  },

  setLastRouteTemplateId: async (v) => {
    if (v) await storage.setItem(LAST_ROUTE_KEY, v);
    else await storage.deleteItem(LAST_ROUTE_KEY);
    set({ lastRouteTemplateId: v });
  },

  // Ekrandaki anahtar ANINDA dönsün diye önce state, sonra disk (yazma hatası
  // arayüzü kilitlemez; en kötü ihtimalle tercih o cihazda kalıcı olmaz).
  setKk1ManualEntry: async (v) => {
    set({ kk1ManualEntry: v });
    await storage.setItem(KK1_MANUAL_METER_KEY, v ? 'true' : 'false');
  },

  setTamburOutputCollapsed: async (v) => {
    set({ tamburOutputCollapsed: v });
    await storage.setItem(TAMBUR_OUTPUT_COLLAPSED_KEY, String(v));
  },

  setTamburCutMode: async (v) => {
    set({ tamburCutMode: v });
    await storage.setItem(TAMBUR_CUT_MODE_KEY, v);
  },

  setTamburKgMode: async (v) => {
    set({ tamburKgMode: v });
    await storage.setItem(TAMBUR_KG_MODE_KEY, v);
  },

  setTamburResetQualityAfterCut: async (v) => {
    set({ tamburResetQualityAfterCut: v });
    await storage.setItem(TAMBUR_RESET_QUALITY_KEY, v ? 'true' : 'false');
  },

  setTamburLastQualityCode: async (v) => {
    const code = v?.trim() ? v.trim() : null;
    set({ tamburLastQualityCode: code });
    if (code) await storage.setItem(TAMBUR_LAST_QUALITY_KEY, code);
    else await storage.deleteItem(TAMBUR_LAST_QUALITY_KEY);
  },

  setListColumns: async (screenKey, cols) => {
    const next = { ...useDeviceSettingsStore.getState().listColumns };
    if (cols) next[screenKey] = [...cols];
    else delete next[screenKey];
    set({ listColumns: next });
    await storage.setItem(LIST_COLUMNS_KEY, JSON.stringify(next));
  },

  setTamburResetKartelaAfterCut: async (v) => {
    set({ tamburResetKartelaAfterCut: v });
    await storage.setItem(TAMBUR_RESET_KARTELA_KEY, v ? 'true' : 'false');
  },

  // Aynı desen (önce state, sonra disk): mod anahtarı ekranda ANINDA dönmeli —
  // operatör hangi moda geçtiğini beklemeden görmeli.
  setTamburManualMode: async (v) => {
    set({ tamburManualMode: v });
    await storage.setItem(TAMBUR_MANUAL_MODE_KEY, v ? 'true' : 'false');
  },

  setScanSoundEnabled: async (v) => {
    set({ scanSoundEnabled: v });
    await storage.setItem(SCAN_SOUND_KEY, v ? 'true' : 'false');
  },

  // Aynı desen: rozet ANINDA dönsün diye önce state, sonra disk.
  // Harita KOMPLE yazılır (tek anahtar) — belge tipi başına ayrı storage anahtarı
  // açmak, tip eklendikçe `init`in Promise.all listesini büyütürdü.
  setDocPageSize: async (docType, v) => {
    let next: Record<string, DocPageSize> = {};
    set((s) => {
      next = { ...s.docPageSize, [docType]: v };
      return { docPageSize: next };
    });
    await storage.setItem(DOC_PAGE_SIZE_KEY, JSON.stringify(next));
  },

  clearDocPageSize: async (docType) => {
    let next: Record<string, DocPageSize> = {};
    set((s) => {
      // Anahtarı `undefined` bırakmak yerine SİL: `JSON.stringify` undefined
      // değeri zaten atar, ama harita bellekte de temiz kalsın (`in` ile bakan
      // bir çağıran ileride yanılmasın).
      const { [docType]: _drop, ...rest } = s.docPageSize;
      next = rest;
      return { docPageSize: next };
    });
    await storage.setItem(DOC_PAGE_SIZE_KEY, JSON.stringify(next));
  },

  // Aynı desen: kamera ANINDA dönsün diye önce state, sonra disk.
  setCameraFacing: async (v) => {
    set({ cameraFacing: v });
    await storage.setItem(CAMERA_FACING_KEY, v);
  },

  setTamburShortCutA1Override: async (v) => {
    set({ tamburShortCutA1Override: v });
    await storage.setItem(TAMBUR_SHORT_CUT_A1_OVERRIDE_KEY, v);
  },

  // Aynı desen: anahtar ANINDA dönsün diye önce state, sonra disk.
  setWoCreateKinds: async (v) => {
    const next = parseWoCreateKinds(v.join(','));
    set({ woCreateKinds: next });
    await storage.setItem(WO_CREATE_KINDS_KEY, next.join(','));
  },

  setDocIncomingShown: async (key, shown) => {
    let next: DocIncomingField[] = [];
    set((s) => {
      next = setIncomingShown(s.docHiddenIncoming, key, shown);
      return { docHiddenIncoming: next };
    });
    await storage.setItem(DOC_HIDDEN_INCOMING_KEY, next.join(','));
  },

  setWoRouteOnButton: async (v) => {
    set({ woRouteOnButton: v });
    await storage.setItem(WO_ROUTE_ON_BUTTON_KEY, v ? 'true' : 'false');
  },

  setWoButtons: async (v) => {
    set({ woButtons: v });
    await storage.setItem(WO_BUTTONS_KEY, v);
  },

  setWoLastBatchHint: async (v) => {
    set({ woLastBatchHint: v });
    await storage.setItem(WO_LAST_BATCH_HINT_KEY, v ? 'true' : 'false');
  },

  setDocDeskDevice: async (v) => {
    set({ docDeskDevice: v });
    await storage.setItem(DOC_DESK_KEY, v ? 'true' : 'false');
  },

  setDocDeskCaptureMode: async (v) => {
    set({ docDeskCaptureMode: v });
    await storage.setItem(DOC_DESK_CAPTURE_KEY, v);
  },

  setDocScanEngine: async (v) => {
    const engine = parseDocScanEngine(v);
    set({ docScanEngine: engine });
    await storage.setItem(DOC_SCAN_ENGINE_KEY, engine);
  },

  setDocTorchAuto: async (v) => {
    set({ docTorchAuto: v });
    await storage.setItem(DOC_TORCH_AUTO_KEY, v ? 'true' : 'false');
  },

  setDocDeskFrameMs: async (v) => {
    const ms = parseDocDeskFrameMs(String(v));
    set({ docDeskFrameMs: ms });
    await storage.setItem(DOC_DESK_FRAME_MS_KEY, String(ms));
  },

  // null/geçersiz → kayıt SİLİNİR (eşik girilmemiş durumuna döner). Override
  // 'server'a dönse bile cihaz eşiği SİLİNMEZ: operatör geçici olarak fabrikaya
  // dönüp geri geldiğinde "kaç metreydi?" diye hatırlamak zorunda kalmasın.
  setTamburShortCutA1DeviceThresholdM: async (v) => {
    const valid = v != null && Number.isFinite(v) && v > 0 ? v : null;
    set({ tamburShortCutA1DeviceThresholdM: valid });
    if (valid == null) await storage.deleteItem(TAMBUR_SHORT_CUT_A1_DEVICE_THRESHOLD_KEY);
    else await storage.setItem(TAMBUR_SHORT_CUT_A1_DEVICE_THRESHOLD_KEY, String(valid));
  },
}));
