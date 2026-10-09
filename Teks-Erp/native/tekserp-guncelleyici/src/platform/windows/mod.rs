//! Windows arka ucu: backend bir Windows hizmetidir (`tekserp-hizmet` konağı, SCM), sağlık döngü adresinden
//! HTTP ile ölçülür, araçlar sürüm dizininin `runtime\node`u ve kurulu PG araçlarıyla koşar, PG küçük sürümü
//! ImagePath + `pgsql\bin` bağlantısıdır. Arka uç her hedefte derlenir (sahte dünyanın Windows profili);
//! Win32 bağları (`sys`) ve SCM hizmet yapıştırıcısı (`service`) yalnız Windows'ta.
pub mod araclar;
pub mod pg;
#[cfg(windows)]
pub mod service;
#[cfg(windows)]
pub mod sys;
#[cfg(windows)]
pub mod tani;

use crate::env::{Env, EnvResult, HttpResponse};
use std::sync::Arc;
use std::time::Duration;

/// İşlem günlüğünün `platform`u (bildirimin platform sözlüğüyle aynı ad).
pub const PLATFORM: &str = "win32-x64";
/// Paketteki güncelleyici ikilisi (`runtime\\tekserp-guncelleyici.exe`; imzalı listede `/` ayraçlı).
pub const GUNCELLEYICI_PAKET_YOLU: &str = "runtime/tekserp-guncelleyici.exe";

pub fn arka_ucu() -> crate::platform::Arka {
    crate::platform::Arka {
        ortam: crate::settings::OrtamKipi::Hizmet,
        platform: PLATFORM,
        guncelleyici_paket_yolu: GUNCELLEYICI_PAKET_YOLU,
        saglik: Arc::new(HttpSaglik),
        araclar: Arc::new(araclar::NodeAraclar),
        pg: Arc::new(pg::ImagePathPg),
    }
}

fn endpoint(port: u16, path: &str) -> String {
    format!("http://127.0.0.1:{port}{path}")
}

/// Sağlık sondası: yalnız döngü adresi (`/health/yerel` dışarıdan gelen isteğe cevap vermez).
pub struct HttpSaglik;

impl crate::platform::Saglik for HttpSaglik {
    fn probe(&self, env: &Env, port: u16, path: &str) -> EnvResult<HttpResponse> {
        env.net.get(&endpoint(port, path), &[], Duration::from_secs(5))
    }

    fn address(&self, port: u16, path: &str) -> String {
        endpoint(port, path)
    }

    /// Konağın hizmete özgü çıkış kodunun anlamı (`tekserp_hizmet::contract::exit`).
    fn exit_meaning(&self, code: u32) -> &'static str {
        use tekserp_hizmet::contract::exit;
        match code {
            exit::NODE_UNEXPECTED => "node beklenmedik çıktı",
            exit::NODE_NOT_STARTED => "node başlatılamadı",
            exit::ENV_FILE => ".env yok/okunamadı",
            exit::JOB_OBJECT => "iş nesnesi kurulamadı",
            exit::CURRENT_LINK => "current çözülemedi",
            _ => "konak hatası",
        }
    }
}
