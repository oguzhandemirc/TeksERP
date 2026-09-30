//! Güncelleme sözleşmesi (Dağıtım v2, `docs/design/GUNCELLEYICI.md` §1) — TS `protocol/guncelleme.ts`,
//! `guncelleme-ortak.ts` ve `guncelleme-pg.ts` AYNASI: sürüm bildirimi (`tekserp-surum`), işaretçi
//! (`son.json` · `<sürüm>/surum.json` · `pg/<a.k>-<derleme>/pg.json`), paket bağı, PG künyesi
//! (`tekserp-pg`) ve PG bağı. Aynı sırayla aynı kodu verir; eşlik `test-vektorleri/guncelleme-surum.json`
//! ve `guncelleme-karar.json` ile ölçülür (`tests/sozlesme_vektorleri.rs`). İmza doğrulaması ve şema
//! biçimlendirmesi lisans çekirdeğiyle AYNI kod (`tekserp_dogrulama::{jws, schema}`).
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::sync::OnceLock;
use tekserp_dogrulama::jsonx::{js_number, utf16_len};
use tekserp_dogrulama::outcome::{code as proto, Fail, Outcome};
use tekserp_dogrulama::schema::{self, is_bool, is_int, is_iso, is_nullable, is_str_matching, is_string_len, is_uuid, object, req};
use tekserp_dogrulama::{b64, iso, jws};

/// Belge türleri (TS `TYP.SURUM` · `TYP.PG`).
pub const TYP_SURUM: &str = "tekserp-surum";
pub const TYP_PG: &str = "tekserp-pg";
pub const UPDATE_PLATFORMS: [&str; 1] = ["win32-x64"];
pub const UPDATE_PRODUCT: &str = "backend";
pub const PG_PRODUCT: &str = "postgresql";
pub const PACKAGE_MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const POINTER_MAX_UNITS: usize = 64 * 1024;
/// TS `CLOCK_SKEW_MS`.
pub const CLOCK_SKEW_MS: f64 = 10.0 * 60.0 * 1000.0;

pub const RELEASE_POINTER_FILE: &str = "son.json";
pub const RELEASE_MANIFEST_FILE: &str = "surum.json";
pub const PG_POINTER_FILE: &str = "pg.json";

/// Sözleşmenin kendi hata kodları (TS `PROTOCOL_ERROR_CODES`'a Dağıtım v2 ile eklenenler).
pub mod code {
    pub const SURUM_ISARETCI: &str = "SURUM_ISARETCI";
    pub const SURUM_KANAL: &str = "SURUM_KANAL";
    pub const SURUM_ANAHTAR: &str = "SURUM_ANAHTAR";
    pub const PAKET_BAGI: &str = "PAKET_BAGI";
    pub const PG_BAGI: &str = "PG_BAGI";
}

struct Patterns {
    package_kid: Regex,
    sha256_hex: Regex,
    artifact_name: Regex,
    commit: Regex,
    node_version: Regex,
    pg_version: Regex,
    icu_version: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        package_kid: Regex::new(r"^paket-[a-z0-9-]{1,40}$").expect("paket kid"),
        sha256_hex: Regex::new(r"^[0-9a-f]{64}$").expect("sha256"),
        artifact_name: Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,115}\.zip$").expect("paket adi"),
        commit: Regex::new(r"^[0-9a-f]{7,40}$").expect("commit"),
        node_version: Regex::new(r"^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$").expect("node"),
        pg_version: Regex::new(r"^[0-9]{2}\.[0-9]{1,3}$").expect("pg surumu"),
        icu_version: Regex::new(r"^[0-9]{2,3}$").expect("icu"),
    })
}

// ── Yayın düzeni ─────────────────────────────────────────────────────────────────────────────────

/// `/<kanal>/backend/son.json` — kanalın EN YENİ sürümü.
pub fn release_pointer_path(kanal: &str) -> String {
    format!("/{kanal}/{UPDATE_PRODUCT}/{RELEASE_POINTER_FILE}")
}

/// `/<kanal>/backend/<sürüm>/<dosya>` — sürüm dizini DEĞİŞMEZ.
pub fn release_file_path(kanal: &str, surum: &str, dosya: &str) -> String {
    format!("/{kanal}/{UPDATE_PRODUCT}/{surum}/{dosya}")
}

/// `/<kanal>/backend/pg/<sürüm>-<derleme>/<dosya>`.
pub fn pg_release_file_path(kanal: &str, surum: &str, derleme: u32, dosya: &str) -> String {
    format!("/{kanal}/{UPDATE_PRODUCT}/pg/{surum}-{derleme}/{dosya}")
}

pub fn is_package_kid(kid: &str) -> bool {
    patterns().package_kid.is_match(kid)
}

/// TS `packageKeyLookup`: biçimsiz kid/anahtar sessizce dışarıda.
fn package_key<'a>(keys: &'a [(String, String)]) -> impl Fn(&str) -> Option<[u8; 32]> + 'a {
    move |kid: &str| keys.iter().filter(|(k, _)| is_package_kid(k)).find(|(k, _)| k == kid).and_then(|(_, x)| b64::decode_exact::<32>(x))
}

// ── İşaretçi ─────────────────────────────────────────────────────────────────────────────────────

/// `{v: 1, bildirim: <JWS>}` (KATI, ≤ 64 KB) → imzalı bildirim metni. İşaretçinin kendisine güvenilmez.
pub fn read_release_pointer(text: &str) -> Outcome<String> {
    if utf16_len(text) > POINTER_MAX_UNITS {
        return Err(Fail { code: code::SURUM_ISARETCI, message: "Sürüm işaretçisi çok büyük".into() });
    }
    let raw: Value =
        serde_json::from_str(text).map_err(|_| Fail { code: code::SURUM_ISARETCI, message: "Sürüm işaretçisi JSON değil".into() })?;
    if let Value::Object(m) = &raw {
        if m.get("v").and_then(js_number) != Some(1.0) {
            return Err(Fail { code: proto::BELGE_SURUM, message: "Desteklenmeyen işaretçi sürümü".into() });
        }
    }
    let shaped = object(&raw, &[req("v", &|x| js_number(x) == Some(1.0)), req("bildirim", &schema::is_jws_text)], true)
        .map_err(|_| Fail { code: code::SURUM_ISARETCI, message: "Sürüm işaretçisi biçimsiz".into() })?;
    Ok(shaped.get("bildirim").and_then(Value::as_str).unwrap_or_default().to_string())
}

// ── Ortak ilkeller ───────────────────────────────────────────────────────────────────────────────

fn is_sha256_hex(v: &Value) -> bool {
    is_str_matching(v, &patterns().sha256_hex)
}

fn is_artifact_name(v: &Value) -> bool {
    is_string_len(v, 0, 120) && is_str_matching(v, &patterns().artifact_name)
}

fn is_package_size(v: &Value) -> bool {
    is_int(v, Some(1.0), Some(PACKAGE_MAX_BYTES as f64))
}

fn artifact_fields(extra_uuid: bool) -> impl Fn(&Value) -> Option<Value> {
    move |x: &Value| {
        let mut fields = vec![req("ad", &is_artifact_name), req("boyut", &is_package_size), req("sha256", &is_sha256_hex)];
        if extra_uuid {
            fields.push(req("paketId", &is_uuid));
        }
        object(x, &fields, false).ok().map(Value::Object)
    }
}

fn is_pg_version(v: &Value) -> bool {
    is_str_matching(v, &patterns().pg_version)
}

fn pg_major_of(v: &Value) -> Option<f64> {
    v.as_str()?.split('.').next()?.parse::<f64>().ok()
}

/// `PgTargetSchema` (z.object).
fn pg_target(v: &Value) -> Option<Value> {
    let is_build = |x: &Value| is_int(x, Some(1.0), Some(999.0));
    let is_icu = |x: &Value| is_str_matching(x, &patterns().icu_version);
    let any_object = |x: &Value| x.is_object();
    let artifact = artifact_fields(false);
    schema::object_with_nested(
        v,
        &[
            req("surum", &is_pg_version),
            req("derleme", &is_build),
            req("paket", &any_object),
            req("icerikSha256", &is_sha256_hex),
            req("icuSurum", &is_icu),
        ],
        &[("paket", &artifact)],
    )
    .ok()
    .map(Value::Object)
}

/// TS `comparePgVersions`: ana · küçük · derleme sayısal (derleme bilinmiyorsa 0); biçimsizde `None`.
pub fn compare_pg_versions(a: (&str, Option<u32>), b: (&str, Option<u32>)) -> Option<Ordering> {
    let parse = |s: &str| -> Option<[u64; 2]> {
        if !patterns().pg_version.is_match(s) {
            return None;
        }
        let (x, y) = s.split_once('.')?;
        Some([x.parse().ok()?, y.parse().ok()?])
    };
    let (x, y) = (parse(a.0)?, parse(b.0)?);
    Some([x[0], x[1], u64::from(a.1.unwrap_or(0))].cmp(&[y[0], y[1], u64::from(b.1.unwrap_or(0))]))
}

/// `PgRequirementSchema`: tek ana sürüm (`cizgi`) + en eski küçük (`enAz`) + kendi örnek hedefi.
fn pg_requirement(v: &Value) -> Option<Value> {
    let is_line = |x: &Value| is_int(x, Some(10.0), Some(99.0));
    let target_or_null = |x: &Value| x.is_null() || x.is_object();
    let out = schema::object_with_nested(
        v,
        &[req("cizgi", &is_line), req("enAz", &is_pg_version), req("hedef", &target_or_null)],
        &[("hedef", &pg_target)],
    )
    .ok()?;
    let line = out.get("cizgi").and_then(js_number)?;
    if pg_major_of(out.get("enAz")?) != Some(line) {
        return None;
    }
    if let Some(Value::Object(h)) = out.get("hedef") {
        if pg_major_of(h.get("surum")?) != Some(line) {
            return None;
        }
        let build = h.get("derleme").and_then(js_number).map(|n| n as u32);
        let at_least = compare_pg_versions((h.get("surum")?.as_str()?, build), (out.get("enAz")?.as_str()?, None));
        if !matches!(at_least, Some(Ordering::Greater | Ordering::Equal)) {
            return None;
        }
    }
    Some(Value::Object(out))
}

// ── Sürüm bildirimi (`tekserp-surum`) ───────────────────────────────────────────────────────────

/// `ReleaseManifestSchema` (z.object: tanınmayan anahtar ATILIR) + iki ek kural.
pub fn release_manifest_schema(v: &Value) -> Result<Map<String, Value>, String> {
    let is_v = |x: &Value| js_number(x) == Some(1.0);
    let is_product = |x: &Value| x.as_str() == Some(UPDATE_PRODUCT);
    let is_platform = |x: &Value| matches!(x, Value::String(s) if UPDATE_PLATFORMS.contains(&s.as_str()));
    let is_commit = |x: &Value| is_str_matching(x, &patterns().commit);
    let is_kid = |x: &Value| matches!(x, Value::String(s) if is_package_kid(s));
    let is_min_source = |x: &Value| is_nullable(x, &schema::is_release_version);
    let is_migrations = |x: &Value| is_int(x, Some(0.0), Some(100_000.0));
    let any_object = |x: &Value| x.is_object();
    let package = artifact_fields(true);
    let runtime = |x: &Value| object(x, &[req("node", &|y| is_str_matching(y, &patterns().node_version))], false).ok().map(Value::Object);
    let notes = |x: &Value| object(x, &[req("ozet", &|y| is_string_len(y, 1, 2000))], false).ok().map(Value::Object);
    let out = schema::object_with_nested(
        v,
        &[
            req("v", &is_v),
            req("urun", &is_product),
            req("platform", &is_platform),
            req("kanal", &schema::is_channel_code),
            req("surum", &schema::is_release_version),
            req("commit", &is_commit),
            req("derlemeTarihi", &is_iso),
            req("yayinZamani", &is_iso),
            req("paket", &any_object),
            req("paketImzaKid", &is_kid),
            req("minKaynakSurum", &is_min_source),
            req("gocSayisi", &is_migrations),
            req("pg", &any_object),
            req("runtime", &any_object),
            req("notlar", &any_object),
            req("zorunlu", &is_bool),
        ],
        &[("paket", &package), ("pg", &pg_requirement), ("runtime", &runtime), ("notlar", &notes)],
    )?;
    let s = |k: &str| out.get(k).and_then(Value::as_str).unwrap_or_default();
    if let Some(min) = out.get("minKaynakSurum").and_then(Value::as_str) {
        if crate::version::compare(min, s("surum")).unwrap_or(Ordering::Equal) != Ordering::Less {
            return Err("minKaynakSurum sürümün kendisinden eski olmalı".into());
        }
    }
    if !schema::at_most(iso::date_parse_ms(s("derlemeTarihi")), iso::date_parse_ms(s("yayinZamani")) + CLOCK_SKEW_MS) {
        return Err("Derleme tarihi yayın zamanından sonra olamaz".into());
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Artifact {
    pub ad: String,
    pub boyut: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleasePackage {
    pub ad: String,
    pub boyut: u64,
    pub sha256: String,
    #[serde(rename = "paketId")]
    pub package_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PgTarget {
    pub surum: String,
    pub derleme: u32,
    pub paket: Artifact,
    #[serde(rename = "icerikSha256")]
    pub content_sha256: String,
    #[serde(rename = "icuSurum")]
    pub icu: String,
}

impl PgTarget {
    /// Kurulum dizini ve künye yolu etiketi: `16.15-4`.
    pub fn tag(&self) -> String {
        format!("{}-{}", self.surum, self.derleme)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PgRequirement {
    pub cizgi: u32,
    #[serde(rename = "enAz")]
    pub min: String,
    pub hedef: Option<PgTarget>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub node: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notes {
    pub ozet: String,
}

/// Doğrulanmış sürüm bildirimi (yük; alan adları tel sözleşmesi).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseManifest {
    pub v: u32,
    pub urun: String,
    pub platform: String,
    pub kanal: String,
    pub surum: String,
    pub commit: String,
    #[serde(rename = "derlemeTarihi")]
    pub built_at: String,
    #[serde(rename = "yayinZamani")]
    pub published_at: String,
    pub paket: ReleasePackage,
    #[serde(rename = "paketImzaKid")]
    pub signer_kid: String,
    #[serde(rename = "minKaynakSurum")]
    pub min_source: Option<String>,
    #[serde(rename = "gocSayisi")]
    pub migrations: u64,
    pub pg: PgRequirement,
    pub runtime: RuntimeInfo,
    pub notlar: Notes,
    pub zorunlu: bool,
}

/// Doğrulanmış belge: şemanın ATILMIŞ çıktısı (TS'in döndürdüğüyle aynı JSON) + tipli hâli.
#[derive(Debug, Clone)]
pub struct Checked<T> {
    pub shaped: Map<String, Value>,
    pub doc: T,
}

fn typed<T: serde::de::DeserializeOwned>(shaped: Map<String, Value>) -> Outcome<Checked<T>> {
    match serde_json::from_value::<T>(Value::Object(shaped.clone())) {
        Ok(doc) => Ok(Checked { shaped, doc }),
        Err(e) => Err(Fail { code: proto::BELGE_SEMA, message: format!("Belge tipe dönüşmedi: {e}") }),
    }
}

/// Sıra (TS `verifyReleaseManifest` ile aynı kod): JWS (typ · kid · imza) → şema → imzalayan =
/// `paketImzaKid` → kanal. `keys` ÇAĞIRANIN süzdüğü kümedir (hazırlık anahtarı yalnız TEST/DEMO'da).
pub fn verify_release_manifest(token: &Value, keys: &[(String, String)], kanal: &str) -> Outcome<Checked<ReleaseManifest>> {
    let parsed = jws::verify(token, TYP_SURUM, package_key(keys))?;
    let shaped = schema::decode(release_manifest_schema, &parsed.payload)?;
    if shaped.get("paketImzaKid").and_then(Value::as_str) != Some(parsed.header.kid.as_str()) {
        return Err(Fail { code: code::SURUM_ANAHTAR, message: "Bildirimi imzalayan anahtar paketImzaKid değil".into() });
    }
    let channel = shaped.get("kanal").and_then(Value::as_str).unwrap_or_default().to_string();
    if channel != kanal {
        return Err(Fail { code: code::SURUM_KANAL, message: format!("Bildirim {channel} kanalının, kurulum {kanal} kanalında") });
    }
    typed(shaped)
}

/// Açılan paketin imzalı künyesinden (`butunluk.jws` + imzalayan kid) bağ için gereken alanlar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackageIdentity {
    pub kid: String,
    #[serde(rename = "paketId")]
    pub package_id: String,
    pub urun: String,
    pub surum: String,
    #[serde(rename = "derlemeTarihi")]
    pub built_at: String,
    pub musteri: Option<String>,
}

/// Paket bildirimin paketi mi? Künyenin müşterisi yoksa kanal-dışı paket kabul, varsa bildirimin kanalı.
pub fn check_package_binding(m: &ReleaseManifest, p: &PackageIdentity) -> Outcome<()> {
    let mut off = vec![];
    if p.kid != m.signer_kid {
        off.push("kid");
    }
    if p.package_id != m.paket.package_id {
        off.push("paketId");
    }
    if p.urun != m.urun {
        off.push("urun");
    }
    if p.surum != m.surum {
        off.push("surum");
    }
    // JS `!==` ile aynı: ayrıştırılamayan damga (NaN) hiçbir şeye eşit değildir.
    if iso::date_parse_ms(&p.built_at) != iso::date_parse_ms(&m.built_at) {
        off.push("derlemeTarihi");
    }
    if p.musteri.as_ref().is_some_and(|c| *c != m.kanal) {
        off.push("musteri");
    }
    if off.is_empty() {
        Ok(())
    } else {
        Err(Fail { code: code::PAKET_BAGI, message: format!("Paket künyesi bildirimle bağlanmıyor: {}", off.join(", ")) })
    }
}

// ── PG künyesi (`tekserp-pg`) ────────────────────────────────────────────────────────────────────

/// `PgPackageManifestSchema` — kanaldan bağımsız; sürümün ana sürümü `cizgi` olmalı.
pub fn pg_package_manifest_schema(v: &Value) -> Result<Map<String, Value>, String> {
    let is_v = |x: &Value| js_number(x) == Some(1.0);
    let is_product = |x: &Value| x.as_str() == Some(PG_PRODUCT);
    let is_platform = |x: &Value| matches!(x, Value::String(s) if UPDATE_PLATFORMS.contains(&s.as_str()));
    let is_line = |x: &Value| is_int(x, Some(10.0), Some(99.0));
    let is_build = |x: &Value| is_int(x, Some(1.0), Some(999.0));
    let is_icu = |x: &Value| is_str_matching(x, &patterns().icu_version);
    let any_object = |x: &Value| x.is_object();
    let artifact = artifact_fields(false);
    let out = schema::object_with_nested(
        v,
        &[
            req("v", &is_v),
            req("urun", &is_product),
            req("platform", &is_platform),
            req("cizgi", &is_line),
            req("surum", &is_pg_version),
            req("derleme", &is_build),
            req("paket", &any_object),
            req("icerikSha256", &is_sha256_hex),
            req("icuSurum", &is_icu),
            req("yayinZamani", &is_iso),
        ],
        &[("paket", &artifact)],
    )?;
    if out.get("surum").and_then(pg_major_of) != out.get("cizgi").and_then(js_number) {
        return Err("PG sürümü çizginin ana sürümünde olmalı".into());
    }
    Ok(out)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PgPackageManifest {
    pub v: u32,
    pub urun: String,
    pub platform: String,
    pub cizgi: u32,
    pub surum: String,
    pub derleme: u32,
    pub paket: Artifact,
    #[serde(rename = "icerikSha256")]
    pub content_sha256: String,
    #[serde(rename = "icuSurum")]
    pub icu: String,
    #[serde(rename = "yayinZamani")]
    pub published_at: String,
}

/// Sıra: JWS (typ · kid · imza) → şema. Anahtar kümesi bildirimdekiyle aynı süzgeçten.
pub fn verify_pg_package_manifest(token: &Value, keys: &[(String, String)]) -> Outcome<Checked<PgPackageManifest>> {
    let parsed = jws::verify(token, TYP_PG, package_key(keys))?;
    let shaped = schema::decode(pg_package_manifest_schema, &parsed.payload)?;
    typed(shaped)
}

/// Bildirimin PG hedefi bu künyenin paketi mi (çizgi · sürüm · derleme · paket · içerik · ICU birebir).
pub fn check_pg_binding(req_: &PgRequirement, k: &PgPackageManifest) -> Outcome<()> {
    let Some(h) = &req_.hedef else {
        return Err(Fail { code: code::PG_BAGI, message: "Backend bildirimi PG hedefi taşımıyor".into() });
    };
    let mut off = vec![];
    if k.cizgi != req_.cizgi {
        off.push("cizgi");
    }
    if k.surum != h.surum {
        off.push("surum");
    }
    if k.derleme != h.derleme {
        off.push("derleme");
    }
    if k.paket != h.paket {
        off.push("paket");
    }
    if k.content_sha256 != h.content_sha256 {
        off.push("icerikSha256");
    }
    if k.icu != h.icu {
        off.push("icuSurum");
    }
    if off.is_empty() {
        Ok(())
    } else {
        Err(Fail { code: code::PG_BAGI, message: format!("PG künyesi bildirimin hedefiyle bağlanmıyor: {}", off.join(", ")) })
    }
}

/// `SHOW server_version` çıktısı → `ana.küçük` (`16.15`); PG biçimi değilse `None`.
pub fn pg_version_of(server_version: &str) -> Option<String> {
    let v = server_version.split_whitespace().next()?;
    patterns().pg_version.is_match(v).then(|| v.to_string())
}

pub fn pg_major(surum: &str) -> Option<u32> {
    surum.split('.').next()?.parse().ok()
}
