// =============================================================================
// TeksERP Mobil — uygulama güncelleme servisi
// =============================================================================
// İKİ AYRI GÜNCELLEME VARDIR ve karıştırılmamalıdır:
//
//  1) UZAKTAN GÜNCELLEME (OTA) — ekran/kural/düzeltme. Sunucudan JS paketi
//     iner, kurulum YOK, operatör hiçbir şey yapmaz. Değişikliklerin ~%90'ı.
//     Taşıyıcı: `expo-updates` (grup-nötr takma ad + indirme belirteci).
//
//  2) NATIVE GÜNCELLEME — yeni native modül, yeni izin, Expo yükseltmesi.
//     Ortak tablette YALNIZ Google Play gizli yayınından gelir (K-14); uygulama
//     kendi APK'sını indirip kurmaz (Play politikası), yalnız Play sayfasını
//     açar (`playStore.ts`).
//
// ⚠️ İKİSİNİ AYIRAN ÇİZGİ `runtimeVersion`'dır. Sunucu, tabletin taşıdığı
// runtimeVersion'a uymayan paketi GÖNDERMEZ (fail-closed). Yani (2)'yi
// gerektiren bir değişiklik yanlışlıkla (1) ile gönderilemez — bu, sahadaki
// tüm tabletleri aynı anda açılmaz hale getirebilecek tek senaryodur.
// =============================================================================

import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

import { queryClient } from '../offline/queryClient';
import { fetchDownloadGrant, refreshOtaDownloadToken } from './downloadToken.service';
import { formatFactory } from '../lib/factory-time';

/* ------------------------------------------------------------------ *
 * 1) UZAKTAN GÜNCELLEME
 * ------------------------------------------------------------------ */

export interface OtaKimlik {
  /** Uygulamada `expo-updates` etkin mi (üretim APK'sında true, `expo start`te false). */
  etkin: boolean;
  /** APK'nın taşıdığı native sürüm kimliği. */
  runtimeVersion: string | null;
  /** Şu an koşan paketin kimliği — APK'nın gömülü paketiyse null döner. */
  paketId: string | null;
  /** Paketin yayın anı. */
  paketTarihi: Date | null;
  /** APK'nın kendi gömülü paketiyle mi açıldı (yani hiç OTA almadı mı). */
  gomulu: boolean;
  /** Güncelleme sunucusunun APK'ya gömülü adresi (manifest ucu). */
  sunucu: string | null;
  /** Tek ortak paket mi (grup-nötr OTA takma adı): OTA denetimi indirme belirtecine (grup) bağlıdır. */
  ortakPaket: boolean;
}

/** Kullanıcıya gösterilecek kısa paket etiketi: `#a1b2c3d4 · 26.08 14:10`. */
export function paketEtiketi(k: OtaKimlik): string {
  if (!k.etkin) return 'geliştirme';
  if (k.gomulu || !k.paketId) return 'kurulumla gelen';
  const kisa = k.paketId.replace(/-/g, '').slice(0, 8);
  if (!k.paketTarihi) return `#${kisa}`;
  return `#${kisa} · ${formatFactory(k.paketTarihi, 'dd.MM HH:mm')}`;
}

export function otaKimlik(): OtaKimlik {
  // ⚠️ Güncelleme adresi çalışma anında DEĞİŞTİRİLEMEZ (APK'ya gömülüdür).
  // Ekranda gösterilmesinin sebebi tam da bu: API adresi tabletten
  // değiştirilebildiği için ikisi AYRIŞABİLİR ve ayrışma sessizdir —
  // uygulama çalışır ama güncelleme hiç gelmez.
  const sunucu =
    (Constants.expoConfig?.updates?.url as string | undefined) ??
    (Constants.manifest2 as { extra?: { expoClient?: { updates?: { url?: string } } } } | undefined)
      ?.extra?.expoClient?.updates?.url ??
    null;

  return {
    etkin: Updates.isEnabled,
    runtimeVersion: Updates.runtimeVersion,
    paketId: Updates.updateId,
    paketTarihi: Updates.createdAt,
    gomulu: Updates.isEmbeddedLaunch,
    sunucu,
    ortakPaket: ortakPaketKoku(sunucu) !== null,
  };
}

/**
 * Ortak paketin gömülü adresi grup-nötr Worker takma adıdır: `https://<ana makine>/ota/<rv>/manifest` → kök.
 * Eski kanal adresi (`…/<kanal>/mobil/ota/…`) bu biçimde değildir → null.
 */
export function ortakPaketKoku(manifestAdresi: string | null): string | null {
  if (!manifestAdresi) return null;
  const m = /^(https:\/\/[^/]+\/)ota\/[^/]+\/manifest\/?$/.exec(manifestAdresi.trim());
  return m ? m[1] : null;
}

export type OtaKontrolSonuc =
  | { durum: 'kapali' }
  | { durum: 'grupBilinmiyor' }
  | { durum: 'guncel' }
  | { durum: 'indirildi' }
  | { durum: 'hata'; mesaj: string };

/**
 * Elle denetleme: sor → varsa indir. Uygulamayı YENİLEMEZ (onu `guvenliYenile`
 * yapar) — indirme ile yenileme ayrı adımlar, çünkü yenileme veri kaybı
 * riski taşıyan tek adımdır ve kendi kapısı vardır.
 */
export async function otaKontrolEtVeIndir(): Promise<OtaKontrolSonuc> {
  if (!Updates.isEnabled) return { durum: 'kapali' };
  try {
    // Manifest isteği taze indirme belirteciyle (3c); alınamazsa başlıksız — bugünkü davranış.
    // Ortak pakette takma ad belirteçsiz 403'tür: grup bilinmeden denetim yapılmaz.
    const belirtec = await refreshOtaDownloadToken();
    if (!belirtec && otaKimlik().ortakPaket) return { durum: 'grupBilinmiyor' };
    const sonuc = await Updates.checkForUpdateAsync();
    if (!sonuc.isAvailable) return { durum: 'guncel' };
    const indirme = await Updates.fetchUpdateAsync();
    return indirme.isNew ? { durum: 'indirildi' } : { durum: 'guncel' };
  } catch (e) {
    return { durum: 'hata', mesaj: e instanceof Error ? e.message : String(e) };
  }
}

/** Kuyrukta bekleyen istasyon yazımı sayısı (React DIŞINDAN okunabilir). */
export function bekleyenYazimSayisi(): number {
  return queryClient
    .getMutationCache()
    .getAll()
    .filter((m) => {
      if (m.state.status !== 'pending') return false;
      const key = m.options.mutationKey;
      return Array.isArray(key) && key[0] === 'station';
    }).length;
}

/** Kuyruk boşalana kadar bekleme tavanı. */
export const YENILEME_BEKLEME_TAVANI_MS = 20_000;
const YOKLAMA_ARALIGI_MS = 500;

export type YenilemeSonuc = 'yenilendi' | 'ertelendi' | 'kapali';

export interface YenilemeBagimlilik {
  /** Uzaktan güncelleme bu kurulumda etkin mi. */
  etkin: () => boolean;
  /** Gönderilmemiş istasyon kaydı sayısı. */
  bekleyen: () => number;
  /** Uygulamayı yeniden başlat. */
  yenile: () => Promise<void>;
  /** Şu anki zaman (test edilebilirlik). */
  simdi: () => number;
  /** Bekleme (test edilebilirlik). */
  uyu: (ms: number) => Promise<void>;
}

/**
 * Yenileme kararının SAF çekirdeği — bağımlılıklar enjekte edilir.
 *
 * Ayrı durmasının sebebi `flushThenLogout` ile aynı: kritik olan şey SIRA ve
 * KOŞUL, ve bunlar `expo-updates` ile TanStack Query'nin arkasında test
 * edilemez halde kalırsa hiç ölçülmez. Buradaki hata sınıfı sessizdir —
 * "yenileme kuyruk doluyken de yapıldı" ancak sahada kayıp kayıt olarak
 * görünür ve o noktada sebebi artık bulunamaz.
 */
export async function yenilemeAkisi(
  d: YenilemeBagimlilik,
  tavanMs: number = YENILEME_BEKLEME_TAVANI_MS,
  yoklamaMs: number = YOKLAMA_ARALIGI_MS,
): Promise<YenilemeSonuc> {
  if (!d.etkin()) return 'kapali';

  const bitis = d.simdi() + tavanMs;
  while (d.bekleyen() > 0) {
    if (d.simdi() >= bitis) return 'ertelendi';
    await d.uyu(yoklamaMs);
  }

  await d.yenile();
  return 'yenilendi';
}

/**
 * İndirilmiş güncellemeyi UYGULA (uygulamayı yeniden başlatır).
 *
 * ⚠️ TEK KOŞUL — GÖNDERİLMEMİŞ KAYIT YOKKEN. Kullanıcı kararı "indirilir
 * indirilmez yenilensin" oldu; bu kural onun İSTİSNASI değil, veri kaybı
 * önlemesidir: `reloadAsync` JS'i öldürür ve o anda uçuşta olan bir istasyon
 * yazımı (KK1 girişi, tambur kesimi) yarıda kalır. Bekleme TAVANLIDIR —
 * takılı tek kayıt yenilemeyi sonsuza kadar erteleyemez; tavan dolarsa
 * yenileme atlanır ve paket zaten BİR SONRAKİ AÇILIŞTA uygulanır (indirilmiş
 * güncelleme kaybolmaz).
 */
export async function guvenliYenile(
  tavanMs: number = YENILEME_BEKLEME_TAVANI_MS,
): Promise<YenilemeSonuc> {
  return yenilemeAkisi(
    {
      etkin: () => Updates.isEnabled,
      bekleyen: bekleyenYazimSayisi,
      yenile: () => Updates.reloadAsync(),
      simdi: () => Date.now(),
      uyu: (ms) => new Promise((r) => setTimeout(r, ms)),
    },
    tavanMs,
  );
}

/* ------------------------------------------------------------------ *
 * 2) NATIVE GÜNCELLEME — Google Play (K-14)
 * ------------------------------------------------------------------ */

/** Kurulu uygulamanın sürüm adı (sürüm politikası ve sürüm notları bunu okur). */
export function kuruluVersionName(): string {
  return Constants.expoConfig?.version ?? '?';
}

export interface UpdateGroupInfo {
  /** Belirteç yanıtındaki güncelleme grubu (doğrulanmış kiradan); yoksa null. */
  grup: string | null;
  /** Grup alınamadı (lisans etkin değil / sunucuya ulaşılamadı) → OTA denetimi yapılmaz. */
  bilinmiyor: boolean;
}

/** Tabletin güncelleme grubu — kaynak YALNIZ backend'in indirme belirteci yanıtıdır (lisans/kira). */
export async function fetchUpdateGroup(): Promise<UpdateGroupInfo> {
  const izin = await fetchDownloadGrant();
  const grup = izin?.grup ?? null;
  return { grup, bilinmiyor: grup === null };
}
