// =============================================================================
// TÜRKÇE KÖK KATALOĞU — [IL-32]'nin dayanağı (VERİ dosyası, ölçüm aracı DEĞİL)
// =============================================================================
// ⭐ NEDEN İZLENEN BİR DOSYA: bu ayrım 2026-09-13'te bir ölçüm scratch'inde
//    (`scripts/out/`, gitignore'lu) doğdu ve `[IL-32]` ona dayanıyordu. Oturum
//    kapanınca kaynağı kaybolacaktı. ⇒ *Bir kuralın dayanağı, kuraldan kısa
//    ömürlü olamaz.*
//
// ⚠️ BU LİSTE ÖLÇÜMLE DEĞİL, ELLE KURULDU — ve bu bir kusur değil, kararın
//    kendisi: ayrımın ölçütü *"bu kelimenin tam karşılığı olan bir İngilizce
//    terim var mı?"* ve bu soruya bir sözlük cevap veremez. Sonraki kişi bunu
//    bir ölçüm sanmasın: sayılar ölçüldü, SINIFLAR elle ayrıldı.
//
// NASIL ÜRETİLDİ (tekrarlanabilir):
//   1. Üç projenin `src/`indeki bildirim adları toplandı (31.159 benzersiz
//      `dosya::ad`; `scripts/` ve `*.test.*` hariç).
//   2. camelCase parçalara ayrıldı; parça `/usr/share/dict/words` (236k) ya da
//      gövdelenmiş hâli ya da teknik terim listesinde ise ELENDİ.
//   3. Kalan 896 artık parçanın ≥5 kez geçen 211'i ELLE iki sınıfa ayrıldı.
//   Taban: `a2cedff5` · 2026-09-13.
//
// ⚠️ ÜÇ TUZAK — üçü de ölçüldü, üçü de bu dosyayı KULLANAN kapıya aittir:
//   ① LİSTE, ÖLÇÜM ARACININ YARISIDIR. Eleme adımı (2) olmadan liste kendi
//      çakışmalarını sayar: `al`→alert · `ver`→verify · `ad`→admin ·
//      `modul`→module. Elemesiz ilk koşum 1.667 dedi, elemeli koşum 876.
//      ⇒ Eşleşen segmentin KENDİSİ İngilizce olmamalı.
//   ② `EN_CAKISMA` DEVRALINIR, sıfırdan kurulmaz — `test_identifier_language`
//      içinde ÖLÇÜLEREK kuruldu (`partial` ×26, `listener` ×7) ve `parti`
//      orada adıyla duruyor.
//   ③ ÖLÇÜLMÜŞ kök ≠ ÖNGÖRÜLMÜŞ kök. Aşağıda ikisi AYRI durur; öngörülmüş bir
//      kök bir tavanı DOLDURMAZ (bugün sıfır ad eşliyor).
//
// POLİTİKA (1e kararı 2026-09-13, ölçümle): fabrikanın SÖZLÜĞÜ Türkçe KALIR,
// GENEL Türkçe GİRMEZ. Gerekçe: 591 ad aylardır duruyor, kimse borç saymadı ve
// çevrilse kod DAHA AZ okunur olur — bu bir borç değil bir karar.
// =============================================================================

/** Fabrikanın sözlüğü — bugün `src/`te ÖLÇÜLDÜ (591 ad / 25 kök). Türkçe KALIR. */
export const TR_DOMAIN_OLCULEN = [
  "fason", "kartela", "tambur", "cari", "kursun", "ceki", "kk1", "etiket",
  "tebdil", "sevk", "depo", "bordro", "musteri", "stok", "iplik", "cuval",
  "siparis", "devere", "urun", "renk", "kumas", "kalite", "fatura", "sevkiyat",
  "tezgah",
] as const;

/**
 * Fabrikanın sözlüğünden ÖNGÖRÜLEN kökler — bugün `src/`te SIFIR ad eşliyor.
 * ⚠️ Tavanı DOLDURMAZLAR; muafiyet olarak meşru, ölçüm olarak değil.
 */
export const TR_DOMAIN_ONGORULEN = [
  "levent", "havuz", "ipek", "dokuma", "cozgu", "hasil", "refakat", "irsaliye",
  "kasa", "banka", "carikart", "mizan", "kdv",
] as const;

/** Genel Türkçe — çevrilebilir, YENİSİ GİRMEZ (bugün 285 ad / 64 kök). */
export const TR_GENEL = [
  "surum", "notu", "sonuc", "acik", "kapali", "taze", "govde", "hedef",
  "sunucu", "istemci", "durum", "politika", "kapsam", "okuma", "toplam",
  "guncelleme", "kime", "mevcut", "bilgi", "satir", "guc", "dagitim", "kalan",
  "gelen", "isaret", "yayin", "devir", "yenileme", "kontrol", "gecmis",
  "ayar", "kapi", "bekci", "sonda", "damga", "olcum", "yedek", "onarim",
  "bosluk", "kazanc", "ozet", "baslik", "aciklama", "uyari", "hata",
  "gorulen", "kuruldu", "imza", "tavan", "deger", "adet", "liste", "secim",
  "gecerli", "dosya", "klasor", "kaynak", "cikti", "girdi", "sayfa", "rejim",
  "kayit", "zamanlayici", "tarih", "sure",
] as const;

/**
 * ⚠️ BİLEREK DIŞARIDA BIRAKILAN KÖKLER — 2-3 harfli ve İngilizceyle çakışıyorlar.
 * Listeye eklenirlerse eleme adımı olmadan yanlış pozitif patlaması olur; eleme
 * adımıyla bile kazancı düşük. Kayda geçiyor ki biri "unutulmuş" sanıp eklemesin:
 *   al (alert/align) · ver (verify/version) · ad (add/admin) · bul (bulk/bullet)
 *   yol · yaz · sil · say · oku · kur · not · modul (module) · yeni · eski · coz
 */
export const TR_KAPSAM_DISI_GEREKCELI = [
  "al", "ver", "ad", "bul", "yol", "yaz", "sil", "say", "oku", "kur", "not",
  "modul", "yeni", "eski", "coz",
] as const;

/**
 * Eleme adımının İNGİLİZCE tarafı — sözlükte olmayan ama İngilizce sayılan
 * teknik terimler. ⚠️ Bu küme de ölçülerek büyür, tahminle değil.
 */
export const TEKNIK_TERIMLER = [
  "api", "url", "uri", "html", "css", "json", "jwt", "sql", "db", "uuid",
  "cfg", "config", "ctx", "req", "res", "env", "dto", "idx", "fn", "cb",
  "args", "params", "opts", "props", "ref", "src", "nav", "btn", "img", "svg",
  "dom", "ui", "pdf", "csv", "utc", "iso", "px", "pct", "qty", "num", "str",
  "bool", "int", "len", "max", "min", "avg", "sum", "id", "ids", "totp", "otp",
  "pin", "rbac", "cors", "cli", "sdk", "http", "dns", "ssl", "tls", "mdns",
  "rclone", "pm2", "prisma", "zod", "expo", "electron", "vite", "react",
  "redux", "axios", "dayjs", "eslint", "tsc", "pg", "psql", "sha", "hmac",
  "rsa", "aes", "jwk", "jwks", "oauth", "module", "modul", "alloc", "auth",
  "admin",
] as const;
