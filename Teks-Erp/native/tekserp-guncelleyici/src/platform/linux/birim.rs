//! systemd birimi (`GUNCELLEYICI-SAGLAMLIK.md` §4.3, L6): iki katman. **Taban birim** kurulumda (`hizmet-kur`) bir kez
//! yazılır ve DONMUŞTUR — `ExecStart` · `Restart` · onarım satırları (`ExecStartPre`, W1b §4.7 L-B) yalnız orada;
//! güncelleyici onu HİÇ yazmaz. **Ek dosya** (`<ad>.service.d/50-tekserp.conf`) güncelleyicinin gömülü şablonudur,
//! her açılışta hizalanır ve yalnız izin listesindeki anahtarları taşır (`ek_dosya_denetle`, bekçi
//! `test_systemd_ek_izinli`). Saf metin: her hedefte derlenir ve sınanır; G/Ç `hizmet` modülünde.
use std::path::{Path, PathBuf};

/// Asıl ikilinin adı (Linux'ta `.exe` yok): `<kök>/guncelleyici/<IKILI>` ve paketin (sürüm dizininin) kökünde aynı
/// ad (`oci-paket.ts` `OCI_GUNCELLEYICI`).
pub const IKILI: &str = "tekserp-guncelleyici";
/// Varsayılan birim adı (`--ad` verilmezse; ikinci kanal kendi adını alır).
pub const VARSAYILAN_AD: &str = "tekserp-guncelleyici";
/// Birim dosyalarının yeri (yönetici birimleri).
pub const SYSTEMD_DIZINI: &str = "/etc/systemd/system";
/// Güncelleyicinin yönettiği ek dosyanın adı (başka ek dosyalara dokunmaz).
pub const EK_DOSYA_ADI: &str = "50-tekserp.conf";
/// Taban birimin onarım satırının alt komutu (W1b §4.7 L-B). `onar` tek başına W1b öncesi ikililerde `tur` takma adıdır;
/// bayrak, ikiliye "yalnız asıl adı onar, tur KOŞMA" der — bayrağı tanıyan her ikili tur koşmadan çıkar.
pub const ONARIM_KOMUTU: [&str; 2] = ["onar", "--yalniz-asil-ad"];

/// Ek dosyaya girebilen anahtarlar (yalnız `[Service]`). `ExecStart*` · `User` · `Restart*` · `Type` ASLA: taban birimin.
pub const EK_IZINLI_ANAHTARLAR: [&str; 6] =
    ["OOMScoreAdjust", "WatchdogSec", "LimitNOFILE", "ProtectSystem", "ReadWritePaths", "Environment"];
/// `Environment=` ile verilebilecek beyanlı adlar.
pub const EK_ORTAM_ADLARI: [&str; 1] = ["RUST_BACKTRACE"];

/// Güncelleyicinin gömülü ek dosya şablonu (her açılışta diske hizalanır). `WatchdogSec`: gözcü ancak güncelleyicinin
/// kalp atışı eşiği aşıldığında susar (`gozcu_canli`); sustuğunda systemd öldürür, `Restart=always` geri getirir.
pub const EK_DOSYA_SABLONU: &str = "\
# TeksERP güncelleyici — EK DOSYA. Güncelleyici yönetir: her açılışta gömülü şablona hizalar, elle değişiklik
# geri yazılır. Yalnız izin listesindeki anahtarlar girer; ExecStart/User/Restart taban birimdedir.
# Yerel ayar gerekiyorsa ayrı bir ek dosya (ör. 60-yerel.conf) kullanın.
[Service]
WatchdogSec=180
OOMScoreAdjust=-500
";

/// Birim adı geçerli mi (systemd birim adı + Windows hizmet adıyla aynı alfabe).
pub fn ad_gecerli(ad: &str) -> bool {
    tekserp_hizmet::contract::valid_service_name(ad)
}

/// Birime yazılacak yol: mutlak, `..`/boş bileşensiz, yalnız `[A-Za-z0-9/._-]` (systemd tırnak ve `%` belirteci
/// gerektirmesin; fail-closed — başka yol birimi bozmaz, hiç yazılmaz).
pub fn yol_gecerli(p: &Path) -> bool {
    let s = p.to_string_lossy();
    s.starts_with('/')
        && s.len() > 1
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'.' | b'_' | b'-'))
        && s[1..].split('/').all(|c| !c.is_empty() && c != "." && c != "..")
}

pub fn birim_dosyasi(dizin: &Path, ad: &str) -> PathBuf {
    dizin.join(format!("{ad}.service"))
}

pub fn ek_dosya(dizin: &Path, ad: &str) -> PathBuf {
    dizin.join(format!("{ad}.service.d")).join(EK_DOSYA_ADI)
}

/// Asıl ikili `<kök>/guncelleyici/tekserp-guncelleyici`.
pub fn asil_ikili(kok: &Path) -> PathBuf {
    kok.join(tekserp_hizmet::contract::path::UPDATER).join(IKILI)
}

/// Taban birimin metni. DONMUŞ: kurulumdan sonra değişmez — yeni satır yalnız yeni kurulumla gelir. Onarım satırları
/// (`-` öneki: ikili yoksa ya da hata verirse başlatma sürer) önce son bilinen iyiyi (`.lkg`), sonra kurulu sürümün
/// imzalı ikilisini (`current/`) koşar; ikisi de asıl ad sağlamsa hiçbir şey yapmadan çıkar (§4.7 madde 2, 9).
pub fn taban_birim(kok: &Path, veri: &Path, ad: &str) -> Result<String, String> {
    if !ad_gecerli(ad) {
        return Err(format!("birim adı geçersiz: {ad:?}"));
    }
    for (n, p) in [("--kok", kok), ("--veri", veri)] {
        if !yol_gecerli(p) {
            return Err(format!("{n} birime yazılamaz (mutlak, yalnız [A-Za-z0-9/._-]): {}", p.display()));
        }
    }
    // Birim metni `/` ayraçlıdır (hedeften bağımsız; Windows'ta derlenen sahte dünya da aynı metni üretir).
    let (k, v) = (kok.to_string_lossy(), veri.to_string_lossy());
    let asil = format!("{k}/{}/{IKILI}", tekserp_hizmet::contract::path::UPDATER);
    let lkg = format!("{asil}.lkg");
    let current = format!("{k}/{}/{IKILI}", tekserp_hizmet::contract::path::CURRENT);
    let ortak = format!("--kok {k} --veri {v} --ad {ad}");
    let onar = ONARIM_KOMUTU.join(" ");
    Ok(format!(
        "\
# TeksERP güncelleyici — TABAN BİRİM. `tekserp-guncelleyici hizmet-kur` bir kez yazar; güncelleyici DEĞİŞTİRMEZ.
# Ayarlanabilen anahtarlar yalnız {ad}.service.d/{EK_DOSYA_ADI} ek dosyasında (güncelleyici her açılışta hizalar).
[Unit]
Description=TeksERP Güncelleyici ({ad})
After=network-online.target docker.service
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=notify
NotifyAccess=main
ExecStartPre=-{lkg} {onar} {ortak}
ExecStartPre=-{current} {onar} {ortak}
ExecStart={asil} hizmet {ortak}
Restart=always
RestartSec=10
KillMode=mixed

[Install]
WantedBy=multi-user.target
",
    ))
}

/// Ek dosya metninin izin dışı içeriği (boş = uygun). Yalnız `[Service]` bölümü; her satır yorum, boş ya da
/// `Anahtar=Değer` (izin listesinde); satır devamı (`\`) ve `%` belirteci yok; `Environment` yalnız beyanlı adlar.
pub fn ek_dosya_denetle(metin: &str) -> Vec<String> {
    let mut ihlal = Vec::new();
    let mut bolum: Option<String> = None;
    for (i, ham) in metin.lines().enumerate() {
        let n = i + 1;
        let satir = ham.trim();
        if satir.is_empty() || satir.starts_with('#') || satir.starts_with(';') {
            continue;
        }
        if satir.ends_with('\\') {
            ihlal.push(format!("satır {n}: satır devamı yasak"));
            continue;
        }
        if satir.starts_with('[') {
            if satir != "[Service]" {
                ihlal.push(format!("satır {n}: bölüm {satir} izinli değil (yalnız [Service])"));
            }
            bolum = Some(satir.to_string());
            continue;
        }
        if bolum.as_deref() != Some("[Service]") {
            ihlal.push(format!("satır {n}: [Service] dışında anahtar"));
            continue;
        }
        let Some((anahtar, deger)) = satir.split_once('=') else {
            ihlal.push(format!("satır {n}: Anahtar=Değer değil"));
            continue;
        };
        let (anahtar, deger) = (anahtar.trim(), deger.trim());
        if !EK_IZINLI_ANAHTARLAR.contains(&anahtar) {
            ihlal.push(format!("satır {n}: {anahtar} izin listesinde değil"));
            continue;
        }
        if deger.is_empty() {
            ihlal.push(format!("satır {n}: {anahtar} boş (sıfırlama taban birimi değiştirir)"));
        }
        if deger.contains('%') {
            ihlal.push(format!("satır {n}: % belirteci yasak"));
        }
        if anahtar == "Environment" {
            for atama in deger.split_whitespace() {
                let atama = atama.trim_matches('"');
                let ad = atama.split_once('=').map_or(atama, |(a, _)| a);
                if !EK_ORTAM_ADLARI.contains(&ad) {
                    ihlal.push(format!("satır {n}: Environment adı {ad:?} beyanlı değil"));
                }
            }
        }
    }
    ihlal
}

/// Gözcünün (`WatchdogSec`) varsayılan eşiği: durum dosyası yokken üç boş tur (`tick` 300 sn).
pub const GOZCU_VARSAYILAN_ESIK_S: u64 = 900;
/// Gözcünün eşiğe eklediği pay (yazım gecikmesi, saat kayması).
pub const GOZCU_PAY_MS: i64 = 60_000;

/// Gözcü "canlı" der mi: son ilerleme = döngünün kendi damgası (bekleme/indirme sondaları) ile `durum.json`
/// `sonCanlilik`inin büyüğü; eşik `canlilikEsigiSn` (en az varsayılan) + pay. Eşik aşıldıysa gözcü susar ve systemd
/// süreci yeniden başlatır (işlem günlüğü sürdürülür). `durum` = (kalp atışı ms, eşik sn); okunamazsa yalnız döngü.
pub fn gozcu_canli(simdi_ms: i64, dongu_ms: i64, durum: Option<(i64, u64)>) -> bool {
    let (son, esik_s) = match durum {
        Some((kalp, esik)) => (dongu_ms.max(kalp), esik.max(GOZCU_VARSAYILAN_ESIK_S)),
        None => (dongu_ms, GOZCU_VARSAYILAN_ESIK_S),
    };
    let esik_ms = i64::try_from(esik_s).unwrap_or(i64::MAX / 2).saturating_mul(1000).saturating_add(GOZCU_PAY_MS);
    simdi_ms.saturating_sub(son) <= esik_ms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yol_ve_ad_denetimi() {
        assert!(yol_gecerli(Path::new("/opt/tekserp")) && yol_gecerli(Path::new("/var/lib/tekserp-2")));
        for kotu in ["opt/tekserp", "/", "/opt/te kserp", "/opt/%h", "/opt/../etc", "/opt//x", "/opt/x/", "/opt/\"x", "/opt/ş"] {
            assert!(!yol_gecerli(Path::new(kotu)), "{kotu}");
        }
        assert!(taban_birim(Path::new("/opt/te kserp"), Path::new("/var/lib/tekserp"), VARSAYILAN_AD).is_err());
        assert!(taban_birim(Path::new("/opt/tekserp"), Path::new("/var/lib/tekserp"), "a b").is_err());
    }

    #[test]
    fn gozcu_esigi() {
        let m = 1_000_000_000_i64;
        let esik = 900_000 + GOZCU_PAY_MS;
        assert!(gozcu_canli(m + esik, m, None));
        assert!(!gozcu_canli(m + esik + 1, m, None));
        // Uygulama sırasında eşik büyür (durum dosyasının `canlilikEsigiSn`i).
        assert!(gozcu_canli(m + 3_600_000, m, Some((m, 7200))));
        // Kalp atışı döngü damgasından tazeyse o sayılır.
        assert!(gozcu_canli(m + esik + 500, m, Some((m + 1000, 10))));
        // Küçük eşik varsayılanın altına inmez.
        assert!(gozcu_canli(m + 800_000, m, Some((m, 30))));
        // Saat geri giderse (gelecekteki damga) canlı.
        assert!(gozcu_canli(m, m + 5000, None));
    }
}
