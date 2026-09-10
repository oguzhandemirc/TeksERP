// =============================================================================
// BACKEND LOG KANALI — seviye + alan etiketi
// =============================================================================
// Bugüne dek backend'in tek log kanalı çıplak `console` idi (142 çağrı) ve
// `eslint.config.mjs` başlığı `no-console` kuralını bilerek AÇMAMIŞTI: "logger
// kararı ayrı bir iştir". Bu dosya o kararın kendisidir.
//
// ⭐ KARAR NEDEN ŞİMDİ VERİLDİ (ölçüm, 2026-09-06/07): fabrikanın beş haftalık
//    hata log'u (5648 satır) elle ayrıştırıldı. Sonuç netti —
//      · `[etiket]` taşıyan 531 satır saniyeler içinde gruplanabildi
//        (`[offsite]` 505 · `[swagger]` 23 · `[audit]` 3),
//      · etiketsiz ~5100 satır (yığın izleri, pg bağlantı nesnesi dökümleri)
//        ancak elle okunarak sınıflanabildi.
//    Aradaki fark tesadüf değil, bu dosyanın varlık sebebidir.
//
// PAKET EKLENMEDİ (bilinçli): pino/winston bir bağımlılık, bir yapılandırma ve
// bir taşıma katmanı getirirdi. Bu kurulumda log'u pm2 topluyor (`out_file` /
// `error_file`, `time: true` ile satır başına zaman damgası) ve rotasyonu
// `pm2-logrotate` yapıyor. Kütüphanenin çözdüğü iki sorun (taşıma + rotasyon)
// zaten çözülmüş; geriye kalan tek eksik SEVİYE + ETİKET disiplini ve o
// otuz satırlık bir iş. Kütüphane kararı `docs/standart/KUTUPHANELER.md`.
//
// ⚠️ AKIŞ AYRIMI KORUNUR: `hata`/`uyari` → stderr, `bilgi` → stdout. pm2 bu iki
//    akışı AYRI DOSYAYA yazar; birleştirmek `backend-err.log`u işe yaramaz
//    hale getirirdi (bugün orada 5 haftada 383 KB var, out'ta 57 MB).
//
// ⚠️ ZAMAN DAMGASI BURADA BASILMAZ — pm2 `time: true` ile her satırın başına
//    kendisi koyar. İkinci damga her satırı iki kez tarihlerdi.
// =============================================================================

/** `HATA [alan] mesaj` — tek satır, greplenebilir. */
type Seviye = "HATA" | "UYARI" | "BILGI";

function bicimle(seviye: Seviye, alan: string, mesaj: string): string {
  return `${seviye} [${alan}] ${mesaj}`;
}

/** `Error` ise cümlesini, değilse kendisini okunur hâle getirir. */
function metin(ek: unknown): string {
  if (ek === undefined) return "";
  if (ek instanceof Error) return ek.message;
  if (typeof ek === "string") return ek;
  try {
    return JSON.stringify(ek);
  } catch {
    return String(ek);
  }
}

/**
 * Hata. `ek` bir `Error` ise yığın izi ALTINA girintili basılır.
 *
 * ⚠️ Yığın izi BİLEREK etiketsiz satırlara yazılır: etiketli satır ÖNDE ve TEK
 * olsun ki "bu hata kaç kez oldu" sorusu tek `grep -c` ile cevaplanabilsin.
 * Fabrikanın eski log'unda 64 kez tekrarlayan bir hata, tam da bu ayrım
 * olmadığı için ancak elle sayılabildi.
 */
export function hata(alan: string, mesaj: string, ek?: unknown): void {
  const kuyruk = metin(ek);
  console.error(bicimle("HATA", alan, kuyruk ? `${mesaj} — ${kuyruk}` : mesaj));
  if (ek instanceof Error && ek.stack) {
    console.error(ek.stack.split("\n").slice(1).join("\n"));
  }
}

/**
 * Yığın izini ETİKETSİZ, ham olarak stderr'e basar (`hata()`nın alt satırlarıyla
 * AYNI biçim). `Error` elde olmayan yerler için — süreç `warning` olayı gibi.
 *
 * ⚠️ Neden ayrı bir kapı: yığın izini basmak `console`a dokunmayı gerektirir ve
 * `no-console` yalnız BU dosyada kapalıdır. İstisnayı çağıran dosyaya yaymak
 * yerine kanal ADLI bir yol açar; kaçışın nerede kullanıldığı greplenebilir
 * kalır (`satir()` emsali).
 */
export function stackTrace(stack: string): void {
  // İlk satır uyarının kendi metnidir; onu `uyari()`/`hata()` zaten bastı.
  console.error(stack.split("\n").slice(1).join("\n"));
}

/** Uyarı — işlem sürdü ama bir şey eksik/riskli. */
export function uyari(alan: string, mesaj: string, ek?: unknown): void {
  const kuyruk = metin(ek);
  console.warn(bicimle("UYARI", alan, kuyruk ? `${mesaj} — ${kuyruk}` : mesaj));
}

/** Bilgi — açılış, zamanlayıcı, uzlaştırma sonucu gibi normal akış olayları. */
export function bilgi(alan: string, mesaj: string, ek?: unknown): void {
  const kuyruk = metin(ek);
  console.log(bicimle("BILGI", alan, kuyruk ? `${mesaj} — ${kuyruk}` : mesaj));
}

/**
 * Çok satırlı serbest metin (açılış banner'ı gibi) — ETİKET ALMAZ.
 *
 * ⚠️ Neden var: `server.ts`in açılış kutusu insan okuru içindir ve her satırına
 * `BILGI [server]` eklemek kutuyu okunamaz hâle getirir. Bu fonksiyon o dar
 * istisnayı ADIYLA taşır; `no-console` kuralının tek meşru kaçışı budur ve
 * kaçışın nerede kullanıldığı greplenebilir kalır.
 */
export function satir(metinSatiri = ""): void {
  console.log(metinSatiri);
}
