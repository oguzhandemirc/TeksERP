//! Sözleşmenin dondurulması (`docs/design/GUNCELLEYICI.md` §15): bu ikili, yayınlanmış her güncelleyicinin ve
//! kurulum/backend yazıcısının bıraktığı dosyaları okur ve yarım işlemini sonuca götürür. Vektörler
//! `test-vektorleri/guncelleyici-{gunluk,ayar,niyet,durum}/` altındadır, silinmez ve değiştirilmez
//! (`eski_bicim_vektorleri_donmus`).
mod common;

use common::eski_bicim::{files_under, vectors_dir};
use common::*;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tekserp_guncelleyici::env::RealFs;
use tekserp_guncelleyici::ipc::{self, IntentRead};
use tekserp_guncelleyici::journal::{self, Journal};
use tekserp_guncelleyici::layout::Layout;
use tekserp_guncelleyici::settings;

/// Dondurulmuş vektör klasörleri; listedeki her dosya `guncelleyici-eski-bicim.sha256`te özetiyle durur.
const FROZEN_DIRS: &[&str] = &["guncelleyici-gunluk", "guncelleyici-ayar", "guncelleyici-niyet", "guncelleyici-durum"];
const MANIFEST: &str = "guncelleyici-eski-bicim.sha256";
/// Cırcır: dondurulmuş vektör sayısı. Düşerse vektör silinmiştir (yasak); artarsa taban da artırılır.
const TABAN: usize = 85;
/// `1` iken eksik özet satırlarını EKLER (var olanı değiştirmez, silinmiş dosyayı affetmez).
const APPEND_ENV: &str = "TEKSERP_ESKI_BICIM_LISTE_EKLE";

fn read_json(p: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

fn vectors_in(kind: &str) -> Vec<PathBuf> {
    let files: Vec<PathBuf> =
        files_under(&vectors_dir().join(kind)).into_iter().filter(|p| p.extension().is_some_and(|e| e == "json")).collect();
    assert!(!files.is_empty(), "{kind}: vektör yok");
    files
}

fn label(p: &Path) -> String {
    p.strip_prefix(vectors_dir()).unwrap().to_string_lossy().replace('\\', "/")
}

fn tmp_layout(tag: &str) -> (PathBuf, Layout) {
    let d = std::env::temp_dir().join(format!("tekserp-eski-bicim-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    let layout = Layout::new(&d.join("kok"), &d.join("programdata"));
    (d, layout)
}

/// Eski güncelleyicinin her adımda yarım bıraktığı işlem: bu ikili onu ESKİ İKİLİNİN VARDIĞI sonuca götürür
/// (değişmezler + aynı son durum + aynı hata kodu).
#[test]
fn eski_gunluk_surdurulur() {
    let mut by_source = std::collections::BTreeMap::<String, usize>::new();
    for p in vectors_in("guncelleyici-gunluk") {
        let doc = read_json(&p);
        let ctx = label(&p);
        *by_source.entry(doc["kaynak"]["etiket"].as_str().unwrap().to_string()).or_default() += 1;
        let w = World::from_vector("eski-gunluk", &doc);
        assert!(w.unfinished(), "{ctx}: vektörde yarım işlem yok");
        w.run_to_rest(0);
        assert_invariants(&w, &ctx);
        let st = w.status().unwrap();
        let old = &doc["eskiSonuc"];
        assert_eq!(format!("{:?}", st.state), old["durum"].as_str().unwrap(), "{ctx}: eski ikiliden farklı son durum ({:?})", st.message);
        assert_eq!(st.error_code.as_deref(), old["hataKodu"].as_str(), "{ctx}: eski ikiliden farklı hata kodu");
    }
    assert!(by_source.contains_key("0.1.3-backend-v2.14.0"), "yayınlanmış ilk güncelleyicinin vektörleri yok: {by_source:?}");
}

/// Daha yeni bir ikilinin günlüğü (kendini güncellemenin A/B dönüşü): tanınmayan adım sürdürülmez, işlem geri alınır.
#[test]
fn bilinmeyen_adim_geri_alinir() {
    let p = vectors_in("guncelleyici-gunluk")
        .into_iter()
        .find(|p| label(p).starts_with("guncelleyici-gunluk/0.1.3-backend-v2.14.0/basarili/") && label(p).ends_with("-bitti-goc.json"))
        .expect("BITTI GOC vektörü");
    let doc = read_json(&p);
    let w = World::from_vector("gelecek-adim", &doc);
    let file = w.layout.journal_file();
    let text = std::fs::read_to_string(&file).unwrap();
    let op = text.lines().next().map(|l| serde_json::from_str::<Value>(l).unwrap()["islemId"].as_str().unwrap().to_string()).unwrap();
    let seq = text.lines().count();
    let extra = format!(
        "{{\"sira\":{},\"islemId\":\"{op}\",\"olay\":\"BASLADI\",\"adim\":\"GELECEK_ADIM\",\"zaman\":\"2026-09-30T23:31:00.000Z\",\"veri\":null}}\n",
        seq + 1
    );
    std::fs::write(&file, text + &extra).unwrap();
    w.run_to_rest(0);
    assert_invariants(&w, "bilinmeyen adım");
    let st = w.status().unwrap();
    assert_eq!(format!("{:?}", st.state), "RolledBack", "{:?}", st.message);
    assert_eq!(st.error_code.as_deref(), Some("KESINTI"));
    assert!(st.last.expect("son").data_restored, "göç bitmişti: DB yedekten dönmeli");
}

/// Bu ikilinin başlattığı işlem ISLEM satırında `v` ve `platform` taşır; profil iskeletiyle (`senaryo`) koşar.
#[test]
fn yeni_islem_bicim_ve_platform_yazar() {
    senaryo("yeni işlem", |profil, ctx| {
        let w = World::new_in(profil, "bicim", Setup::default());
        w.run_to_rest(0);
        assert_invariants(&w, ctx);
        let j = Journal::open(&RealFs, &w.layout.journal_file()).unwrap();
        let begin = &j.last_op().unwrap().records[0];
        assert_eq!((begin.format, begin.platform.as_deref()), (Some(journal::FORMAT), Some(profil.platform())), "{ctx}: ISLEM satırı");
    });
}

/// Kurulumun/elle yazılmış eski `ayar.json` okunur ve aynı değerleri verir.
#[test]
fn eski_ayar_okunur() {
    for p in vectors_in("guncelleyici-ayar") {
        let doc = read_json(&p);
        let ctx = label(&p);
        assert_eq!(doc["v"], 1, "{ctx}: tanınmayan vektör biçimi");
        let (d, layout) = tmp_layout("ayar");
        std::fs::create_dir_all(layout.settings_file().parent().unwrap()).unwrap();
        std::fs::write(layout.settings_file(), doc["dosya"].as_str().unwrap()).unwrap();
        let s = settings::read_settings(&RealFs, &layout).unwrap_or_else(|e| panic!("{ctx}: {e}"));
        let got = serde_json::json!({
            "guncellemeSunucusu": s.server, "vekil": s.proxy, "backendHizmeti": s.backend_service(),
            "saglikZamanAsimiSn": s.health_timeout_s, "durdurmaZamanAsimiSn": s.stop_timeout_s, "gocZamanAsimiSn": s.migrate_timeout_s,
            "yedekZamanAsimiSn": s.backup_timeout_s, "turAraligiSn": s.tick_s,
        });
        assert_eq!(got, doc["beklenen"], "{ctx}");
        assert!(s.server_base().is_ok(), "{ctx}: sunucu kökü reddedildi");
        let _ = std::fs::remove_dir_all(d);
    }
}

/// Backend'in eski niyet yazıcısının dosyası okunur: belirteç ve onay aynen.
#[test]
fn eski_niyet_okunur() {
    for p in vectors_in("guncelleyici-niyet") {
        let doc = read_json(&p);
        let ctx = label(&p);
        assert_eq!(doc["v"], 1, "{ctx}: tanınmayan vektör biçimi");
        let (d, layout) = tmp_layout("niyet");
        std::fs::create_dir_all(layout.intent_file().parent().unwrap()).unwrap();
        std::fs::write(layout.intent_file(), doc["dosya"].as_str().unwrap()).unwrap();
        let got = match ipc::read_intent(&RealFs, &layout) {
            IntentRead::Ok(i) => serde_json::json!({
                "gecerli": true,
                "belirtec": i.download.as_ref().map(|t| t.token.clone()),
                "bitis": i.download.as_ref().map(|t| t.expires.clone()),
                "onay": i.approval.as_ref().map(|a| serde_json::json!({ "onayId": a.id, "surum": a.version, "zamanlama": a.timing })),
            }),
            IntentRead::Invalid(e) => panic!("{ctx}: niyet reddedildi: {e}"),
            IntentRead::Missing => panic!("{ctx}: niyet okunmadı"),
        };
        assert_eq!(got, doc["beklenen"], "{ctx}");
        let _ = std::fs::remove_dir_all(d);
    }
}

/// Satır sonu çevirisi (Windows `core.autocrlf`) özeti değiştirmesin: CRLF → LF sayılır.
fn digest(p: &Path) -> String {
    let b = std::fs::read(p).unwrap();
    let mut out = Vec::with_capacity(b.len());
    for (i, x) in b.iter().enumerate() {
        if !(*x == b'\r' && b.get(i + 1) == Some(&b'\n')) {
            out.push(*x);
        }
    }
    sha_hex(&out)
}

/// Dondurulmuş vektörler: her dosya listede, her liste satırı diskte ve özeti aynı, sayı tabana eşit (cırcır).
#[test]
fn eski_bicim_vektorleri_donmus() {
    let root = vectors_dir();
    let manifest_path = root.join(MANIFEST);
    let text = std::fs::read_to_string(&manifest_path).unwrap_or_default();
    let mut listed: Vec<(String, String)> = vec![];
    for l in text.lines().filter(|l| !l.trim().is_empty()) {
        let (h, rel) = l.split_once("  ").unwrap_or_else(|| panic!("{MANIFEST}: biçimsiz satır {l}"));
        listed.push((h.to_string(), rel.to_string()));
    }
    let mut on_disk: Vec<String> = vec![];
    for kind in FROZEN_DIRS {
        on_disk.extend(files_under(&root.join(kind)).iter().map(|p| label(p)));
    }
    let mut errors = vec![];
    for (h, rel) in &listed {
        let p = root.join(rel);
        if !p.exists() {
            errors.push(format!("SİLİNMİŞ: {rel} — dondurulmuş vektör silinmez"));
        } else if digest(&p) != *h {
            errors.push(format!("DEĞİŞMİŞ: {rel} — dondurulmuş vektör düzenlenmez, yeni etiketle eklenir"));
        }
    }
    let missing: Vec<&String> = on_disk.iter().filter(|r| !listed.iter().any(|(_, l)| l == *r)).collect();
    if !missing.is_empty() && std::env::var(APPEND_ENV).as_deref() == Ok("1") && errors.is_empty() {
        let mut out = text.clone();
        for rel in &missing {
            out.push_str(&format!("{}  {rel}\n", digest(&root.join(rel.as_str()))));
        }
        std::fs::write(&manifest_path, out).unwrap();
        panic!("{} satır eklendi — TABAN'ı {} yapın ve yeniden koşun", missing.len(), listed.len() + missing.len());
    }
    for rel in &missing {
        errors.push(format!("LİSTEDE YOK: {rel} — `{APPEND_ENV}=1` ile listeye eklenir"));
    }
    assert!(errors.is_empty(), "{MANIFEST}:\n{}", errors.join("\n"));
    assert!(listed.len() >= TABAN, "vektör sayısı DÜŞTÜ: {} < taban {TABAN} — dondurulmuş vektör silinmez", listed.len());
    assert_eq!(listed.len(), TABAN, "vektör sayısı arttı ({}): TABAN'ı {} yapın (cırcır)", listed.len(), listed.len());
}
