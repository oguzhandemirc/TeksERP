// Yaygın parola KÖKLERİ (VDS denetimi Y2, 2026-11-01) — yeni paket yok, küçük gömülü liste.
// Karşılaştırma `password-policy.ts#passwordCore` ile: küçük harf, Türkçe harf katlanmış, harf dışı atılmış.
// Yani "Parola2024!" → "parola" kökü → red. Liste kasıtlı kısa: tahmin sözlüklerinin başı + Türkçe yaygınlar.
export const COMMON_PASSWORD_CORES: readonly string[] = [
  "password", "passw", "passwd", "pass", "parola", "sifre", "sifrem", "parolam", "gizli", "gizlisifre",
  "admin", "administrator", "admins", "root", "yonetici", "user", "kullanici", "test", "deneme", "demo",
  "qwerty", "qwert", "qwer", "qwe", "qwertyuiop", "asdf", "asdfgh", "asdfghjkl", "zxcvbn", "zxcvbnm",
  "qaz", "qazwsx", "wsx", "abc", "abcd", "abcde", "abcdef", "abcdefg", "abcdefgh",
  "welcome", "letmein", "iloveyou", "monkey", "dragon", "master", "login", "hello", "sunshine", "princess",
  "football", "baseball", "superman", "batman", "trustno", "shadow", "michael", "charlie", "secret",
  "merhaba", "selam", "seni", "seviyorum", "ask", "askim", "canim", "hayatim", "bebegim",
  "galatasaray", "fenerbahce", "besiktas", "trabzonspor", "cimbom", "fener", "gs", "fb", "bjk", "ts",
  "istanbul", "ankara", "izmir", "bursa", "turkiye", "turkey", "ataturk", "mustafa", "mehmet", "ahmet",
  "ali", "ayse", "fatma", "emine", "hatice", "zeynep", "elif", "murat", "hasan", "huseyin", "ibrahim",
  "tekstil", "fabrika", "uretim", "dokuma", "orme", "kumas", "iplik", "boyahane", "konfeksiyon",
  "tekserp", "teks", "erp", "sirket", "firma", "muhasebe", "satis", "depo", "mudur", "patron",
];

/** Yalnız rakam/simge parolada da reddedilen tam biçimler (kök boş kalır). */
export const COMMON_PASSWORD_DIGIT_PATTERNS: readonly string[] = [
  "1234567890", "0987654321", "1122334455", "1234512345", "1111111111", "0000000000",
  "1q2w3e4r5t", "1q2w3e4r5t6y", "q1w2e3r4t5", "1qaz2wsx3edc", "zaq12wsxcde3",
];
