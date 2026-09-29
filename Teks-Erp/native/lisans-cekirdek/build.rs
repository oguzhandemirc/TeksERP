// N-API bağlama ayarı yalnız `napi` özelliği açıkken (cdylib → .node). `cargo test`
// özelliksiz koşar; orada node sembolleri aranmaz. Hedef üçlüsü künyeye gömülür.
fn main() {
    let target = std::env::var("TARGET").unwrap_or_else(|_| "bilinmiyor".to_string());
    println!("cargo:rustc-env=LISANS_CEKIRDEK_HEDEF={target}");
    if std::env::var_os("CARGO_FEATURE_NAPI").is_some() {
        napi_build::setup();
    }
}
