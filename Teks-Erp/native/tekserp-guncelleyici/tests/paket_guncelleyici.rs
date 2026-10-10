//! PAKET anahtarı kökün altında — güncelleyici tarafı (sözleşme `docs/design/PAKET-ANAHTARI-KOK-ALTINDA.md` §2.3–§4):
//! işaretçi sırası + eski dosyaya 404 düşüşü, KABUL/YERLEŞİK, tolerans sınırı, sınıf, iptal birleşmesi, D8 kid'li adlar
//! (sabitli sürüm bildirimi · PG künyesi bildirimi imzalayanından).
//! Belge doğrulayıcının kendisi `tekserp-dogrulama/tests/paket_zinciri.rs`te (TS vektörleriyle) ölçülür.
#![allow(dead_code)]
mod common;

use common::*;
use ed25519_dalek::SigningKey;
use serde_json::{json, Value};
use tekserp_dogrulama::b64;
use tekserp_dogrulama::outcome::code;
use tekserp_dogrulama::paket_zinciri::{self, PackageMode, PackageTrust, VerifiedPackageRevocation};
use tekserp_guncelleyici::env::{Fs, RealFs};
use tekserp_guncelleyici::ipc::State;
use tekserp_guncelleyici::policy::{self, LicenseView};
use tekserp_guncelleyici::release;

const PKT_KID: &str = "pkt-2026-1";
const CERT_ID: &str = "1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c";
const OTHER_CERT_ID: &str = "2d2d2d2d-2d2d-4d2d-8d2d-2d2d2d2d2d2d";
const CERT_END: i64 = T0 + 170 * DAY;
const TOLERANCE: i64 = paket_zinciri::PACKAGE_ACCEPT_TOLERANCE_DAYS as i64 * DAY;

fn pkt_key() -> SigningKey {
    SigningKey::from_bytes(&[9; 32])
}

fn certificate(w: &World, classes: &[&str]) -> String {
    let doc = json!({
        "v": 1, "sertifikaId": CERT_ID, "kullanim": "PAKET", "kid": PKT_KID, "x": x_of(&pkt_key()),
        "siniflar": classes, "baslangic": iso(T0 - 10 * DAY), "bitis": iso(CERT_END), "bayi": null,
    });
    sign(&w.keys.root, "tekserp-sertifika", "kok-test-1", &doc)
}

fn chained_payload(payload: &Value, cert: &str) -> Value {
    let mut p = payload.clone();
    p[paket_zinciri::PACKAGE_CERT_FIELD] = json!(cert);
    p[paket_zinciri::PACKAGE_SIGNED_AT_FIELD] = json!(iso(T0));
    p
}

fn revocation_token(w: &World, sequence: u32, cert_id: &str) -> String {
    let doc = json!({
        "v": 1, "iptalId": "3e3e3e3e-3e3e-4e3e-8e3e-3e3e3e3e3e3e", "sira": sequence, "verilis": iso(T0 - DAY),
        "iptaller": [{ "kid": if cert_id == CERT_ID { PKT_KID } else { "pkt-2026-9" }, "sertifikaId": cert_id, "tarih": iso(T0 - DAY), "neden": "sızıntı" }],
    });
    sign(&w.keys.root, paket_zinciri::TYP_PAKET_IPTAL, "kok-test-1", &doc)
}

fn revocation(w: &World, sequence: u32, cert_id: &str) -> VerifiedPackageRevocation {
    paket_zinciri::verify_package_revocation(&Value::String(revocation_token(w, sequence, cert_id)), &w.anchor.roots)
        .expect("iptal geçerli")
}

/// Zincirli paket: `butunluk-zincir.jws` (eski `butunluk.jws` YOK) + kökte `paket-iptal.jws` (başka sertifikayı iptal eder).
fn chained_zip(w: &World, cert: &str) -> Vec<u8> {
    chained_zip_by(w, &pkt_key(), PKT_KID, cert)
}

fn chained_zip_by(w: &World, key: &SigningKey, kid: &str, cert: &str) -> Vec<u8> {
    let files = version_files(NEW);
    let mut all = files.clone();
    for (name, body) in integrity_files(&files, NEW, key, kid, Some(CHANNEL)) {
        if name == "butunluk.jws" {
            let text = String::from_utf8(body).unwrap();
            let payload: Value = serde_json::from_slice(&b64::decode_strict(text.split('.').nth(1).unwrap()).unwrap()).unwrap();
            let token = sign(key, "tekserp-butunluk", kid, &chained_payload(&payload, cert));
            all.push((paket_zinciri::CHAINED_INTEGRITY_FILE.into(), token.into_bytes()));
        } else {
            all.push((name, body));
        }
    }
    all.push((paket_zinciri::PACKAGE_REVOCATION_FILE.into(), revocation_token(w, 1, OTHER_CERT_ID).into_bytes()));
    zip_of(&all)
}

/// Sunucuya zincirli bildirimi koyar (`son-zincir.json` + `<sürüm>/surum-zincir.json` + zincirli paket).
fn publish_chained(w: &World) -> Value {
    let cert = certificate(w, &["URETIM", "TEST"]);
    let zip = chained_zip(w, &cert);
    let payload = manifest_payload(PKT_KID, NEW, &zip, None);
    let token = sign_manifest(&pkt_key(), PKT_KID, &chained_payload(&payload, &cert));
    let mut f = w.files.lock().unwrap();
    f.insert(format!("/{CHANNEL}/backend/{NEW}/{}", payload["paket"]["ad"].as_str().unwrap()), zip);
    f.insert(format!("/{CHANNEL}/backend/{NEW}/{}", release::CHAINED_RELEASE_MANIFEST_FILE), pointer(&token));
    f.insert(format!("/{CHANNEL}/backend/{}", release::CHAINED_RELEASE_POINTER_FILE), pointer(&token));
    Value::String(token)
}

fn trust(w: &World, mode: PackageMode, now: i64) -> PackageTrust {
    PackageTrust {
        keys: w.anchor.package_keys.clone(),
        roots: w.anchor.roots.clone(),
        mode,
        now_ms: (mode == PackageMode::Kabul).then_some(now as f64),
        revocation: None,
        install_class: Some(Some("URETIM".into())),
    }
}

fn verdict(token: &Value, t: &PackageTrust) -> Result<(), &'static str> {
    release::verify_release_manifest(token, t, CHANNEL).map(|_| ()).map_err(|f| f.code)
}

// ── Motor: işaretçi sırası ──────────────────────────────────────────────────────────────────────

/// Bugünkü sunucu (zincirli dosya yok → 404) ve bugünkü `paket-*` paketi: kurulum eski yoldan aynen yapılır.
#[test]
fn legacy_pointer_after_404_installs_as_today() {
    let w = World::new("pz-eski", Setup::default());
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::Succeeded, "{:?} {:?}", st.error_code, st.message);
    assert_eq!(w.current().as_deref(), Some(NEW));
    assert!(st.package_chain, "durum.json paketZinciri yazmalı");
}

/// Zincirli işaretçi varsa ÖNCE o okunur (eski dosyalar bozuk olsa da kurulur) ve paketteki iptal listesi benimsenir.
#[test]
fn chained_pointer_is_read_first_and_package_revocation_is_adopted() {
    let w = World::new("pz-zincir", Setup::default());
    publish_chained(&w);
    {
        let mut f = w.files.lock().unwrap();
        f.insert(format!("/{CHANNEL}/backend/son.json"), b"{bozuk".to_vec());
        f.insert(format!("/{CHANNEL}/backend/{NEW}/surum.json"), b"{bozuk".to_vec());
    }
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::Succeeded, "{:?} {:?}", st.error_code, st.message);
    assert_eq!(w.current().as_deref(), Some(NEW));
    let adopted = w.license_dir().join(paket_zinciri::PACKAGE_REVOCATION_FILE);
    let text = std::fs::read_to_string(&adopted).expect("paketteki iptal listesi lisans dizinine yazılmalı");
    assert_eq!(text.trim(), revocation_token(&w, 1, OTHER_CERT_ID));
}

/// Gömülü `paket-*` anahtarı yoksa eski (`paket-*` imzalı) işaretçiye düşülmez: 404 olduğu gibi raporlanır.
#[test]
fn no_fallback_without_embedded_package_keys() {
    let mut w = World::new("pz-dususyok", Setup::default());
    w.anchor.package_keys.clear();
    let _ = w.run(1);
    let st = w.status().unwrap();
    assert_eq!(st.error_code.as_deref(), Some("MANIFEST_INDIRILEMEDI"), "{:?}", st.message);
    assert!(st.message.as_deref().unwrap_or_default().contains(release::CHAINED_RELEASE_POINTER_FILE), "{:?}", st.message);
    assert_eq!(w.current().as_deref(), Some(OLD));
}

// ── Güven kipleri ───────────────────────────────────────────────────────────────────────────────

#[test]
fn revoked_certificate_rejected_on_accept_marked_when_installed() {
    let w = World::new("pz-iptal", Setup::default());
    let token = publish_chained(&w);
    let mut kabul = trust(&w, PackageMode::Kabul, T0);
    assert_eq!(verdict(&token, &kabul), Ok(()));
    kabul.revocation = Some(revocation(&w, 1, CERT_ID));
    assert_eq!(verdict(&token, &kabul), Err(code::PAKET_SERTIFIKA_IPTAL));
    let mut yerlesik = trust(&w, PackageMode::Yerlesik, T0);
    yerlesik.revocation = Some(revocation(&w, 1, CERT_ID));
    let checked = release::verify_release_manifest(&token, &yerlesik, CHANNEL).expect("kurulu paket iptalde de açılır");
    assert!(checked.chain.expect("zincirli imzacı").revoked, "iptal yalnız işaretlenir");
}

/// KABUL: sertifika bitişi + 180 gün geçer, 1 ms sonrası düşer; YERLEŞİK zamana bakmaz.
#[test]
fn accept_tolerance_boundary() {
    let w = World::new("pz-tolerans", Setup::default());
    let token = publish_chained(&w);
    assert_eq!(verdict(&token, &trust(&w, PackageMode::Kabul, CERT_END + TOLERANCE)), Ok(()));
    assert_eq!(verdict(&token, &trust(&w, PackageMode::Kabul, CERT_END + TOLERANCE + 1)), Err(code::PAKET_SERTIFIKA_ZAMAN));
    assert_eq!(verdict(&token, &trust(&w, PackageMode::Kabul, CERT_END + TOLERANCE + DAY)), Err(code::PAKET_SERTIFIKA_ZAMAN));
    assert_eq!(verdict(&token, &trust(&w, PackageMode::Yerlesik, CERT_END + 10 * TOLERANCE)), Ok(()));
}

/// KABUL "şimdi"si = max(sistem saati, kira verilişi): geri alınan sistem saati toleransı uzatmaz.
#[test]
fn accept_now_never_goes_before_lease_issue() {
    let w = World::new("pz-simdi", Setup::default());
    let lic = LicenseView { lease_issued_ms: Some((T0 + 5 * DAY) as f64), class: Some("URETIM".into()), ..LicenseView::default() };
    let geri = policy::package_trust(&w.anchor, &lic, PackageMode::Kabul, T0 as f64);
    assert_eq!(geri.now_ms, Some((T0 + 5 * DAY) as f64));
    let ileri = policy::package_trust(&w.anchor, &lic, PackageMode::Kabul, (T0 + 9 * DAY) as f64);
    assert_eq!(ileri.now_ms, Some((T0 + 9 * DAY) as f64));
    let yerlesik = policy::package_trust(&w.anchor, &lic, PackageMode::Yerlesik, T0 as f64);
    assert_eq!(yerlesik.now_ms, None);
}

/// Sınıf bilinmiyor (HAK yok): zincirli belge SINIF ile düşer, eski `paket-*` belge bugünkü gibi geçer.
#[test]
fn unknown_class_rejects_chained_keeps_legacy() {
    let w = World::new("pz-sinif", Setup::default());
    let token = publish_chained(&w);
    let lic = LicenseView { class: None, ..LicenseView::default() };
    let t = policy::package_trust(&w.anchor, &lic, PackageMode::Kabul, T0 as f64);
    assert_eq!(t.install_class, Some(None));
    assert_eq!(verdict(&token, &t), Err(code::PAKET_SERTIFIKA_SINIF));
    let legacy = w.files.lock().unwrap()[&format!("/{CHANNEL}/backend/{NEW}/surum.json")].clone();
    let legacy_token = release::read_release_pointer(std::str::from_utf8(&legacy).unwrap()).unwrap();
    assert_eq!(verdict(&Value::String(legacy_token), &t), Ok(()));
    let dar = LicenseView { class: Some("DEMO".into()), ..LicenseView::default() };
    let t = policy::package_trust(&w.anchor, &dar, PackageMode::Kabul, T0 as f64);
    assert_eq!(verdict(&token, &t), Err(code::PAKET_SERTIFIKA_SINIF), "sertifikanın sınıfları dışında");
}

// ── İptal birleşmesi ────────────────────────────────────────────────────────────────────────────

#[test]
fn package_revocation_merge_keeps_highest_sequence() {
    let w = World::new("pz-birlesme", Setup::default());
    let pkg = w.dir.join("paket");
    let lic_dir = w.dir.join("lisans-birlesme");
    std::fs::create_dir_all(&pkg).unwrap();
    std::fs::create_dir_all(&lic_dir).unwrap();
    std::fs::write(pkg.join(paket_zinciri::PACKAGE_REVOCATION_FILE), revocation_token(&w, 2, CERT_ID)).unwrap();
    let target = lic_dir.join(paket_zinciri::PACKAGE_REVOCATION_FILE);

    let mut t = trust(&w, PackageMode::Kabul, T0);
    t.revocation = Some(revocation(&w, 3, OTHER_CERT_ID));
    assert!(!policy::adopt_package_revocation(&RealFs, &lic_dir, &w.anchor, &pkg, &mut t), "düşük sıra benimsenmez");
    assert_eq!(t.revocation.as_ref().unwrap().sequence(), 3.0);
    assert!(!target.exists());

    t.revocation = Some(revocation(&w, 1, OTHER_CERT_ID));
    assert!(policy::adopt_package_revocation(&RealFs, &lic_dir, &w.anchor, &pkg, &mut t), "yüksek sıra benimsenir");
    assert_eq!(t.revocation.as_ref().unwrap().sequence(), 2.0);
    assert_eq!(std::fs::read_to_string(&target).unwrap(), revocation_token(&w, 2, CERT_ID));
    let loaded = policy::read_package_revocation(&RealFs, &target, &w.anchor).expect("yazılan liste okunur");
    assert_eq!(loaded.sequence(), 2.0);

    std::fs::write(pkg.join(paket_zinciri::PACKAGE_REVOCATION_FILE), "kok-imzasiz").unwrap();
    let mut bos = trust(&w, PackageMode::Kabul, T0);
    assert!(!policy::adopt_package_revocation(&RealFs, &lic_dir, &w.anchor, &pkg, &mut bos), "doğrulanmayan liste yok sayılır");
}

// ── ISTEMCI satırı (ISTEMCI-ANAHTARI-KOK-ALTINDA.md §3.4): dağıtım iptalinde `ist-*` satırı güncelleyicide zararsız ──

fn mixed_revocation_token(w: &World, sequence: u32, with_pkt_row: bool) -> String {
    let mut rows = vec![json!({ "kid": "ist-2026-1", "sertifikaId": OTHER_CERT_ID, "tarih": iso(T0 - DAY), "neden": "istemci anahtarı" })];
    if with_pkt_row {
        rows.push(json!({ "kid": PKT_KID, "sertifikaId": CERT_ID, "tarih": iso(T0 - DAY), "neden": "sızıntı" }));
    }
    let doc =
        json!({ "v": 1, "iptalId": "4f4f4f4f-4f4f-4f4f-8f4f-4f4f4f4f4f4f", "sira": sequence, "verilis": iso(T0 - DAY), "iptaller": rows });
    sign(&w.keys.root, paket_zinciri::TYP_PAKET_IPTAL, "kok-test-1", &doc)
}

/// `ist-*` satırlı belge düşmez (benimsenir, yüksek sıra), PAKET sertifikasını iptal etmez; aynı belgedeki `pkt-*` satırı eder.
#[test]
fn istemci_rows_in_package_revocation_are_harmless() {
    let w = World::new("pz-istemci", Setup::default());
    let token = publish_chained(&w);
    let only_ist = paket_zinciri::verify_package_revocation(&Value::String(mixed_revocation_token(&w, 4, false)), &w.anchor.roots)
        .expect("ist- satırlı belge doğrulanır (bütün belge düşmez)");
    let mut kabul = trust(&w, PackageMode::Kabul, T0);
    kabul.revocation = Some(only_ist);
    assert_eq!(verdict(&token, &kabul), Ok(()), "ist- satırı PAKET sertifikasına dokunmaz");

    let mixed = paket_zinciri::verify_package_revocation(&Value::String(mixed_revocation_token(&w, 5, true)), &w.anchor.roots)
        .expect("karma belge doğrulanır");
    kabul.revocation = Some(mixed);
    assert_eq!(verdict(&token, &kabul), Err(code::PAKET_SERTIFIKA_IPTAL), "aynı belgedeki pkt- satırı iptal eder");

    let pkg = w.dir.join("paket-ist");
    let lic_dir = w.dir.join("lisans-ist");
    std::fs::create_dir_all(&pkg).unwrap();
    std::fs::create_dir_all(&lic_dir).unwrap();
    std::fs::write(pkg.join(paket_zinciri::PACKAGE_REVOCATION_FILE), mixed_revocation_token(&w, 4, false)).unwrap();
    let mut t = trust(&w, PackageMode::Kabul, T0);
    t.revocation = Some(revocation(&w, 3, OTHER_CERT_ID));
    assert!(policy::adopt_package_revocation(&RealFs, &lic_dir, &w.anchor, &pkg, &mut t), "ist- satırlı yüksek sıra benimsenir");
    assert_eq!(t.revocation.as_ref().unwrap().sequence(), 4.0);
    assert_eq!(verdict(&token, &t), Ok(()));
}

// ── D8: değişmez sürüm dizininde yeniden imzalı ad (`surum-zincir-<kid>.json`) ─────────────────────

const PKT2_KID: &str = "pkt-2027-1";
const CERT2_ID: &str = "4f4f4f4f-4f4f-4f4f-8f4f-4f4f4f4f4f4f";

fn pkt2_key() -> SigningKey {
    SigningKey::from_bytes(&[10; 32])
}

fn certificate_of(w: &World, key: &SigningKey, kid: &str, id: &str, end: i64) -> String {
    let doc = json!({
        "v": 1, "sertifikaId": id, "kullanim": "PAKET", "kid": kid, "x": x_of(key),
        "siniflar": ["URETIM", "TEST"], "baslangic": iso(T0 - 10 * DAY), "bitis": iso(end), "bayi": null,
    });
    sign(&w.keys.root, "tekserp-sertifika", "kok-test-1", &doc)
}

/// Sabitlenmiş hedef (`hedefSurum` = NEW): eski takım `surum-zincir.json` (pkt-2026-1) + yeniden imzalı
/// `surum-zincir-pkt-2027-1.json` (zip `<ad>-<kid>.zip`); `son-zincir.json` yeniden imzalı bildirim. `extra` ikincinin
/// yükünü ezer. Yalnız yeniden imzalı zip sunulur: yanlış aday seçilirse indirme düşer.
fn pinned_world(tag: &str, second_end: i64, extra: Option<&Value>) -> World {
    let w = World::new(
        tag,
        Setup {
            lease: LeaseOpts { update: Some(policy("OTOMATIK", &open_window(), Some(NEW))), ..LeaseOpts::default() },
            ..Setup::default()
        },
    );
    let cert1 = certificate(&w, &["URETIM", "TEST"]);
    let zip1 = chained_zip(&w, &cert1);
    let first = manifest_payload(PKT_KID, NEW, &zip1, None);
    let token1 = sign_manifest(&pkt_key(), PKT_KID, &chained_payload(&first, &cert1));
    let cert2 = certificate_of(&w, &pkt2_key(), PKT2_KID, CERT2_ID, second_end);
    let zip2 = chained_zip_by(&w, &pkt2_key(), PKT2_KID, &cert2);
    let name2 = format!("tekserp-backend-{NEW}-{PKT2_KID}.zip");
    let mut second = manifest_payload(PKT2_KID, NEW, &zip2, extra);
    second["paket"]["ad"] = json!(name2);
    let token2 = sign_manifest(&pkt2_key(), PKT2_KID, &chained_payload(&second, &cert2));
    let mut f = w.files.lock().unwrap();
    f.insert(format!("/{CHANNEL}/backend/{NEW}/{name2}"), zip2);
    f.insert(format!("/{CHANNEL}/backend/{NEW}/{}", release::CHAINED_RELEASE_MANIFEST_FILE), pointer(&token1));
    f.insert(format!("/{CHANNEL}/backend/{NEW}/surum-zincir-{PKT2_KID}.json"), pointer(&token2));
    f.insert(format!("/{CHANNEL}/backend/{}", release::CHAINED_RELEASE_POINTER_FILE), pointer(&token2));
    drop(f);
    w
}

/// ⭐ Eski takımın sertifikası iptal: kid'siz `surum-zincir.json` KABUL'de elenir, `son-zincir.json` imzalayanından
/// bilinen kid'li ad seçilir (ikincinin bitişi DAHA ERKEN — kazanmasının tek nedeni iptal) ve kurulur.
#[test]
fn pinned_target_skips_revoked_unkidded_and_installs_kidded() {
    let w = pinned_world("pz-d8-iptal", CERT_END - 20 * DAY, None);
    std::fs::write(w.license_dir().join(paket_zinciri::PACKAGE_REVOCATION_FILE), revocation_token(&w, 2, CERT_ID)).unwrap();
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::Succeeded, "{:?} {:?}", st.error_code, st.message);
    assert_eq!(w.current().as_deref(), Some(NEW));
}

/// İptal yokken iki geçerli aday: bitişi EN GEÇ olan (yeniden imzalı) kazanır — eski zip sunulmasa da kurulur.
#[test]
fn pinned_target_prefers_latest_certificate_end() {
    let w = pinned_world("pz-d8-gec", CERT_END + 365 * DAY, None);
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::Succeeded, "{:?} {:?}", st.error_code, st.message);
    assert_eq!(w.current().as_deref(), Some(NEW));
}

/// Belirsizlikte FAIL-CLOSED: iki geçerli aday farklı paketi anlatıyor → SURUM_ISARETCI, kurulu sürüm yerinde.
#[test]
fn pinned_target_ambiguous_documents_fail_closed() {
    let other =
        json!({ "paket": { "ad": "x.zip", "boyut": 1, "sha256": "c".repeat(64), "paketId": "5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a" } });
    let w = pinned_world("pz-d8-belirsiz", CERT_END + 365 * DAY, Some(&other));
    let _ = w.run(1);
    let st = w.status().unwrap();
    assert_eq!(st.error_code.as_deref(), Some(release::code::SURUM_ISARETCI), "{:?}", st.message);
    assert!(st.message.as_deref().unwrap_or_default().contains("belirsiz"), "{:?}", st.message);
    assert_eq!(w.current().as_deref(), Some(OLD));
}

/// Eski davranış: sabitlenmiş hedefte yalnız kid'siz `surum-zincir.json` (kid'li ad yok) aynen kurulur.
#[test]
fn pinned_target_unkidded_only_installs_as_before() {
    let w = World::new(
        "pz-d8-eski",
        Setup {
            lease: LeaseOpts { update: Some(policy("OTOMATIK", &open_window(), Some(NEW))), ..LeaseOpts::default() },
            ..Setup::default()
        },
    );
    publish_chained(&w);
    w.files.lock().unwrap().insert(format!("/{CHANNEL}/backend/{NEW}/surum.json"), b"{bozuk".to_vec());
    w.run_to_rest(0);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::Succeeded, "{:?} {:?}", st.error_code, st.message);
    assert_eq!(w.current().as_deref(), Some(NEW));
}

// ── D8 PG künyesi: kid'li ad, bildirimi imzalayan `pkt-*`ten ──────────────────────────────────────

/// Kendi PG (16.9-1) + yeniden imzalı dünya: `son-zincir.json` ikinci PAKET sertifikasıyla (pkt-2027-1) imzalı, zip de
/// onunla; PG künyesi `pg.json` OLMADAN — `kidsiz` = eski takımın `pg-zincir.json`u (pkt-2026-1), `kidli` =
/// `pg-zincir-pkt-2027-1.json`. Künye adayı yalnız kid'siz ad + bildirimi imzalayanın kid'li adıdır. İkinci sertifikanın
/// bitişi `second_end`.
fn chained_pg_world(tag: &str, unkidded: bool, kidded: bool, second_end: i64) -> World {
    let w = World::new(tag, Setup::default());
    install_pg_instance(&w, "kendi");
    let (pg_zip, content_hex) = pg_stage_zip("67");
    let kunye = pg_manifest(&pg_zip, &content_hex, "67");
    let cert1 = certificate(&w, &["URETIM", "TEST"]);
    let cert2 = certificate_of(&w, &pkt2_key(), PKT2_KID, CERT2_ID, second_end);
    let zip2 = chained_zip_by(&w, &pkt2_key(), PKT2_KID, &cert2);
    let name2 = format!("tekserp-backend-{NEW}-{PKT2_KID}.zip");
    let mut payload = manifest_payload(PKT2_KID, NEW, &zip2, Some(&json!({ "pg": pg_requirement(&kunye) })));
    payload["paket"]["ad"] = json!(name2);
    let token = sign_manifest(&pkt2_key(), PKT2_KID, &chained_payload(&payload, &cert2));
    let dir = format!("/{CHANNEL}/backend/pg/{PG_NEW_TAG}");
    let mut f = w.files.lock().unwrap();
    f.clear();
    f.insert(format!("/{CHANNEL}/backend/{NEW}/{name2}"), zip2);
    f.insert(format!("/{CHANNEL}/backend/{NEW}/surum-zincir-{PKT2_KID}.json"), pointer(&token));
    f.insert(format!("/{CHANNEL}/backend/{}", release::CHAINED_RELEASE_POINTER_FILE), pointer(&token));
    f.insert(format!("{dir}/{PG_ZIP}"), pg_zip);
    if unkidded {
        let t = sign(&pkt_key(), "tekserp-pg", PKT_KID, &chained_payload(&kunye, &cert1));
        f.insert(format!("{dir}/{}", release::CHAINED_PG_POINTER_FILE), pointer(&t));
    }
    if kidded {
        let t = sign(&pkt2_key(), "tekserp-pg", PKT2_KID, &chained_payload(&kunye, &cert2));
        f.insert(format!("{dir}/pg-zincir-{PKT2_KID}.json"), pointer(&t));
    }
    drop(f);
    w
}

fn run_pg_and_backend(w: &World) {
    for _ in 0..8 {
        if w.run(3).is_ok() && !w.unfinished() && matches!(w.state(), Some(State::Succeeded | State::RolledBack | State::Failed)) {
            return;
        }
        w.crash.disarm();
    }
}

fn pg_tag(w: &World) -> String {
    RealFs.link_target(&w.layout.pg_bin_link()).unwrap().unwrap().to_string_lossy().into_owned()
}

/// ⭐ Yalnız kid'li künye (`pg-zincir-pkt-2027-1.json`; kid'siz ve `pg.json` yok): ad bildirimi imzalayanından türer,
/// PG 16.15-4'e geçer, ardından backend kurulur.
#[test]
fn chained_pg_kidded_name_from_manifest_signer() {
    let w = chained_pg_world("pz-d8-pg-kidli", false, true, CERT_END + 365 * DAY);
    run_pg_and_backend(&w);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::Succeeded, "{:?} {:?}", st.error_code, st.message);
    assert!(pg_tag(&w).contains(PG_NEW_TAG), "PG bağı {}", pg_tag(&w));
    assert_eq!(w.current().as_deref(), Some(NEW));
}

/// ⭐ Eski takımın sertifikası iptal: kid'siz `pg-zincir.json` (pkt-2026-1) KABUL'de elenir, kid'li ad seçilir — ikincinin
/// bitişi DAHA ERKEN, kazanmasının tek nedeni iptal (günlükteki seçim satırı ölçer).
#[test]
fn chained_pg_revoked_unkidded_skipped_for_kidded() {
    let w = chained_pg_world("pz-d8-pg-iptal", true, true, CERT_END - 20 * DAY);
    std::fs::write(w.license_dir().join(paket_zinciri::PACKAGE_REVOCATION_FILE), revocation_token(&w, 2, CERT_ID)).unwrap();
    let log = w.run_logged(9);
    let st = w.status().unwrap();
    assert_eq!(st.state, State::Succeeded, "{:?} {:?}", st.error_code, st.message);
    assert!(pg_tag(&w).contains(PG_NEW_TAG), "PG bağı {}", pg_tag(&w));
    let picked = format!("pg-zincir-{PKT2_KID}.json seçildi; elenen: pg-zincir.json ({})", code::PAKET_SERTIFIKA_IPTAL);
    assert!(log.contains(&picked), "seçim satırı yok:\n{log}");
}

/// Yeniden imzalı künye yayına konmadıysa (yalnız iptalli kid'siz ad): PG adımı FAIL-CLOSED düşer, PG ve backend yerinde.
#[test]
fn chained_pg_only_revoked_unkidded_fails_closed() {
    let w = chained_pg_world("pz-d8-pg-takili", true, false, CERT_END + 365 * DAY);
    std::fs::write(w.license_dir().join(paket_zinciri::PACKAGE_REVOCATION_FILE), revocation_token(&w, 2, CERT_ID)).unwrap();
    let _ = w.run(3);
    let st = w.status().unwrap();
    assert_eq!(st.error_code.as_deref(), Some(code::PAKET_SERTIFIKA_IPTAL), "{:?} {:?}", st.state, st.message);
    assert!(pg_tag(&w).contains(PG_OLD_TAG), "PG bağı {}", pg_tag(&w));
    assert_eq!(w.current().as_deref(), Some(OLD));
}
