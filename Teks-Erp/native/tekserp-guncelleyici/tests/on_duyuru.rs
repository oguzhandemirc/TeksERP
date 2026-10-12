//! R23 (0.2.7): OTOMATİK kipte bakım penceresi İÇİNDE hazır olan paket ön duyurusuz kurulmaz — önce
//! `planlanan = ilk görülme + 5 dk` ile PENCERE_BEKLIYOR (backend `plannedOutage` bunu panel/tablete duyurur).
//! Saf vektörler (`decision::announce_gate`) + sahte dünya senaryoları a–e (GUNCELLEYICI-SAGLAMLIK.md §12 R23).
mod common;

use common::*;
use std::sync::atomic::Ordering;
use tekserp_guncelleyici::decision::{self, Decision, Interval, Kind, Mode, UpdatePolicy, NOTICE_MS};
use tekserp_guncelleyici::ipc::State;

const MIN: i64 = 60_000;

/// Güncelleyicinin yazdığı an biçimi (milisaniyeli).
fn ms(t: i64) -> String {
    tekserp_hizmet::timefmt::iso_millis(t)
}

fn iv(a: i64, b: i64) -> Interval {
    Interval { baslangic: iso(a), bitis: iso(b) }
}

fn pol(kip: Mode, intervals: &[(i64, i64)]) -> UpdatePolicy {
    UpdatePolicy { kip, pencere: None, araliklar: intervals.iter().map(|(a, b)| iv(*a, *b)).collect(), target: None }
}

fn install_in(current: (i64, i64)) -> Decision {
    Decision { karar: Kind::Install, neden: Some("PENCERE".into()), aralik: Some(iv(current.0, current.1)), pg_update: false }
}

/// Kapının sonucu `karar/neden/aralık başı/duyuru` biçiminde.
fn gate(p: &UpdatePolicy, d: Decision, approved: bool, announced: Option<i64>, now: i64) -> String {
    let (d, notice) = decision::announce_gate(d, p, approved, announced.map(|a| a as f64), now as f64);
    format!(
        "{}/{}/{}/{}",
        d.karar.label(),
        d.neden.unwrap_or_else(|| "-".into()),
        d.aralik.map(|a| a.baslangic).unwrap_or_else(|| "-".into()),
        notice.map(|n| ms(n as i64)).unwrap_or_else(|| "-".into())
    )
}

#[test]
fn karar_vektorleri() {
    let w1 = (T0 - 30 * MIN, T0 + 150 * MIN);
    let w2 = (w1.0 + DAY, w1.1 + DAY);
    let p = pol(Mode::Automatic, &[w1, w2]);
    assert_eq!(NOTICE_MS, 5.0 * MIN as f64, "backend UPDATE_APPROVAL_NOTICE_MS ile aynı");
    // (a) pencere içinde ilk görülen paket: 5 dk PENCERE_BEKLIYOR, aralık = [planlanan, pencere sonu].
    let due = T0 + 5 * MIN;
    assert_eq!(gate(&p, install_in(w1), false, None, T0), format!("PENCERE_BEKLIYOR/-/{}/{}", ms(due), ms(due)), "a: ilk görülme");
    assert_eq!(
        gate(&p, install_in(w1), false, Some(due), T0 + 4 * MIN),
        format!("PENCERE_BEKLIYOR/-/{}/{}", ms(due), ms(due)),
        "a: süre dolmadı"
    );
    assert_eq!(gate(&p, install_in(w1), false, Some(due), due), format!("KUR/PENCERE/{}/{}", iso(w1.0), ms(due)), "a: süre doldu → KUR");
    // (b) pencere başlamadan duyurulmuş (planlanan = pencere başı): pencerede hemen KUR — bugünkü davranış.
    assert_eq!(gate(&p, install_in(w1), false, Some(w1.0), w1.0 + MIN), format!("KUR/PENCERE/{}/{}", iso(w1.0), ms(w1.0)), "b");
    // (c) süre pencere kapanmadan dolmuyor: bu pencerede kurulmaz, sıradaki aralık beklenir (planlanan = onun başı).
    let late = w1.1 - 3 * MIN;
    assert_eq!(gate(&p, install_in(w1), false, None, late), format!("PENCERE_BEKLIYOR/-/{}/-", iso(w2.0)), "c: sıradaki pencere");
    assert_eq!(gate(&p, install_in(w1), false, Some(w2.0), late + MIN), format!("PENCERE_BEKLIYOR/-/{}/-", iso(w2.0)), "c: kararlı");
    assert_eq!(
        gate(&pol(Mode::Automatic, &[w1]), install_in(w1), false, None, late),
        "PENCERE_BEKLIYOR/PENCERE_YOK/-/-",
        "c: sıradaki yok"
    );
    // (d) saat geri gitti: duyurulmuş an 5 dk'dan uzak gelecekte → bekleme 5 dk'yı aşmaz (yeniden duyurulur).
    assert_eq!(gate(&p, install_in(w1), false, Some(T0 + HOUR), T0), format!("PENCERE_BEKLIYOR/-/{}/{}", ms(due), ms(due)), "d: saat geri");
    // Bayat duyuru (> 15 dk geçmiş, örn. dünkü pencere ya da uzun kesinti): yeniden duyurulur.
    assert_eq!(gate(&p, install_in(w1), false, Some(T0 - 16 * MIN), T0), format!("PENCERE_BEKLIYOR/-/{}/{}", ms(due), ms(due)), "bayat");
    // (e) onaylı kurulum ve ONAYLI kip kapıya girmez (backend onayı zaten 5 dk geciktirip duyurur).
    assert_eq!(gate(&p, install_in(w1), true, None, T0), format!("KUR/PENCERE/{}/-", iso(w1.0)), "e: OTOMATİK + PENCERE onayı");
    assert_eq!(gate(&pol(Mode::Approval, &[w1]), install_in(w1), true, None, T0), format!("KUR/PENCERE/{}/-", iso(w1.0)), "e: ONAYLI");
    let now_ = Decision { karar: Kind::Install, neden: Some("ONAY_HEMEN".into()), aralik: None, pg_update: false };
    assert_eq!(gate(&p, now_, true, None, T0), "KUR/ONAY_HEMEN/-/-", "e: HEMEN");
    let waiting = Decision { karar: Kind::AwaitingWindow, neden: None, aralik: Some(iv(w2.0, w2.1)), pg_update: true };
    assert_eq!(gate(&p, waiting, false, None, T0), format!("PENCERE_BEKLIYOR/-/{}/-", iso(w2.0)), "pencere dışı karar değişmez");
}

fn automatic(intervals: &[(i64, i64)]) -> Setup {
    Setup { lease: LeaseOpts { update: Some(policy("OTOMATIK", intervals, None)), ..LeaseOpts::default() }, ..Setup::default() }
}

fn planned(w: &World) -> Option<String> {
    w.status().and_then(|s| s.planned)
}

fn pending_verdict(w: &World) -> String {
    let p = w.status().and_then(|s| s.pending).expect("bekleyen");
    format!("{}/{}", p.karar, p.neden.unwrap_or_else(|| "-".into()))
}

/// (a) + (d): pencere içinde ilk kez hazırlanan paket 5 dk duyurulur; yeniden başlatma (yeni motor) duyuru anını
/// korur, geri giden saat bekleme süresini uzatmaz; an gelince kurulur.
#[test]
fn pencere_icinde_hazir_paket_once_duyurulur() {
    let w = World::new("r23-a", automatic(&open_window()));
    w.unannounce();
    w.run(2).unwrap();
    let due = ms(T0 + 5 * MIN);
    assert_eq!(w.state(), Some(State::Ready), "{:?}", w.status().and_then(|s| s.message));
    assert_eq!(pending_verdict(&w), "PENCERE_BEKLIYOR/-", "rapor (backend plannedOutage) PENCERE_BEKLIYOR görür");
    assert_eq!(planned(&w).as_deref(), Some(due.as_str()), "planlanan = ilk görülme + 5 dk");
    assert_eq!(w.backend().starts, 0, "duyurulmadan kurulmadı");
    // (d) yeniden başlatma: her `run` yeni motordur; 4. dakikada duyuru anı aynı, kurulum yok.
    w.clock.store(T0 + 4 * MIN, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(planned(&w).as_deref(), Some(due.as_str()), "yeniden başlatmada ilk görülme korunur");
    assert_eq!(w.backend().starts, 0);
    // Saat geri gitti (T0 − 2 dk): bekleme 5 dk'yı aşmaz, kurulum yine yok.
    w.clock.store(T0 - 2 * MIN, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(planned(&w).as_deref(), Some(ms(T0 + 3 * MIN).as_str()), "saat geri gidince yeniden duyurulur, ≤ 5 dk");
    assert_eq!(w.backend().starts, 0);
    w.clock.store(T0 + 3 * MIN, Ordering::SeqCst);
    w.run_to_rest(0);
    assert_eq!(w.state(), Some(State::Succeeded));
    assert_eq!(w.current().as_deref(), Some(NEW));
}

/// (b): paket pencere başlamadan hazır — planlanan = pencere başı, pencere açılınca bekletmeden kurulur.
#[test]
fn pencereden_once_hazir_paket_bugunku_gibi() {
    let start = T0 + 2 * HOUR;
    let w = World::new("r23-b", automatic(&[(start, start + 3 * HOUR)]));
    w.unannounce();
    w.run(2).unwrap();
    assert_eq!(planned(&w).as_deref(), Some(iso(start).as_str()));
    assert_eq!(w.backend().starts, 0);
    w.clock.store(start + MIN, Ordering::SeqCst);
    w.run(3).unwrap();
    assert_eq!(w.state(), Some(State::Succeeded), "pencerede ek bekleme yok: {:?}", w.status().and_then(|s| s.message));
}

/// (c): 5 dk dolmadan pencere kapanıyor — bu pencerede kurulmaz, sıradaki pencerenin başı duyurulur.
#[test]
fn sure_dolmadan_pencere_kapanirsa_kurulmaz() {
    let w1 = (T0 - HOUR, T0 + 3 * MIN);
    let w2 = (T0 + DAY - HOUR, T0 + DAY + 2 * HOUR);
    let w = World::new("r23-c", automatic(&[w1, w2]));
    w.unannounce();
    w.run(2).unwrap();
    assert_eq!(pending_verdict(&w), "PENCERE_BEKLIYOR/-");
    assert_eq!(planned(&w).as_deref(), Some(iso(w2.0).as_str()), "planlanan = sıradaki pencerenin başı");
    w.clock.store(T0 + 2 * MIN, Ordering::SeqCst);
    w.run(1).unwrap();
    w.clock.store(w1.1 + MIN, Ordering::SeqCst);
    w.run(1).unwrap();
    assert_eq!(w.backend().starts, 0, "pencere kapandı: kurulmadı");
    assert_eq!(planned(&w).as_deref(), Some(iso(w2.0).as_str()));
    w.clock.store(w2.0 + MIN, Ordering::SeqCst);
    w.run(3).unwrap();
    assert_eq!(w.state(), Some(State::Succeeded), "sıradaki pencerede duyurulmuş: hemen kurulur");
}

/// (e): onaylı kurulum (ONAYLI kip + PENCERE onayı, OTOMATİK + PENCERE onayı) değişmez — backend onayı zaten
/// 5 dk geç yazar ve duyurur.
#[test]
fn onayli_kurulum_degismez() {
    for (tag, kip) in [("r23-e-onayli", "ONAYLI"), ("r23-e-otomatik", "OTOMATIK")] {
        let w = World::new(
            tag,
            Setup {
                lease: LeaseOpts { update: Some(policy(kip, &open_window(), None)), ..LeaseOpts::default() },
                intent: Some(intent(Some(approval("onay-p", NEW, "PENCERE")))),
                ..Setup::default()
            },
        );
        w.unannounce();
        w.run(3).unwrap();
        assert_eq!(w.state(), Some(State::Succeeded), "{tag}: {:?}", w.status().and_then(|s| s.message));
    }
}
