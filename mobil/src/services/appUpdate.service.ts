// =============================================================================
// TeksERP Mobil — uygulama güncelleme servisi
// =============================================================================
// İKİ AYRI GÜNCELLEME VARDIR ve karıştırılmamalıdır:
//
//  1) UZAKTAN GÜNCELLEME (OTA) — ekran/kural/düzeltme. Sunucudan JS paketi
//     iner, kurulum YOK, operatör hiçbir şey yapmaz. Değişikliklerin ~%90'ı.
//     Taşıyıcı: `expo-updates` + `Teks-Erp/src/routes/mobile-update.routes.ts`.
//
//  2) KURULUM DOSYASI (APK) — yeni native modül, yeni izin, Expo yükseltmesi.
//     Uzaktan gönderilemez; indirilip Android'in kurulum ekranından geçmesi
//     gerekir. Yılda birkaç kez.
//
// ⚠️ İKİSİNİ AYIRAN ÇİZGİ `runtimeVersion`'dır. Sunucu, tabletin taşıdığı
// runtimeVersion'a uymayan paketi GÖNDERMEZ (fail-closed). Yani (2)'yi
// gerektiren bir değişiklik yanlışlıkla (1) ile gönderilemez — bu, sahadaki
// tüm tabletleri aynı anda açılmaz hale getirebilecek tek senaryodur.
// =============================================================================

import * as Updates from 'expo-updates';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { queryClient } from '../offline/queryClient';

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
  /** Güncelleme kanalının kökü — APK künyesi de buradan okunur. */
  feedTabani: string | null;
}

/** Kullanıcıya gösterilecek kısa paket etiketi: `#a1b2c3d4 · 26.08 14:10`. */
export function paketEtiketi(k: OtaKimlik): string {
  if (!k.etkin) return 'geliştirme';
  if (k.gomulu || !k.paketId) return 'kurulumla gelen';
  const kisa = k.paketId.replace(/-/g, '').slice(0, 8);
  if (!k.paketTarihi) return `#${kisa}`;
  const d = k.paketTarihi;
  const iki = (n: number) => String(n).padStart(2, '0');
  return `#${kisa} · ${iki(d.getDate())}.${iki(d.getMonth() + 1)} ${iki(d.getHours())}:${iki(d.getMinutes())}`;
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
    feedTabani: feedTabaniCoz(sunucu),
  };
}

/**
 * `…/mobil/ota/54.2/manifest` → `…/mobil/`
 *
 * ⚠️ Güncelleme kanalının kökü AYRI BİR AYARDAN OKUNMAZ, gömülü manifest
 * adresinden TÜRETİLİR. Sebep tek kaynak: ikinci bir değişken olsaydı biri
 * güncellenip diğeri unutulabilirdi ve APK künyesi başka bir sunucudan
 * okunurdu. Türetilmiş olduğu için "APK'ya gömülü, tabletten değiştirilemez"
 * özelliğini de miras alır.
 */
export function feedTabaniCoz(manifestAdresi: string | null): string | null {
  if (!manifestAdresi) return null;
  const m = /^(.*\/)ota\/[^/]+\/manifest\/?$/.exec(manifestAdresi.trim());
  return m ? m[1] : null;
}

export type OtaKontrolSonuc =
  | { durum: 'kapali' }
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
 * 2) KURULUM DOSYASI (APK)
 * ------------------------------------------------------------------ */

export interface ApkKunye {
  varMi: boolean;
  versionCode?: number;
  versionName?: string;
  boyut?: number;
  sha256?: string | null;
  zorunlu?: boolean;
  notlar?: string | null;
  indirmeUrl?: string;
}

/** Tablette kurulu APK'nın versionCode'u. */
export function kuruluVersionCode(): number {
  const v = Constants.expoConfig?.android?.versionCode;
  return typeof v === 'number' ? v : 0;
}

export function kuruluVersionName(): string {
  return Constants.expoConfig?.version ?? '?';
}

export interface ApkDurum {
  yeniVarMi: boolean;
  kunye: ApkKunye | null;
  kurulu: number;
}

/**
 * Sunucudaki kurulum dosyası künyesini okur.
 *
 * ⚠️ KARŞILAŞTIRMA `versionCode` İLEDİR, `versionName` ile DEĞİL: Android'in
 * kurulum kapısı da onu kullanır. Ada bakan bir karşılaştırma ("2.9.10" <
 * "2.9.9") sözlüksel sıralamaya düşerdi.
 */
/** Saf karşılaştırma — sunucudaki künye tabletteki kurulumdan yeni mi. */
export function apkYeniMi(kunye: ApkKunye | null, kurulu: number): boolean {
  if (!kunye?.varMi) return false;
  return (kunye.versionCode ?? 0) > kurulu;
}

/** Künye okuma zaman aşımı — internet, LAN'dan yavaştır. */
const KUNYE_TIMEOUT_MS = 15_000;

/**
 * Kurulum dosyası künyesini GÜNCELLEME KANALINDAN okur.
 *
 * ⚠️ `apiClient` KULLANILMAZ: o, fabrika ERP sunucusuna gider ve adresi
 * tabletten değiştirilebilir. Kurulum dosyası ERP'de değil güncelleme
 * kanalında (internet) durur — masaüstü panelindeki düzenin aynısı. Uç zaten
 * kimliksizdir; token/cihaz başlığına ihtiyaç yok.
 */
export async function apkDurumu(): Promise<ApkDurum> {
  const kurulu = kuruluVersionCode();
  const taban = otaKimlik().feedTabani;
  if (!taban) return { kunye: null, kurulu, yeniVarMi: false };

  try {
    const kontrol = new AbortController();
    const zamanlayici = setTimeout(() => kontrol.abort(), KUNYE_TIMEOUT_MS);
    try {
      const yanit = await fetch(`${taban}apk/surum.json`, { signal: kontrol.signal });
      if (!yanit.ok) return { kunye: null, kurulu, yeniVarMi: false };
      const ham = (await yanit.json()) as Partial<ApkKunye>;
      // Statik künyede `varMi` alanı yok — dosyanın VARLIĞI yayının kendisidir.
      const kunye: ApkKunye = { ...ham, varMi: typeof ham.versionCode === 'number' };
      return { kunye, kurulu, yeniVarMi: apkYeniMi(kunye, kurulu) };
    } finally {
      clearTimeout(zamanlayici);
    }
  } catch {
    // Ulaşılamadı → "yeni sürüm yok". Güncelleme kontrolü hiçbir zaman
    // operatörün işini durduran bir hata üretmemeli.
    return { kunye: null, kurulu, yeniVarMi: false };
  }
}

export type ApkKurulumSonuc =
  | { durum: 'basladi' }
  | { durum: 'desteklenmiyor' }
  | { durum: 'hata'; mesaj: string };

/**
 * APK'yı indirir ve Android'in kurulum ekranını açar.
 *
 * ⚠️ SESSİZ KURULUM DEĞİLDİR ve olamaz: uygulamanın kendisi paket kuramaz,
 * yalnız kurulum ekranını AÇAR — son "Yükle" dokunuşu operatördedir. Her
 * tablette bir kez de "bu kaynaktan kuruluma izin ver" onayı gerekir.
 * (Sessiz kurulum ancak cihaz yönetimi/MDM ile mümkündür — ayrı karar.)
 *
 * ⚠️ `content://` ZORUNLU: Android 7'den beri `file://` URI'siyle açılan
 * kurulum `FileUriExposedException` ile ÇÖKER. `getContentUriAsync` yalnız
 * `expo-file-system/legacy` altında var (SDK 54'te yeni API'de yok).
 */
export async function apkIndirVeKur(
  indirmeUrl: string,
  onIlerleme?: (oran: number) => void,
): Promise<ApkKurulumSonuc> {
  if (Platform.OS !== 'android') return { durum: 'desteklenmiyor' };

  const hedef = `${FileSystem.cacheDirectory}tekserp-guncelleme.apk`;
  try {
    // Aynı addaki bayat dosya kurulumu sessizce ESKİ sürüme çevirir.
    await FileSystem.deleteAsync(hedef, { idempotent: true });

    const indirici = FileSystem.createDownloadResumable(
      indirmeUrl,
      hedef,
      {},
      (p) => {
        if (onIlerleme && p.totalBytesExpectedToWrite > 0) {
          onIlerleme(p.totalBytesWritten / p.totalBytesExpectedToWrite);
        }
      },
    );
    const sonuc = await indirici.downloadAsync();
    if (!sonuc?.uri) return { durum: 'hata', mesaj: 'Dosya indirilemedi' };

    const contentUri = await FileSystem.getContentUriAsync(sonuc.uri);
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      type: 'application/vnd.android.package-archive',
      // 1 = FLAG_GRANT_READ_URI_PERMISSION — kurulum servisi dosyayı bu izinle
      // okur; verilmezse kurulum "dosya açılamadı" ile sessizce düşer.
      flags: 1,
    });
    return { durum: 'basladi' };
  } catch (e) {
    return { durum: 'hata', mesaj: e instanceof Error ? e.message : String(e) };
  }
}

/** İndirilen kurulum dosyasını temizler (kurulum sonrası / iptalde). */
export async function apkTemizle(): Promise<void> {
  try {
    await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}tekserp-guncelleme.apk`, {
      idempotent: true,
    });
  } catch {
    /* temizlik best-effort */
  }
}
