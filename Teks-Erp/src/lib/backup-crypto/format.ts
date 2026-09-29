// =============================================================================
// Yedek şifreleme — `.tkenc` biçiminin sabitleri ve hata sınıfı (SAF, bağımlılıksız)
// =============================================================================
// Biçim (age kalıbı; yalnız node:crypto — sunucu aracı `dist/tools`a paketsiz derlenir):
//
//   SİHİR (8)  "TKSENC" 0x00 0x01          → dosyanın şifreli yedek olduğunu söyler
//   UZUNLUK(4) başlık JSON bayt sayısı (BE)
//   BAŞLIK     JSON: { surum, parca, olusturma, alicilar:[{ad, parmakIzi, epk, sarili}] }
//   MAC (32)   HMAC-SHA256(HKDF(dosyaAnahtari,"tkenc/baslik-mac"), SİHİR‖UZUNLUK‖BAŞLIK)
//   YUK_TUZU(16)
//   PARÇALAR   AES-256-GCM, düz metin ≤ 64 KiB/parça, her parçanın arkasında 16 bayt etiket;
//              IV = 11 bayt sayaç (BE) ‖ 1 bayt "son parça" bayrağı → kesme/yeniden sıralama
//              da kurcalama gibi yakalanır.
//
// Dosya anahtarı her alıcı için ayrı sarılır: geçici X25519 çifti → ortak sır → HKDF →
// AES-256-GCM ile 32 bayt anahtar (48 bayt sarılı). Aynı dosyayı alıcılardan HERHANGİ biri açar.
// =============================================================================

export const TKENC_MAGIC = Buffer.from([0x54, 0x4b, 0x53, 0x45, 0x4e, 0x43, 0x00, 0x01]);
export const TKENC_VERSION = 1;
/** Şifreli yedeğin dosya uzantısı — düz dökümün adına eklenir (`x.dump` → `x.dump.tkenc`). */
export const ENCRYPTED_SUFFIX = ".tkenc";
export const CHUNK_SIZE = 64 * 1024;
export const TAG_SIZE = 16;
export const PAYLOAD_SALT_SIZE = 16;
export const HEADER_MAC_SIZE = 32;
/** Başlık bu boyutu aşarsa dosya bozuk sayılır — kötü niyetli uzunluk alanı bellek şişirmesin. */
export const MAX_HEADER_BYTES = 1024 * 1024;

export const HKDF_INFO_HEADER_MAC = "tkenc/baslik-mac";
export const HKDF_INFO_PAYLOAD = "tkenc/yuk";
export const HKDF_INFO_WRAP = "tkenc/x25519";

/** Açık anahtar dosyası (`<ad>.tkpub`) ve yerel özel anahtar (`yerel.tkkey`) adları. */
export const PUBLIC_KEY_EXT = ".tkpub";
export const WRAPPED_KEY_EXT = ".tkkey";
export const LOCAL_KEY_NAME = "yerel";
export const LOCAL_KEY_FILE = `${LOCAL_KEY_NAME}${WRAPPED_KEY_EXT}`;

export type BackupCryptoErrorCode =
  | "BICIM" // sihir/başlık okunamıyor
  | "KESIK" // dosya yarım
  | "KURCALANMIS" // etiket/MAC tutmuyor
  | "YANLIS_ANAHTAR" // anahtar bu dosyanın alıcılarından değil
  | "YANLIS_PAROLA" // sarılı anahtarın parolası yanlış
  | "ANAHTAR_BICIMI" // anahtar metni/dosyası okunamıyor
  | "ALICI_YOK"; // şifrelemek için alıcı verilmedi

export class BackupCryptoError extends Error {
  readonly code: BackupCryptoErrorCode;
  constructor(code: BackupCryptoErrorCode, message: string) {
    super(message);
    this.name = "BackupCryptoError";
    this.code = code;
  }
}

export function isBackupCryptoError(e: unknown): e is BackupCryptoError {
  return e instanceof BackupCryptoError;
}

export interface TkencRecipientStanza {
  /** Alıcının etiketi (`yerel`, `musteri`, `etkili`…) — açık anahtar dosyasının adından. */
  ad: string;
  /** SHA-256(açık anahtar) ilk 8 bayt, hex — hangi anahtarın açacağını söyler, sır değildir. */
  parmakIzi: string;
  /** Geçici X25519 açık anahtarı (base64url). */
  epk: string;
  /** Sarılı dosya anahtarı (base64url, 48 bayt). */
  sarili: string;
}

export interface TkencHeader {
  surum: number;
  parca: number;
  olusturma: string;
  alicilar: TkencRecipientStanza[];
}
