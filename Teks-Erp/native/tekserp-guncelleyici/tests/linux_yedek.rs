//! Linux'ta güncelleme öncesi yedeğin alıcıları (2.15.2 saha hatası, deneme sunucusu): kurulumun alıcısı backend'in
//! `<proje>_yedek_anahtar` biriminde (10001, 0700) durur; bağ taşıyan araç yetkisiz köktür (`--user 0:0`, `cap_drop:
//! ALL`) ve oraya giremez. Güncelleyici alıcıyı konaktan okuyup işlemin özel alanına kopyalar; yedek kurulum alıcısına
//! ve geçici anahtara şifrelenir, araca birim yolu verilmez (sahte Docker bunu ayrıca reddeder).
mod common;

use common::*;
use serde_json::Value;
use tekserp_guncelleyici::ipc::State;

#[test]
fn linux_yedek_kurulum_alicisina_birimden_kopyayla() {
    let w = World::new_in(Profil::Linux, "li-yedek", Setup::default());
    assert!(!w.layout.root.join("yedek-anahtar").exists(), "Linux'ta konakta alıcı dizini yok — alıcı birimde");
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded), "{:?}", w.status().and_then(|s| s.message));
    let ops: Vec<_> = std::fs::read_dir(w.layout.update_backups()).unwrap().map(|e| e.unwrap().path()).collect();
    assert_eq!(ops.len(), 1, "{ops:?}");
    let info: Value = serde_json::from_slice(&std::fs::read(ops[0].join("yedek.json")).unwrap()).unwrap();
    assert_eq!(info["kurulumAlicisi"], 1, "kurulumun alıcısı sayıldı: {info}");
    let enc = std::fs::read(ops[0].join("db.dump.tkenc")).unwrap();
    assert!(enc.starts_with(b"ENC2:"), "kurulum alıcısı + geçici anahtar: {:?}", String::from_utf8_lossy(&enc[..8]));
    let kopya = ops[0].join(tekserp_guncelleyici::operation::RECIPIENT_STAGE).join("musteri.tkpub");
    assert_eq!(std::fs::read_to_string(&kopya).unwrap(), "tkpub1:MUSTERI\n", "özel alandaki kopya birimdekinin aynısı");
}

#[test]
fn linux_yedek_alici_birimi_yoksa_yedek_alinmaz_geri_doner() {
    let w = World::new_in(Profil::Linux, "li-yedek-yok", Setup::default());
    std::fs::remove_dir_all(docker_volume_dir(&w.layout.root, "tekserp_yedek_anahtar")).unwrap();
    w.run_to_rest(0);
    let d = w.status().and_then(|s| s.last_detail).expect("sonAyrinti");
    assert_eq!(d.error_code.as_deref(), Some("YEDEK_HATASI"), "{:?}", d.message);
    assert!(d.message.as_deref().unwrap_or_default().contains("tekserp_yedek_anahtar"), "{:?}", d.message);
    assert_eq!(w.current().as_deref(), Some(OLD), "geri döndü");
}
