//! PAKET anahtarı kökün altında — TS `protocol/paket-zinciri.ts` aynası (denetim SIRASI dahil, kod eşliği;
//! kâhin `test_paket_zinciri` + `tests/paket_zinciri.rs`). `paket-*` kid'i gömülü çapadan, `pkt-*` kid'i yükte
//! gömülü kök imzalı PAKET sertifikasıyla doğrulanır.
use crate::b64;
use crate::chain::{prepare_trust_anchor, verify_certificate, RootKey};
use crate::iso;
use crate::jsonx::js_number;
use crate::jws;
use crate::outcome::{code, fail, Outcome};
use crate::schema::{self, DAY_MS};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

/// PAKET sertifikası iptal belgesi (yalnız KÖK imzalar). `tekserp-iptal`den ayrı tür; adda tire yok (typ deseni).
pub const TYP_PAKET_IPTAL: &str = "tekserp-paketiptal";
pub const PACKAGE_CERT_FIELD: &str = "paketSertifikasi";
pub const PACKAGE_SIGNED_AT_FIELD: &str = "imzaZamani";
/// KABUL kipinde sertifika bitişinden sonra yeni paketin kabul edildiği gün (TS `PACKAGE_ACCEPT_TOLERANCE_DAYS`).
pub const PACKAGE_ACCEPT_TOLERANCE_DAYS: u32 = 180;
pub const CHAINED_INTEGRITY_FILE: &str = "butunluk-zincir.jws";
pub const CHAINED_RELEASE_POINTER_FILE: &str = "son-zincir.json";
pub const CHAINED_RELEASE_MANIFEST_FILE: &str = "surum-zincir.json";
pub const CHAINED_PG_POINTER_FILE: &str = "pg-zincir.json";
pub const PACKAGE_REVOCATION_FILE: &str = "paket-iptal.jws";

struct Patterns {
    chain_kid: Regex,
    package_kid: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        chain_kid: Regex::new(r"^pkt-[a-z0-9-]{1,40}$").expect("pkt kid"),
        package_kid: Regex::new(r"^paket-[a-z0-9-]{1,40}$").expect("paket kid"),
    })
}

/// `pkt-*`: yükte sertifika taşıması ZORUNLU aile.
pub fn is_chain_package_kid(kid: &str) -> bool {
    patterns().chain_kid.is_match(kid)
}

/// KABUL: dışarıdan gelen yeni belge (iptal RED, bitiş + tolerans). YERLEŞİK: kurulu paket (iptal yalnız işaret).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackageMode {
    Kabul,
    Yerlesik,
}

#[derive(Debug, Clone)]
pub struct VerifiedPackageRevocation {
    pub document: Map<String, Value>,
    pub root_kid: String,
}

impl VerifiedPackageRevocation {
    pub fn sequence(&self) -> f64 {
        self.document.get("sira").and_then(js_number).unwrap_or(f64::NAN)
    }
}

#[derive(Debug, Clone)]
pub struct PackageTrust {
    /// Gömülü `paket-*` anahtarları (kid, x) — çağıranın sınıfa göre süzdüğü küme; boş olabilir.
    pub keys: Vec<(String, String)>,
    pub roots: Vec<RootKey>,
    pub mode: PackageMode,
    /// KABUL kipinde zorunlu: max(sistem saati, elde doğrulanmış kiranın verilişi).
    pub now_ms: Option<f64>,
    pub revocation: Option<VerifiedPackageRevocation>,
    /// `None` süzgeç yok · `Some(None)` sınıf bilinmiyor (zincirli belge RED) · `Some(Some(s))` kümede olmalı.
    pub install_class: Option<Option<String>>,
}

impl PackageTrust {
    /// Yalnız gömülü `paket-*` anahtarları (kök yok): TS'te `zincir` verilmemiş çağrı — `pkt-*` belge GUVEN_CAPASI_BOS.
    pub fn embedded(keys: Vec<(String, String)>) -> PackageTrust {
        PackageTrust { keys, roots: Vec::new(), mode: PackageMode::Yerlesik, now_ms: None, revocation: None, install_class: None }
    }
}

#[derive(Debug, Clone)]
pub struct PackageChainSigner {
    pub certificate: Map<String, Value>,
    pub root_kid: String,
    pub revoked: bool,
}

#[derive(Debug, Clone)]
pub struct PackageSigned {
    /// İmzası doğrulanmış yük; zincir alanları ayıklanmış.
    pub payload: Map<String, Value>,
    pub kid: String,
    pub chain: Option<PackageChainSigner>,
}

impl PackageSigned {
    /// Vektör görünümü (TS bekçisinin `degerlendir` biçimi).
    pub fn view(&self) -> Value {
        let chain = self.chain.as_ref().map_or(Value::Null, |c| {
            json!({ "sertifikaId": str_of(&c.certificate, "sertifikaId"), "kid": str_of(&c.certificate, "kid"), "rootKid": c.root_kid, "revoked": c.revoked })
        });
        json!({ "ok": true, "kid": self.kid, "payload": Value::Object(self.payload.clone()), "chain": chain })
    }
}

fn str_of<'a>(m: &'a Map<String, Value>, key: &str) -> &'a str {
    m.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// Sertifika PAKET iptal listesinde mi: kimliğiyle ya da kid'iyle (iptal ANAHTARIN iptalidir).
pub fn is_package_certificate_revoked(cert: &Map<String, Value>, revocation: Option<&VerifiedPackageRevocation>) -> bool {
    let Some(r) = revocation else { return false };
    let entries = r.document.get("iptaller").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    entries
        .iter()
        .filter_map(Value::as_object)
        .any(|e| str_of(e, "sertifikaId") == str_of(cert, "sertifikaId") || str_of(e, "kid") == str_of(cert, "kid"))
}

/// Gömülü çapalı (`paket-*`) belgede zincir alanı = şema ihlali.
pub fn carries_package_chain_fields(payload: &Map<String, Value>) -> bool {
    payload.contains_key(PACKAGE_CERT_FIELD) || payload.contains_key(PACKAGE_SIGNED_AT_FIELD)
}

/// TS `packageKeyLookup`: biçimsiz kid/anahtar sessizce dışarıda.
fn package_key(keys: &[(String, String)], kid: &str) -> Option<[u8; 32]> {
    keys.iter().filter(|(k, _)| patterns().package_kid.is_match(k)).find(|(k, _)| k == kid).and_then(|(_, x)| b64::decode_exact::<32>(x))
}

fn verify_chained(token: &Value, parsed: &jws::Parsed, typ: &str, trust: &PackageTrust) -> Outcome<PackageSigned> {
    let kid = parsed.header.kid.clone();
    if parsed.header.typ != typ {
        return fail(code::JWS_TYP, format!("Beklenen belge türü {typ}, gelen {}", parsed.header.typ));
    }
    let cert_token = parsed.payload.get(PACKAGE_CERT_FIELD).and_then(Value::as_str);
    let signed_at = parsed.payload.get(PACKAGE_SIGNED_AT_FIELD).and_then(Value::as_str);
    let (Some(cert_token), Some(signed_at)) = (cert_token, signed_at) else {
        return fail(code::PAKET_SERTIFIKA_YOK, format!("{kid} imzalı belge PAKET sertifikası ve imza zamanı taşımıyor"));
    };
    if !iso::is_zod_datetime(signed_at) {
        return fail(code::PAKET_SERTIFIKA_YOK, format!("{kid} imzalı belge PAKET sertifikası ve imza zamanı taşımıyor"));
    }
    let cert_value = Value::String(cert_token.to_string());
    let cert = match verify_certificate(&cert_value, &trust.roots, "PAKET", iso::date_parse_ms(signed_at), None) {
        Ok(c) => c,
        Err(f) if f.code == code::SERTIFIKA_ZAMAN => return fail(code::PAKET_SERTIFIKA_ZAMAN, f.message),
        Err(f) => return Err(f),
    };
    if str_of(&cert.document, "kid") != kid {
        return fail(code::JWS_KID, "Belgeyi imzalayan anahtar gömülü PAKET sertifikasınınki değil");
    }
    let verified = jws::verify(token, typ, |k| (k == kid).then_some(cert.key))?;
    let revoked = is_package_certificate_revoked(&cert.document, trust.revocation.as_ref());
    if trust.mode == PackageMode::Kabul {
        if revoked {
            return fail(code::PAKET_SERTIFIKA_IPTAL, format!("PAKET sertifikası {kid} iptal edilmiş"));
        }
        let end = iso::date_parse_ms(str_of(&cert.document, "bitis"));
        let tolerance = f64::from(PACKAGE_ACCEPT_TOLERANCE_DAYS) * DAY_MS;
        match trust.now_ms {
            Some(now) if now.is_finite() && now <= end + tolerance => {}
            _ => {
                return fail(
                    code::PAKET_SERTIFIKA_ZAMAN,
                    format!("PAKET sertifikası {kid} bitişinden {PACKAGE_ACCEPT_TOLERANCE_DAYS} günden fazla geçti"),
                )
            }
        }
    }
    if let Some(class) = &trust.install_class {
        if !class.as_ref().is_some_and(|c| cert.allowed_classes.contains(c)) {
            return fail(
                code::PAKET_SERTIFIKA_SINIF,
                format!("PAKET sertifikası {kid} bu kurulumun sınıfına ({}) yetkili değil", class.as_deref().unwrap_or("bilinmiyor")),
            );
        }
    }
    let mut payload = verified.payload;
    payload.remove(PACKAGE_CERT_FIELD);
    payload.remove(PACKAGE_SIGNED_AT_FIELD);
    Ok(PackageSigned { payload, kid, chain: Some(PackageChainSigner { certificate: cert.document, root_kid: cert.root_kid, revoked }) })
}

/// Paket belgesinin imzası (şema çağıranın): `pkt-*` → zincir · aksi gömülü çapa (`paket-*`; zincir alanı BELGE_SEMA).
pub fn verify_package_signed(token: &Value, typ: &str, trust: &PackageTrust) -> Outcome<PackageSigned> {
    if let Ok(parsed) = jws::parse(token) {
        if is_chain_package_kid(&parsed.header.kid) {
            return verify_chained(token, &parsed, typ, trust);
        }
    }
    let verified = jws::verify(token, typ, |kid| package_key(&trust.keys, kid))?;
    if carries_package_chain_fields(&verified.payload) {
        return fail(code::BELGE_SEMA, "Gömülü çapalı paket belgesi PAKET sertifikası taşıyamaz");
    }
    Ok(PackageSigned { payload: verified.payload, kid: verified.header.kid, chain: None })
}

/// PAKET İPTAL belgesi: yalnız çapadaki bir KÖK imzalar.
pub fn verify_package_revocation(token: &Value, roots: &[RootKey]) -> Outcome<VerifiedPackageRevocation> {
    let anchor = prepare_trust_anchor(roots)?;
    let parsed = jws::parse(token)?;
    if parsed.header.typ != TYP_PAKET_IPTAL {
        return fail(code::JWS_TYP, format!("Beklenen {TYP_PAKET_IPTAL}, gelen {}", parsed.header.typ));
    }
    let kid = parsed.header.kid.clone();
    let Some(root_key) = anchor.get(&kid).map(|r| r.key) else {
        return fail(code::KOK_BILINMIYOR, format!("PAKET iptal belgesini imzalayan kök tanınmıyor: {kid}"));
    };
    let verified = jws::verify(token, TYP_PAKET_IPTAL, |k| (k == kid).then_some(root_key))?;
    let document = schema::decode(schema::package_revocation, &verified.payload)?;
    Ok(VerifiedPackageRevocation { document, root_kid: kid })
}

/// Yüksek `sira` kazanır; eşit ya da düşük sıralı gelen yok sayılır.
pub fn pick_newer_package_revocation(
    current: Option<VerifiedPackageRevocation>,
    incoming: Option<VerifiedPackageRevocation>,
) -> Option<VerifiedPackageRevocation> {
    match (current, incoming) {
        (current, None) => current,
        (None, incoming) => incoming,
        (Some(c), Some(i)) => Some(if i.sequence() > c.sequence() { i } else { c }),
    }
}
