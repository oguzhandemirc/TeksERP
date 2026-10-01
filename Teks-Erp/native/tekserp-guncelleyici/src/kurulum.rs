//! Kurulum (setup.exe) doğrulayıcısı — ilk kurulumda backend paketi ve PostgreSQL paketi GÜNCELLEYİCİYLE
//! AYNI kodla doğrulanır (sözleşme `docs/design/GUNCELLEYICI.md` §1.5 madde 2 · §1.6; D4 `KENDI-POSTGRESQL.md`
//! §4.3). setup.exe bu ikilinin KENDİ kopyasını taşır (CI'da aynı commit'ten, üretim çapasıyla derlenir):
//! paketin İÇİNDEKİ ikili doğrulayıcı olamaz — doğruladığı paketin parçasıdır.
//!
//!   kurulum-paket --zip <backend zip> --hedef <YOK olan dizin>
//!   kurulum-pg    --kunye <pg.json> --zip <PG zip> --hedef <YOK olan dizin>
//!   kurulum-dizin --dizin <açılmış sürüm dizini>     (onarım: var olan dizini yeniden ölçer, SİLMEZ)
//!
//! Anahtar kümesi gömülü çapanın BÜTÜN PAKET anahtarlarıdır: kurulumda HAK (sınıf) henüz yoktur. Hazırlık
//! anahtarı (`paket-hazirlik*`) çıktıda `hazirlikAnahtari: true` diye söylenir — üretim sınıfı kurulumda
//! backend o paketi zaten GEÇERSİZ sayar; sınıf kararı lisansındır, kurulum yalnız uyarır.
//! Çıktı stdout'a TEK satır JSON. Doğrulama hatasında `{"tamam":false,"kod","mesaj"}` + çıkış 3 ve
//! hedef dizin SİLİNİR (yarım/kurcalı içerik kullanılmasın); kullanım hatası çıkış 2.
use crate::env::{self, Fs, RealFs};
use crate::package::{self, ExtractLimits};
use crate::pgminor;
use crate::release;
use crate::trust::{self, TrustAnchor};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use tekserp_dogrulama::jws;

/// Kurulumun kendi kodları (tel sözleşmesi değil — setup betiği gösterir). Paket/imza/bağ hatalarında
/// güncelleyicinin kodu (`codes::*`, sözleşmenin `JWS_*` · `BELGE_*` · `PG_BAGI`) olduğu gibi döner.
pub mod kod {
    pub const GIRDI: &str = "KURULUM_GIRDI";
    pub const HEDEF_VAR: &str = "KURULUM_HEDEF_VAR";
    pub const PAKET_ACILAMADI: &str = "PAKET_ACILAMADI";
    pub const URUN: &str = "PAKET_URUNU";
}

/// PG künyesi işaretçisinin tavanı (sözleşme §1.2: işaretçi ≤ 64 KB).
const KUNYE_TAVANI: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KurulumHatasi {
    pub kod: &'static str,
    pub mesaj: String,
}

fn hata(kod: &'static str, mesaj: impl Into<String>) -> KurulumHatasi {
    KurulumHatasi { kod, mesaj: mesaj.into() }
}

/// Doğrulama düştüyse açılan içerik kullanılmasın: hedef silinir (yalnız bu çağrının yarattığı dizin).
fn temizle(hedef: &Path, kod: &'static str, mesaj: impl Into<String>) -> KurulumHatasi {
    let _ = std::fs::remove_dir_all(hedef);
    hata(kod, mesaj)
}

/// Hedef YOK olmalı (üzerine açılmaz) ve mutlak olmalı; üst dizini var olmalı.
fn hedef_hazir(hedef: &Path) -> Result<(), KurulumHatasi> {
    if !hedef.is_absolute() {
        return Err(hata(kod::GIRDI, format!("--hedef mutlak yol olmalı: {}", hedef.display())));
    }
    if std::fs::symlink_metadata(hedef).is_ok() {
        return Err(hata(kod::HEDEF_VAR, format!("hedef zaten var (üzerine açılmaz): {}", hedef.display())));
    }
    match hedef.parent() {
        Some(p) if p.is_dir() => Ok(()),
        _ => Err(hata(kod::GIRDI, format!("hedefin üst dizini yok: {}", hedef.display()))),
    }
}

fn sha256_hex(p: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn acma_hatasi(hedef: &Path, mesaj: String) -> KurulumHatasi {
    let kod = if mesaj.starts_with("PAKET_YOL:") { crate::codes::PAKET_YOL } else { kod::PAKET_ACILAMADI };
    temizle(hedef, kod, mesaj)
}

/// Backend paketi: güvenli açma (göreli yol · bağlantı girdisi RED · boy tavanı) → `butunluk.jws` PAKET
/// anahtarıyla + imzalı listedeki HER dosya GEÇERLİ (§1.5 madde 2) → künye ürünü backend.
pub fn backend_paketi(zip: &Path, hedef: &Path, keys: &[(String, String)]) -> Result<Value, KurulumHatasi> {
    hedef_hazir(hedef)?;
    let boy = std::fs::metadata(zip).map_err(|e| hata(kod::GIRDI, format!("paket okunamadı ({}): {e}", zip.display())))?.len();
    if boy == 0 || boy > release::PACKAGE_MAX_BYTES {
        return Err(hata(kod::PAKET_ACILAMADI, format!("paket boyu sınır dışı: {boy} B")));
    }
    let stats = package::extract_real(zip, hedef, &ExtractLimits::default()).map_err(|m| acma_hatasi(hedef, m))?;
    let id = package::verify_dir(hedef, &RealFs, keys).map_err(|e| temizle(hedef, e.code, e.message))?;
    if id.urun != release::UPDATE_PRODUCT {
        return Err(temizle(hedef, kod::URUN, format!("paket ürünü \"{}\" (beklenen {})", id.urun, release::UPDATE_PRODUCT)));
    }
    Ok(json!({
        "tamam": true,
        "tur": "backend",
        "surum": id.surum,
        "paketId": id.package_id,
        "kid": id.kid,
        "hazirlikAnahtari": trust::is_staging_package_kid(&id.kid),
        "musteri": id.musteri,
        "derlemeTarihi": id.built_at,
        "dosya": stats.files,
        "bayt": stats.bytes,
    }))
}

/// Onarım: daha önce açılmış sürüm dizini yeniden ölçülür (`butunluk.jws` + imzalı listedeki her dosya).
/// Dizin kurulu sistemin parçasıdır — hata olsa da SİLİNMEZ; karar çağıranındır (yeniden açma).
pub fn surum_dizini(dizin: &Path, keys: &[(String, String)]) -> Result<Value, KurulumHatasi> {
    if !dizin.is_dir() {
        return Err(hata(kod::GIRDI, format!("sürüm dizini yok: {}", dizin.display())));
    }
    let id = package::verify_dir(dizin, &RealFs, keys).map_err(|e| hata(e.code, e.message))?;
    if id.urun != release::UPDATE_PRODUCT {
        return Err(hata(kod::URUN, format!("paket ürünü \"{}\" (beklenen {})", id.urun, release::UPDATE_PRODUCT)));
    }
    Ok(json!({
        "tamam": true,
        "tur": "dizin",
        "surum": id.surum,
        "paketId": id.package_id,
        "kid": id.kid,
        "hazirlikAnahtari": trust::is_staging_package_kid(&id.kid),
        "musteri": id.musteri,
        "derlemeTarihi": id.built_at,
    }))
}

/// `bin\icuuc<N>.dll` adlarının N'leri (küçük harf; D4 U2: tek ICU, künyenin `icuSurum`u).
fn icu_surumleri(dizin: &Path) -> Vec<String> {
    let mut out: Vec<String> = RealFs
        .list(&dizin.join("bin"))
        .unwrap_or_default()
        .into_iter()
        .filter_map(|n| {
            let l = n.to_ascii_lowercase();
            let rest = l.strip_prefix("icuuc")?.strip_suffix(".dll")?;
            (!rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit())).then(|| rest.to_string())
        })
        .collect();
    out.sort();
    out
}

/// PG paketi: künye (`tekserp-pg`) imzası + şema → zip boyu ve sha256'sı künyeyle birebir → güvenli açma →
/// her dosya içerik manifestosuna, manifesto künyenin `icerikSha256`sına karşı (listede olmayan dosya RED)
/// → `bin\icuuc<N>.dll` tek ve künyenin ICU'su (§1.6, D4 §3.5 · §5 U0–U2).
pub fn pg_paketi(kunye: &Path, zip: &Path, hedef: &Path, keys: &[(String, String)]) -> Result<Value, KurulumHatasi> {
    hedef_hazir(hedef)?;
    let km = std::fs::metadata(kunye).map_err(|e| hata(kod::GIRDI, format!("PG künyesi okunamadı ({}): {e}", kunye.display())))?;
    if km.len() > KUNYE_TAVANI {
        return Err(hata(crate::codes::PG_PAKET, "PG künyesi 64 KB tavanını aşıyor"));
    }
    let text = std::fs::read_to_string(kunye).map_err(|e| hata(kod::GIRDI, format!("PG künyesi okunamadı: {e}")))?;
    let token = Value::String(release::read_release_pointer(&text).map_err(|f| hata(f.code, f.message))?);
    let kid = jws::parse(&token).map(|p| p.header.kid).map_err(|f| hata(f.code, f.message))?;
    let k = release::verify_pg_package_manifest(&token, keys).map_err(|f| hata(f.code, f.message))?.doc;
    let boy = std::fs::metadata(zip).map_err(|e| hata(kod::GIRDI, format!("PG paketi okunamadı ({}): {e}", zip.display())))?.len();
    if boy != k.paket.boyut {
        return Err(hata(crate::codes::PAKET_OZETI, format!("PG paketi {boy} B, künye {} B", k.paket.boyut)));
    }
    let ozet = sha256_hex(zip).map_err(|e| hata(kod::GIRDI, format!("PG paketi okunamadı: {e}")))?;
    if ozet != k.paket.sha256 {
        return Err(hata(crate::codes::PAKET_OZETI, "PG paketinin sha256'sı künyeyle aynı değil"));
    }
    let stats = package::extract_real(zip, hedef, &ExtractLimits::default()).map_err(|m| acma_hatasi(hedef, m))?;
    let ortam = env::real(None, "TeksERP-Kurulum").map_err(|e| temizle(hedef, kod::GIRDI, e))?;
    let n = pgminor::verify_content(&ortam, hedef, &k.content_sha256).map_err(|m| temizle(hedef, crate::codes::PG_PAKET, m))?;
    let icu = icu_surumleri(hedef);
    if icu != [k.icu.clone()] {
        return Err(temizle(hedef, release::code::PG_BAGI, format!("ICU [{}] — künye {} (tek ICU beklenir)", icu.join(", "), k.icu)));
    }
    Ok(json!({
        "tamam": true,
        "tur": "pg",
        "cizgi": k.cizgi,
        "surum": k.surum,
        "derleme": k.derleme,
        "icuSurum": k.icu,
        "kid": kid,
        "hazirlikAnahtari": trust::is_staging_package_kid(&kid),
        "paketAdi": k.paket.ad,
        "dosya": n,
        "acilan": stats.files,
    }))
}

fn bayrak(args: &[String], ad: &str) -> Option<PathBuf> {
    args.iter().position(|a| a == ad).and_then(|i| args.get(i + 1)).map(PathBuf::from)
}

/// CLI girişi: `kurulum-paket` · `kurulum-pg` · `kurulum-dizin`. Dönüş çıkış kodudur (0 tamam · 3 doğrulama · 2 kullanım).
pub fn komut(command: &str, args: &[String]) -> Result<u32, String> {
    let keys = TrustAnchor::for_process()?.package_keys;
    let gerek = |ad: &str| bayrak(args, ad).ok_or_else(|| format!("{command}: {ad} <yol> gerekli"));
    let sonuc = match command {
        "kurulum-paket" => backend_paketi(&gerek("--zip")?, &gerek("--hedef")?, &keys),
        "kurulum-pg" => pg_paketi(&gerek("--kunye")?, &gerek("--zip")?, &gerek("--hedef")?, &keys),
        "kurulum-dizin" => surum_dizini(&gerek("--dizin")?, &keys),
        _ => return Err(format!("bilinmeyen kurulum komutu: {command}")),
    };
    match sonuc {
        Ok(v) => {
            println!("{v}");
            Ok(0)
        }
        Err(e) => {
            println!("{}", json!({ "tamam": false, "kod": e.kod, "mesaj": e.mesaj }));
            Ok(3)
        }
    }
}
