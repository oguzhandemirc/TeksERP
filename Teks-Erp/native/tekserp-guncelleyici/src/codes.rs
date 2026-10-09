//! `durum.json` `hataKodu` değerleri (§12) — tel sözleşmesidir, Türkçe ve kararlı. İmza/şema/bağ
//! hatalarında sözleşmenin kendi kodu (`JWS_*` · `BELGE_*` · `SURUM_*` · `PAKET_BAGI` · `PG_BAGI`)
//! olduğu gibi yazılır. Yoklama raporunun `son.kod`u belgeli kümeye eşlenir (`report_code`).
pub const NIYET_BICIMSIZ: &str = "NIYET_BICIMSIZ";
pub const BELIRTEC_YOK: &str = "BELIRTEC_YOK";
pub const KILIT_DOLU: &str = "KILIT_DOLU";
pub const AYAR_BICIMSIZ: &str = "AYAR_BICIMSIZ";
/// `yapilandirma\.env`de güncelleyicinin zorunlu anahtarı yok ya da boş (`settings::REQUIRED_BACKEND_KEYS`).
pub const AYAR_EKSIK: &str = "AYAR_EKSIK";
/// SYSTEM'in çalıştıracağı/güveneceği dizin ya da araç yabancı yazmaya açık (DAGK-3/4) ya da izni ölçülemedi.
pub const IZIN_GUVENSIZ: &str = "IZIN_GUVENSIZ";
/// Uyarı (DAGK-9): kiradaki kanal güncel sürümü güncelleme sunucusunun adayından YENİ — sunucu geride.
pub const SURUM_GERIDE: &str = "SURUM_GERIDE";
pub const KURULU_SURUM_YOK: &str = "KURULU_SURUM_YOK";
pub const KIRA_YOK: &str = "KIRA_YOK";
pub const KIRA_GECERSIZ: &str = "KIRA_GECERSIZ";
pub const INSAN_GEREKIYOR: &str = "INSAN_GEREKIYOR";
/// HATA sonrası onay reddedildi: yalnız başarısız denemenin sürümüne ya da ondan YENİ imzalı adaya verilen
/// yeni onay kilidi açar (`engine.rs` `failed_exit_rule`); durum HATA kalır.
pub const ONAY_REDDEDILDI: &str = "ONAY_REDDEDILDI";
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
/// Bakım çiti (W2) kurulamadı/kaldırılamadı: Windows başlangıç türü yazılamadı ya da Linux yeniden başlatma politikası
/// durdurulan konteyneri açılışta başlatıyor (`always`).
pub const CIT_HATASI: &str = "CIT_HATASI";
pub const HIZMET_BASLAMADI: &str = "HIZMET_BASLAMADI";
pub const YEDEK_HATASI: &str = "YEDEK_HATASI";
pub const GECIS_HATASI: &str = "GECIS_HATASI";
/// Hazırlık/sürüm dizini başka bir süreçte açık (erişim engellendi · paylaşım/kilit ihlali): indirme değil,
/// kilit — kilit kalkınca bir sonraki turda kendiliğinden sürer, paket yeniden indirilmez, ertelenmez.
pub const DOSYA_KILITLI: &str = "DOSYA_KILITLI";
/// Paket şemanın GERİSİNDE (`sema::ahead`, setup ve geçişle TEK kural): veritabanında paketin taşımadığı bitmiş
/// göç var — geri indirme yapılmaz, hiçbir şey değişmeden BEKLİYOR (bu göçleri taşıyan sürüm gelince sürer).
pub const SEMA_ILERIDE: &str = "SEMA_ILERIDE";
/// BİLGİ, sorun DEĞİL (`durum.bilgi`, `hataKodu` değil): şema hizası ölçülemedi (veritabanı ya da paketin göç dizini
/// okunamadı). Güncelleme DURMAZ — göç adımı veritabanını zaten ister, düşerse telafiyle döner; engel acil sürümü de
/// bloklardı. Sessiz de geçilmez: günlüğe ve durum dosyasına kod + nedenle yazılır.
pub const SEMA_OLCULEMEDI: &str = "SEMA_OLCULEMEDI";
/// BİLGİ, sorun DEĞİL (`durum.bilgi`): paket HAZIR ve taşıdığı güncelleyici çalışandan yeni — backend işleminden ÖNCE
/// güncelleyici kendini yeniledi (plan §4.2 madde 1; `DONDUR`da da, AK-3); işlemi yeni ikili yeniden doğrulayıp yürütür.
pub const GUNCELLEYICI_ONCE: &str = "GUNCELLEYICI_ONCE";
/// BİLGİ (`durum.bilgi`): `onar` güncelleyici ikilisini doğrulanmış kaynaktan geri koydu ya da durmuş hizmeti başlattı
/// (W1b, plan §4.7); son 24 saat boyunca görünür kalır. Rapora (`son.kod`) GİRMEZ — deneme sonucu değildir.
pub const ONARILDI: &str = "ONARILDI";
/// `onar` 24 saatte `onarim::MAX_REPAIRS` onarımı aştı: döngü kesildi, ONARILMADI (insan). `durum.json` HATA kodu —
/// güncelleyici çalışmıyor; satıcı `guncelleyici.durum = DURDU` görür.
pub const ONARIM_TAVANI: &str = "ONARIM_TAVANI";
/// Hizmetin ikilisi eksik/bozuk ve doğrulanmış onarım kaynağı yok (`.lkg` · eski · kurulu sürüm · `surumler`).
pub const ONARIM_KAYNAK_YOK: &str = "ONARIM_KAYNAK_YOK";
/// Güncelleyici hizmeti silinmiş ya da yönetici "Devre dışı" yapmış — bilinçli karar, onarılmaz (§4.7 madde 7).
pub const GUNCELLEYICI_KAPALI: &str = "GUNCELLEYICI_KAPALI";
/// Linux: imaj arşivinin kimliği bildirimin `imaj.kimlik`iyle tutmuyor, yüklenen imajın katmanları arşivle tutmuyor ya da
/// başlatılacak etiket güncelleyicinin yüklediği nesne değil (yeniden etiketlenmiş) — kesin, geri çekilir.
pub const IMAJ_KIMLIGI: &str = "IMAJ_KIMLIGI";
/// Linux: `docker load` düştü (daemon geçici olabilir — kesin sayılmaz, sonraki turda yeniden denenir).
pub const IMAJ_YUKLENEMEDI: &str = "IMAJ_YUKLENEMEDI";
/// Linux: paketin compose dosyası çözülemedi ya da güvenlik kuralına uymuyor (`platform::linux::compose`) — kesin.
pub const COMPOSE_HATASI: &str = "COMPOSE_HATASI";
pub const GOC_HATASI: &str = "GOC_HATASI";
pub const GOC_ZAMAN_ASIMI: &str = "GOC_ZAMAN_ASIMI";
pub const SAGLIK_ZAMAN_ASIMI: &str = "SAGLIK_ZAMAN_ASIMI";
pub const SAGLIK_SURUM: &str = "SAGLIK_SURUM";
pub const SAGLIK_DB: &str = "SAGLIK_DB";
pub const SAGLIK_LISANS: &str = "SAGLIK_LISANS";
pub const SAGLIK_LISANS_OLCULEMEDI: &str = "SAGLIK_LISANS_OLCULEMEDI";
/// Yeni sürüm açılışta düştü: konak node'un çıkışını hizmete özgü kodla bildirdi (zaman aşımı beklenmez).
pub const SAGLIK_HIZMET_DUSTU: &str = "SAGLIK_HIZMET_DUSTU";
pub const GERI_YUKLEME_HATASI: &str = "GERI_YUKLEME_HATASI";
pub const GERI_DONUS_SAGLIKSIZ: &str = "GERI_DONUS_SAGLIKSIZ";
pub const KESINTI: &str = "KESINTI";
pub const IC_HATA: &str = "IC_HATA";
/// PAKET anahtarı kökün altında (`tekserp_dogrulama::paket_zinciri`): `pkt-*` imzalı belgede kök imzalı PAKET
/// sertifikası ya da imza zamanı yok.
pub const PAKET_SERTIFIKA_YOK: &str = "PAKET_SERTIFIKA_YOK";
/// PAKET sertifikası imza anında geçerli değildi ya da (yeni paket) bitişinden 180 günden fazla geçti.
pub const PAKET_SERTIFIKA_ZAMAN: &str = "PAKET_SERTIFIKA_ZAMAN";
/// PAKET sertifikası PAKET iptal belgesinde — yeni paket kurulmaz (kurulu paket yalnız uyarı).
pub const PAKET_SERTIFIKA_IPTAL: &str = "PAKET_SERTIFIKA_IPTAL";
/// Kurulumun sınıfı PAKET sertifikasının sınıf kümesinde değil (ya da HAK yok, sınıf bilinmiyor).
pub const PAKET_SERTIFIKA_SINIF: &str = "PAKET_SERTIFIKA_SINIF";

/// Güncelleyicinin kendine özgü hizmet çıkış kodu: yeni ikiliyle yeniden başlatılmak için (§10).
pub const EXIT_SELF_UPDATE: u32 = 20;

/// İç kod → yoklama raporunun BELGELİ sonuç kodu (TS `UPDATE_RESULT_CODES`, sözleşme §3.1 madde 10).
pub fn report_code(internal: &str) -> &'static str {
    match internal {
        INDIRME_HATASI
        | IMAJ_YUKLENEMEDI
        | MANIFEST_INDIRILEMEDI
        | INDIRME_REDDEDILDI
        | BELIRTEC_SURESI_DOLDU
        | BELIRTEC_YOK
        | INDIRME_ERTELENDI => "INDIRME_HATASI",
        c if c.starts_with("JWS_") || c.starts_with("BELGE_") || c.starts_with("SURUM_") || c == MANIFEST_GECERSIZ => "IMZA_GECERSIZ",
        // Zincir: PAKET sertifikası ve onu imzalayan kök (sözleşmenin kendi kodları).
        c if c.starts_with("PAKET_SERTIFIKA_")
            || c.starts_with("SERTIFIKA_")
            || c.starts_with("KOK_")
            || c.starts_with("GUVEN_CAPASI_") =>
        {
            "IMZA_GECERSIZ"
        }
        PAKET_OZETI => "PAKET_OZETI",
        "PAKET_BAGI" | "PG_BAGI" | IMAJ_KIMLIGI => "PAKET_BAGI",
        BUTUNLUK_GECERSIZ | PAKET_YOL => "BUTUNLUK_GECERSIZ",
        DISK_DOLU => "DISK_DOLU",
        GECIS_HATASI | DOSYA_KILITLI => "DOSYA_KILITLI",
        YEDEK_HATASI => "YEDEK_HATASI",
        HIZMET_YOK | HIZMET_DURMADI | CIT_HATASI => "DURDURMA_HATASI",
        c if c.starts_with("PG_") => "PG_GUNCELLEME_HATASI",
        GOC_HATASI | GOC_ZAMAN_ASIMI => "GOC_HATASI",
        HIZMET_BASLAMADI | COMPOSE_HATASI => "BASLATMA_HATASI",
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
            crate::release::code::SURUM_PLATFORM,
            "PG_BAGI",
            IC_HATA,
            KESINTI,
            HIZMET_DURMADI,
            CIT_HATASI,
            GOC_ZAMAN_ASIMI,
        ] {
            assert!(DOCUMENTED.contains(&report_code(c)), "{c} → {}", report_code(c));
        }
        // Sözleşme 5: platform uyuşmazlığı imza/sözleşme reddidir (aday kurulmaz, geri dönüş yok).
        assert_eq!(report_code(crate::release::code::SURUM_PLATFORM), "IMZA_GECERSIZ");
        assert_eq!(report_code(PG_SURUM_UYUSMAZ), "PG_GUNCELLEME_HATASI");
        assert_eq!(report_code(SAGLIK_ZAMAN_ASIMI), "SAGLIK_HATASI");
        assert_eq!(report_code(SAGLIK_HIZMET_DUSTU), "SAGLIK_HATASI");
        assert_eq!(report_code(DOSYA_KILITLI), "DOSYA_KILITLI");
        assert_eq!(report_code(CIT_HATASI), "DURDURMA_HATASI", "plan §3: çit backend'i durdurmanın ön adımı");
        for c in [
            PAKET_SERTIFIKA_YOK,
            PAKET_SERTIFIKA_ZAMAN,
            PAKET_SERTIFIKA_IPTAL,
            PAKET_SERTIFIKA_SINIF,
            "KOK_BILINMIYOR",
            "SERTIFIKA_KULLANIM",
        ] {
            assert_eq!(report_code(c), "IMZA_GECERSIZ", "{c}");
        }
        // W1b: onarım kodları deneme sonucu DEĞİLDİR — `report_code`ta eşlenmez (belgeli kümeye özel kod açılmaz),
        // `onarim.rs` geçmişe (`gecmis.jsonl`) ve işlem günlüğüne yazmaz; satıcı `guncelleyici.durum = DURDU` görür.
        for c in [ONARILDI, ONARIM_TAVANI, ONARIM_KAYNAK_YOK, GUNCELLEYICI_KAPALI] {
            assert!(!DOCUMENTED.contains(&c), "{c} belgeli rapor kodu olmamalı");
            assert_eq!(report_code(c), "BILINMEYEN", "{c} rapora eşlenmemeli");
        }
        // L4c-2: Linux imaj/compose iç kodları belgeli kümeye eşlenir (plan §3 tablosu; yeni rapor kodu açılmaz).
        for (c, want) in [(IMAJ_KIMLIGI, "PAKET_BAGI"), (IMAJ_YUKLENEMEDI, "INDIRME_HATASI"), (COMPOSE_HATASI, "BASLATMA_HATASI")] {
            assert_eq!(report_code(c), want, "{c}");
            assert!(DOCUMENTED.contains(&want));
        }
        let onarim = include_str!("onarim.rs");
        for yasak in ["history_file", "journal_file", "gecmis.jsonl"] {
            assert!(!onarim.contains(yasak), "onarim.rs {yasak}'a dokunuyor — onarım deneme sonucu değil");
        }
        for (ours, proto) in [
            (PAKET_SERTIFIKA_YOK, tekserp_dogrulama::outcome::code::PAKET_SERTIFIKA_YOK),
            (PAKET_SERTIFIKA_ZAMAN, tekserp_dogrulama::outcome::code::PAKET_SERTIFIKA_ZAMAN),
            (PAKET_SERTIFIKA_IPTAL, tekserp_dogrulama::outcome::code::PAKET_SERTIFIKA_IPTAL),
            (PAKET_SERTIFIKA_SINIF, tekserp_dogrulama::outcome::code::PAKET_SERTIFIKA_SINIF),
        ] {
            assert_eq!(ours, proto, "durum kodu sözleşme kodunun aynısı");
        }
    }
}
