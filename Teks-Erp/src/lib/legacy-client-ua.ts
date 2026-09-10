// =============================================================================
// TeksERP — KÜNYESİZ İSTEMCİ: sürümü User-Agent'tan OKU (yedek yol)
// =============================================================================
// `X-Client-*` künye başlıkları 2026-09-04'te geldi. Ondan ESKİ paneller o
// başlıkları göndermez ve `client-info.middleware` künyesiz isteği hiç deftere
// yazmaz → "Bağlı İstemciler" ekranında GÖRÜNMEZLER.
//
// ⭐ SAHADA ISIRDI (2026-09-07): 192.168.1.56'daki panel 2.5.0'da kalmıştı,
//    rapor menüsünün TAMAMI 404 veriyordu ve bu HAFTALARCA fark edilmedi.
//    Makine listede "sürümü bilinmiyor" olarak DEĞİL, HİÇ görünmüyordu.
//    Görülmesi en gereken kitle, kendini tanıtamayacak kadar eski olanlardır.
//
// ⚠️ SIRALAMA SEKTÖR STANDARDIDIR: açık beyan (başlık) TERCİH EDİLİR, UA
//    yalnız YEDEKTİR (Sentry SDK etiketi ↔ UA, Datadog agent ↔ UA aynı düzen).
//    Başlık varsa buraya hiç gelinmez; ekran da hangi kaynaktan geldiğini
//    SÖYLER (`declared`), çünkü çıkarılmış bir sürümü beyan edilmiş gibi
//    göstermek okuyucuyu yanıltır.
//
// ⚠️ KAPI DEĞİL: UA istemcinin uydurabileceği bir metindir; buradan çıkan
//    hiçbir değer yetki/kapı kararına giremez (bkz. constants/client-info.ts).
// =============================================================================

/**
 * UA'daki `Ad/Sürüm` jetonlarından UYGULAMANINKİNİ ayıklamak için elenecek
 * motor/tarayıcı/kütüphane adları. Uygulama adı MÜŞTERİ MARKASIDIR (paket adı
 * argümandan gelir) ve önceden bilinemez — bu yüzden beyaz liste değil KARA
 * LİSTE kullanılır: "tanımadığım ad = uygulamanın kendisi".
 *
 * ⚠️ `okhttp` BİLEREK BURADA: tablet UA'sı `okhttp/4.12.0` yani KÜTÜPHANE
 * sürümüdür, uygulamanınki değil. Onu uygulama sürümü sanmak sahada "tablet
 * 4.12.0" gibi var olmayan bir sürüm gösterirdi — yanlış bilgi, bilgisizlikten
 * kötüdür. Eski tabletler bu yoldan görünmez kalır; kabul edilen sınırdır
 * (tablet OTA ile güncellenir, panel ise elden kurulum ister).
 */
const ENGINE_TOKENS = new Set([
  "mozilla",
  "applewebkit",
  "khtml",
  "gecko",
  "chrome",
  "chromium",
  "safari",
  "electron",
  "edg",
  "edge",
  "opr",
  "version",
  "mobile",
  "like",
  "okhttp",
  "curl",
  "wget",
  "postmanruntime",
  "axios",
  "node-fetch",
  "python-requests",
]);

/** `constants/client-info.ts`teki `isPlausibleVersion` ile AYNI kabul kalıbı. */
const VERSION_TOKEN_RE = /^[0-9][0-9A-Za-z.+-]{0,31}$/;

export interface LegacyClientInfo {
  /** UA'dan çıkarılan uygulama sürümü. */
  version: string;
  /** Yalnız KESİN olduğunda doldurulur; tahmin edilmez. */
  kind: "electron" | null;
}

/**
 * Künyesiz bir isteğin UA'sından uygulama sürümünü çıkarır.
 *
 * Kapsam BİLEREK DAR — yalnız Electron paneli: sorunun tamamı orada (kendini
 * güncelleyemeyen eski kurulum). Tarayıcı her açılışta sunucudan taze gelir,
 * tablet OTA alır; ikisi de "aylardır eski sürümde" durumuna düşmez.
 *
 * @returns Çıkarılamazsa `null` — uydurulmaz.
 */
export function parseLegacyClientFromUserAgent(
  userAgent: string | undefined,
): LegacyClientInfo | null {
  if (!userAgent || userAgent.length > 512) return null;
  // Hızlı kapı: künyesiz her isteğin (sağlık yoklaması, curl, tablet) jeton
  // ayrıştırmasına girmesini engeller — bu yol istek başına koşar.
  if (!userAgent.includes("Electron/")) return null;

  // Parantezli yorumlar (`(Windows NT 10.0; Win64; x64)`) jeton taşımaz.
  const withoutComments = userAgent.replace(/\([^)]*\)/g, " ");

  for (const token of withoutComments.split(/\s+/)) {
    const slash = token.lastIndexOf("/");
    if (slash <= 0) continue;
    const name = token.slice(0, slash).toLowerCase();
    const version = token.slice(slash + 1);
    if (ENGINE_TOKENS.has(name)) continue;
    if (!VERSION_TOKEN_RE.test(version)) continue;
    return { version, kind: "electron" };
  }
  return null;
}
