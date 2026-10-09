//! systemd birimi (L6, `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §4.3 + §4.7 L-B): gömülü ek dosya şablonu yalnız izin
//! listesindeki anahtarları taşır (`test_systemd_ek_izinli`; iki sonda — izin dışı anahtar ve beyansız ortam adı
//! gerçek şablona eklenince KIRMIZI) ve DONMUŞ taban birim plandaki satırları taşır (onarım satırları tur koşmaz).
use std::path::Path;
use tekserp_guncelleyici::platform::linux::birim::{self, EK_DOSYA_SABLONU};

#[test]
fn test_systemd_ek_izinli() {
    let ihlal = birim::ek_dosya_denetle(EK_DOSYA_SABLONU);
    assert!(ihlal.is_empty(), "gömülü ek dosya şablonu izin listesini aşıyor: {ihlal:?}");
    assert!(EK_DOSYA_SABLONU.contains("\nWatchdogSec="), "gözcü ek dosyada (sd_notify WATCHDOG=1)");
    // Taban birimin anahtarları ek dosyaya ASLA girmez (izin listesi onları tanımaz).
    for yasak in ["ExecStart", "ExecStartPre", "User", "Restart", "RestartSec", "Type", "KillMode", "NotifyAccess", "StartLimitIntervalSec"]
    {
        assert!(!birim::EK_IZINLI_ANAHTARLAR.contains(&yasak), "{yasak} izin listesinde");
    }
}

/// Sonda 1: gerçek şablona izin dışı anahtar (ExecStart · User · Restart) eklenirse denetim KIRMIZI verir.
#[test]
fn sonda_izin_disi_anahtar_kirmizi() {
    for satir in ["ExecStart=/bin/sh -c id", "ExecStart=", "User=nobody", "Restart=no", "Type=simple", "ExecStartPre=/bin/true"] {
        let metin = format!("{EK_DOSYA_SABLONU}{satir}\n");
        assert!(!birim::ek_dosya_denetle(&metin).is_empty(), "{satir} geçti");
    }
    // Başka bölüm, satır devamı, belirteç ve [Service] dışı anahtar da kırmızı.
    for ek in ["[Unit]\nAfter=x.service\n", "OOMScoreAdjust=-500 \\\n", "LimitNOFILE=%h\n"] {
        assert!(!birim::ek_dosya_denetle(&format!("{EK_DOSYA_SABLONU}{ek}")).is_empty(), "{ek:?} geçti");
    }
    assert!(!birim::ek_dosya_denetle("WatchdogSec=10\n").is_empty(), "bölümsüz anahtar geçti");
}

/// Sonda 2: `Environment=` yalnız beyanlı adları taşır.
#[test]
fn sonda_beyansiz_ortam_kirmizi() {
    assert!(birim::ek_dosya_denetle(&format!("{EK_DOSYA_SABLONU}Environment=RUST_BACKTRACE=1\n")).is_empty());
    for satir in ["Environment=LD_PRELOAD=/tmp/x.so", "Environment=RUST_BACKTRACE=1 PATH=/tmp", "Environment=\"TEKSERP_X=1\""] {
        assert!(!birim::ek_dosya_denetle(&format!("{EK_DOSYA_SABLONU}{satir}\n")).is_empty(), "{satir} geçti");
    }
}

fn taban() -> String {
    birim::taban_birim(Path::new("/opt/tekserp"), Path::new("/var/lib/tekserp"), birim::VARSAYILAN_AD).unwrap()
}

fn anahtarlar(metin: &str, anahtar: &str) -> Vec<String> {
    metin.lines().filter_map(|l| l.strip_prefix(&format!("{anahtar}="))).map(str::to_string).collect()
}

/// Taban birim DONMUŞTUR: kurulumdan sonra değişmez, bu satırlar ilk Linux kurulumundan itibaren sabit (§4.3, §4.7 L-B).
#[test]
fn taban_birim_plandaki_satirlar() {
    let t = taban();
    let ortak = "--kok /opt/tekserp --veri /var/lib/tekserp --ad tekserp-guncelleyici";
    assert_eq!(anahtarlar(&t, "ExecStart"), vec![format!("/opt/tekserp/guncelleyici/tekserp-guncelleyici hizmet {ortak}")]);
    assert_eq!(
        anahtarlar(&t, "ExecStartPre"),
        vec![
            format!("-/opt/tekserp/guncelleyici/tekserp-guncelleyici.lkg onar --yalniz-asil-ad {ortak}"),
            format!("-/opt/tekserp/current/tekserp-guncelleyici onar --yalniz-asil-ad {ortak}"),
        ],
        "onarım satırları: önce son bilinen iyi, sonra kurulu sürümün imzalı ikilisi; `-` öneki (ikili yoksa başlatma sürer)"
    );
    for (k, v) in [
        ("Type", "notify"),
        ("NotifyAccess", "main"),
        ("Restart", "always"),
        ("RestartSec", "10"),
        ("StartLimitIntervalSec", "0"),
        ("KillMode", "mixed"),
        ("WantedBy", "multi-user.target"),
    ] {
        assert_eq!(anahtarlar(&t, k), vec![v.to_string()], "{k}");
    }
    // Ayarlanabilen anahtarlar taban birimde değil ek dosyada.
    for k in birim::EK_IZINLI_ANAHTARLAR {
        assert!(anahtarlar(&t, k).is_empty(), "{k} taban birimde");
    }
    // Onarım satırının `.lkg` adı kendini güncellemenin yan adıyla aynı (selfupdate::sibling).
    #[cfg(unix)]
    assert_eq!(
        tekserp_guncelleyici::selfupdate::sibling(&birim::asil_ikili(Path::new("/opt/tekserp")), "lkg"),
        Path::new("/opt/tekserp/guncelleyici/tekserp-guncelleyici.lkg")
    );
}

/// İkinci kanal kendi adını ve kökünü taşır; birime yazılamayacak yol/ad HİÇ yazılmaz.
#[test]
fn taban_birim_kanal_ve_red() {
    let t = birim::taban_birim(Path::new("/opt/tekserp-hazirlik"), Path::new("/var/lib/tekserp-hazirlik"), "tekserp-guncelleyici-hazirlik")
        .unwrap();
    assert!(t.contains("ExecStart=/opt/tekserp-hazirlik/guncelleyici/tekserp-guncelleyici hizmet --kok /opt/tekserp-hazirlik --veri /var/lib/tekserp-hazirlik --ad tekserp-guncelleyici-hazirlik\n"));
    assert!(birim::taban_birim(Path::new("/opt/x y"), Path::new("/var/lib/t"), "a").is_err());
    assert!(birim::taban_birim(Path::new("/opt/t"), Path::new("relative"), "a").is_err());
    assert!(birim::taban_birim(Path::new("/opt/t"), Path::new("/var/lib/t"), "a;b").is_err());
}
