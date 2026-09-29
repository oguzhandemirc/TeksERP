//! N-API yapıştırıcısı — ince katman: JSON metni al, `api` fonksiyonunu çağır, JSON metni döndür.
//! Panik JS istisnasına döner (`catch_unwind`); native hata backend sürecini DÜŞÜRMEZ.
use crate::api;
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Task};
use napi_derive::napi;
use serde_json::Value;

fn parse(request: &str) -> Result<Value> {
    serde_json::from_str(request).map_err(|e| Error::from_reason(format!("lisans-cekirdek: istek JSON değil ({e})")))
}

fn call(request: &str, f: fn(&Value) -> Value) -> Result<String> {
    Ok(f(&parse(request)?).to_string())
}

fn call_fallible(request: &str, f: fn(&Value) -> std::result::Result<Value, String>) -> Result<String> {
    f(&parse(request)?).map(|v| v.to_string()).map_err(|m| Error::from_reason(format!("lisans-cekirdek: {m}")))
}

/// Künye: ad · sürüm · abi · platform · arch · hedef · test çapası · ayna listeleri.
#[napi(catch_unwind)]
pub fn kunye() -> String {
    api::identity().to_string()
}

#[napi(catch_unwind)]
pub fn builtin_anchor() -> String {
    api::builtin_anchor().to_string()
}

#[napi(catch_unwind)]
pub fn verify_jws(request: String) -> Result<String> {
    call(&request, api::verify_jws)
}

#[napi(catch_unwind)]
pub fn verify_certificate(request: String) -> Result<String> {
    call(&request, api::verify_certificate)
}

#[napi(catch_unwind)]
pub fn verify_entitlement(request: String) -> Result<String> {
    call(&request, api::verify_entitlement)
}

#[napi(catch_unwind)]
pub fn verify_lease(request: String) -> Result<String> {
    call(&request, api::verify_lease)
}

#[napi(catch_unwind)]
pub fn check_lease_binding(request: String) -> Result<String> {
    call(&request, api::check_lease_binding)
}

#[napi(catch_unwind)]
pub fn normalize_factor(request: String) -> Result<String> {
    call(&request, api::normalize_factor)
}

#[napi(catch_unwind)]
pub fn digest_fingerprint(request: String) -> Result<String> {
    call_fallible(&request, api::digest_fingerprint)
}

#[napi(catch_unwind)]
pub fn unwrap_module_key(request: String) -> Result<String> {
    call(&request, api::unwrap_module_key)
}

/// İş parçacığı havuzunda koşan istek (süreç başlatma, dosya özetleme) — olay döngüsü bloke olmaz.
pub struct BlockingCall {
    request: String,
    run: fn(&str) -> Result<String>,
}

impl Task for BlockingCall {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        let (run, request) = (self.run, self.request.clone());
        std::panic::catch_unwind(move || run(&request))
            .unwrap_or_else(|_| Err(Error::from_reason("lisans-cekirdek: iç hata (panik yakalandı)")))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// OS parmak izi (f1..f4) + çağıranın f5'i → yalnız tuzlu özet. En çok 20 sn (süreç zaman aşımı).
#[napi]
pub fn collect_fingerprint(request: String) -> AsyncTask<BlockingCall> {
    AsyncTask::new(BlockingCall { request, run: |r| call_fallible(r, api::collect_fingerprint) })
}

/// İmzalı dosya listesine karşı dosya özetleri.
#[napi]
pub fn verify_integrity(request: String) -> AsyncTask<BlockingCall> {
    AsyncTask::new(BlockingCall { request, run: |r| call(r, api::verify_integrity) })
}
