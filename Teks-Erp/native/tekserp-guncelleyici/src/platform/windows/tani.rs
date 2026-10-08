//! Tanı paketinin Windows ölçümleri (W4): güncelleyici · backend · PG hizmetlerinin SCM durumu, başlangıç türü,
//! hesabı, komut satırı ve kurtarma ayarı. Fail-soft: okunamayan alan hata metniyle girer.
use crate::tani::{Olcum, TaniHedefi};
use serde_json::{json, Value};
use tekserp_hizmet::windows::scm;
use windows_service::service::ServiceAccess;
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

fn config(name: &str) -> Result<Value, String> {
    let m = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT).map_err(|e| e.to_string())?;
    let h = m.open_service(name, ServiceAccess::QUERY_CONFIG).map_err(|e| e.to_string())?;
    let c = h.query_config().map_err(|e| e.to_string())?;
    Ok(json!({
        "baslangicTuru": format!("{:?}", c.start_type),
        "hesap": c.account_name.map(|a| a.to_string_lossy().into_owned()),
        "komutSatiri": c.executable_path.to_string_lossy(),
        "bagimliliklar": c.dependencies.iter().map(|d| format!("{d:?}")).collect::<Vec<_>>(),
    }))
}

fn service(name: &str) -> Value {
    let durum = scm::status(name).map_or_else(|e| json!(format!("okunamadı: {e}")), |s| json!(format!("{s:?}")));
    let mut v = json!({ "ad": name, "durum": durum });
    if matches!(scm::status(name), Ok(scm::Status::Missing)) {
        return v;
    }
    v["yapilandirma"] = config(name).unwrap_or_else(|e| json!(format!("okunamadı: {e}")));
    v["kurtarma"] = match scm::recovery(name) {
        Ok(r) => json!({
            "eylemler": r.actions.iter().map(|(t, ms)| json!({ "tur": t, "gecikmeMs": ms })).collect::<Vec<_>>(),
            "sifirlamaSn": r.reset_s,
            "cokmesizHatada": r.non_crash,
        }),
        Err(e) => json!(format!("okunamadı: {e}")),
    };
    v["cokmeCikisKodu"] = scm::crash_exit_code(name).map_or_else(|e| json!(format!("okunamadı: {e}")), |c| json!(c));
    v
}

pub fn olcumler(h: &TaniHedefi) -> Vec<Olcum> {
    let names = [h.updater_service.as_str(), h.backend_service.as_str(), tekserp_hizmet::contract::PG_SERVICE];
    let v = Value::Array(names.iter().map(|n| service(n)).collect());
    vec![Olcum::new(
        "platform/hizmetler.json",
        "SCM: durum · başlangıç türü · hesap · komut satırı · kurtarma (güncelleyici · backend · PG)",
        v.to_string(),
    )]
}
