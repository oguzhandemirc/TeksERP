//! Bakım çiti (W2; plan `GUNCELLEYICI-SAGLAMLIK.md` §2.1 ara değişmez, §2.2 adım 0 `CIT`, A3): işlem günlüğünde açık
//! bir işlem varken backend'i güncelleyiciden başka hiçbir şey başlatamaz.
//!
//! - **Windows:** SCM backend'i başlangıç türüne göre her açılışta başlatır ⇒ hizmet `ELLE` (SERVICE_DEMAND_START)
//!   yapılır. Değiştirmeden ÖNCE eski tür işarete (`is/cit.json`) iner; işaret "türü biz değiştirdik, geri yazılacak
//!   değer bu" demektir ve geri yazım YALNIZ işaret varken yapılır (yöneticinin kendi seçimi ezilmez). İşaret, tür
//!   doğrulanarak geri yazıldıktan sonra silinir — arada ölüm aynı işi tekrarlar.
//! - **Linux:** Docker `unless-stopped` konteyneri `compose stop` sonrası açılışta da başlatmaz — yazılacak bir şey yok;
//!   politika ölçülür ve günlüğe yazılır. `always` durdurulmuş konteyneri daemon açılışında başlatır: çit kurulamaz.
//!
//! İşaretin adı (`Layout::fence_marker`) ve biçimi (`Marker`) tektir; `onar` da buradan okur (§4.7 madde 7).
use crate::codes;
use crate::env::{start_mode, Env, SvcState};
use crate::layout::Layout;
use crate::platform::CitKipi;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tekserp_hizmet::timefmt;

pub const MARKER_FORMAT: u32 = 1;

/// `is/cit.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Marker {
    pub v: u32,
    /// Çitlenen backend hizmetinin adı.
    #[serde(rename = "hizmet")]
    pub service: String,
    /// Çitten önceki başlangıç türü — kaldırırken geri yazılacak değer.
    #[serde(rename = "eskiTur")]
    pub previous: String,
    /// Çiti kuran işlem (`None` = elle, `cit --kur`).
    #[serde(rename = "islemId")]
    pub op_id: Option<String>,
    pub zaman: String,
}

/// İşaret; yoksa, biçimsizse ya da biçim sürümü tanınmıyorsa `None` (çit sayılmaz).
pub fn read(env: &Env, layout: &Layout) -> Option<Marker> {
    let b = env.fs.read(&layout.fence_marker()).ok()?;
    serde_json::from_slice::<Marker>(&b).ok().filter(|m| m.v == MARKER_FORMAT && !m.previous.is_empty())
}

/// Ölçü çitli mi: bu açılış davranışında DURDURULMUŞ backend açılışta kendiliğinden başlamaz.
pub fn fenced(kind: CitKipi, mode: &str) -> bool {
    match kind {
        CitKipi::BaslangicTuru => matches!(mode, start_mode::DEMAND | start_mode::DISABLED | start_mode::MISSING),
        CitKipi::YenidenBaslatmaPolitikasi => mode != "always",
    }
}

fn measure(env: &Env, service: &str) -> Result<String, String> {
    env.svc.start_mode(service).map_err(|e| format!("{service} açılış davranışı ölçülemedi: {e}"))
}

/// Çitten önceki tür: işaret varsa onun (önceki işlemin bıraktığı çit, ör. HATA), yoksa bugünkü ölçü. Plan bunu saklar.
pub fn original(env: &Env, layout: &Layout, service: &str) -> Option<String> {
    read(env, layout).map(|m| m.previous).or_else(|| measure(env, service).ok())
}

/// Çiti kurar (adım 0 `CIT`, ölç → yap → doğrula). `planned` = planın sakladığı eski tür. Dönen veri BITTI satırına iner.
pub fn raise(env: &Env, layout: &Layout, service: &str, planned: Option<&str>, op_id: Option<&str>) -> Result<Value, String> {
    let kind = env.arka.cit;
    let now = measure(env, service)?;
    if kind == CitKipi::YenidenBaslatmaPolitikasi {
        if !fenced(kind, &now) {
            return Err(format!(
                "{service} yeniden başlatma politikası {now:?}: durdurulan konteyner açılışta yeniden başlar (beklenen unless-stopped)"
            ));
        }
        return Ok(json!({ "olcum": now }));
    }
    let marker = read(env, layout);
    if fenced(kind, &now) && marker.is_none() {
        // Zaten çitli (yönetici "Elle"/"Devre dışı" yapmış): tür bizim değil — dokunulmaz, geri de yazılmaz.
        return Ok(json!({ "olcum": now, "citKuruldu": false }));
    }
    let previous = match &marker {
        Some(m) => m.previous.clone(),
        None => planned.filter(|p| !fenced(kind, p)).map_or_else(|| now.clone(), str::to_string),
    };
    let owner = op_id.map(str::to_string).or_else(|| marker.as_ref().and_then(|m| m.op_id.clone()));
    if marker.as_ref().map(|m| (&m.service, &m.op_id)) != Some((&service.to_string(), &owner)) {
        let m = Marker {
            v: MARKER_FORMAT,
            service: service.to_string(),
            previous: previous.clone(),
            op_id: owner,
            zaman: timefmt::iso_millis(env.clock.now_ms()),
        };
        let body = serde_json::to_vec_pretty(&m).map_err(|e| e.to_string())?;
        env.fs.write_atomic(&layout.fence_marker(), &body).map_err(|e| format!("çit işareti yazılamadı: {e}"))?;
    }
    if !fenced(kind, &now) {
        env.svc
            .set_start_mode(service, start_mode::DEMAND)
            .map_err(|e| format!("{service} başlangıç türü {} yapılamadı: {e}", start_mode::DEMAND))?;
    }
    let after = measure(env, service)?;
    if !fenced(kind, &after) {
        return Err(format!("{service} başlangıç türü yazıldı ama ölçü {after:?} (beklenen {})", start_mode::DEMAND));
    }
    Ok(json!({ "olcum": after, "eskiTur": previous, "citKuruldu": true }))
}

/// Çiti kaldırır: işaret varsa eski tür geri yazılır, doğrulanır, işaret silinir. İşaret yoksa iş yok (tür bizim değil).
pub fn lift(env: &Env, layout: &Layout) -> Result<Value, String> {
    let Some(m) = read(env, layout) else {
        if env.fs.exists(&layout.fence_marker()) {
            return Err(format!("çit işareti {} okunamadı — eski tür bilinmiyor, elle bakılmalı", layout.fence_marker().display()));
        }
        return Ok(json!({ "citKaldirildi": false }));
    };
    let now = measure(env, &m.service)?;
    if now != m.previous {
        env.svc
            .set_start_mode(&m.service, &m.previous)
            .map_err(|e| format!("{} başlangıç türü {} geri yazılamadı: {e}", m.service, m.previous))?;
        let after = measure(env, &m.service)?;
        if after != m.previous {
            return Err(format!("{} başlangıç türü geri yazıldı ama ölçü {after:?} (beklenen {})", m.service, m.previous));
        }
    }
    env.fs.remove_file(&layout.fence_marker()).map_err(|e| format!("çit işareti silinemedi: {e}"))?;
    Ok(json!({ "citKaldirildi": true, "tur": m.previous }))
}

/// İşlemin son adımı ve telafisi: backend'i (çit yüzünden açılışta başlamamışsa) başlatır, sonra çiti kaldırır. Sıra
/// bilinçli: tür önce geri yazılsaydı arada yeniden açılış, işlem hâlâ açıkken backend'i SCM'e başlattırırdı.
pub fn finish(
    ctx: &crate::operation::Ctx,
    ensure_running: &dyn Fn() -> Result<(), crate::operation::StepError>,
) -> Result<Value, crate::operation::StepError> {
    let service = ctx.settings.backend_service();
    if !matches!(ctx.env.svc.state(service), Ok(SvcState::Running | SvcState::Starting)) {
        ensure_running()?;
    }
    lift(ctx.env, ctx.layout).map_err(|m| crate::operation::step_err(codes::CIT_HATASI, m))
}

/// İşlem dışı tur (açık işlem yokken): işareti bırakan işlem BASARILI/GERI_DONDU bitmişse çit kaldırılır — işlemi
/// W2 öncesi bir ikili (tanımadığı `CIT` adımıyla) sonuçlandırdıysa. `HATA`da çit kalır (§2.2: insan; `cit --kaldir`).
pub fn settle(env: &Env, layout: &Layout, last: Option<&crate::journal::OpView>) -> Option<Result<Value, String>> {
    let m = read(env, layout)?;
    let last = last?;
    let done = last.result().and_then(|r| r.get("sonuc")).and_then(Value::as_str).is_some_and(|r| matches!(r, "BASARILI" | "GERI_DONDU"));
    (m.op_id.as_deref() == Some(last.op.as_str()) && done).then(|| lift(env, layout))
}
