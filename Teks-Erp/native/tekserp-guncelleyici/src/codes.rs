//! `durum.json` `hataKodu` değerleri (§12) — tel sözleşmesidir, Türkçe ve kararlı. İmza/şema/bağ
//! hatalarında sözleşmenin kendi kodu (`JWS_*` · `BELGE_*` · `SURUM_*` · `PAKET_BAGI` · `PG_BAGI`)
//! olduğu gibi yazılır. Yoklama raporunun `son.kod`u belgeli kümeye eşlenir (`report_code`).
pub const NIYET_BICIMSIZ: &str = "NIYET_BICIMSIZ";
pub const BELIRTEC_YOK: &str = "BELIRTEC_YOK";
pub const KILIT_DOLU: &str = "KILIT_DOLU";
pub const AYAR_BICIMSIZ: &str = "AYAR_BICIMSIZ";
pub const KURULU_SURUM_YOK: &str = "KURULU_SURUM_YOK";
pub const KIRA_YOK: &str = "KIRA_YOK";
pub const KIRA_GECERSIZ: &str = "KIRA_GECERSIZ";
pub const INSAN_GEREKIYOR: &str = "INSAN_GEREKIYOR";
pub const PG_BUYUK_SURUM: &str = "PG_BUYUK_SURUM";
pub const PG_PAKET: &str = "PG_PAKET";
pub const PG_DURMADI: &str = "PG_DURMADI";
pub const PG_BASLAMADI: &str = "PG_BASLAMADI";
pub const PG_SURUM_UYUSMAZ: &str = "PG_SURUM_UYUSMAZ";
pub const PG_ICU_HATASI: &str = "PG_ICU_HATASI";
pub const PG_YOL_HATASI: &str = "PG_YOL_HATASI";
pub const MANIFEST_INDIRILEMEDI: &str = "MANIFEST_INDIRILEMEDI";
pub const MANIFEST_GECERSIZ: &str = "MANIFEST_GECERSIZ";
pub const BELIRTEC_SURESI_DOLDU: &str = "BELIRTEC_SURESI_DOLDU";
pub const INDIRME_REDDEDILDI: &str = "INDIRME_REDDEDILDI";
pub const INDIRME_HATASI: &str = "INDIRME_HATASI";
pub const INDIRME_ERTELENDI: &str = "INDIRME_ERTELENDI";
pub const PAKET_OZETI: &str = "PAKET_OZETI";
pub const PAKET_YOL: &str = "PAKET_YOL";
pub const BUTUNLUK_GECERSIZ: &str = "BUTUNLUK_GECERSIZ";
pub const DISK_DOLU: &str = "DISK_DOLU";
pub const HIZMET_YOK: &str = "HIZMET_YOK";
pub const HIZMET_DURMADI: &str = "HIZMET_DURMADI";
pub const HIZMET_BASLAMADI: &str = "HIZMET_BASLAMADI";
pub const YEDEK_HATASI: &str = "YEDEK_HATASI";
pub const GECIS_HATASI: &str = "GECIS_HATASI";
pub const GOC_HATASI: &str = "GOC_HATASI";
pub const GOC_ZAMAN_ASIMI: &str = "GOC_ZAMAN_ASIMI";
pub const SAGLIK_ZAMAN_ASIMI: &str = "SAGLIK_ZAMAN_ASIMI";
pub const SAGLIK_SURUM: &str = "SAGLIK_SURUM";
pub const SAGLIK_DB: &str = "SAGLIK_DB";
pub const SAGLIK_LISANS: &str = "SAGLIK_LISANS";
pub const SAGLIK_LISANS_OLCULEMEDI: &str = "SAGLIK_LISANS_OLCULEMEDI";
pub const GERI_YUKLEME_HATASI: &str = "GERI_YUKLEME_HATASI";
pub const GERI_DONUS_SAGLIKSIZ: &str = "GERI_DONUS_SAGLIKSIZ";
pub const KESINTI: &str = "KESINTI";
pub const IC_HATA: &str = "IC_HATA";

/// Güncelleyicinin kendine özgü hizmet çıkış kodu: yeni ikiliyle yeniden başlatılmak için (§10).
pub const EXIT_SELF_UPDATE: u32 = 20;

/// İç kod → yoklama raporunun BELGELİ sonuç kodu (TS `UPDATE_RESULT_CODES`, sözleşme §3.1 madde 10).
pub fn report_code(internal: &str) -> &'static str {
    match internal {
        INDIRME_HATASI | MANIFEST_INDIRILEMEDI | INDIRME_REDDEDILDI | BELIRTEC_SURESI_DOLDU | BELIRTEC_YOK | INDIRME_ERTELENDI => {
            "INDIRME_HATASI"
        }
        c if c.starts_with("JWS_") || c.starts_with("BELGE_") || c.starts_with("SURUM_") || c == MANIFEST_GECERSIZ => "IMZA_GECERSIZ",
        PAKET_OZETI => "PAKET_OZETI",
        "PAKET_BAGI" | "PG_BAGI" => "PAKET_BAGI",
        BUTUNLUK_GECERSIZ | PAKET_YOL => "BUTUNLUK_GECERSIZ",
        DISK_DOLU => "DISK_DOLU",
        GECIS_HATASI => "DOSYA_KILITLI",
        YEDEK_HATASI => "YEDEK_HATASI",
        HIZMET_YOK | HIZMET_DURMADI => "DURDURMA_HATASI",
        c if c.starts_with("PG_") => "PG_GUNCELLEME_HATASI",
        GOC_HATASI | GOC_ZAMAN_ASIMI => "GOC_HATASI",
        HIZMET_BASLAMADI => "BASLATMA_HATASI",
        c if c.starts_with("SAGLIK_") => "SAGLIK_HATASI",
        KESINTI => "KESINTI",
        GERI_YUKLEME_HATASI | GERI_DONUS_SAGLIKSIZ => "GERI_DONUS_HATASI",
        _ => "BILINMEYEN",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_codes_are_documented() {
        // TS `UPDATE_RESULT_CODES` (sözleşme §3.1) — eşlenen her kod bu kümede.
        const DOCUMENTED: [&str; 16] = [
            "INDIRME_HATASI",
            "IMZA_GECERSIZ",
            "PAKET_OZETI",
            "PAKET_BAGI",
            "BUTUNLUK_GECERSIZ",
            "DISK_DOLU",
            "DOSYA_KILITLI",
            "YEDEK_HATASI",
            "DURDURMA_HATASI",
            "PG_GUNCELLEME_HATASI",
            "GOC_HATASI",
            "BASLATMA_HATASI",
            "SAGLIK_HATASI",
            "KESINTI",
            "GERI_DONUS_HATASI",
            "BILINMEYEN",
        ];
        for c in [
            GECIS_HATASI,
            PG_ICU_HATASI,
            SAGLIK_LISANS,
            GERI_YUKLEME_HATASI,
            "JWS_IMZA",
            "SURUM_KANAL",
            "PG_BAGI",
            IC_HATA,
            KESINTI,
            HIZMET_DURMADI,
            GOC_ZAMAN_ASIMI,
        ] {
            assert!(DOCUMENTED.contains(&report_code(c)), "{c} → {}", report_code(c));
        }
        assert_eq!(report_code(PG_SURUM_UYUSMAZ), "PG_GUNCELLEME_HATASI");
        assert_eq!(report_code(SAGLIK_ZAMAN_ASIMI), "SAGLIK_HATASI");
    }
}
