//! Güncelleme manifesti (§6.3) — PAKET anahtarıyla imzalı JWS. ⚠ GEÇİCİ biçim: D1 (§1–§3)
//! dondurunca alan adları ve `typ` onunkilerle hizalanır; doğrulama `tekserp_dogrulama::jws` (tek
//! kod). Bu modül yalnız İMZA + BİÇİM denetler; kanal/sürüm/sınıf kararları politika ve motorda.
use crate::trust::TrustAnchor;
use crate::version;
use serde_json::{Map, Value};
use tekserp_dogrulama::{b64, jws};

/// GEÇİCİ belge türü — D1 protokolün `TYP` kayıt defterine ekleyince burası onun aynası olur.
pub const TYP_UPDATE_MANIFEST: &str = "tekserp-guncelleme";
/// Paket tavanı: imzalı boydan büyük akış kesilir; zip açılımı ayrıca sınırlı (`package`).
pub const MAX_PACKAGE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageRef {
    /// Güncelleme sunucusundaki yol (`/<kanal>/backend/…`).
    pub path: String,
    /// sha256, base64url (43 karakter) — protokolün özet biçimi.
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PgTarget {
    pub version: String,
    pub build: String,
    pub package: PackageRef,
    /// Açılmış dizindeki `TEKSERP-ICERIK.sha256` dosyasının sha256'sı (base64url).
    pub content_sha256: String,
    pub icu: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PgBlock {
    /// Ana sürüm (`16`).
    pub line: String,
    /// Harici kipte en az sunucu sürümü.
    pub min: Option<String>,
    pub target: Option<PgTarget>,
    /// `guncellemeSonrasi` içinde `reindex-icu` isteniyor mu.
    pub reindex_icu: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub kid: String,
    pub channel: String,
    pub version: String,
    pub package: PackageRef,
    pub min_source: Option<String>,
    pub migrations: Option<u64>,
    pub pg: Option<PgBlock>,
    pub text: String,
}

fn s<'a>(m: &'a Map<String, Value>, k: &str) -> Option<&'a str> {
    m.get(k).and_then(Value::as_str)
}

fn digest(v: Option<&str>) -> Option<String> {
    let d = v?;
    (d.len() == 43 && b64::decode_exact::<32>(d).is_some()).then(|| d.to_string())
}

fn package_ref(v: Option<&Value>) -> Result<PackageRef, String> {
    let o = v.and_then(Value::as_object).ok_or("paket alanı yok")?;
    let path = s(o, "yol").filter(|p| p.starts_with('/') && p.len() <= 300).ok_or("paket.yol biçimsiz")?.to_string();
    let sha256 = digest(s(o, "sha256")).ok_or("paket.sha256 biçimsiz (base64url sha256)")?;
    let size = o.get("boyut").and_then(Value::as_u64).filter(|n| *n > 0 && *n <= MAX_PACKAGE_BYTES).ok_or("paket.boyut biçimsiz")?;
    Ok(PackageRef { path, sha256, size })
}

fn channel_ok(c: &str) -> bool {
    !c.is_empty() && c.len() <= 40 && c.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') && !c.starts_with('-')
}

fn pg_block(v: Option<&Value>) -> Result<Option<PgBlock>, String> {
    let Some(v) = v.filter(|v| !v.is_null()) else { return Ok(None) };
    let o = v.as_object().ok_or("pg alanı nesne değil")?;
    let line = s(o, "cizgi")
        .filter(|c| !c.is_empty() && c.len() <= 4 && c.bytes().all(|b| b.is_ascii_digit()))
        .ok_or("pg.cizgi biçimsiz")?
        .to_string();
    let min = match o.get("enAz") {
        None | Some(Value::Null) => None,
        Some(Value::String(m)) if m.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())) => Some(m.clone()),
        Some(_) => return Err("pg.enAz biçimsiz".into()),
    };
    let target = match o.get("hedef") {
        None | Some(Value::Null) => None,
        Some(Value::Object(h)) => {
            let version = s(h, "surum")
                .filter(|x| x.split('.').count() == 2 && x.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())))
                .ok_or("pg.hedef.surum biçimsiz")?;
            let build = s(h, "derleme")
                .filter(|x| !x.is_empty() && x.len() <= 4 && x.bytes().all(|b| b.is_ascii_digit()))
                .ok_or("pg.hedef.derleme biçimsiz")?;
            let package = PackageRef {
                path: s(h, "paket").filter(|p| p.starts_with('/') && p.len() <= 300).ok_or("pg.hedef.paket biçimsiz")?.to_string(),
                sha256: digest(s(h, "sha256")).ok_or("pg.hedef.sha256 biçimsiz")?,
                size: h
                    .get("boyut")
                    .and_then(Value::as_u64)
                    .filter(|n| *n > 0 && *n <= MAX_PACKAGE_BYTES)
                    .ok_or("pg.hedef.boyut biçimsiz")?,
            };
            let content_sha256 = digest(s(h, "icerikSha256")).ok_or("pg.hedef.icerikSha256 biçimsiz")?;
            Some(PgTarget {
                version: version.into(),
                build: build.into(),
                package,
                content_sha256,
                icu: s(h, "icuSurum").map(str::to_string),
            })
        }
        Some(_) => return Err("pg.hedef biçimsiz".into()),
    };
    let reindex_icu = o
        .get("guncellemeSonrasi")
        .and_then(Value::as_array)
        .is_some_and(|a| a.iter().any(|x| x.get("tur").and_then(Value::as_str) == Some("reindex-icu")));
    if target.as_ref().is_some_and(|t| !t.version.starts_with(&format!("{line}."))) {
        return Err("pg.hedef çizgi dışında (büyük sürüm otomatik değil)".into());
    }
    Ok(Some(PgBlock { line, min, target, reindex_icu }))
}

/// İmza (gömülü PAKET anahtarlarıyla) + biçim.
pub fn verify(text: &str, anchor: &TrustAnchor) -> Result<Manifest, String> {
    let token = Value::String(text.trim().to_string());
    let find = |kid: &str| if kid.starts_with("paket-") { anchor.package_key(kid) } else { None };
    let parsed =
        jws::verify(&token, TYP_UPDATE_MANIFEST, find).map_err(|f| format!("manifest imzası doğrulanamadı: {} ({})", f.message, f.code))?;
    let p = &parsed.payload;
    if p.get("v").and_then(Value::as_u64) != Some(1) {
        return Err("manifest sürümü desteklenmiyor".into());
    }
    if s(p, "urun") != Some("backend") {
        return Err("manifest backend ürünü değil".into());
    }
    let channel = s(p, "kanal").filter(|c| channel_ok(c)).ok_or("manifest kanalı biçimsiz")?.to_string();
    let version = s(p, "surum").filter(|v| version::parse(v).is_some()).ok_or("manifest sürümü biçimsiz")?.to_string();
    let package = package_ref(p.get("paket"))?;
    let min_source = match p.get("enAzKaynakSurum") {
        None | Some(Value::Null) => None,
        Some(Value::String(m)) if version::parse(m).is_some() => Some(m.clone()),
        Some(_) => return Err("enAzKaynakSurum biçimsiz".into()),
    };
    let migrations = p.get("gocSayisi").and_then(Value::as_u64);
    let pg = pg_block(p.get("pg"))?;
    Ok(Manifest { kid: parsed.header.kid, channel, version, package, min_source, migrations, pg, text: text.trim().to_string() })
}
