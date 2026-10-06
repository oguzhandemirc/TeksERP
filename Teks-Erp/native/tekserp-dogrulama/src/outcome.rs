//! Doğrulama sonucu — TS `Result<T>` (`protocol/ortak.ts`) aynası: istisna değil değer.
//! Kodlar protokolün `PROTOCOL_ERROR_CODES` kümesinin alt kümesidir; çekirdeğe özgü
//! kodlar (bütünlük, modül anahtarı, çapa enjeksiyonu) ayrı listede durur ve kâhin
//! bekçisi ikisini de TS tarafıyla karşılaştırır.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fail {
    pub code: &'static str,
    pub message: String,
}

pub type Outcome<T> = Result<T, Fail>;

pub fn fail<T>(code: &'static str, message: impl Into<String>) -> Outcome<T> {
    Err(Fail { code, message: message.into() })
}

/// Protokol kodları — `Teks-Erp/src/lib/license/protocol/ortak.ts` `PROTOCOL_ERROR_CODES`in
/// bu çekirdeğin ürettiği alt kümesi (istek/indirme kodları fabrika tarafında doğrulanmaz).
pub mod code {
    pub const JWS_BICIM: &str = "JWS_BICIM";
    pub const JWS_BASLIK: &str = "JWS_BASLIK";
    pub const JWS_ALG: &str = "JWS_ALG";
    pub const JWS_TYP: &str = "JWS_TYP";
    pub const JWS_KID: &str = "JWS_KID";
    pub const JWS_IMZA: &str = "JWS_IMZA";
    pub const BELGE_SEMA: &str = "BELGE_SEMA";
    pub const BELGE_SURUM: &str = "BELGE_SURUM";
    pub const GUVEN_CAPASI_BOS: &str = "GUVEN_CAPASI_BOS";
    pub const GUVEN_CAPASI_BICIM: &str = "GUVEN_CAPASI_BICIM";
    pub const KOK_BILINMIYOR: &str = "KOK_BILINMIYOR";
    pub const KOK_SINIF_YETKISIZ: &str = "KOK_SINIF_YETKISIZ";
    pub const SERTIFIKA_KULLANIM: &str = "SERTIFIKA_KULLANIM";
    pub const SERTIFIKA_ZAMAN: &str = "SERTIFIKA_ZAMAN";
    /// Lisans v2 (G4): iptal belgesindeki sertifika · ara imzacı kimliği · sınıf ufuk tavanı · ileri tarihli HAK.
    pub const SERTIFIKA_IPTAL: &str = "SERTIFIKA_IPTAL";
    pub const BAYI_KIMLIK: &str = "BAYI_KIMLIK";
    pub const BAYI_TAVAN_MODUL: &str = "BAYI_TAVAN_MODUL";
    pub const BAYI_TAVAN_SINIF: &str = "BAYI_TAVAN_SINIF";
    pub const IMZACI_KIMLIK: &str = "IMZACI_KIMLIK";
    pub const UFUK_TAVANI_ASIMI: &str = "UFUK_TAVANI_ASIMI";
    pub const BELGE_ILERI_TARIHLI: &str = "BELGE_ILERI_TARIHLI";
    pub const KIRA_HAK_UYUSMAZ: &str = "KIRA_HAK_UYUSMAZ";
    pub const KIRA_SINIF_YETKISIZ: &str = "KIRA_SINIF_YETKISIZ";
    /// PAKET anahtarı kökün altında (`paket_zinciri.rs`): sertifika yok · zaman · iptal · sınıf.
    pub const PAKET_SERTIFIKA_YOK: &str = "PAKET_SERTIFIKA_YOK";
    pub const PAKET_SERTIFIKA_ZAMAN: &str = "PAKET_SERTIFIKA_ZAMAN";
    pub const PAKET_SERTIFIKA_IPTAL: &str = "PAKET_SERTIFIKA_IPTAL";
    pub const PAKET_SERTIFIKA_SINIF: &str = "PAKET_SERTIFIKA_SINIF";

    /// Çekirdeğe özgü kodlar (protokol kümesinde YOK; TS aynası `native.ts` `CORE_ERROR_CODES`).
    pub const CAPA_ENJEKSIYONU_KAPALI: &str = "CAPA_ENJEKSIYONU_KAPALI";
    pub const BUTUNLUK_CAPA_BOS: &str = "BUTUNLUK_CAPA_BOS";
    pub const BUTUNLUK_OKUNAMADI: &str = "BUTUNLUK_OKUNAMADI";
    pub const BUTUNLUK_UYUSMAZ: &str = "BUTUNLUK_UYUSMAZ";
    pub const BUTUNLUK_FAZLA: &str = "BUTUNLUK_FAZLA";
    pub const BUTUNLUK_LISTE_BOZUK: &str = "BUTUNLUK_LISTE_BOZUK";
    pub const MODUL_SARMA_BICIM: &str = "MODUL_SARMA_BICIM";
    pub const MODUL_UYUSMAZ: &str = "MODUL_UYUSMAZ";
    pub const MODUL_ANAHTAR_GECERSIZ: &str = "MODUL_ANAHTAR_GECERSIZ";
    pub const MODUL_SARMA_ACILAMADI: &str = "MODUL_SARMA_ACILAMADI";
    /// Faz 2d: anahtar YALNIZ doğrulanmış kiradan açılır — HAK'ta yok · dondurulmuş · kirada hak yok · kimlik uyuşmaz.
    pub const MODUL_HAK_YOK: &str = "MODUL_HAK_YOK";
    pub const MODUL_DONMUS: &str = "MODUL_DONMUS";
    pub const MODUL_ANAHTARI_YOK: &str = "MODUL_ANAHTARI_YOK";
    pub const MODUL_KID_UYUSMAZ: &str = "MODUL_KID_UYUSMAZ";
    /// Yerel koruma (Windows DPAPI): bu platformda yok · işletim sistemi reddetti.
    pub const KORUMA_YOK: &str = "KORUMA_YOK";
    pub const KORUMA_HATASI: &str = "KORUMA_HATASI";

    pub const PROTOCOL: &[&str] = &[
        JWS_BICIM,
        JWS_BASLIK,
        JWS_ALG,
        JWS_TYP,
        JWS_KID,
        JWS_IMZA,
        BELGE_SEMA,
        BELGE_SURUM,
        GUVEN_CAPASI_BOS,
        GUVEN_CAPASI_BICIM,
        KOK_BILINMIYOR,
        KOK_SINIF_YETKISIZ,
        SERTIFIKA_KULLANIM,
        SERTIFIKA_ZAMAN,
        SERTIFIKA_IPTAL,
        BAYI_KIMLIK,
        BAYI_TAVAN_MODUL,
        BAYI_TAVAN_SINIF,
        IMZACI_KIMLIK,
        UFUK_TAVANI_ASIMI,
        BELGE_ILERI_TARIHLI,
        KIRA_HAK_UYUSMAZ,
        KIRA_SINIF_YETKISIZ,
        PAKET_SERTIFIKA_YOK,
        PAKET_SERTIFIKA_ZAMAN,
        PAKET_SERTIFIKA_IPTAL,
        PAKET_SERTIFIKA_SINIF,
    ];

    pub const CORE: &[&str] = &[
        CAPA_ENJEKSIYONU_KAPALI,
        BUTUNLUK_CAPA_BOS,
        BUTUNLUK_OKUNAMADI,
        BUTUNLUK_UYUSMAZ,
        BUTUNLUK_FAZLA,
        BUTUNLUK_LISTE_BOZUK,
        MODUL_SARMA_BICIM,
        MODUL_UYUSMAZ,
        MODUL_ANAHTAR_GECERSIZ,
        MODUL_SARMA_ACILAMADI,
        MODUL_HAK_YOK,
        MODUL_DONMUS,
        MODUL_ANAHTARI_YOK,
        MODUL_KID_UYUSMAZ,
        KORUMA_YOK,
        KORUMA_HATASI,
    ];
}
