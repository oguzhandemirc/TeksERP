//! Disk dolu (W3a, plan §2.3 · §9.3 `disk_dolu_her_yazimda`): bir güncellemenin (ve geri dönüşün) yer isteyen HER
//! yazımında disk dolar ve DOLU KALIR. İnsan yer açmadan önce: açık işlem kalmaz (yedek alan bırakılır, işlem geri
//! alınır), tek backend `current`in sürümünü ve onunla uyumlu şemayı koşar, kurulu sürüm silinmez, yarım kopya yok,
//! `durum.json` ve işlem günlüğü okunur. Yer açılınca: değişmezler (`assert_invariants`) ve yedek alan yeniden kurulu.
mod common;

use common::*;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::Ordering;
use tekserp_guncelleyici::env::{RealFs, SvcState};
use tekserp_guncelleyici::ipc::State;
use tekserp_guncelleyici::journal::Journal;

fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    walk(dir, &mut |p| {
        out.insert(p.strip_prefix(dir).unwrap().display().to_string(), std::fs::read(p).unwrap());
    });
    out
}

/// Yarım kopya yok (atomik yazımın/kopyanın `.tmp`'si, yarım yedek alan) · günlükte yırtık satır yok · durum okunur.
fn assert_no_half_writes(w: &World, ctx: &str) {
    let mut half = vec![];
    walk(&w.dir, &mut |p| {
        if name(p).ends_with(".tmp") {
            half.push(p.display().to_string());
        }
    });
    assert!(half.is_empty(), "{ctx}: yarım kopya: {half:?}");
    let reserve = w.layout.reserve_file();
    if let Ok(m) = std::fs::metadata(&reserve) {
        assert_eq!(m.len(), TEST_RESERVE, "{ctx}: yarım yedek alan dosyası");
    }
    let raw = std::fs::read(w.layout.journal_file()).unwrap_or_default();
    assert!(raw.is_empty() || raw.ends_with(b"\n"), "{ctx}: işlem günlüğünde yarım satır");
    for line in raw.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
        assert!(serde_json::from_slice::<serde_json::Value>(line).is_ok(), "{ctx}: işlem günlüğünde bozuk satır");
    }
    // Hiç yazılamamış olabilir (ilk tur dolu diske denk geldi); varsa okunur.
    assert!(!w.layout.status_file().exists() || w.status().is_some(), "{ctx}: durum.json bozuk");
}

/// Disk HÂLÂ doluyken: açık işlem yok, backend `current`i ve uyumlu şemayı koşuyor, çit kalkmış.
fn assert_safe_while_full(w: &World, ctx: &str) {
    let j = Journal::open(&RealFs, &w.layout.journal_file()).expect("günlük");
    assert!(j.unfinished().is_none(), "{ctx}: disk doluyken işlem açık kaldı (yedek alan işe yaramadı)");
    let b = w.backend();
    assert_eq!(b.state, SvcState::Running, "{ctx}: backend çalışmıyor");
    assert!(b.args.is_empty(), "{ctx}: backend doğrulama kipinde: {:?}", b.args);
    let cur = w.current().unwrap_or_else(|| panic!("{ctx}: current yok"));
    assert_eq!(b.version.as_deref(), Some(cur.as_str()), "{ctx}: backend current'ı koşmuyor");
    let db = w.db();
    assert_eq!((db.finished, db.total, db.data), (migrations_of(&cur), migrations_of(&cur), 42), "{ctx}: şema current'la uyumsuz");
    assert!(!w.layout.fence_marker().exists(), "{ctx}: çit kalmış");
    // Bitmiş işlemin sonucu durumda: panel "uygulanıyor" görmez (sonuç yazımı yedek alanı kullanır).
    if let Some(r) = j.last_op().and_then(|v| v.result().cloned()) {
        let want = match r["sonuc"].as_str() {
            Some("BASARILI") => State::Succeeded,
            Some("GERI_DONDU") => State::RolledBack,
            _ => State::Failed,
        };
        assert_eq!(w.state(), Some(want), "{ctx}: durum.json işlemin sonucuyla tutarsız");
    }
}

/// Nokta adı dünyadan bağımsız: işlem kimliği (UUID) ve dünya dizini atılır — iki yolun öneki karşılaştırılabilsin.
fn same_world(l: &str) -> String {
    l.split(' ')
        .map(|t| {
            if t.len() == 36 && t.matches('-').count() == 4 {
                "<islem>".to_string()
            } else if t.contains("tekserp-gy-") {
                Path::new(t).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
            } else {
                t.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Bekçinin dolaşacağı noktalar (kapsam korunarak): yer isteyen noktalardan, aynı işlem günlüğü kesitinde art arda
/// gelen AYNI yazımın yalnız ilki (aralarında yer isteyen başka yazım yok ⇒ dolu disk aynı yerden düşer) ve
/// `skip_prefix` verilirse ondan sonrakiler (önceki yol o öneki zaten dolaştı; dünya o noktaya dek aynı).
fn representatives(w: &World, skip_prefix: usize) -> (Vec<u64>, usize) {
    let log = w.crash.log.lock().unwrap().clone();
    let what = |k: u64| log[k as usize - 1].split_once(':').map(|(_, x)| x.to_string()).unwrap_or_default();
    let mut space = w.crash.space_points.lock().unwrap().clone();
    space.dedup();
    let all = space.len();
    let mut out: Vec<u64> = vec![];
    let mut prev: Option<(usize, String)> = None;
    for k in space.into_iter().filter(|k| *k as usize > skip_prefix) {
        let segment = log[..k as usize - 1].iter().filter(|l| l.ends_with(":ekle islem.jsonl")).count();
        let key = (segment, what(k));
        if prev.as_ref() != Some(&key) {
            out.push(k);
        }
        prev = Some(key);
    }
    (out, all)
}

#[test]
fn disk_dolu_her_yazimda() {
    senaryo("disk_dolu_her_yazimda", |p, ctx| {
        eprintln!("{ctx}");
        let mut success_log: Vec<String> = vec![];
        for rollback in [false, true] {
            let setup = |tag: &str| {
                let w = World::new_in(p, tag, Setup::default());
                if rollback {
                    *w.faults.unhealthy_version.lock().unwrap() = Some(NEW.into());
                }
                w
            };
            let path = if rollback { "geri dönüşte" } else { "güncellemede" };
            let sayac = setup("disk-sayac");
            let old_files = snapshot(&sayac.layout.version_dir(OLD));
            sayac.count_points();
            let new_files = snapshot(&sayac.layout.version_dir(NEW));
            assert!(!old_files.is_empty() && !new_files.is_empty(), "{ctx}: sürüm dizini boş");
            let log = sayac.crash.log.lock().unwrap().clone();
            // Geri dönüş yolu güncelleme yolundan ayrıldığı noktaya dek aynı dünyadır: o önek bir kez dolaşılır.
            let log: Vec<String> = log.iter().map(|l| same_world(l)).collect();
            let prefix = if rollback { success_log.iter().zip(&log).take_while(|(a, b)| a == b).count() } else { 0 };
            let (points, all) = representatives(&sayac, prefix);
            // Linux: imaj yükleme (`docker load`) yer isteyen noktadır ve dolaşılır (L4c-2 hazırlık kolu).
            let load_point = (1..=log.len() as u64).find(|k| log[*k as usize - 1].ends_with(":surec docker load"));
            if p == Profil::Linux && !rollback {
                let k = load_point.unwrap_or_else(|| panic!("{ctx}: sayımda docker load yok"));
                assert!(points.contains(&k), "{ctx}: docker load yer isteyen nokta sayılmadı");
            }
            // İşlemin günlük satırları: ISLEM (ilk) ve SONUÇ (son). Aradaki her noktada disk dolarsa işlem GERİ ALINIR
            // (adım ilerletilmez); SONUÇ'tan sonra dolarsa sonuç değişmez.
            let journal: Vec<u64> = (1..=log.len() as u64).filter(|k| log[*k as usize - 1].ends_with(":ekle islem.jsonl")).collect();
            let (begin, result) = (journal[0], *journal.last().unwrap());
            eprintln!("{ctx} {path}: {} yer isteyen nokta, {} temsilci (önek {prefix})", all, points.len());
            assert!(points.len() > 10, "{ctx} {path}: temsilci nokta beklenenden az: {}", points.len());
            if !rollback {
                success_log = log;
            }
            // Her nokta kendi dünyasında: süre fsync beklemesi, işlemci boş — dört iş parçacığına bölünür.
            let check = |k: u64| -> String {
                let w = setup("disk");
                // İmaj yüzlerce MB ister, durum dosyası yüzlerce bayt: hazırlıktaki disk dolu panelde görünür.
                let at_load = Some(k) == load_point && !rollback;
                w.crash.small_fits.store(at_load, Ordering::SeqCst);
                w.enospc_at(k);
                let _ = w.run(3);
                let last = w.crash.log.lock().unwrap().iter().find(|l| l.starts_with(&format!("{k}:"))).cloned().unwrap_or_default();
                let ctx = format!("{ctx} {path} nokta {k} ({last})");
                assert!(w.crash.enospc_fired(), "{ctx}: disk dolmadı");
                assert_no_half_writes(&w, &ctx);
                assert_safe_while_full(&w, &ctx);
                assert_eq!(snapshot(&w.layout.version_dir(OLD)), old_files, "{ctx}: kurulu sürüm değişti/silindi");
                let st = w.status().map(|st| format!("{:?}/{}", st.state, st.error_code.as_deref().unwrap_or("-")));
                if at_load {
                    assert_eq!(st.as_deref(), Some("Waiting/DISK_DOLU"), "{ctx}: imaj yüklemede disk dolu görünmüyor");
                }
                let trail = w.crash.status_trail.lock().unwrap().clone();
                assert!(!trail.iter().any(|s| s == "HATA"), "{ctx}: disk dolu HATA'ya düşürdü (insan gerekir): {trail:?}");
                // İnsan yer açar: işlem sonuna varır, yedek alan yeniden kurulur.
                w.crash.free_disk();
                w.run_to_rest(4);
                let ctx = format!("{ctx} → yer açıldı");
                assert_invariants(&w, &ctx);
                assert_no_half_writes(&w, &ctx);
                assert_eq!(snapshot(&w.layout.version_dir(OLD)), old_files, "{ctx}: kurulu sürüm değişti/silindi");
                if w.state() == Some(State::Succeeded) {
                    assert_eq!(snapshot(&w.layout.version_dir(NEW)), new_files, "{ctx}: yeni sürüm dizini eksik/bozuk");
                }
                if rollback || (begin..result).contains(&k) {
                    assert_eq!(w.state(), Some(State::RolledBack), "{ctx}: açık işlemde disk doldu — geri alınmalıydı");
                } else if k >= result {
                    assert_eq!(w.state(), Some(State::Succeeded), "{ctx}: sonuç yazıldıktan sonra disk doldu");
                }
                assert_eq!(
                    std::fs::metadata(w.layout.reserve_file()).map(|m| m.len()).ok(),
                    Some(TEST_RESERVE),
                    "{ctx}: yedek alan yeniden kurulmadı"
                );
                st.unwrap_or_else(|| "durum yok".into())
            };
            let check = &check;
            let mut outcomes: BTreeMap<String, u32> = BTreeMap::new();
            let per = points.len().div_ceil(4);
            let results: Vec<String> = std::thread::scope(|sc| {
                let hs: Vec<_> = points.chunks(per).map(|c| sc.spawn(move || c.iter().map(|k| check(*k)).collect::<Vec<_>>())).collect();
                hs.into_iter().flat_map(|h| h.join().unwrap_or_else(|e| std::panic::resume_unwind(e))).collect()
            });
            for r in results {
                *outcomes.entry(r).or_insert(0) += 1;
            }
            eprintln!("{ctx} {path}: {outcomes:?}");
            // Güncelleme yolunda disk dolunca işlem `DISK_DOLU` ile geri döner (geri dönüş yolunda ilk hatanın kodu kalır).
            let by_disk = outcomes.iter().filter(|(k, _)| k.ends_with("/DISK_DOLU")).map(|(_, n)| n).sum::<u32>();
            assert!(rollback || by_disk > 0, "{ctx} {path}: hiçbir noktada yedek alanla DISK_DOLU geri dönüşü olmadı: {outcomes:?}");
        }
    });
}

/// İşlem başlatma kapısı: yedek alan kurulamıyorsa (disk dolarsa günlüğe yer açılamaz) hazır paket UYGULANMAZ —
/// `DISK_DOLU` ile bekler, işlem açılmaz, backend'e dokunulmaz; yer açılınca kurulur.
#[test]
fn yedek_alan_yoksa_islem_baslamaz() {
    senaryo("yedek_alan_yoksa_islem_baslamaz", |p, ctx| {
        let w = World::new_in(p, "yedek-yok", Setup::default());
        w.crash.reserve_blocked.store(true, Ordering::SeqCst);
        w.run(3).unwrap();
        let st = w.status().expect("durum");
        assert_eq!((st.state, st.error_code.as_deref()), (State::Waiting, Some("DISK_DOLU")), "{ctx}: {:?}", st.message);
        let j = Journal::open(&RealFs, &w.layout.journal_file()).unwrap();
        assert!(j.last_op().is_none(), "{ctx}: yedek alan yokken işlem açıldı");
        assert_eq!(w.current().as_deref(), Some(OLD), "{ctx}");
        assert_eq!(w.backend().state, SvcState::Running, "{ctx}");
        assert!(!w.layout.reserve_file().exists(), "{ctx}");
        w.crash.reserve_blocked.store(false, Ordering::SeqCst);
        w.run_to_rest(2);
        assert_eq!(w.state(), Some(State::Succeeded), "{ctx}");
        assert_invariants(&w, ctx);
    });
}

/// İndirme yazımında disk dolarsa (ön kontrol başka dosya sistemini ölçmüş olabilir — ayrı bağlı iş diski) kod
/// `DISK_DOLU`dur, `INDIRME_HATASI` değil (ağ sorunu sanılmaz); işlem açılmaz, yer açılınca indirme sürer.
#[test]
fn indirme_yaziminda_disk_dolu() {
    senaryo("indirme_yaziminda_disk_dolu", |p, ctx| {
        let w = World::new_in(p, "indirme-dolu", Setup::default());
        w.crash.fill_disk(true);
        w.run(1).unwrap();
        let st = w.status().expect("durum");
        assert_eq!(st.error_code.as_deref(), Some("DISK_DOLU"), "{ctx}: {:?}", st.message);
        let j = Journal::open(&RealFs, &w.layout.journal_file()).unwrap();
        assert!(j.last_op().is_none(), "{ctx}: indirme bitmeden işlem açıldı");
        assert_eq!(w.current().as_deref(), Some(OLD), "{ctx}");
        w.crash.free_disk();
        w.run_to_rest(2);
        assert_eq!(w.state(), Some(State::Succeeded), "{ctx}");
        assert_invariants(&w, ctx);
    });
}

/// Disk formülü iki platformda AYNI biçim (§5 madde 4): Windows da yedek payını (DB × 1,2) sayar — aynı boş alan,
/// DB boyu karar verir; yer yoksa indirme bile başlamaz.
#[test]
fn windows_disk_formulu_db_payini_sayar() {
    const GB: u64 = 1024 * 1024 * 1024;
    let small = World::new_in(Profil::Windows, "disk-kucuk-db", Setup::default());
    small.fs.free.store(3 * GB, Ordering::SeqCst);
    small.faults.db_bytes.store(100 * 1024 * 1024, Ordering::SeqCst);
    small.run(1).unwrap();
    assert_ne!(small.status().and_then(|s| s.error_code).as_deref(), Some("DISK_DOLU"), "küçük DB: paket × 3 + DB × 1,2 + 2 GB sığar");
    let big = World::new_in(Profil::Windows, "disk-buyuk-db", Setup::default());
    big.fs.free.store(3 * GB, Ordering::SeqCst);
    big.faults.db_bytes.store(2 * GB, Ordering::SeqCst);
    big.run(1).unwrap();
    assert_eq!(big.status().and_then(|s| s.error_code).as_deref(), Some("DISK_DOLU"));
    assert_eq!(big.current().as_deref(), Some(OLD));
    assert!(!big.layout.downloads().join(format!("{NEW}.zip.part")).exists(), "yer yokken indirme başlamaz");
}
