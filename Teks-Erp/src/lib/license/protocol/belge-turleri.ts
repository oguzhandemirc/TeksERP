// Protokol sürümü ve belge türü kayıt defteri — `belgeler.ts` yeniden dışa verir; bağımlılıksız (döngü yok).

export const PROTOCOL_VERSION = 1;

/** Belge türleri — aynı anahtarın imzaladığı iki tür birbirinin yerine geçemez. */
export const TYP = {
  HAK: "tekserp-hak",
  KIRA: "tekserp-kira",
  ISTEK: "tekserp-istek",
  INDIRME: "tekserp-indirme",
  /**
   * Panel (Electron) sürüm künyesi — latest.yml'deki imzalı `tekserp` bloğu (PAKET ya da ayrı panel yayın anahtarı).
   * Doğrulayan panelin kendisi (`Electron/electron/guncelleme/panel-kunye.mjs`, bağımlılıksız ayna; kâhin test_panel_imza).
   */
  PANEL: "tekserp-panel",
  /**
   * Tablet APK sürüm künyesi — `apk/surum.json`daki imzalı `tekserp` bloğu (panelle aynı anahtar kararı).
   * Doğrulayan tablet (`mobil/src/services/apkKunye.ts`, saf JS); yayın tarafı `mobil/scripts/lib/apk-kunye.mjs`.
   */
  APK: "tekserp-apk",
  SERTIFIKA: "tekserp-sertifika",
  DURUM: "tekserp-durum",
  /** Paket bütünlük listesi (PAKET anahtarıyla imzalı) — doğrulayan `lib/license/integrity.ts` + native çekirdek. */
  BUTUNLUK: "tekserp-butunluk",
  /** İlk kurulum kabul belgesi (KURULUM anahtarıyla imzalı, Ek-7) — doğrulayan satıcı (`kabul.ts`). */
  KABUL: "tekserp-kabul",
  /** Backend sürüm bildirimi (PAKET anahtarıyla imzalı, Dağıtım v2) — doğrulayan güncelleyici (`guncelleme.ts`). */
  SURUM: "tekserp-surum",
  /** PostgreSQL paketi künyesi (PAKET imzalı, Dağıtım v2 sözleşme sürümü 2) — doğrulayan güncelleyici + kurulum (`guncelleme-pg.ts`). */
  PG: "tekserp-pg",
  /** Sertifika iptal belgesi (yalnız KÖK imzalar, G4 §2.3) — doğrulayan fabrika (`verifyRevocation`). */
  IPTAL: "tekserp-iptal",
  /**
   * PAKET sertifikası iptal belgesi (yalnız KÖK imzalar; `paket-zinciri.ts`). `IPTAL`den AYRI tür: o belgenin satır
   * kullanımı sahadaki doğrulayıcılarda kapalı enumdur, PAKET satırı onları bütün belgeden koparırdı. Adda tire yok: `typ` deseni `^tekserp-[a-z]+$`.
   */
  PAKET_IPTAL: "tekserp-paketiptal",

  /** Canlı lisans yanıtının istek bağı (ALT imzalı, 6.3c) — kirayı isteğin nonce'una bağlar; doğrulayan fabrika. */
  YANIT_BAGI: "tekserp-yanit",
} as const;
