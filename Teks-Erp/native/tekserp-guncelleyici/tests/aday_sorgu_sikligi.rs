//! Aday sorgu sıklığı (W5, plan §6.3 · A8): sahte saatle günler simüle edilir, güncelleme sunucusuna (CDN Worker) giden
//! istekler sayılır. Kira saatlik yenilenirken günde 24 sorgu; kira yenilenmezse en geç 6 saatte bir, kurulum
//! kimliğinden türeyen sabit kaydırmaya oturarak; panel onayı ve uygulama öncesi tazeleme HEMEN sorgular; sunucu
//! erişilemezken sorgu sayısı sınırlı kalır ve hata görünür.
mod common;

use common::*;
use std::sync::atomic::Ordering;
use tekserp_guncelleyici::engine::Engine;
use tekserp_guncelleyici::ipc::State;
use tekserp_guncelleyici::schedule::{self, CEILING_MS, SPREAD_MS};

const MINUTE: i64 = 60_000;

/// Worker'ın ücretsiz katmanı (istek/gün) ve plandaki filo ölçeği.
const WORKER_DAILY_LIMIT: usize = 100_000;
const FLEET: usize = 300;

struct Sim {
    w: World,
    e: Engine,
    lease: LeaseOpts,
}

impl Sim {
    fn new(tag: &str, lease: LeaseOpts) -> Sim {
        let w = World::new(tag, Setup { lease: lease.clone(), ..Setup::default() });
        let e = w.engine();
        Sim { w, e, lease }
    }

    fn now(&self) -> i64 {
        self.w.clock.load(Ordering::SeqCst)
    }

    fn requests(&self) -> Vec<String> {
        self.w.faults.update_requests.lock().unwrap().clone()
    }

    /// Lisans yoklaması kirayı yeniden yazar (yeni `verilis`).
    fn renew(&self) {
        let (lease, _) = lease_and_entitlement(&self.w.keys, &self.lease, self.now());
        std::fs::write(self.w.layout.root.join("lisans").join("kira.jws"), lease).unwrap();
    }

    /// `minutes` dakika, `step` dakikada bir tur (gerçek tur 60 sn; sayım tur aralığından bağımsızdır, uzun simülasyon
    /// süre bütçesi için seyrek); `renew_at(dakika)` doğruysa o turdan önce kira yenilenir. Dönüş: sorgu (istek) anları.
    fn run(&self, minutes: i64, step: i64, renew_at: &dyn Fn(i64) -> bool) -> Vec<i64> {
        let mut at = vec![];
        for m in (step..=minutes).step_by(step as usize) {
            self.w.clock.fetch_add(step * MINUTE, Ordering::SeqCst);
            if renew_at(m) {
                self.renew();
            }
            let before = self.requests().len();
            self.e.tick(&|| false);
            if self.requests().len() > before {
                at.push(self.now());
            }
        }
        at
    }
}

fn onayli() -> LeaseOpts {
    LeaseOpts { update: Some(policy("ONAYLI", &[], None)), ..LeaseOpts::default() }
}

/// Kira saatlik yenilenir (dakika 20'de; gerçek yoklama süreç başlangıcına göre kayar): kurulum başına günde 24 sorgu
/// (bugün 5 dk'lık önbellekle 288) — 300 kurulumda 7.200/gün, Worker'ın 100 bin/gün sınırının %7'si. Sahte sunucuda
/// zincirli işaretçi yok (404 → eski `son.json`), sorgu başına 2 istek: üst sınır yine %15.
#[test]
fn hourly_lease_gives_24_per_day() {
    let s = Sim::new("w5-saatlik", onayli());
    s.e.tick(&|| false);
    assert_eq!(s.w.state(), Some(State::Ready), "{:?}", s.w.status().map(|d| (d.error_code, d.message)));
    let start = s.requests().len();
    let mut per_day = vec![];
    for _ in 0..2 {
        per_day.push(s.run(24 * 60, 10, &|m| m % 60 == 20).len());
    }
    let reqs = &s.requests()[start..];
    assert!(reqs.iter().all(|p| p.ends_with("son-zincir.json") || p.ends_with("son.json")), "yalnız işaretçi: {reqs:?}");
    assert_eq!(per_day, vec![24, 24], "günlük sorgu (kira saatlik)");
    assert!(reqs.len() <= 2 * 48, "sorgu başına en çok 2 istek: {}", reqs.len());
    let fleet = FLEET * reqs.len() / 2;
    assert!(fleet * 100 <= WORKER_DAILY_LIMIT * 15, "{FLEET} kurulum: {fleet} istek/gün — Worker sınırının %15'ini aşıyor");
    assert_eq!(s.w.state(), Some(State::Ready), "sorgu seyrekleşti, HAZIR durumu sürer");
}

/// Kira hiç yenilenmezse (lisans sunucusu erişilemez): en geç 6 saatte bir, son sorgudan (5 sa, 6 sa] sonra ve
/// kurulumun sabit kaydırmasına oturan dakikada — günde 4 istek.
#[test]
fn ceiling_six_hours_on_installation_phase() {
    let s = Sim::new("w5-tavan", onayli());
    s.e.tick(&|| false);
    let first = s.now();
    let at = s.run(2 * 24 * 60, 10, &|_| false);
    let phase = schedule::phase_ms(KURULUM_ID);
    let mut prev = first;
    for t in &at {
        let gap = t - prev;
        assert!(gap <= CEILING_MS && gap > CEILING_MS - SPREAD_MS, "aralık {} dk (5–6 sa beklenir)", gap / MINUTE);
        assert!(
            (t - phase).rem_euclid(SPREAD_MS) < 10 * MINUTE,
            "sorgu kaydırmaya oturmuyor: {} dk",
            (t - phase).rem_euclid(SPREAD_MS) / MINUTE
        );
        prev = *t;
    }
    assert!((8..=9).contains(&at.len()), "2 günde {} sorgu (≈4/gün beklenir)", at.len());
    assert!(s.now() - prev <= CEILING_MS);
}

/// İnsan eylemi (panel onayı) beklemez: niyete yeni onay yazıldığı turda aday sorgulanır — onay pencereyi beklese
/// (uygulama öncesi tazeleme yokken) bile; onaylanan sürüm sunucudaki güncel adayla o an karşılaştırılır.
#[test]
fn panel_approval_queries_at_once() {
    let lease = LeaseOpts { update: Some(policy("ONAYLI", &[(T0 + 3 * HOUR, T0 + 5 * HOUR)], None)), ..LeaseOpts::default() };
    let s = Sim::new("w5-onay", lease);
    s.e.tick(&|| false);
    s.run(30, 1, &|_| false);
    let before = s.requests().len();
    s.w.write_intent(&intent(Some(approval("onay-w5", NEW, "PENCERE"))));
    let at = s.run(1, 1, &|_| false);
    assert_eq!(at.len(), 1, "onay turunda aday sorgulanmadı");
    assert!(s.requests().len() > before);
    assert_eq!(s.w.state(), Some(State::Ready), "{:?}", s.w.status().map(|d| (d.error_code, d.message)));
    assert!(s.w.status().unwrap().planned.is_some(), "onaylı sürüm pencereyi bekler");
    assert!(s.run(30, 1, &|_| false).is_empty(), "aynı onay yeniden sorgulatmaz");
}

/// Uygulamadan hemen önceki tazeleme (≤ 60 sn) sorgu zamanlamasından bağımsızdır: kira yenilenmeden pencere açılınca
/// aday yeniden indirilir.
#[test]
fn apply_refreshes_candidate_regardless_of_schedule() {
    let lease = LeaseOpts { update: Some(policy("OTOMATIK", &[(T0 + 3 * HOUR, T0 + 5 * HOUR)], None)), ..LeaseOpts::default() };
    let s = Sim::new("w5-uygulama", lease);
    s.e.tick(&|| false);
    assert_eq!(s.w.state(), Some(State::Ready), "{:?}", s.w.status().map(|d| (d.error_code, d.message)));
    let opened = T0 + 3 * HOUR;
    let at = s.run((opened - s.now()) / MINUTE + 1, 1, &|_| false);
    assert!(at.iter().any(|t| (opened..opened + MINUTE).contains(t)), "pencere açılınca aday tazelenmedi: {at:?}");
    assert!(s.w.unfinished() || s.w.current().as_deref() == Some(NEW), "{:?}", s.w.status().map(|d| (d.error_code, d.message)));
}

/// Sunucu erişilemezken: başarısız sorgu 1 · 2 · 4 … dk aralıkla yinelenir, olağan sorgu anından (kira) seyrek
/// olmaz; hata durumda görünür (bayat aday ile "her şey yolunda" denmez); sunucu dönünce bir sonraki sorguda iyileşir.
#[test]
fn server_down_is_bounded_and_visible() {
    let s = Sim::new("w5-kesinti", onayli());
    s.e.tick(&|| false);
    s.w.faults.update_server_down.store(true, Ordering::SeqCst);
    let before = s.requests().len();
    let n = s.run(24 * 60, 10, &|m| m % 60 == 20).len();
    assert!((24..=34).contains(&n), "kesintide günlük sorgu {n}");
    assert!(s.requests().len() - before <= 2 * n);
    let st = s.w.status().unwrap();
    assert!(st.error_code.is_some() && st.state != State::Ready, "kesinti görünmüyor: {:?} {:?}", st.state, st.error_code);
    s.w.faults.update_server_down.store(false, Ordering::SeqCst);
    s.run(60, 10, &|m| m == 20);
    assert_eq!(s.w.state(), Some(State::Ready), "{:?}", s.w.status().map(|d| (d.error_code, d.message)));
}

/// Tek seferlik ağ hatası saatlik yenilemeyi beklemez: 1 dk sonra yeniden denenir.
#[test]
fn transient_failure_retries_within_minutes() {
    let s = Sim::new("w5-gecici", onayli());
    s.e.tick(&|| false);
    s.w.faults.update_server_down.store(true, Ordering::SeqCst);
    let failed = s.run(1, 1, &|_| true);
    assert_eq!(failed.len(), 1, "kira yenilenince sorgu");
    assert_ne!(s.w.state(), Some(State::Ready));
    s.w.faults.update_server_down.store(false, Ordering::SeqCst);
    let retried = s.run(3, 1, &|_| false);
    assert_eq!(retried.first().copied(), Some(failed[0] + MINUTE), "1 dk sonra yeniden deneme yok: {retried:?}");
    assert_eq!(s.w.state(), Some(State::Ready), "{:?}", s.w.status().map(|d| (d.error_code, d.message)));
}

/// Kaydırma belirlenimlidir (aynı kimlik → aynı an) ve filoya yayılır: 300 kurulumun tavan anları saatin altı
/// 10 dakikalık dilimine dengeli düşer, hiçbir dakikada 300'ün %3'ünden fazlası yok.
#[test]
fn phase_is_deterministic_and_spread() {
    assert_eq!(schedule::phase_ms(KURULUM_ID), schedule::phase_ms(KURULUM_ID));
    let ids: Vec<String> = (0..FLEET as u32)
        .map(|i| {
            let x = i.wrapping_mul(2_654_435_761);
            format!("{x:08x}-{:04x}-4{:03x}-8{:03x}-{:012x}", i & 0xffff, i & 0xfff, (i >> 3) & 0xfff, u64::from(x) * 7919)
        })
        .collect();
    let phases: Vec<i64> = ids.iter().map(|id| schedule::phase_ms(id)).collect();
    assert!(phases.iter().all(|p| (0..SPREAD_MS).contains(p)));
    let mut buckets = [0usize; 6];
    let mut minutes = vec![0usize; (SPREAD_MS / MINUTE) as usize];
    for p in &phases {
        buckets[(p / (SPREAD_MS / 6)) as usize] += 1;
        minutes[(p / MINUTE) as usize] += 1;
    }
    let mean = FLEET / 6;
    assert!(buckets.iter().all(|b| *b * 2 >= mean && *b * 2 <= mean * 3), "10 dk dilimleri dengesiz: {buckets:?}");
    let peak = *minutes.iter().max().unwrap();
    assert!(peak * 20 <= FLEET, "aynı dakikada {peak} kurulum (kaydırmasız: {FLEET})");
    let ceilings: Vec<i64> = phases.iter().map(|p| schedule::ceiling_at(T0, *p)).collect();
    assert!(ceilings.iter().all(|c| *c <= T0 + CEILING_MS && *c > T0 + CEILING_MS - SPREAD_MS));
}
