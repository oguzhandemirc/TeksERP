import { SCREEN_MODULE, conditionalScreens, resolveMobileModuleState } from './screenModules';
import { DEFAULT_FEATURE_FLAGS } from '../services/featureFlag.service';
import { MOBILE_SCREENS } from '../types/permissions';

// =============================================================================
// Tablet modül kapısının SAF yarısı. Üç sonda (1e, 2026-09-14): modül KAPALI →
// o modülün ekranları elenir · AÇIK → hiçbir ekran elenmez (bugünkü liste) ·
// bayrak OKUNAMADI → backend'in satır-yok yönü (üretim AÇIK = bugünkü davranış).
// =============================================================================
describe('screenModules — ekran → modül aynası', () => {
  it('üretim modülünün beş ekranı tabloda; çekirdek/planlanan ekranlar tabloda DEĞİL', () => {
    expect(Object.keys(SCREEN_MODULE).sort()).toEqual(
      ['Dokuma', 'HizliIsEmri', 'KK1', 'KursunDagitim', 'KursunQc', 'Tambur'].sort()
    );
    expect(SCREEN_MODULE.Dokuma).toBe('dokumaEnabled');
    for (const k of ['Depo', 'TartiPaket', 'Sevkiyat', 'IadeGirisi', 'Siparis', 'Kumas', 'FasonSevk', 'KartelaSevk']) {
      expect(SCREEN_MODULE[k as keyof typeof SCREEN_MODULE]).toBeUndefined();
    }
  });

  it('tablodaki her ekran gerçek bir mobil ekran (yazım hatası sızmaz)', () => {
    const keys = new Set(MOBILE_SCREENS.map((s) => s.key));
    for (const k of Object.keys(SCREEN_MODULE)) expect(keys.has(k as never)).toBe(true);
  });

  it('⭐ modül KAPALI → o modülün ekranları false, diğerleri koşulsuz', () => {
    const c = conditionalScreens({ productionEnabled: false });
    expect(c.KK1).toBe(false);
    expect(c.Tambur).toBe(false);
    expect(c.KursunDagitim).toBe(false);
    expect(c.Depo).toBeUndefined();
  });

  it('⭐ modül AÇIK → hiçbir ekran false değil (bugünkü liste birebir)', () => {
    const c = conditionalScreens({ productionEnabled: true, dokumaEnabled: true });
    expect(Object.values(c).every((v) => v === true)).toBe(true);
  });

  it('⭐ dokuma: satır-yok KAPALI (fail-closed) ve ÜRETİME bağlı (zincir tek yerde)', () => {
    expect(DEFAULT_FEATURE_FLAGS.dokumaEnabled).toBe(false);
    expect(conditionalScreens(undefined).Dokuma).toBe(false);
    expect(conditionalScreens({ productionEnabled: true, dokumaEnabled: true }).Dokuma).toBe(true);
    // Üretim kapalıyken dokuma açık olsa da ETKİN kapalı — backend requireDokumaEnabled sırası.
    expect(conditionalScreens({ productionEnabled: false, dokumaEnabled: true }).Dokuma).toBe(false);
    expect(resolveMobileModuleState({ productionEnabled: false, dokumaEnabled: true }).dokumaEnabled).toBe(false);
  });

  it('⭐ bayrak OKUNAMADI → backend satır-yok yönü: üretim AÇIK (fabrikada sıfır fark)', () => {
    expect(DEFAULT_FEATURE_FLAGS.productionEnabled).toBe(true);
    expect(resolveMobileModuleState(undefined).productionEnabled).toBe(true);
    expect(conditionalScreens(undefined).KK1).toBe(true);
    // Kısmi yük (alan yok) da varsayılana düşer, "false"a değil.
    expect(conditionalScreens({}).KK1).toBe(true);
  });
});
