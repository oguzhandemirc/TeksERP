//! Güven zinciri: kök → (ALT | İNDİRME | BAYİ | HAK ara) sertifikası → belge; kök imzalı HAK da geçerlidir.
//! TS `protocol/anahtar-zinciri.ts` aynası — denetim SIRASI dahil (kod eşliği). Sertifika çocuk belgenin
//! İMZA ANINDA geçerli olmalıdır; iptal (G4) ise TÜMDENDİR.
use crate::b64;
use crate::iso;
use crate::jsonx::js_number;
use crate::jws::{self, Parsed};
use crate::outcome::{code, fail, Fail, Outcome};
use crate::schema::{self, LICENSE_CLASSES, OFFLINE_HORIZON_DEALER_DAYS, OFFLINE_HORIZON_SHORT_CLASS_DAYS, STAGING_ROOT_CLASSES};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

/// Belge türleri: TS `TYP` kayıt defterinin aynası (`TYP_<AD>` = `TYP.<AD>`, kâhin §0j ölçer).
pub const TYP_HAK: &str = "tekserp-hak";
pub const TYP_KIRA: &str = "tekserp-kira";
pub const TYP_SERTIFIKA: &str = "tekserp-sertifika";
pub const TYP_IPTAL: &str = "tekserp-iptal";
/// Saat farkı toleransı (TS `CLOCK_SKEW_MS`).
pub const CLOCK_SKEW_MS: f64 = 600_000.0;

#[derive(Debug, Clone)]
pub struct RootKey {
    pub kid: String,
    pub x: String,
    pub classes: Vec<String>,
}

struct AnchorEntry {
    key: [u8; 32],
    classes: Vec<String>,
}

type Anchor = HashMap<String, AnchorEntry>;

fn root_kid_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(kok|hazirlik)-[a-z0-9-]{1,40}$").expect("kök kid"))
}

/// Çapayı doğrular: boş liste, biçimsiz kid/anahtar ve TEST/DEMO dışına taşan hazırlık kökü RED.
fn prepare_trust_anchor(roots: &[RootKey]) -> Outcome<Anchor> {
    if roots.is_empty() {
        return fail(code::GUVEN_CAPASI_BOS, "Güven çapası boş: bu derlemede kök açık anahtarı yok");
    }
    let mut lookup = Anchor::new();
    for root in roots {
        if !root_kid_re().is_match(&root.kid) || lookup.contains_key(&root.kid) {
            return fail(code::GUVEN_CAPASI_BICIM, format!("Kök kimliği biçimsiz ya da tekrarlı: {}", root.kid));
        }
        let Some(key) = b64::decode_exact::<32>(&root.x) else {
            return fail(code::GUVEN_CAPASI_BICIM, format!("Kök açık anahtarı biçimsiz: {}", root.kid));
        };
        if root.classes.is_empty() || root.classes.iter().any(|c| !LICENSE_CLASSES.contains(&c.as_str())) {
            return fail(code::GUVEN_CAPASI_BICIM, format!("Kökün sınıf listesi geçersiz: {}", root.kid));
        }
        if root.kid.starts_with("hazirlik-") && root.classes.iter().any(|c| !STAGING_ROOT_CLASSES.contains(&c.as_str())) {
            return fail(code::GUVEN_CAPASI_BICIM, format!("Hazırlık kökü yalnız TEST/DEMO sınıflarına yetkili olabilir: {}", root.kid));
        }
        lookup.insert(root.kid.clone(), AnchorEntry { key, classes: root.classes.clone() });
    }
    Ok(lookup)
}

#[derive(Debug, Clone)]
pub struct VerifiedCertificate {
    pub document: Map<String, Value>,
    pub root_kid: String,
    pub allowed_classes: Vec<String>,
    pub key: [u8; 32],
}

impl VerifiedCertificate {
    pub fn view(&self) -> Value {
        json!({ "document": self.document, "rootKid": self.root_kid, "allowedClasses": self.allowed_classes })
    }
}

/// HAK'ı imzalayan: kök · bayi (gömülü BAYI sertifikası) · ara imzacı (gömülü HAK sertifikası, G4).
pub const SIGNER_KINDS: [&str; 3] = ["KOK", "BAYI", "ARA"];

#[derive(Debug, Clone)]
pub struct VerifiedEntitlement {
    pub document: Map<String, Value>,
    pub signer_kind: &'static str,
    pub signer_kid: String,
    pub root_kid: String,
    /// Doğrulanan compact metnin özeti (`jws::digest`) — kiranın `hakOzeti` bağı buna bakar. Görünüme girmez:
    /// TS köprüsü özeti doğrulanan metinden kendisi kurar.
    pub digest: String,
}

impl VerifiedEntitlement {
    pub fn view(&self) -> Value {
        json!({
            "document": self.document,
            "signer": { "kind": self.signer_kind, "kid": self.signer_kid, "rootKid": self.root_kid },
        })
    }
}

#[derive(Debug, Clone)]
pub struct VerifiedLease {
    pub document: Map<String, Value>,
    pub sub_certificate: VerifiedCertificate,
}

impl VerifiedLease {
    pub fn view(&self) -> Value {
        json!({ "document": self.document, "subCertificate": self.sub_certificate.view() })
    }
}

#[derive(Debug, Clone)]
pub struct VerifiedRevocation {
    pub document: Map<String, Value>,
    pub root_kid: String,
}

impl VerifiedRevocation {
    pub fn view(&self) -> Value {
        json!({ "document": self.document, "rootKid": self.root_kid })
    }

    fn sequence(&self) -> f64 {
        self.document.get("sira").and_then(js_number).unwrap_or(f64::NAN)
    }
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

fn str_of<'a>(m: &'a Map<String, Value>, key: &str) -> &'a str {
    m.get(key).and_then(Value::as_str).unwrap_or_default()
}

/// Sertifika iptal listesinde mi: kimliğiyle ya da (kid, kullanım) çiftiyle — iptal ANAHTARIN iptalidir.
pub fn is_certificate_revoked(cert: &Map<String, Value>, revocation: Option<&VerifiedRevocation>) -> bool {
    let Some(r) = revocation else { return false };
    let entries = r.document.get("iptaller").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
    entries.iter().filter_map(Value::as_object).any(|e| {
        str_of(e, "sertifikaId") == str_of(cert, "sertifikaId")
            || (str_of(e, "kid") == str_of(cert, "kid") && str_of(e, "kullanim") == str_of(cert, "kullanim"))
    })
}

pub fn verify_certificate(
    token: &Value,
    roots: &[RootKey],
    usage: &str,
    at_ms: f64,
    revocation: Option<&VerifiedRevocation>,
) -> Outcome<VerifiedCertificate> {
    let anchor = prepare_trust_anchor(roots)?;
    let parsed = jws::parse(token)?;
    let root_kid = parsed.header.kid.clone();
    let Some(root) = anchor.get(&root_kid) else {
        return fail(code::KOK_BILINMIYOR, format!("Sertifikayı imzalayan kök tanınmıyor: {root_kid}"));
    };
    let verified = jws::verify(token, TYP_SERTIFIKA, |kid| (kid == root_kid).then_some(root.key))?;
    let s = schema::decode(schema::certificate, &verified.payload)?;
    let kullanim = str_of(&s, "kullanim");
    if kullanim != usage {
        return fail(code::SERTIFIKA_KULLANIM, format!("Beklenen {usage} sertifikası, gelen {kullanim}"));
    }
    if is_certificate_revoked(&s, revocation) {
        return fail(code::SERTIFIKA_IPTAL, format!("Sertifika {} iptal edilmiş", str_of(&s, "kid")));
    }
    let classes = strings(s.get("siniflar"));
    if classes.iter().any(|c| !root.classes.contains(c)) {
        return fail(code::KOK_SINIF_YETKISIZ, format!("Kök {root_kid} sertifikaya yetkisi olmayan sınıf vermiş"));
    }
    let start = iso::date_parse_ms(str_of(&s, "baslangic"));
    let end = iso::date_parse_ms(str_of(&s, "bitis"));
    if !at_ms.is_finite() || at_ms < start - CLOCK_SKEW_MS || at_ms > end + CLOCK_SKEW_MS {
        return fail(code::SERTIFIKA_ZAMAN, format!("Sertifika {} imza anında geçerli değildi", str_of(&s, "kid")));
    }
    let Some(key) = b64::decode_exact::<32>(str_of(&s, "x")) else {
        return fail(code::BELGE_SEMA, "Sertifikadaki açık anahtar biçimsiz");
    };
    Ok(VerifiedCertificate { document: s, root_kid, allowed_classes: classes, key })
}

/// Doğrulanmamış yükten gömülü sertifikayı ve imza anını okur (zincir onları doğrulayacak).
fn embedded_certificate(payload: &Map<String, Value>, field: &str) -> Option<(Value, f64)> {
    let token = payload.get(field)?.as_str()?;
    let issued = payload.get("verilis")?.as_str()?;
    Some((Value::String(token.to_string()), iso::date_parse_ms(issued)))
}

fn verify_root_signed(token: &Value, kid: &str, root: &AnchorEntry, digest: String) -> Outcome<VerifiedEntitlement> {
    let verified = jws::verify(token, TYP_HAK, |k| (k == kid).then_some(root.key))?;
    let doc = schema::decode(schema::entitlement, &verified.payload)?;
    if doc.contains_key("bayiSertifikasi") {
        return fail(code::BAYI_KIMLIK, "Kök imzalı HAK bayi sertifikası taşıyamaz");
    }
    if doc.contains_key("imzaciSertifikasi") {
        return fail(code::IMZACI_KIMLIK, "Kök imzalı HAK ara imzacı sertifikası taşıyamaz");
    }
    let class = str_of(&doc, "sinif");
    if !root.classes.iter().any(|c| c == class) {
        return fail(code::KOK_SINIF_YETKISIZ, format!("Kök {kid} {class} sınıfı imzalamaya yetkili değil"));
    }
    Ok(VerifiedEntitlement { document: doc, signer_kind: "KOK", signer_kid: kid.to_string(), root_kid: kid.to_string(), digest })
}

fn verify_dealer_signed(token: &Value, kid: &str, cert: &VerifiedCertificate, digest: String) -> Outcome<VerifiedEntitlement> {
    if str_of(&cert.document, "kid") != kid {
        return fail(code::BAYI_KIMLIK, "HAK'ı imzalayan anahtar gömülü bayi sertifikasınınki değil");
    }
    let verified = jws::verify(token, TYP_HAK, |k| (k == kid).then_some(cert.key))?;
    let doc = schema::decode(schema::entitlement, &verified.payload)?;
    let cap = cert.document.get("bayi").and_then(Value::as_object);
    let cap_dealer = cap.and_then(|c| c.get("bayiId"));
    if cap.is_none() || doc.get("bayiId") != cap_dealer {
        return fail(code::BAYI_KIMLIK, "HAK'taki bayi kimliği sertifikayla uyuşmuyor");
    }
    let class = str_of(&doc, "sinif").to_string();
    if !cert.allowed_classes.contains(&class) {
        return fail(code::BAYI_TAVAN_SINIF, format!("Bayi {class} sınıfı veremez"));
    }
    let cap_modules = strings(cap.and_then(|c| c.get("moduller")));
    let exceeding: Vec<String> = strings(doc.get("moduller")).into_iter().filter(|m| !cap_modules.contains(m)).collect();
    if !exceeding.is_empty() {
        return fail(code::BAYI_TAVAN_MODUL, format!("Bayi tavanı dışında modül: {}", exceeding.join(", ")));
    }
    Ok(VerifiedEntitlement { document: doc, signer_kind: "BAYI", signer_kid: kid.to_string(), root_kid: cert.root_kid.clone(), digest })
}

fn verify_intermediate_signed(token: &Value, kid: &str, cert: &VerifiedCertificate, digest: String) -> Outcome<VerifiedEntitlement> {
    if str_of(&cert.document, "kid") != kid {
        return fail(code::IMZACI_KIMLIK, "HAK'ı imzalayan anahtar gömülü ara imzacı sertifikasınınki değil");
    }
    let verified = jws::verify(token, TYP_HAK, |k| (k == kid).then_some(cert.key))?;
    let doc = schema::decode(schema::entitlement, &verified.payload)?;
    let class = str_of(&doc, "sinif").to_string();
    if !cert.allowed_classes.contains(&class) {
        return fail(code::KOK_SINIF_YETKISIZ, format!("Ara imzacı {kid} {class} sınıfını imzalamaya yetkili değil"));
    }
    Ok(VerifiedEntitlement { document: doc, signer_kind: "ARA", signer_kid: kid.to_string(), root_kid: cert.root_kid.clone(), digest })
}

fn verify_entitlement_signature(token: &Value, roots: &[RootKey], revocation: Option<&VerifiedRevocation>) -> Outcome<VerifiedEntitlement> {
    let anchor = prepare_trust_anchor(roots)?;
    let parsed: Parsed = jws::parse(token)?;
    let Some(text) = token.as_str() else {
        return fail(code::JWS_BICIM, "HAK metin değil");
    };
    if parsed.header.typ != TYP_HAK {
        return fail(code::JWS_TYP, format!("Beklenen {TYP_HAK}, gelen {}", parsed.header.typ));
    }
    let digest = jws::digest(text);
    let kid = parsed.header.kid.clone();
    if let Some(root) = anchor.get(&kid) {
        return verify_root_signed(token, &kid, root, digest);
    }
    if let Some((cert_token, at_ms)) = embedded_certificate(&parsed.payload, "imzaciSertifikasi") {
        let cert = verify_certificate(&cert_token, roots, "HAK", at_ms, revocation)?;
        return verify_intermediate_signed(token, &kid, &cert, digest);
    }
    let Some((cert_token, at_ms)) = embedded_certificate(&parsed.payload, "bayiSertifikasi") else {
        return fail(code::KOK_BILINMIYOR, format!("HAK'ı imzalayan anahtar tanınmıyor: {kid}"));
    };
    let cert = match verify_certificate(&cert_token, roots, "BAYI", at_ms, revocation) {
        Ok(c) => c,
        Err(Fail { code: c, message }) if c == code::SERTIFIKA_KULLANIM => return fail(code::BAYI_KIMLIK, message),
        Err(e) => return Err(e),
    };
    verify_dealer_signed(token, &kid, &cert, digest)
}

/// HAK çevrimdışı ufkunun tavanı (gün; `None` = tavansız, süresiz dahil) — K2 sınıf kısıtı: DEMO/TEST ≤ 45,
/// bayi imzalı ≤ 400, süresiz ya da 400 gün üstü yalnız ÜRETİM ve DR (TS `offlineHorizonCeilingDays`).
pub fn offline_horizon_ceiling_days(class: &str, signer_kind: &str) -> Option<u32> {
    if ["DEMO", "TEST"].contains(&class) {
        return Some(OFFLINE_HORIZON_SHORT_CLASS_DAYS);
    }
    if signer_kind == "BAYI" || !["URETIM", "DR"].contains(&class) {
        return Some(OFFLINE_HORIZON_DEALER_DAYS);
    }
    None
}

fn check_horizon(v: VerifiedEntitlement) -> Outcome<VerifiedEntitlement> {
    let Some(horizon) = v.document.get("cevrimdisiUfukGun") else {
        return Ok(v);
    };
    let class = str_of(&v.document, "sinif");
    let Some(ceiling) = offline_horizon_ceiling_days(class, v.signer_kind) else {
        return Ok(v);
    };
    // Şemadan geçmiş ufuk tamsayı ya da `null` (süresiz); süresiz her tavanı aşar.
    if js_number(horizon).is_none_or(|days| days > f64::from(ceiling)) {
        return fail(
            code::UFUK_TAVANI_ASIMI,
            format!("{class} HAK'ı ({}) en çok {ceiling} günlük çevrimdışı ufuk taşıyabilir", v.signer_kind),
        );
    }
    Ok(v)
}

/// Veriliş sınırı (G4 §2.5): "şimdi"den toleranstan fazla ileri tarihli HAK RED; sonlu olmayan şimdi de RED (fail-closed).
fn check_issuance(v: VerifiedEntitlement, now_ms: Option<f64>) -> Outcome<VerifiedEntitlement> {
    let Some(now) = now_ms else {
        return Ok(v);
    };
    let issued = iso::date_parse_ms(str_of(&v.document, "verilis"));
    if !now.is_finite() || issued.partial_cmp(&(now + CLOCK_SKEW_MS)).is_none_or(|o| o == std::cmp::Ordering::Greater) {
        return fail(code::BELGE_ILERI_TARIHLI, "HAK'ın veriliş zamanı doğrulayanın saatinden ileride");
    }
    Ok(v)
}

/// HAK: kök imzalıysa kökün sınıf yetkisi, bayi imzalıysa bayi tavanı, ara imzalıysa ara sertifikanın sınıfları
/// kriptografik uygulanır; ardından ufuk tavanı (her imzacı) ve — `now_ms` verildiyse — veriliş sınırı.
pub fn verify_entitlement(
    token: &Value,
    roots: &[RootKey],
    now_ms: Option<f64>,
    revocation: Option<&VerifiedRevocation>,
) -> Outcome<VerifiedEntitlement> {
    let signed = verify_entitlement_signature(token, roots, revocation)?;
    check_issuance(check_horizon(signed)?, now_ms)
}

/// KİRA: gömülü ALT sertifikası kökle, kira alt anahtarla doğrulanır. HAK bağı ayrıca denetlenir.
pub fn verify_lease(token: &Value, roots: &[RootKey], revocation: Option<&VerifiedRevocation>) -> Outcome<VerifiedLease> {
    let parsed = jws::parse(token)?;
    if parsed.header.typ != TYP_KIRA {
        return fail(code::JWS_TYP, format!("Beklenen {TYP_KIRA}, gelen {}", parsed.header.typ));
    }
    let Some((cert_token, at_ms)) = embedded_certificate(&parsed.payload, "altSertifika") else {
        return fail(code::BELGE_SEMA, "Kira alt sertifika ya da veriliş zamanı taşımıyor");
    };
    let cert = verify_certificate(&cert_token, roots, "ALT", at_ms, revocation)?;
    let kid = parsed.header.kid.clone();
    if str_of(&cert.document, "kid") != kid {
        return fail(code::JWS_KID, "Kirayı imzalayan anahtar gömülü alt sertifikanınki değil");
    }
    let verified = jws::verify(token, TYP_KIRA, |k| (k == kid).then_some(cert.key))?;
    let doc = schema::decode(schema::lease, &verified.payload)?;
    Ok(VerifiedLease { document: doc, sub_certificate: cert })
}

/// Kira bu HAK'ın bu sürümüne mi ait, ve alt anahtarın zinciri HAK'ın sınıfına yetkili mi?
pub fn check_lease_binding(lease: &VerifiedLease, entitlement: &VerifiedEntitlement) -> Outcome<()> {
    let k = &lease.document;
    let h = &entitlement.document;
    let same_version = crate::jsonx::js_number(k.get("hakSurum").unwrap_or(&Value::Null))
        == crate::jsonx::js_number(h.get("surum").unwrap_or(&Value::Null));
    if str_of(k, "hakId") != str_of(h, "hakId") || !same_version || str_of(k, "kurulumId") != str_of(h, "kurulumId") {
        return fail(code::KIRA_HAK_UYUSMAZ, "Kira bu HAK'a (ya da bu sürümüne) ait değil");
    }
    if k.get("hakOzeti").is_some_and(|d| d.as_str() != Some(entitlement.digest.as_str())) {
        return fail(code::KIRA_HAK_UYUSMAZ, "Kira bu HAK'ın baytına bağlı değil (aynı kimlikle başka HAK)");
    }
    let class = str_of(h, "sinif").to_string();
    if !lease.sub_certificate.allowed_classes.contains(&class) {
        return fail(code::KIRA_SINIF_YETKISIZ, format!("Kirayı imzalayan alt anahtar {class} sınıfına yetkili değil"));
    }
    Ok(())
}

/// İPTAL belgesi: yalnız çapadaki bir KÖK imzalar (ara/alt anahtar iptal basamaz).
pub fn verify_revocation(token: &Value, roots: &[RootKey]) -> Outcome<VerifiedRevocation> {
    let anchor = prepare_trust_anchor(roots)?;
    let parsed = jws::parse(token)?;
    if parsed.header.typ != TYP_IPTAL {
        return fail(code::JWS_TYP, format!("Beklenen {TYP_IPTAL}, gelen {}", parsed.header.typ));
    }
    let kid = parsed.header.kid.clone();
    let Some(root) = anchor.get(&kid) else {
        return fail(code::KOK_BILINMIYOR, format!("İptal belgesini imzalayan kök tanınmıyor: {kid}"));
    };
    let verified = jws::verify(token, TYP_IPTAL, |k| (k == kid).then_some(root.key))?;
    let document = schema::decode(schema::revocation, &verified.payload)?;
    Ok(VerifiedRevocation { document, root_kid: kid })
}

/// Kira bir iptal sırası beyan ediyorsa elde en az o sırada belge olmalı (yoksa iptal yanıttan ayıklanmış olabilir).
pub fn is_revocation_current(lease: &Map<String, Value>, revocation: Option<&VerifiedRevocation>) -> bool {
    let Some(required) = lease.get("iptalSira") else {
        return true;
    };
    let required = js_number(required).unwrap_or(f64::NAN);
    revocation.is_some_and(|r| r.sequence() >= required)
}

/// Yüksek `sira` kazanır; eşit ya da düşük sıralı gelen yok sayılır (mevcut kalır — geri alınamaz, çırpınmaz).
pub fn pick_newer_revocation(current: Option<VerifiedRevocation>, incoming: Option<VerifiedRevocation>) -> Option<VerifiedRevocation> {
    match (current, incoming) {
        (current, None) => current,
        (None, incoming) => incoming,
        (Some(c), Some(i)) => Some(if i.sequence() > c.sequence() { i } else { c }),
    }
}
