// =============================================================================
// entryAttempt — "mantıksal kayıt denemesi" durum makinesi (idempotency anahtarı)
// =============================================================================
// SAHA VAKASI (2026-08-03): fabrikada sunucu restart edildi; ham giriş personeli
// etiket çıkmadığı için "Kaydet ve Etiket Bas"a defalarca bastı. Sunucu ayağa
// kalkınca TEK fiziksel top için N ayrı stok kaydı doğdu.
//
// KÖK NEDEN: `clientToken` `handleSubmit`'in İÇİNDE üretiliyordu → her buton
// basışı sunucuya YENİ BİR KİMLİK olarak gidiyordu. Backend koruması
// (`Roll.clientToken @unique` → P2002 → cached Roll) sağlamdı ama hiç devreye
// giremiyordu. Aynı hata Tambur'da daha önce düzeltilmişti (`TamburScreen`
// `takeCutToken`); KK1 o taramada atlanmıştı.
//
// SÖZLEŞME — token neyin kimliğidir:
//   token = FİZİKSEL TOP'un kimliği, buton basışının değil.
//   • `idle`   → basış yeni bir topu anlatır  → TAZE token
//   • `failed` → basış bilinen bir başarısız denemenin TEKRARIDIR → AYNI token
//
// NEDEN "yapışkan tek ref" DEĞİL (bu modülün varlık sebebi):
// KK1 tek yüksek-hacimli SERİ GİRİŞ ekranıdır. Offline'da operatör 5 topu arka
// arkaya girer ve 5 mutation kuyrukta *paused* bekler. Tek bir sabit ref
// kullanılsaydı 2..5. toplar 1.'nin token'ıyla giderdi → backend hepsini aynı
// topun retry'ı sanıp cached kaydı dönerdi → 4 top SESSİZCE YUTULURDU. Bu,
// önlemeye çalıştığımız kopyanın aynadaki ikizi (eksik stok) ve en az onun kadar
// kötüdür. Bu yüzden token yalnız GERÇEK BİR HATA'dan sonra yapışkan olur:
// offline'da mutation *paused* olur, `onError` TETİKLENMEZ → durum `idle` kalır
// → seri giriş bugünkü davranışını birebir korur.
//
// Durum yalnız `failedToken` tutar; uçuştaki token'ı izlemeye gerek yok —
// TanStack `onError/onSuccess` geri çağrıları `variables`'ı zaten verir.
//
// ⚠️ Aynı anda birden fazla basış `failed` durumundayken AYNI token'ı gönderir;
// bu KASITLIDIR (operatörün "tuşa üst üste basma" refleksi artık zararsız —
// sunucu hepsine tek kaydı döner).
// =============================================================================

import { generateClientUuid } from './barcode';

export interface EntryAttemptState {
  /** Son başarısız denemenin token'ı. null = ortada tekrarlanacak deneme yok. */
  readonly failedToken: string | null;
}

export const IDLE_ATTEMPT: EntryAttemptState = { failedToken: null };

/** Bu ekranda tekrarlanmayı bekleyen bir deneme var mı (CTA "Tekrar Dene"ye döner). */
export function isRetrying(state: EntryAttemptState): boolean {
  return state.failedToken !== null;
}

/**
 * Bu basışta hangi token gitmeli? Durumu DEĞİŞTİRMEZ (saf okuma) — geçişler
 * yalnız sunucu yanıtıyla olur.
 *
 * @param gen test edilebilirlik için enjekte edilebilir üretici.
 */
export function tokenForSubmit(
  state: EntryAttemptState,
  gen: () => string = generateClientUuid,
): string {
  return state.failedToken ?? gen();
}

/**
 * Bu hata SONUCU BELİRSİZ mi bıraktı? Yapışkanlığın tek meşru sebebi budur.
 *
 * • Ağ hatası / zaman aşımı (status yok) → istek sunucuya ULAŞMIŞ ve COMMIT
 *   olmuş OLABİLİR. Saha vakasının tam kalbi: 10 sn'lik timeout "yazılmadı"
 *   demek DEĞİLDİR. Sonraki basış aynı token'la gitmeli.
 * • 5xx → sunucu tx'i kapatmış olabilir; aynı belirsizlik.
 * • Kesin 4xx (400 doğrulama, 403 izin, 404, 409) → hiçbir şey YAZILMADI.
 *   Burada yapışmak zararlıdır: "Ürün silinmiş" hatasında operatör ürünü
 *   değiştiremeden aynı payload sonsuza dek yeniden gönderilirdi (döngü).
 */
export function isAmbiguousFailure(error: unknown): boolean {
  const status = (error as { status?: number } | null | undefined)?.status;
  return status === undefined || status >= 500;
}

/** Deneme kalıcı olarak düştü (stationRetry'ın denemeleri de tükendi). */
export function onAttemptFailed(
  _state: EntryAttemptState,
  token: string,
): EntryAttemptState {
  return { failedToken: token };
}

/**
 * Sunucu onayı geldi. Yalnız BEKLENEN token onaylandıysa durum temizlenir —
 * aksi hâlde (gecikmiş/ilgisiz yanıt) tekrar bekleyen deneme düşürülmez.
 */
export function onAttemptSucceeded(
  state: EntryAttemptState,
  token: string,
): EntryAttemptState {
  return state.failedToken === token ? IDLE_ATTEMPT : state;
}

/**
 * Backend 409 `CLIENT_TOKEN_COLLISION` dedi ve operatör "bu farklı bir top"
 * kararını verdi: önceki deneme aslında COMMIT olmuş demektir, yapışkanlık
 * bırakılır ve sıradaki gönderim taze token alır.
 */
export function onCollisionResolvedAsNew(): EntryAttemptState {
  return IDLE_ATTEMPT;
}
