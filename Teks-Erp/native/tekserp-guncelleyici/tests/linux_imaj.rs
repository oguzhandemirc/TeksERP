//! Linux imaj hazırlığı (L4c-2, `docs/design/GUNCELLEYICI-SAGLAMLIK.md` §1.2 · §5 halka 6–7): paketteki `docker save`
//! arşivi bildirimin kimliğiyle ölçülür, yüklenir, etiketin katmanları arşivle karşılaştırılır ve kaydedilir; backend
//! yalnız kaydı tutan etiketle başlar. Compose dosyası kurallara uymuyorsa sürüm hazırlanmaz.
mod common;

use common::*;
use serde_json::json;
use std::sync::atomic::Ordering;
use tekserp_guncelleyici::env::RealFs;
use tekserp_guncelleyici::imaj;
use tekserp_guncelleyici::ipc::State;

fn linux(tag: &str) -> World {
    World::new_in(Profil::Linux, tag, Setup::default())
}

fn code(w: &World) -> Option<String> {
    w.status().and_then(|s| s.error_code)
}

fn new_tag() -> String {
    format!("tekserp-korumali:{NEW}")
}

/// Hazırlık reddi: backend dokunulmadı, `current` aynı, sürüm dizini ve NEW kaydı yok.
fn untouched(w: &World, ctx: &str) {
    assert_eq!(w.backend().starts, 0, "{ctx}: backend yeniden başlatıldı");
    assert_eq!(w.current().as_deref(), Some(OLD), "{ctx}: current değişti");
    assert!(!w.layout.version_dir(NEW).exists(), "{ctx}: sürüm dizini kaldı");
    assert!(imaj::kayit_oku(&RealFs, &w.layout, NEW).is_none(), "{ctx}: NEW kaydı yazılmış");
    assert!(w.layout.version_dir(OLD).is_dir(), "{ctx}: kurulu sürümün dizini silindi");
}

/// Testin seçtiği imaj arşivi/compose ile imzalı paket sunulur.
fn serve(w: &World, image: Vec<u8>, compose: &serde_json::Value) {
    let files = oci_files_with(NEW, &oci_default_updater(), &w.keys.package, "paket-2026", None, &|_| {}, image, compose);
    w.serve_oci(NEW, ustar_of(&files), None);
}

#[test]
fn imaj_etiketi_kaydi() {
    let w = linux("li-kayit");
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().and_then(|s| s.message));
    assert_eq!(w.faults.image_loads.load(Ordering::SeqCst), 1);
    let k = imaj::kayit_oku(&RealFs, &w.layout, NEW).expect("NEW kaydı");
    let kimlik = oci_image_id(NEW);
    assert_eq!(
        (k.etiket.as_str(), k.kimlik.as_str(), k.katmanlar.clone(), k.docker_id.as_str()),
        (new_tag().as_str(), kimlik.as_str(), vec![oci_layer_id(NEW)], docker_handle(&kimlik).as_str()),
        "kimlik arşivden (config özeti), tutamaç Docker'dan"
    );
    assert!(w.docker_tags().contains(&new_tag()));
    // Budama: `current` + bir önceki sürüm kalır — OLD'un kaydı da.
    assert!(imaj::kayit_oku(&RealFs, &w.layout, OLD).is_some());

    // Başlatma öncesi ölçüm: yeniden etiketlenmiş, silinmiş ya da kaydı olmayan imaj başlatılmaz.
    let env = w.env();
    assert!(env.svc.start("backend", &[]).is_ok());
    w.docker_retag(&new_tag());
    let e = env.svc.start("backend", &[]).unwrap_err().0;
    assert!(e.starts_with(imaj::KIMLIK_ONEKI) && e.contains("yeniden etiketlenmiş"), "{e}");
    w.docker_forget(&new_tag());
    let e = env.svc.start("backend", &[]).unwrap_err().0;
    assert!(e.starts_with(imaj::KIMLIK_ONEKI) && e.contains("yok"), "{e}");
    std::fs::remove_file(imaj::kayit_yolu(&w.layout, NEW)).unwrap();
    let e = env.svc.start("backend", &[]).unwrap_err().0;
    assert!(e.starts_with(imaj::KIMLIK_ONEKI) && e.contains("kaydı yok"), "{e}");
}

#[test]
fn imaj_kimligi_arsivden() {
    // Arşivin config'i bildirimdeki kimlikle tutmuyor (imzalı kapsamda, bütünlük geçer): yüklenmez.
    let w = linux("li-kimlik");
    let other = json!({ "rootfs": { "type": "layers", "diff_ids": [oci_layer_id(NEW)] }, "os": "baska" }).to_string();
    serve(&w, oci_image_archive_of(other.as_bytes(), &[new_tag()]), &oci_compose(NEW));
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("IMAJ_KIMLIGI"));
    assert_eq!(w.faults.image_loads.load(Ordering::SeqCst), 0, "ölçüm yüklemeden önce");
    untouched(&w, "kimlik");

    // Arşiv başka bir etiket taşıyor: `docker load` sürüm etiketini başka nesneye vermesin.
    let w = linux("li-etiket");
    serve(&w, oci_image_archive_of(&oci_config(NEW), &["tekserp-korumali:9.9.9".into()]), &oci_compose(NEW));
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("IMAJ_KIMLIGI"));
    assert_eq!(w.faults.image_loads.load(Ordering::SeqCst), 0);
    untouched(&w, "etiket");
}

#[test]
fn imaj_katmani_tutmaz() {
    // Yüklenen imajın katmanları arşivden sapar: imaj silinir, kesin hata (dizin silinir, geri çekilir).
    let w = linux("li-katman");
    w.faults.load_wrong_layers.store(true, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("IMAJ_KIMLIGI"));
    assert!(!w.docker_tags().contains(&new_tag()), "uyuşmayan imaj silinmedi: {:?}", w.docker_tags());
    assert!(w.docker_tags().contains(&format!("tekserp-korumali:{OLD}")), "başka imaja dokunuldu");
    untouched(&w, "katman");
    w.faults.load_wrong_layers.store(false, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(w.faults.image_loads.load(Ordering::SeqCst), 1, "kesin hata geri çekilir — yükleme tekrarlanmadı");
}

#[test]
fn imaj_yuklenemedi_yarim_artik() {
    // Yükleme etiketli bir artık bırakıp düşer: artık temizlenir, sürüm dizini KALIR (geçici), sonra yeniden yüklenir.
    let w = linux("li-yarim");
    w.faults.load_partial.store(true, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("IMAJ_YUKLENEMEDI"));
    assert!(!w.docker_tags().contains(&new_tag()), "yarım yükleme artığı kaldı: {:?}", w.docker_tags());
    assert!(w.docker_tags().contains(&format!("tekserp-korumali:{OLD}")));
    assert!(w.layout.version_dir(NEW).exists(), "geçici hatada sürüm dizini silinmez");
    assert_eq!((w.backend().starts, w.current().as_deref()), (0, Some(OLD)));
    w.faults.load_partial.store(false, Ordering::SeqCst);
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().and_then(|s| s.message));
    assert_eq!(w.faults.image_loads.load(Ordering::SeqCst), 2);

    // Daemon hiçbir şey yüklemeden düşer.
    let w = linux("li-daemon");
    w.faults.load_fails.store(true, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("IMAJ_YUKLENEMEDI"));
    assert_eq!(w.docker_tags(), vec![format!("tekserp-korumali:{OLD}")]);
}

/// `docker load` disk doluyken düşer (daemon ENOSPC'yi metinle bildirir): kod `DISK_DOLU` (insan yer açmalı; W3a'nın
/// hazırlık kolu — işlem açılmadan), yarım imaj kalmaz, sürüm dizini KALIR; yer açılınca yükleme yeniden denenir ve güncelleme tamamlanır.
#[test]
fn imaj_yukleme_disk_dolu() {
    let sayac = linux("li-disk-sayac");
    sayac.count_points();
    let log = sayac.crash.log.lock().unwrap().clone();
    let k = log.iter().find_map(|l| l.split_once(':').filter(|(_, x)| *x == "surec docker load").map(|(n, _)| n.parse::<u64>().unwrap()));
    let k = k.expect("sayım koşusunda docker load noktası yok");
    let w = linux("li-disk");
    // İmaj yüzlerce MB ister, durum dosyası yüzlerce bayt: kod panelde görünür.
    w.crash.small_fits.store(true, Ordering::SeqCst);
    w.enospc_at(k);
    w.run(2).unwrap();
    assert!(w.crash.enospc_fired(), "disk docker load'da dolmadı");
    assert_eq!(code(&w).as_deref(), Some("DISK_DOLU"), "{:?}", w.status().and_then(|s| s.message));
    assert_eq!(w.docker_tags(), vec![format!("tekserp-korumali:{OLD}")], "yarım imaj kaldı");
    assert!(w.layout.version_dir(NEW).exists(), "disk dolu geçicidir — sürüm dizini silinmez");
    assert_eq!((w.backend().starts, w.current().as_deref()), (0, Some(OLD)));
    w.crash.free_disk();
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().and_then(|s| s.message));
}

#[test]
fn compose_motor_yolundan() {
    for (ad, edit) in [
        (
            "ayricalikli",
            &(|c: &mut serde_json::Value| c["services"]["backend"]["privileged"] = json!(true)) as &dyn Fn(&mut serde_json::Value),
        ),
        ("baska-surum", &|c: &mut serde_json::Value| c["services"]["backend"]["image"] = json!("tekserp-korumali:9.9.9")),
        ("cekme", &|c: &mut serde_json::Value| c["services"]["backend"]["pull_policy"] = json!("always")),
    ] {
        let w = linux(&format!("li-compose-{ad}"));
        let mut c = oci_compose(NEW);
        edit(&mut c);
        serve(&w, oci_image_archive(NEW), &c);
        w.run(1).unwrap();
        assert_eq!(code(&w).as_deref(), Some("COMPOSE_HATASI"), "{ad}");
        assert_eq!(w.faults.image_loads.load(Ordering::SeqCst), 0, "{ad}: compose imajdan önce");
        untouched(&w, ad);
    }
    // Servissiz yapılandırma da kural ihlalidir.
    let w = linux("li-compose-bos");
    serve(&w, oci_image_archive(NEW), &json!({ "services": {} }));
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("COMPOSE_HATASI"));
    untouched(&w, "boş");
}

#[test]
fn hazir_imaj_kaybolursa_yeniden_yuklenir() {
    // Onay bekleyen hazır sürüm (işaretli dizin) ama imaj sonradan silinmiş: dizin yeniden doğrulanır, imaj yeniden
    // yüklenir; imaj yerindeyken tur yeniden yüklemez.
    let lease = LeaseOpts { update: Some(policy("ONAYLI", &open_window(), None)), ..LeaseOpts::default() };
    let w = World::new_in(Profil::Linux, "li-kayip", Setup { lease, ..Setup::default() });
    w.run(1).unwrap();
    assert_eq!(w.state(), Some(State::Ready), "{:?}", w.status().map(|s| (s.error_code, s.message)));
    w.run(1).unwrap();
    assert_eq!(w.faults.image_loads.load(Ordering::SeqCst), 1, "hazır imaj her turda yeniden yüklendi");
    w.docker_forget(&new_tag());
    w.run(1).unwrap();
    assert_eq!(w.state(), Some(State::Ready), "{:?}", w.status().map(|s| (s.error_code, s.message)));
    assert_eq!(w.faults.image_loads.load(Ordering::SeqCst), 2, "kayıp imaj yeniden yüklenmedi");
    assert!(w.docker_tags().contains(&new_tag()));
    // Yeniden etiketlenmiş hazır imaj da hazır sayılmaz.
    w.docker_retag(&new_tag());
    w.run(1).unwrap();
    assert_eq!(w.faults.image_loads.load(Ordering::SeqCst), 3);
}

#[test]
fn baslatma_etiketi_motor_yolundan() {
    // Yeni sürüm açılışta düşer, geri dönüş eski sürümü başlatacak ama eski etiket yeniden etiketlenmiş: başlatılmaz
    // ve adım kodu IMAJ_KIMLIGI'dir (başlatma hatası değil).
    let w = linux("li-baslat");
    *w.faults.crash_on_start_version.lock().unwrap() = Some(NEW.into());
    w.docker_retag(&format!("tekserp-korumali:{OLD}"));
    w.run_to_rest(0);
    let s = w.status().unwrap();
    assert_eq!(s.state, State::Failed, "{:?}", s.message);
    let journal = std::fs::read_to_string(w.layout.journal_file()).unwrap();
    let err = journal.lines().find(|l| l.contains("\"hataKodu\":\"IMAJ_KIMLIGI\"")).unwrap_or_default();
    assert!(err.contains(imaj::KIMLIK_ONEKI) && err.contains(OLD), "günlükte IMAJ_KIMLIGI adımı yok:\n{journal}");
    assert!(s.message.unwrap_or_default().contains("PAKET_BAGI"), "rapora belgeli kodla (PAKET_BAGI)");
}

#[test]
fn kurulu_surum_dizini_silinmez() {
    // Kesin hata (katman tutmaz) anında `current` hazırlanan sürümü gösteriyor (yükleme sürerken elle çevrildi):
    // dizin SİLİNMEZ — kurulu sürümün dizini hiçbir hatada silinmez, karar tur başındaki bilgiyle verilmez.
    let w = linux("li-kurulu");
    w.faults.load_wrong_layers.store(true, Ordering::SeqCst);
    *w.faults.load_repoints_current.lock().unwrap() = Some(w.layout.version_dir(NEW));
    w.run(1).unwrap();
    assert_eq!(code(&w).as_deref(), Some("IMAJ_KIMLIGI"));
    assert_eq!(w.current().as_deref(), Some(NEW));
    assert!(w.layout.version_dir(NEW).is_dir(), "current'in gösterdiği sürüm dizini silindi");
    assert!(w.layout.version_dir(OLD).is_dir());
}
