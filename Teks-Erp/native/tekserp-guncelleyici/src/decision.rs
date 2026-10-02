//! Politika ve TEK karar noktası — TS `protocol/guncelleme-karar.ts` `effectiveUpdatePolicy` +
//! `decideUpdate` AYNASI (vektör `guncelleme-karar.json` `karar` · `guncelleme-kira.json`
//! `etkin-politika`). SAF: saat, kira, kurulu sürüm, PG ve onay girdidir. Sıra: yetki (kira · K1 ·
//! DONDUR) → sürüm (sabitleme · aday · kaynak sınırı) → uygunluk (HAK · bakım · PG) → zamanlama
//! (onay · pencere). Güncelleyici saat dilimi hesabı YAPMAZ: pencere kiradaki MUTLAK aralıklardır.
use crate::release::{compare_pg_versions, pg_major, PgRequirement, ReleaseManifest, CLOCK_SKEW_MS};
use crate::version;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::cmp::Ordering;
use tekserp_dogrulama::iso;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    #[serde(rename = "OTOMATIK")]
    Automatic,
    #[serde(rename = "ONAYLI")]
    Approval,
    #[serde(rename = "DONDUR")]
    Frozen,
}

impl Mode {
    pub fn label(self) -> &'static str {
        match self {
            Mode::Automatic => "OTOMATIK",
            Mode::Approval => "ONAYLI",
            Mode::Frozen => "DONDUR",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Interval {
    pub baslangic: String,
    pub bitis: String,
}

impl Interval {
    fn start_ms(&self) -> f64 {
        iso::date_parse_ms(&self.baslangic)
    }
    fn end_ms(&self) -> f64 {
        iso::date_parse_ms(&self.bitis)
    }
}

/// Kiranın `guncelleme` alanı (şemadan geçmiş hâli); `pencere` yalnız gösterim içindir.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdatePolicy {
    pub kip: Mode,
    pub pencere: Option<Value>,
    pub araliklar: Vec<Interval>,
    #[serde(rename = "hedefSurum")]
    pub target: Option<String>,
}

/// Kirada `guncelleme` YOKKEN (eski satıcı) = bugünkü davranış: hiçbir şey kendiliğinden kurulmaz.
pub fn default_update_policy() -> UpdatePolicy {
    UpdatePolicy { kip: Mode::Approval, pencere: None, araliklar: vec![], target: None }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PolicySource {
    #[serde(rename = "KIRA")]
    Lease,
    #[serde(rename = "VARSAYILAN")]
    Default,
}

/// Geçerli (süresi +10 dk'yı geçmemiş) kiranın politikası; kira yoksa ya da süresi geçtiyse `None`
/// (yetki yok). `lease` = şemadan geçmiş kira belgesi (`tekserp_dogrulama::schema::lease` çıktısı).
pub fn effective_update_policy(lease: Option<&Map<String, Value>>, now_ms: f64) -> Option<(UpdatePolicy, PolicySource)> {
    let lease = lease?;
    let ends = lease.get("bitis").and_then(Value::as_str).map_or(f64::NAN, iso::date_parse_ms);
    // JS: `nowMs > bitis + skew` → null; NaN'da karşılaştırma yanlıştır ve kira GEÇERLİ sayılır — aynen.
    if now_ms > ends + CLOCK_SKEW_MS {
        return None;
    }
    match lease.get("guncelleme") {
        Some(g) => serde_json::from_value::<UpdatePolicy>(g.clone()).ok().map(|p| (p, PolicySource::Lease)),
        None => Some((default_update_policy(), PolicySource::Default)),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PgMode {
    #[serde(rename = "KENDI")]
    Own,
    #[serde(rename = "HARICI")]
    External,
}

/// Kurulu PostgreSQL: kip · `ana.küçük` · kendi kipte EDB derlemesi (zorunlu).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstalledPg {
    pub kip: PgMode,
    pub surum: String,
    pub derleme: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Timing {
    #[serde(rename = "HEMEN")]
    Now,
    #[serde(rename = "PENCERE")]
    Window,
}

/// Yerel onay (panel) — YETKİ DEĞİL: politikanın izin verdiği zamanlamayı tetikler, tek sürüme bağlı.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Approval {
    pub surum: String,
    pub zamanlama: Timing,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Input<'a> {
    pub politika: Option<&'a UpdatePolicy>,
    pub guncelleme_donuk: bool,
    pub bakim_bitis_ms: Option<f64>,
    pub kurulu_surum: &'a str,
    pub pg: Option<&'a InstalledPg>,
    pub aday: Option<&'a ReleaseManifest>,
    pub onay: Option<&'a Approval>,
    pub now_ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Kind {
    #[serde(rename = "GUNCEL")]
    UpToDate,
    #[serde(rename = "DONDURULDU")]
    Frozen,
    #[serde(rename = "UYGUN_DEGIL")]
    NotEligible,
    #[serde(rename = "ONAY_BEKLIYOR")]
    AwaitingApproval,
    #[serde(rename = "PENCERE_BEKLIYOR")]
    AwaitingWindow,
    #[serde(rename = "KUR")]
    Install,
}

impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Kind::UpToDate => "GUNCEL",
            Kind::Frozen => "DONDURULDU",
            Kind::NotEligible => "UYGUN_DEGIL",
            Kind::AwaitingApproval => "ONAY_BEKLIYOR",
            Kind::AwaitingWindow => "PENCERE_BEKLIYOR",
            Kind::Install => "KUR",
        }
    }
}

/// Karar (TS `UpdateDecision`): `aralik` KUR'da içinde bulunulan (HEMEN'de yok), PENCERE_BEKLIYOR'da sıradaki.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Decision {
    pub karar: Kind,
    pub neden: Option<String>,
    pub aralik: Option<Interval>,
    #[serde(rename = "pgGuncellemesi")]
    pub pg_update: bool,
}

fn decision(karar: Kind, neden: Option<&str>) -> Decision {
    Decision { karar, neden: neden.map(str::to_string), aralik: None, pg_update: false }
}

enum PgVerdict {
    Ok,
    Update,
    Refuse(Decision),
}

/// Ana sürüm bildirimin çizgisi değilse ASLA; kendi örnekte hedef kuruludan yeniyse küçük sürüm
/// güncellemesi (backend'den ÖNCE); harici örneğe dokunulmaz, yalnız `enAz` denetlenir.
fn pg_check(req: &PgRequirement, installed: Option<&InstalledPg>) -> PgVerdict {
    let Some(i) = installed else { return PgVerdict::Refuse(decision(Kind::NotEligible, Some("PG_OLCULEMEDI"))) };
    if crate::release::pg_version_of(&i.surum).as_deref() != Some(i.surum.as_str()) || (i.kip == PgMode::Own && i.derleme.is_none()) {
        return PgVerdict::Refuse(decision(Kind::NotEligible, Some("PG_OLCULEMEDI")));
    }
    if pg_major(&i.surum) != Some(req.cizgi) {
        return PgVerdict::Refuse(decision(Kind::NotEligible, Some("PG_ANA_SURUM")));
    }
    if i.kip == PgMode::Own {
        if let Some(h) = &req.hedef {
            if compare_pg_versions((&h.surum, Some(h.derleme)), (&i.surum, i.derleme)).unwrap_or(Ordering::Equal) == Ordering::Greater {
                return PgVerdict::Update;
            }
        }
    }
    match compare_pg_versions((&i.surum, None), (&req.min, None)) {
        Some(Ordering::Greater | Ordering::Equal) => PgVerdict::Ok,
        _ => PgVerdict::Refuse(decision(Kind::NotEligible, Some("PG_SURUMU_ESKI"))),
    }
}

fn timing(p: &UpdatePolicy, onay: Option<&Approval>, now: f64, pg: bool) -> Decision {
    let with = |karar: Kind, neden: Option<&str>, aralik: Option<&Interval>| Decision {
        karar,
        neden: neden.map(str::to_string),
        aralik: aralik.cloned(),
        pg_update: pg,
    };
    if onay.is_some_and(|o| o.zamanlama == Timing::Now) {
        return with(Kind::Install, Some("ONAY_HEMEN"), None);
    }
    if p.kip == Mode::Approval && onay.is_none() {
        return with(Kind::AwaitingApproval, None, None);
    }
    if let Some(current) = p.araliklar.iter().find(|a| a.start_ms() <= now && now < a.end_ms()) {
        return with(Kind::Install, Some("PENCERE"), Some(current));
    }
    let next = p.araliklar.iter().find(|a| a.start_ms() > now);
    with(Kind::AwaitingWindow, if next.is_some() { None } else { Some("PENCERE_YOK") }, next)
}

fn cmp_or(a: &str, b: &str, fallback: Ordering) -> Ordering {
    version::compare(a, b).unwrap_or(fallback)
}

/// Güncelleyicinin TEK karar noktası (TS `decideUpdate` ile aynı sıra ve aynı neden kodları).
pub fn decide(g: &Input) -> Decision {
    let Some(p) = g.politika else { return decision(Kind::Frozen, Some("KIRA_YOK")) };
    if g.guncelleme_donuk {
        return decision(Kind::Frozen, Some("YAPTIRIM"));
    }
    if p.kip == Mode::Frozen {
        return decision(Kind::Frozen, Some("POLITIKA"));
    }
    if version::parse(g.kurulu_surum).is_none() {
        return decision(Kind::NotEligible, Some("KURULU_SURUM_BICIMSIZ"));
    }
    if let Some(t) = &p.target {
        if cmp_or(g.kurulu_surum, t, Ordering::Less) != Ordering::Less {
            return decision(Kind::UpToDate, Some("HEDEF_ULASILDI"));
        }
    }
    let Some(a) = g.aday else { return decision(Kind::UpToDate, Some("ADAY_YOK")) };
    if cmp_or(&a.surum, g.kurulu_surum, Ordering::Equal) != Ordering::Greater {
        return decision(Kind::UpToDate, Some("SURUM_GUNCEL"));
    }
    if p.target.as_ref().is_some_and(|t| version::compare(&a.surum, t) != Some(Ordering::Equal)) {
        return decision(Kind::NotEligible, Some("HEDEF_DISI"));
    }
    if a.min_source.as_ref().is_some_and(|m| cmp_or(g.kurulu_surum, m, Ordering::Less) == Ordering::Less) {
        return decision(Kind::NotEligible, Some("KAYNAK_SURUM_ESKI"));
    }
    let Some(maintenance_end) = g.bakim_bitis_ms else { return decision(Kind::NotEligible, Some("HAK_YOK")) };
    if iso::date_parse_ms(&a.built_at) > maintenance_end {
        return decision(Kind::NotEligible, Some("BAKIM_DISI"));
    }
    let pg_update = match pg_check(&a.pg, g.pg) {
        PgVerdict::Refuse(d) => return d,
        PgVerdict::Update => true,
        PgVerdict::Ok => false,
    };
    let onay = g.onay.filter(|o| version::compare(&o.surum, &a.surum) == Some(Ordering::Equal));
    timing(p, onay, g.now_ms, pg_update)
}

/// Karar girdisi olmadan bilinebilen sonuç (aday gerekmeden): `ADAY_YOK` dönerse aday aranmalıdır.
pub fn needs_candidate(d: &Decision) -> bool {
    d.karar == Kind::UpToDate && d.neden.as_deref() == Some("ADAY_YOK")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_policy_is_todays_behaviour() {
        let p = default_update_policy();
        assert_eq!(p.kip, Mode::Approval);
        assert!(p.araliklar.is_empty() && p.pencere.is_none() && p.target.is_none());
    }
}
