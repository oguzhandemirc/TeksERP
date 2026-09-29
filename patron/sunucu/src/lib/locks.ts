// Advisory kilit ENVANTERİ — patron bulutu DB'sinin kendi uzayı (backend 80xx ve satıcı 91xx'ten
// bağımsız). Kilit tx'in İLK ifadesidir: kiracı ayarıyla (`set_config`) AYNI SELECT'te alınır
// (`lib/tenant.ts`), bir tx tek kilit alır (sıra sorunu doğmaz). Envanter `patron/sunucu/CLAUDE.md`
// tablosuyla birebir — bekçi `test_patron_kapilari` §1.
export const LOCK_NAMESPACES = {
  /** Tesis başına eşitleme paketi (sözleşme §6.3/2) — `try`: doluysa 409 PAKET_ISLENIYOR. */
  PACKAGE: 9201,
  /** Tesis başına hesap yönetimi: davet · izin · kilit · pasif · sıfırlama (son yönetici kuralı). */
  ACCOUNT_ADMIN: 9202,
  /** (tesis, işlem kimliği) başına: gelen kutusu mesajı · rapor isteği · cihaz kaydı tekrarları sıraya girer. */
  CLIENT_TOKEN: 9203,
} as const;

export type LockName = keyof typeof LOCK_NAMESPACES;

export interface LockSpec {
  readonly name: LockName;
  /** Kilit anahtarı (hashtext ile int4'e iner). */
  readonly key: string;
  /** `try`: beklemeden dener; alınamazsa kapsam `acquired: false` döner. */
  readonly mode?: "wait" | "try";
}
