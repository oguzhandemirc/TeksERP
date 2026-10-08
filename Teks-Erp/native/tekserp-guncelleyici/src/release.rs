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
use tekserp_dogrulama::iso;
use tekserp_dogrulama::jsonx::deep_equal;
use tekserp_dogrulama::jsonx::{js_number, utf16_len};
use tekserp_dogrulama::outcome::{code as proto, Fail, Outcome};
use tekserp_dogrulama::paket_zinciri::{is_chain_package_kid, verify_package_signed, PackageChainSigner, PackageSigned, PackageTrust};
use tekserp_dogrulama::schema::{self, is_bool, is_int, is_iso, is_nullable, is_str_matching, is_string_len, is_uuid, object, opt, req};

/// Belge türleri (TS `TYP.SURUM` · `TYP.PG`).
pub const TYP_SURUM: &str = "tekserp-surum";
pub const TYP_PG: &str = "tekserp-pg";
/// TS `UPDATE_PLATFORMS` — sözleşme 5 `linux-x64-oci`yi ekledi (ayrı ürün yolu `backend-oci`).
pub const UPDATE_PLATFORMS: [&str; 2] = ["win32-x64", "linux-x64-oci"];
/// TS `PG_PLATFORMS` — PG sahne paketi yalnız Windows'ta.
pub const PG_PLATFORMS: [&str; 1] = ["win32-x64"];
pub const UPDATE_PRODUCT: &str = "backend";
pub const PG_PRODUCT: &str = "postgresql";
pub const PACKAGE_MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const POINTER_MAX_UNITS: usize = 64 * 1024;
/// TS `CLOCK_SKEW_MS`.
pub const CLOCK_SKEW_MS: f64 = 10.0 * 60.0 * 1000.0;

pub const RELEASE_POINTER_FILE: &str = "son.json";
pub const RELEASE_MANIFEST_FILE: &str = "surum.json";
pub const PG_POINTER_FILE: &str = "pg.json";
/// Zincirli (`pkt-*`) işaretçiler eskisinin YANINDA; eski güncelleyici bunları hiç okumaz (eski dosya KATI kalır).
pub use tekserp_dogrulama::paket_zinciri::{CHAINED_PG_POINTER_FILE, CHAINED_RELEASE_MANIFEST_FILE, CHAINED_RELEASE_POINTER_FILE};

/// Sözleşmenin kendi hata kodları (TS `PROTOCOL_ERROR_CODES`'a Dağıtım v2 ile eklenenler).
pub mod code {
    pub const SURUM_ISARETCI: &str = "SURUM_ISARETCI";
    pub const SURUM_KANAL: &str = "SURUM_KANAL";
    pub const SURUM_ANAHTAR: &str = "SURUM_ANAHTAR";
    /// Sözleşme 5: bildirimin platformu okuyanın hedefi değil.
    pub const SURUM_PLATFORM: &str = "SURUM_PLATFORM";
    pub const PAKET_BAGI: &str = "PAKET_BAGI";
    pub const PG_BAGI: &str = "PG_BAGI";
}

/// Bildirimin platformu (TS `UpdatePlatform`). Okuyan güncelleyici kendi hedefini PARAMETRE olarak verir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdatePlatform {
    Win32X64,
    LinuxX64Oci,
}

/// Sözleşme 1–4'ün tek platformu; platform almayan çağrılar bunu kastetmiştir.
pub const WINDOWS_PLATFORM: UpdatePlatform = UpdatePlatform::Win32X64;

impl UpdatePlatform {
    pub const ALL: [UpdatePlatform; 2] = [UpdatePlatform::Win32X64, UpdatePlatform::LinuxX64Oci];

    pub fn as_str(self) -> &'static str {
        match self {
            UpdatePlatform::Win32X64 => "win32-x64",
            UpdatePlatform::LinuxX64Oci => "linux-x64-oci",
        }
    }

    pub fn parse(s: &str) -> Option<UpdatePlatform> {
        UpdatePlatform::ALL.into_iter().find(|p| p.as_str() == s)
    }

    /// TS `RELEASE_PRODUCT_DIRS`: Linux bildirimi ayrı yolda, eski Windows güncelleyicisi onu hiç görmez.
    pub fn product_dir(self) -> &'static str {
        match self {
            UpdatePlatform::Win32X64 => UPDATE_PRODUCT,
            UpdatePlatform::LinuxX64Oci => "backend-oci",
        }
    }

    /// TS `PACKAGE_IDENTITY_PRODUCTS`: paketin imzalı künyesindeki `urun`.
    pub fn package_product(self) -> &'static str {
        match self {
            UpdatePlatform::Win32X64 => UPDATE_PRODUCT,
            UpdatePlatform::LinuxX64Oci => "backend-docker",
        }
    }

    /// TS `RELEASE_PACKAGE_EXTENSIONS`.
    pub fn package_extension(self) -> &'static str {
        match self {
            UpdatePlatform::Win32X64 => ".zip",
            UpdatePlatform::LinuxX64Oci => ".tar",
        }
    }
}

struct Patterns {
    package_kid: Regex,
    signer_kid: Regex,
    sha256_hex: Regex,
    artifact_name: Regex,
    release_package_name: Regex,
    image_id: Regex,
    image_tag: Regex,
    commit: Regex,
    node_version: Regex,
    pg_version: Regex,
    icu_version: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        package_kid: Regex::new(r"^paket-[a-z0-9-]{1,40}$").expect("paket kid"),
        signer_kid: Regex::new(r"^(paket|pkt)-[a-z0-9-]{1,40}$").expect("imzaci kid"),
        sha256_hex: Regex::new(r"^[0-9a-f]{64}$").expect("sha256"),
        artifact_name: Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,115}\.zip$").expect("paket adi"),
        release_package_name: Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,115}\.(zip|tar)$").expect("surum paketi adi"),
        image_id: Regex::new(r"^sha256:[0-9a-f]{64}$").expect("imaj kimligi"),
        image_tag: Regex::new(r"^[a-z0-9][a-z0-9._/-]{0,127}:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$").expect("imaj etiketi"),
        commit: Regex::new(r"^[0-9a-f]{7,40}$").expect("commit"),
        node_version: Regex::new(r"^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$").expect("node"),
        pg_version: Regex::new(r"^[0-9]{2}\.[0-9]{1,3}$").expect("pg surumu"),
        icu_version: Regex::new(r"^[0-9]{2,3}$").expect("icu"),
    })
}

// ── Yayın düzeni ─────────────────────────────────────────────────────────────────────────────────

/// `/<kanal>/backend/son.json` — kanalın EN YENİ sürümü (Windows yolu; Linux `release_pointer_path_on`).
pub fn release_pointer_path(kanal: &str) -> String {
    release_pointer_path_on(WINDOWS_PLATFORM, kanal)
}

/// `/<kanal>/<ürün dizini>/son.json` — ürün dizini platformun (sözleşme 5).
pub fn release_pointer_path_on(platform: UpdatePlatform, kanal: &str) -> String {
    format!("/{kanal}/{}/{RELEASE_POINTER_FILE}", platform.product_dir())
}

/// `/<kanal>/backend/son-zincir.json` — `son.json`ın zincirli ikizi (önce o okunur).
pub fn chained_release_pointer_path(kanal: &str) -> String {
    chained_release_pointer_path_on(WINDOWS_PLATFORM, kanal)
}

pub fn chained_release_pointer_path_on(platform: UpdatePlatform, kanal: &str) -> String {
    format!("/{kanal}/{}/{CHAINED_RELEASE_POINTER_FILE}", platform.product_dir())
}

/// `/<kanal>/backend/<sürüm>/<dosya>` — sürüm dizini DEĞİŞMEZ.
pub fn release_file_path(kanal: &str, surum: &str, dosya: &str) -> String {
    release_file_path_on(WINDOWS_PLATFORM, kanal, surum, dosya)
}

pub fn release_file_path_on(platform: UpdatePlatform, kanal: &str, surum: &str, dosya: &str) -> String {
    format!("/{kanal}/{}/{surum}/{dosya}", platform.product_dir())
}

/// `/<kanal>/backend/pg/<sürüm>-<derleme>/<dosya>`.
pub fn pg_release_file_path(kanal: &str, surum: &str, derleme: u32, dosya: &str) -> String {
    format!("/{kanal}/{UPDATE_PRODUCT}/pg/{surum}-{derleme}/{dosya}")
}

pub fn is_package_kid(kid: &str) -> bool {
    patterns().package_kid.is_match(kid)
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

/// Bildirimin `paket`i: uzantıyı platform kuralı seçer (`release_manifest_schema`).
fn release_package(x: &Value) -> Option<Value> {
    let is_name = |y: &Value| is_string_len(y, 0, 120) && is_str_matching(y, &patterns().release_package_name);
    let fields = [req("ad", &is_name), req("boyut", &is_package_size), req("sha256", &is_sha256_hex), req("paketId", &is_uuid)];
    object(x, &fields, false).ok().map(Value::Object)
}

/// Sözleşme 5 `ReleaseImageSchema` (z.object).
fn release_image(x: &Value) -> Option<Value> {
    let is_id = |y: &Value| is_str_matching(y, &patterns().image_id);
    let is_tag = |y: &Value| is_string_len(y, 0, 200) && is_str_matching(y, &patterns().image_tag);
    object(x, &[req("kimlik", &is_id), req("etiket", &is_tag)], false).ok().map(Value::Object)
}

/// Sözleşme 5 `ReleaseUpdaterSchema` (z.object).
fn release_updater(x: &Value) -> Option<Value> {
    object(x, &[req("surum", &schema::is_release_version), req("sha256", &is_sha256_hex)], false).ok().map(Value::Object)
}

/// PG paketi künyesi (`ArtifactSchema`, yalnız zip).
fn artifact_fields() -> impl Fn(&Value) -> Option<Value> {
    move |x: &Value| {
        let fields = [req("ad", &is_artifact_name), req("boyut", &is_package_size), req("sha256", &is_sha256_hex)];
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
    let artifact = artifact_fields();
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
    let is_kid = |x: &Value| is_str_matching(x, &patterns().signer_kid);
    let is_min_source = |x: &Value| is_nullable(x, &schema::is_release_version);
    let is_migrations = |x: &Value| is_int(x, Some(0.0), Some(100_000.0));
    let any_object = |x: &Value| x.is_object();
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
            opt("imaj", &any_object),
            opt("guncelleyici", &any_object),
        ],
        &[
            ("paket", &release_package),
            ("pg", &pg_requirement),
            ("runtime", &runtime),
            ("notlar", &notes),
            ("imaj", &release_image),
            ("guncelleyici", &release_updater),
        ],
    )?;
    let s = |k: &str| out.get(k).and_then(Value::as_str).unwrap_or_default();
    // Sözleşme 5 platform kuralları — TS'teki refine sırasıyla.
    let platform = UpdatePlatform::parse(s("platform")).ok_or("platform")?;
    let package_name = out.get("paket").and_then(|p| p.get("ad")).and_then(Value::as_str).unwrap_or_default();
    if !package_name.ends_with(platform.package_extension()) {
        return Err("Paket uzantısı platformun değil".into());
    }
    if (platform == UpdatePlatform::LinuxX64Oci) != out.contains_key("imaj") {
        return Err("imaj yalnız linux-x64-oci bildiriminde ve orada zorunlu".into());
    }
    if platform == UpdatePlatform::LinuxX64Oci && !out.get("pg").and_then(|p| p.get("hedef")).is_some_and(Value::is_null) {
        return Err("linux-x64-oci bildirimi PG hedefi taşımaz".into());
    }
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

/// Sözleşme 5 — OCI imajı: `kimlik` imzalı son katmanlı etiketin config özeti.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseImage {
    pub kimlik: String,
    pub etiket: String,
}

/// Sözleşme 5 — paketin taşıdığı güncelleyici ikilisi.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseUpdater {
    pub surum: String,
    pub sha256: String,
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
    /// Sözleşme 5: yalnız `linux-x64-oci`de (orada zorunlu).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imaj: Option<ReleaseImage>,
    /// Sözleşme 5: paketin taşıdığı güncelleyici (isteğe bağlı, iki platformda).
    #[serde(default, rename = "guncelleyici", skip_serializing_if = "Option::is_none")]
    pub updater: Option<ReleaseUpdater>,
    /// `pkt-*` imzalı bildirimde imzalayan PAKET sertifikasının kimliği (yükte değil, doğrulamadan; bellekte kalır).
    #[serde(skip)]
    pub signer_certificate: Option<String>,
}

/// Doğrulanmış belge: şemanın ATILMIŞ çıktısı (TS'in döndürdüğüyle aynı JSON) + tipli hâli.
#[derive(Debug, Clone)]
pub struct Checked<T> {
    pub shaped: Map<String, Value>,
    pub doc: T,
    /// `pkt-*` imzalı belgede imzalayan PAKET sertifikası (iptal işareti dahil); `paket-*`te `None`.
    pub chain: Option<PackageChainSigner>,
    /// İmzalayan kid ve imzalı ham yük (zincir alanları ayıklanmış) — zincir seçimi "aynı belge mi"yi bununla ölçer.
    pub signer_kid: String,
    pub payload: Map<String, Value>,
}

fn typed<T: serde::de::DeserializeOwned>(shaped: Map<String, Value>, signed: PackageSigned) -> Outcome<Checked<T>> {
    match serde_json::from_value::<T>(Value::Object(shaped.clone())) {
        Ok(doc) => Ok(Checked { shaped, doc, chain: signed.chain, signer_kid: signed.kid, payload: signed.payload }),
        Err(e) => Err(Fail { code: proto::BELGE_SEMA, message: format!("Belge tipe dönüşmedi: {e}") }),
    }
}

/// Windows okuyucusu (sözleşme 1–4 çağrıları): `verify_release_manifest_on(.., WINDOWS_PLATFORM)`.
pub fn verify_release_manifest(token: &Value, trust: &PackageTrust, kanal: &str) -> Outcome<Checked<ReleaseManifest>> {
    verify_release_manifest_on(token, trust, kanal, WINDOWS_PLATFORM)
}

/// Sıra (TS `verifyReleaseManifest` ile aynı kod): JWS (typ · kid · imza; `pkt-*` ise PAKET sertifikası zinciri) →
/// şema → imzalayan = `paketImzaKid` → kanal → platform. `trust.keys` ÇAĞIRANIN süzdüğü kümedir (hazırlık anahtarı
/// yalnız TEST/DEMO'da); `platform` okuyan ikilinin hedefidir.
pub fn verify_release_manifest_on(
    token: &Value,
    trust: &PackageTrust,
    kanal: &str,
    platform: UpdatePlatform,
) -> Outcome<Checked<ReleaseManifest>> {
    let signed = verify_package_signed(token, TYP_SURUM, trust)?;
    let shaped = schema::decode(release_manifest_schema, &signed.payload)?;
    if shaped.get("paketImzaKid").and_then(Value::as_str) != Some(signed.kid.as_str()) {
        return Err(Fail { code: code::SURUM_ANAHTAR, message: "Bildirimi imzalayan anahtar paketImzaKid değil".into() });
    }
    let channel = shaped.get("kanal").and_then(Value::as_str).unwrap_or_default().to_string();
    if channel != kanal {
        return Err(Fail { code: code::SURUM_KANAL, message: format!("Bildirim {channel} kanalının, kurulum {kanal} kanalında") });
    }
    let declared = shaped.get("platform").and_then(Value::as_str).unwrap_or_default().to_string();
    if declared != platform.as_str() {
        let message = format!("Bildirim {declared} platformunun, okuyan {}", platform.as_str());
        return Err(Fail { code: code::SURUM_PLATFORM, message });
    }
    let mut checked: Checked<ReleaseManifest> = typed(shaped, signed)?;
    checked.doc.signer_certificate =
        checked.chain.as_ref().and_then(|c| c.certificate.get("sertifikaId")).and_then(Value::as_str).map(str::to_string);
    Ok(checked)
}

/// Açılan paketin imzalı künyesinden (`butunluk.jws` + imzalayan kid) bağ için gereken alanlar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackageIdentity {
    pub kid: String,
    /// `pkt-*` imzalı listede imzalayan PAKET sertifikasının kimliği; `paket-*`te `None`.
    #[serde(default, rename = "sertifikaId", skip_serializing_if = "Option::is_none")]
    pub certificate_id: Option<String>,
    #[serde(rename = "paketId")]
    pub package_id: String,
    pub urun: String,
    pub surum: String,
    #[serde(rename = "derlemeTarihi")]
    pub built_at: String,
    pub musteri: Option<String>,
}

/// Paket bildirimin paketi mi? Künyenin ürünü platformunki; müşterisi yoksa kanal-dışı paket kabul, varsa bildirimin kanalı.
pub fn check_package_binding(m: &ReleaseManifest, p: &PackageIdentity) -> Outcome<()> {
    let mut off = vec![];
    if p.kid != m.signer_kid {
        off.push("kid");
    }
    // `pkt-*`: bildirimi ve listeyi AYNI PAKET sertifikası imzalamalı (kid aynı, sertifika kimliği de).
    if p.certificate_id != m.signer_certificate {
        off.push("sertifika");
    }
    if p.package_id != m.paket.package_id {
        off.push("paketId");
    }
    if UpdatePlatform::parse(&m.platform).map(UpdatePlatform::package_product) != Some(p.urun.as_str()) {
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
    let is_platform = |x: &Value| matches!(x, Value::String(s) if PG_PLATFORMS.contains(&s.as_str()));
    let is_line = |x: &Value| is_int(x, Some(10.0), Some(99.0));
    let is_build = |x: &Value| is_int(x, Some(1.0), Some(999.0));
    let is_icu = |x: &Value| is_str_matching(x, &patterns().icu_version);
    let any_object = |x: &Value| x.is_object();
    let artifact = artifact_fields();
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

/// Sıra: JWS (typ · kid · imza; `pkt-*` ise zincir) → şema. Güven bildirimdekiyle aynı süzgeçten.
pub fn verify_pg_package_manifest(token: &Value, trust: &PackageTrust) -> Outcome<Checked<PgPackageManifest>> {
    let signed = verify_package_signed(token, TYP_PG, trust)?;
    let shaped = schema::decode(pg_package_manifest_schema, &signed.payload)?;
    typed(shaped, signed)
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

// ── Zincirli işaretçi adı ve seçimi (D8) ─────────────────────────────────────────────────────────
// TS `paket-zinciri.ts` `chainedFileName` · `parseChainedFileName` · `selectChainedDocument` aynası (aynı sıra, aynı kod);
// kâhin `test_zincir_secimi` → `test-vektorleri/zincir-secimi.json` (`tests/zincir_secimi.rs`).

/// Zincirli işaretçi aileleri: `son` (değişken, kid'siz) · `surum` (`<sürüm>/`) · `pg` (`pg/<s>-<d>/`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainedFamily {
    Son,
    Surum,
    Pg,
}

impl ChainedFamily {
    pub fn as_str(self) -> &'static str {
        match self {
            ChainedFamily::Son => "son",
            ChainedFamily::Surum => "surum",
            ChainedFamily::Pg => "pg",
        }
    }

    pub fn parse(s: &str) -> Option<ChainedFamily> {
        match s {
            "son" => Some(ChainedFamily::Son),
            "surum" => Some(ChainedFamily::Surum),
            "pg" => Some(ChainedFamily::Pg),
            _ => None,
        }
    }
}

fn chained_file_pattern() -> &'static Regex {
    static P: OnceLock<Regex> = OnceLock::new();
    P.get_or_init(|| Regex::new(r"^(son|surum|pg)-zincir(?:-(pkt-[a-z0-9-]{1,40}))?\.json$").expect("zincirli ad"))
}

/// `<aile>-zincir.json` ya da `<aile>-zincir-<kid>.json`; `son` ailesine ve `pkt-*` dışı kid'e ad verilmez (`None`).
pub fn chained_file_name(family: ChainedFamily, kid: Option<&str>) -> Option<String> {
    match kid {
        None => Some(format!("{}-zincir.json", family.as_str())),
        Some(k) if family != ChainedFamily::Son && is_chain_package_kid(k) => Some(format!("{}-zincir-{k}.json", family.as_str())),
        Some(_) => None,
    }
}

/// Dosya adı zincirli işaretçi ailesinden mi; kid'li adda kid (yalnız `surum`/`pg`).
pub fn parse_chained_file_name(name: &str) -> Option<(ChainedFamily, Option<String>)> {
    let c = chained_file_pattern().captures(name)?;
    let family = ChainedFamily::parse(c.get(1)?.as_str())?;
    let kid = c.get(2).map(|m| m.as_str().to_string());
    if family == ChainedFamily::Son && kid.is_some() {
        return None;
    }
    Some((family, kid))
}

/// Seçime giren aday: dosya adı + kendi kuralıyla doğrulanmış belge ya da düşme nedeni.
#[derive(Debug, Clone)]
pub struct ChainedCandidate<T> {
    pub name: String,
    pub result: Outcome<Checked<T>>,
}

#[derive(Debug, Clone)]
pub struct ChainedChoice<T> {
    pub name: String,
    pub checked: Checked<T>,
    /// Elenen adaylar (sıralı): ad · kod · ileti.
    pub rejected: Vec<(String, &'static str, String)>,
}

/// Aynı belge mi: `paketImzaKid` ve `paket` (yalnız `paketId` kalır — yeniden imzada zip ad/boyut/özet değişir) dışında yük.
fn document_identity(payload: &Map<String, Value>) -> Value {
    let mut p = payload.clone();
    p.remove("paketImzaKid");
    if let Some(Value::Object(paket)) = p.get("paket") {
        if let Some(id) = paket.get("paketId") {
            let only = Value::Object(Map::from_iter([("paketId".to_string(), id.clone())]));
            p.insert("paket".into(), only);
        }
    }
    Value::Object(p)
}

/// ZİNCİR SEÇİMİ: aday geçerli ⇔ belge doğrulandı · `pkt-*` sertifikalı · adındaki kid = imzalayan · sertifika iptalli
/// DEĞİL. Geçerliler aynı belgeyi anlatmalı; kazanan sertifika bitişi EN GEÇ olan. Belirsizlik ve hiç geçerli yokken
/// FAIL-CLOSED; aday yoksa `None` (eski dosyaya düşüş çağıranın). Sıra: kid'siz önce, sonra ada göre.
pub fn select_chained<T: Clone>(family: ChainedFamily, candidates: Vec<ChainedCandidate<T>>) -> Option<Outcome<ChainedChoice<T>>> {
    if candidates.is_empty() {
        return None;
    }
    let mut ordered = candidates;
    ordered.sort_by(|a, b| {
        let ka = parse_chained_file_name(&a.name).and_then(|(_, k)| k).is_none();
        let kb = parse_chained_file_name(&b.name).and_then(|(_, k)| k).is_none();
        kb.cmp(&ka).then_with(|| a.name.encode_utf16().cmp(b.name.encode_utf16()))
    });
    let mut rejected: Vec<(String, &'static str, String)> = Vec::new();
    let mut valid: Vec<(String, Checked<T>, f64)> = Vec::new();
    for c in ordered {
        let parsed = parse_chained_file_name(&c.name).filter(|(f, _)| *f == family);
        let Some((_, name_kid)) = parsed else {
            rejected.push((c.name.clone(), code::SURUM_ISARETCI, format!("{} {}-zincir ailesinin adı değil", c.name, family.as_str())));
            continue;
        };
        let checked = match c.result {
            Ok(v) => v,
            Err(f) => {
                rejected.push((c.name, f.code, f.message));
                continue;
            }
        };
        let Some(chain) = checked.chain.as_ref() else {
            let m = format!("{} kök sertifikalı pkt-* anahtarla imzalı değil ({})", c.name, checked.signer_kid);
            rejected.push((c.name, proto::PAKET_SERTIFIKA_YOK, m));
            continue;
        };
        if name_kid.as_deref().is_some_and(|k| k != checked.signer_kid) {
            let m = format!("{} adındaki kid imzalayan değil ({})", c.name, checked.signer_kid);
            rejected.push((c.name, proto::JWS_KID, m));
            continue;
        }
        if chain.revoked {
            let m = format!("{}: PAKET sertifikası {} iptal edilmiş", c.name, checked.signer_kid);
            rejected.push((c.name, proto::PAKET_SERTIFIKA_IPTAL, m));
            continue;
        }
        let end = iso::date_parse_ms(chain.certificate.get("bitis").and_then(Value::as_str).unwrap_or_default());
        valid.push((c.name, checked, end));
    }
    if valid.is_empty() {
        let list: Vec<String> = rejected.iter().map(|(n, c, m)| format!("{n} ({c}: {m})")).collect();
        let first = rejected.first().map_or(code::SURUM_ISARETCI, |r| r.1);
        return Some(Err(Fail { code: first, message: format!("zincirli dosyaların hiçbiri geçerli değil: {}", list.join(" · ")) }));
    }
    let identity = document_identity(&valid[0].1.payload);
    if let Some(m) = valid.iter().find(|v| !deep_equal(&document_identity(&v.1.payload), &identity)) {
        let message = format!("belirsiz: {} ile {} aynı belgeyi anlatmıyor — hiçbiri seçilmez", valid[0].0, m.0);
        return Some(Err(Fail { code: code::SURUM_ISARETCI, message }));
    }
    let latest = valid.iter().map(|v| v.2).fold(f64::NEG_INFINITY, f64::max);
    let mut winners: Vec<(String, Checked<T>, f64)> = valid.into_iter().filter(|v| v.2 == latest).collect();
    if winners.len() != 1 {
        let names: Vec<&str> = winners.iter().map(|w| w.0.as_str()).collect();
        let message = format!("belirsiz: {} aynı sertifika bitişini taşıyor — hiçbiri seçilmez", names.join(", "));
        return Some(Err(Fail { code: code::SURUM_ISARETCI, message }));
    }
    let (name, checked, _) = winners.remove(0);
    Some(Ok(ChainedChoice { name, checked, rejected }))
}

/// Zincir seçimi adayı: sürüm bildirimi işaretçisi metni → doğrulanmış bildirim (TS `chainedReleaseCandidate`).
pub fn chained_release_candidate(name: &str, text: &str, trust: &PackageTrust, kanal: &str) -> ChainedCandidate<ReleaseManifest> {
    chained_release_candidate_on(name, text, trust, kanal, WINDOWS_PLATFORM)
}

pub fn chained_release_candidate_on(
    name: &str,
    text: &str,
    trust: &PackageTrust,
    kanal: &str,
    platform: UpdatePlatform,
) -> ChainedCandidate<ReleaseManifest> {
    let result = read_release_pointer(text).and_then(|j| verify_release_manifest_on(&Value::String(j), trust, kanal, platform));
    ChainedCandidate { name: name.to_string(), result }
}

/// Zincir seçimi adayı: PG künyesi işaretçisi metni → doğrulanmış künye (TS `chainedPgCandidate`).
pub fn chained_pg_candidate(name: &str, text: &str, trust: &PackageTrust) -> ChainedCandidate<PgPackageManifest> {
    let result = read_release_pointer(text).and_then(|j| verify_pg_package_manifest(&Value::String(j), trust));
    ChainedCandidate { name: name.to_string(), result }
}
