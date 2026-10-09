//! `tekserp-guncelleyici` — TeksERP güncelleyici hizmeti (`TeksERP-Guncelleyici`, LocalSystem).
//!
//!   hizmet --kok <KOK> [--veri <D>] [--ad <ad>]   SCM'in başlattığı kip (ImagePath argümanları)
//!   tur --kok <KOK> [--veri <D>]    tek tur ön planda (tanı; yarım işlemi de sonuçlandırır)
//!   onar --kok <KOK> [--veri <D>] [--ad <ad>] [--yalniz-asil-ad]   karşılıklı onarım (W1b, `onarim.rs`): hizmetin
//!                                   ikilisi eksik/bozuksa doğrulanmış kaynaktan geri koyar. W1 ikilisinde `onar` =
//!                                   `tur` takma adıydı: onu çağıran görev/birim yalnız künyesinde `"onarim":1` olanı gösterir
//!   durum --kok <KOK> [--veri <D>]  durum.json + son işlemin özeti
//!   hizmet-kur --kok <KOK> [--veri <D>] [--ad <ad>]   kaydet/güncelle (yönetici)
//!   hizmet-kaldir [--ad <ad>]       durdur + sil (yönetici)
//!   onar --yalniz-asil-ad --kok <KOK> ...   Linux taban biriminin onarım satırı (tur koşmaz; W1b §4.7)
//!
//! Aynı makinede ikinci kanal: güncelleyici kendi adını (`--ad`, varsayılan `TeksERP-Guncelleyici`) ve
//! kendi veri kökünü (`--veri`; backend'in `TEKSERP_GUNCELLEME_DIZINI` = `<veri>\guncelleme`) alır; yönettiği
//! backend hizmetinin adı `ayar.json` `backendHizmeti`dir (kanal kaydı `backend.hizmetAdi`).
//!   kunye                           {ad, surum, hedef, testCapasi, capaKipi, paketZinciri} JSON (kendini güncellemede sınanır)
//!   kurulum-paket --zip <z> --hedef <d>                 setup.exe: backend paketini aç + doğrula (§1.5)
//!   kurulum-pg --kunye <pg.json> --zip <z> --hedef <d>  setup.exe: PG paketini aç + doğrula (§1.6)
//!   kurulum-dizin --dizin <d>                         setup.exe onarımı: açılmış sürüm dizinini yeniden ölç
//!   tani --kok <KOK> [--veri <D>] [--ad <ad>] --cikti <z>  tanı paketi (sırsız zip; gönderilmez — `tani.rs`)
//!
//! Sözleşme: docs/design/GUNCELLEYICI.md §4–§13.
use std::process::ExitCode;
use std::sync::Arc;
use tekserp_guncelleyici::cli::{data_arg, root_arg};
use tekserp_guncelleyici::engine::{Engine, TickResult};
use tekserp_guncelleyici::journal::Journal;
use tekserp_guncelleyici::layout::Layout;
use tekserp_guncelleyici::trust::{TrustAnchor, ANCHOR_MODE, TEST_ANCHOR};
use tekserp_guncelleyici::{env, lock, settings};
use tekserp_hizmet::logfile::{LogSpec, RotatingLog};

fn identity() -> String {
    serde_json::json!({
        "ad": "tekserp-guncelleyici",
        "surum": env!("CARGO_PKG_VERSION"),
        "hedef": tekserp_guncelleyici::selfupdate::OWN_TARGET,
        "testCapasi": TEST_ANCHOR,
        "capaKipi": ANCHOR_MODE,
        "paketZinciri": true,
        // `onar` alt komutunu (W1b) tanır — onarım görevi yalnız bunu taşıyan ikiliyi çağırır.
        "onarim": 1,
    })
    .to_string()
}

fn one_tick(args: &[String]) -> Result<u32, String> {
    let root = root_arg(args)?;
    let layout = Layout::new(&root, &data_arg(args, &root));
    let _lock = lock::acquire(&layout.lock_file()).map_err(|e| format!("KILIT_DOLU: {e}"))?;
    let s = settings::read_settings(&env::RealFs, &layout).unwrap_or_default();
    let e = env::real(s.proxy.as_deref(), &tekserp_hizmet::contract::service_name_arg(args, tekserp_hizmet::contract::UPDATER_SERVICE)?)?;
    let e = tekserp_guncelleyici::platform::baglam(e, &layout, &s)?;
    let log = Arc::new(RotatingLog::open(&layout.log_dir(), "guncelleyici", LogSpec::SERVICE));
    let engine = Engine::new(e, layout.clone(), TrustAnchor::for_process()?, log, None);
    let r = engine.tick(&|| false);
    println!("{}", String::from_utf8_lossy(&std::fs::read(layout.status_file()).unwrap_or_default()));
    Ok(u32::from(r == TickResult::RestartForSelfUpdate))
}

fn repair(args: &[String]) -> Result<u32, String> {
    use tekserp_guncelleyici::onarim;
    let root = root_arg(args)?;
    let name = tekserp_hizmet::contract::service_name_arg(args, tekserp_hizmet::contract::UPDATER_SERVICE)?;
    let layout = Layout::new(&root, &data_arg(args, &root)).with_service(&name);
    let own = std::env::current_exe().map_err(|e| format!("kendi yolu okunamadı: {e}"))?;
    let e = env::real(None, &name)?;
    let trust = TrustAnchor::for_process().ok().map(|a| onarim::installed_trust(&e, &layout, &a));
    let opts = onarim::Options { yalniz_asil_ad: args.iter().any(|a| a == "--yalniz-asil-ad") };
    let out = onarim::onar(&e, &layout, &own, trust.as_ref(), &opts);
    println!("{out:?}");
    Ok(out.exit_code())
}

fn show_status(args: &[String]) -> Result<u32, String> {
    let root = root_arg(args)?;
    let layout = Layout::new(&root, &data_arg(args, &root));
    println!("{}", String::from_utf8_lossy(&std::fs::read(layout.status_file()).unwrap_or_else(|_| b"{}".to_vec())));
    if let Ok(j) = Journal::open(&env::RealFs, &layout.journal_file()) {
        if let Some(v) = j.last_op() {
            println!(
                "son işlem {} — {} kayıt, sonuç: {}",
                v.op,
                v.records.len(),
                v.result().map_or("YARIM".to_string(), |r| r.to_string())
            );
        }
    }
    Ok(0)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().cloned().unwrap_or_default();
    let result = match command.as_str() {
        "kunye" => {
            println!("{}", identity());
            Ok(0)
        }
        "tur" => one_tick(&args),
        "onar" => repair(&args),
        "durum" => show_status(&args),
        "hizmet" | "hizmet-kur" | "hizmet-kaldir" => tekserp_guncelleyici::platform::service_command(&command, &args),
        "kurulum-paket" | "kurulum-pg" | "kurulum-dizin" => tekserp_guncelleyici::kurulum::komut(&command, &args),
        "tani" => tekserp_guncelleyici::tani::komut(&args, &identity()),
        _ => Err(
            "kullanım: tekserp-guncelleyici <hizmet|tur|onar|durum|hizmet-kur|hizmet-kaldir|kunye|kurulum-paket|kurulum-pg|kurulum-dizin|tani> [--kok <dizin>] [--veri <dizin>] [--ad <hizmet adı>]"
                .into(),
        ),
    };
    match result {
        Ok(code) => ExitCode::from(u8::try_from(code).unwrap_or(1)),
        Err(e) => {
            eprintln!("tekserp-guncelleyici: {e}");
            ExitCode::from(2)
        }
    }
}
