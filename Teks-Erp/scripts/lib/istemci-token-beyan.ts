// =============================================================================
// İSTEMCİ TOKEN BEYANI — panel + tablet token üretiminin politika kökleri ve muafları
// =============================================================================
// Okuyucu: `test_istemci_token_uretimi`. Kural: kk1.md "İstemci token'ı" (mantıksal deneme başına bir kez; yalnız
// belirsiz hatada yapışır, kesin 4xx ve başarıda yenilenir). Tek yardımcı: panel `Electron/src/lib/attemptToken.ts`,
// tablet ikizi `mobil/src/offline/attemptToken.ts` (+ `entryAttempt` ve modül yardımcıları). P3 borcu D4b'de kapandı.
// Anahtar biçimi `dosya::birim` (en dıştaki adlı fonksiyon — bileşen, hook ya da modül fonksiyonu).
// =============================================================================

/** Politika kökleri: bu adlar bu dosyalardan dışa açılır; türetilen politika adları bunlardan büyür. */
export const KOK_POLITIKA: Readonly<Record<string, readonly string[]>> = {
  "Electron/src/lib/attemptToken.ts": ["isAmbiguousFailure", "useAttemptToken"],
  "mobil/src/offline/entryAttempt.ts": ["isAmbiguousFailure"],
  "mobil/src/offline/attemptToken.ts": ["useAttemptToken"],
};

/** Muaf sınıfları KAPALI küme — yeni sınıf bekçide ve burada birlikte açılır. */
export const MUAF_SINIFLARI = {
  TOKEN_DEGIL: "üretilen değer idempotency anahtarı değil (cihaz/sekme kimliği)",
  EZILEN_VARSAYILAN: "yük kurucusunun varsayılanı; çağıran politika fonksiyonuyla ezer (`ezen` ölçülür)",
  MUTASYON_DEGISKENI: "kimlik mutate değişkenine gömülür; askıdaki mutasyon aynı değişkenle sürdürülür, her tıklama yeni kayıttır",
} as const;

export interface MuafSatiri {
  sinif: keyof typeof MUAF_SINIFLARI;
  /** Satırın örttüğü üretim biçimi ve adedi — fazlası beyansız, eksiği ölü satırdır. */
  bicim: "DONUS" | "SATIR_ICI" | "SINIFLANAMADI";
  adet: number;
  not: string;
  /** EZILEN_VARSAYILAN: başka bir dosyada kurucuyla aynı birimde çağrılan politika fonksiyonu. */
  ezen?: string;
}

export const ISTEMCI_MUAF: Readonly<Record<string, MuafSatiri>> = {
  "Electron/src/lib/deviceId.ts::genUuid": { sinif: "TOKEN_DEGIL", bicim: "DONUS", adet: 1, not: "cihaz kimliği" },
  "Electron/src/store/tabs.ts::newId": { sinif: "TOKEN_DEGIL", bicim: "DONUS", adet: 1, not: "sekme kimliği" },
  "mobil/src/screens/Modules/FasonKabul/receivePayload.helper.ts::buildReceivePayload": {
    sinif: "EZILEN_VARSAYILAN",
    bicim: "SATIR_ICI",
    adet: 1,
    not: "ekran yükün parmak izinden tokenForReceive ile ezer",
    ezen: "tokenForReceive",
  },
  "mobil/src/screens/Modules/KursunQc/KursunQcScreen.tsx::KursunQcScreen": {
    sinif: "MUTASYON_DEGISKENI",
    bicim: "SINIFLANAMADI",
    adet: 1,
    not: "clientErrorId = RollError.id; aynı metre + tip ikinci eklemeyi ekran durdurur",
  },
};
