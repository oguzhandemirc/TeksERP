//! Motor — hizmetin her turu (§5–§8): yarım işlem varsa ÖNCE onu sonuçlandır; yoksa kira (yetki) →
//! aday (işaretçi → PAKET imzalı sürüm bildirimi) → TEK karar (`decision::decide`, TS aynası) →
//! paket (indir · sha256 · aç · bütünlük · bağ) → şema hizası (`sema`) → HAZIR → karar KUR ise (PG küçük sürümü
//! önce) uygula.
//! Her turun sonunda `durum.json` yazılır (canlılık). Hiçbir karar niyetten YETKİ almaz: niyet yalnız
//! panel onayı ve indirme belirtecidir; kurulabilirlik imzalı kira + bildirim + paketten gelir.
use crate::codes;
use crate::decision::{self, Decision, InstalledPg, Kind, PgMode, PolicySource, UpdatePolicy};
use crate::download::{self, Spec};
use crate::env::Env;
use crate::health;
use crate::ipc::{
    self, Approval, IntentRead, LastDetail, Notice, Pending, PolicyView, Progress as IpcProgress, State, StatusDoc, UpdateResult,
};
use crate::journal::{Journal, Kind as JKind};
use crate::layout::Layout;
use crate::operation::{self, BackendOp, BackendPlan, Ctx, OpOutcome, Progress};
use crate::package::{self, ExtractLimits};
use crate::pgminor::{self, PgOp, PgPlan};
use crate::policy::{self, LicenseView};
use crate::release::{self, Checked, PgTarget, ReleaseManifest};
use crate::selfupdate;
use crate::sema;
use crate::settings::{self, BackendEnv, UpdaterSettings};
use crate::tools;
use crate::trust::TrustAnchor;
use crate::version;
use serde_json::{json, Map, Value};
use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tekserp_dogrulama::paket_zinciri::{PackageMode, PackageTrust};
use tekserp_hizmet::logfile::RotatingLog;
use tekserp_hizmet::timefmt;

/// Doğrulanmış aday bu kadar süre yeniden indirilmeden kullanılır; uygulamadan hemen önce tazelenir.
const CANDIDATE_TTL_MS: i64 = 5 * 60 * 1000;
const CANDIDATE_FRESH_FOR_APPLY_MS: i64 = 60 * 1000;
/// Kesin paket hatalarında (özet · bütünlük · bağ) yeniden indirme aralığı: 15 dk × 4ⁿ, en çok 24 sa.
const BACKOFF_BASE_MS: i64 = 15 * 60 * 1000;
const BACKOFF_MAX_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TickResult {
    /// Bir sonraki tura kadar bekle (niyet değişirse erken uyan).
    Idle(Duration),
    /// Yeni ikiliyle yeniden başlatılmak için çık (§10).
    RestartForSelfUpdate,
}

struct Candidate {
    fetched_ms: i64,
    pointer: String,
    manifest: Checked<ReleaseManifest>,
}

/// İşaretçi: zincirli (PAKET sertifikalı) dosya önce, eski (`paket-*` imzalı) dosya 404 düşüşü. `family` doluysa
/// (değişmez dizin: `surum`/`pg`) yeniden imza YANINA yazılır ⇒ kid'siz + bilinen imzacıların `<aile>-zincir-<kid>.json`
/// adları aday, seçim `release::select_chained`.
struct Pointer {
    chained: String,
    legacy: String,
    family: Option<release::ChainedFamily>,
    kids: Vec<String>,
    /// Sabitlenmiş sürüm: bilinen imzacı kanalın `son-zincir.json`ının imzalayanı (en iyi çaba).
    kids_from_latest: bool,
}

impl Pointer {
    fn single(chained: String, legacy: String) -> Pointer {
        Pointer { chained, legacy, family: None, kids: Vec::new(), kids_from_latest: false }
    }
}

pub struct Engine {
    pub env: Env,
    pub layout: Layout,
    pub anchor: TrustAnchor,
    pub log: Arc<RotatingLog>,
    /// Çalışan ikilinin yolu (kendini güncelleme); test `None` verir.
    pub own_exe: Option<PathBuf>,
    /// Çalışan ikilinin sürümü (`kunye.surum`; test yerleşmiş yeni ikiliyi taklit etmek için değiştirir).
    pub own_version: String,
    last_status: RefCell<Option<StatusDoc>>,
    last_progress_ms: RefCell<i64>,
    candidate: RefCell<Option<Candidate>>,
    /// Bu turun bilgisi (`durum.bilgi`): turun başında silinir, ölçüm koyar; sonraki her durum yazımı taşır.
    notice: RefCell<Option<Notice>>,
    /// Sağlıklı tur ölçütü (§4.2 madde 3): bu turda kira/HAK okunup karar verildi · ardından `durum.json` yazıldı.
    decided: Cell<bool>,
    status_after_decision: Cell<bool>,
    healthy_marked: Cell<bool>,
    /// Önce-güncelleyici sınaması sonuçsuz kalan paket (sürüm:paketId) — aynı süreçte her turda yeniden ölçülmez.
    self_checked: RefCell<Option<String>>,
    /// DONDUR'da yenilemenin olmama nedeni: yalnız değişince günlüğe yazılır (her tur aynı satır olmasın).
    frozen_note: RefCell<Option<String>>,
}

struct Inputs {
    settings: UpdaterSettings,
    backend: BackendEnv,
}

/// Bir turun ortak görüntüsü: durum yazımı bunun üstüne kurulur.
struct Frame {
    installed: Option<String>,
    policy: Option<PolicyView>,
    decision: Option<Decision>,
    pending: Option<Pending>,
    last: Option<UpdateResult>,
    last_detail: Option<LastDetail>,
    tick_s: u64,
    /// HATA'dan çıkış onayı bu turda henüz uygulanmadı: yazılan durum HATA kalır (yalnız onaylanan
    /// adayın indirilmesi/hazır olması gösterilir).
    hold_failed: bool,
}

/// Son tamamlanan işlem (işlem günlüğü tek doğru kaynaktır: `durum.json` yazılmadan ölünse bile sonuç
/// buradan türer).
struct LastOp {
    outcome: OpOutcome,
    target: String,
    approval_id: Option<String>,
    result: UpdateResult,
    detail: LastDetail,
    /// Başarılı PG adımı bir denemenin sonucu değildir (backend adımı onu izler).
    attempt_end: bool,
}

type Fail = (&'static str, String);

/// Hazırlık dizini işlemi düştü: kilit (erişim engellendi · Windows paylaşım/kilit ihlali 32/33) `DOSYA_KILITLI`,
/// diğerleri verilen kod. Kilit bir indirme hatası değildir ve paketi ertelemeye sokmaz.
fn staging_fail(otherwise: &'static str, path: &std::path::Path, e: &std::io::Error) -> Fail {
    let locked = e.kind() == std::io::ErrorKind::PermissionDenied || crate::platform::is_sharing_violation(e);
    if locked {
        fail(
            codes::DOSYA_KILITLI,
            format!("{} başka bir program tarafından kullanılıyor ({e}) — virüs tarayıcı, yedek ya da açık bir Gezgin penceresi olabilir; kilit kalkınca kendiliğinden sürer", path.display()),
        )
    } else {
        fail(otherwise, format!("{}: {e}", path.display()))
    }
}

fn fail(code: &'static str, m: impl Into<String>) -> Fail {
    (code, m.into())
}

/// HATA'dan çıkış kuralı (ileti): yalnız başarısız denemenin sürümüne ya da ondan YENİ imzalı adaya onay.
fn failed_exit_rule(failed_target: &str) -> String {
    format!("HATA'dan çıkış yalnız başarısız denemenin sürümüne ({failed_target}) ya da ondan yeni, imzalı bildirimle gelen adaya verilen YENİ onayla")
}

impl Engine {
    pub fn new(env: Env, layout: Layout, anchor: TrustAnchor, log: Arc<RotatingLog>, own_exe: Option<PathBuf>) -> Engine {
        Engine {
            env,
            layout,
            anchor,
            log,
            own_exe,
            own_version: env!("CARGO_PKG_VERSION").to_string(),
            last_status: RefCell::new(None),
            last_progress_ms: RefCell::new(0),
            candidate: RefCell::new(None),
            notice: RefCell::new(None),
            decided: Cell::new(false),
            status_after_decision: Cell::new(false),
            healthy_marked: Cell::new(false),
            self_checked: RefCell::new(None),
            frozen_note: RefCell::new(None),
        }
    }

    fn now(&self) -> i64 {
        self.env.clock.now_ms()
    }

    fn write_status(&self, mut doc: StatusDoc) {
        doc.at = timefmt::iso_millis(self.now());
        doc.heartbeat = doc.at.clone();
        doc.liveness_threshold_s = self.liveness_threshold(&doc);
        match ipc::write_status(self.env.fs.as_ref(), &self.layout, &doc) {
            Ok(()) => self.status_after_decision.set(self.decided.get()),
            Err(e) => self.log.warn(&format!("durum.json yazılamadı: {e}")),
        }
        *self.last_status.borrow_mut() = Some(doc);
    }

    /// `canlilikEsigiSn`: bu durumda iki kalp atışı arası en uzun beklenen süre.
    fn liveness_threshold(&self, doc: &StatusDoc) -> u64 {
        let tick = doc.tick_s.max(10);
        let s = settings::read_settings(self.env.fs.as_ref(), &self.layout).unwrap_or_default();
        match doc.state {
            State::Applying => {
                let longest = s.backup_timeout().max(s.migrate_timeout()).max(s.health_timeout() + s.stop_timeout());
                longest.as_secs() + 300
            }
            State::Downloading => 3 * tick + 600,
            _ => 3 * tick,
        }
    }

    fn doc(&self, f: &Frame, state: State, code: Option<&str>, message: &str) -> StatusDoc {
        let state = if f.hold_failed && !matches!(state, State::Downloading | State::Ready) { State::Failed } else { state };
        let mut d = StatusDoc::new(state);
        d.tick_s = f.tick_s;
        d.installed_version = f.installed.clone();
        d.source_version = f.installed.clone();
        d.version = f.pending.as_ref().map(|p| p.surum.clone());
        let mut policy = f.policy.clone();
        if let (Some(p), Some(dec)) = (policy.as_mut(), f.decision.as_ref()) {
            p.reason = ipc::legacy_reason(dec);
            p.allowed = p.reason.is_none();
        }
        d.policy = policy;
        d.decision = f.decision.clone();
        d.pending = f.pending.clone();
        d.last = f.last.clone();
        d.last_detail = f.last_detail.clone();
        d.error_code = code.map(str::to_string);
        d.message = (!message.is_empty()).then(|| message.to_string());
        // Son 24 saatteki onarım (W1b, `onar`) başka bilgi yoksa görünür kalır.
        d.notice = self.notice.borrow().clone().or_else(|| crate::onarim::recent_notice(&self.env, &self.layout));
        d
    }

    fn previous_status(&self) -> Option<StatusDoc> {
        self.last_status.borrow().clone().or_else(|| ipc::read_status(self.env.fs.as_ref(), &self.layout))
    }

    /// Kurulu sürüm: `current` bağlantısının hedef dizininin adı.
    pub fn installed_version(&self) -> Option<(String, PathBuf)> {
        let target = self.env.fs.link_target(&self.layout.current()).ok().flatten()?;
        let name = target.file_name()?.to_string_lossy().into_owned();
        version::parse(&name).map(|_| (name, target))
    }

    fn inputs(&self) -> Result<Inputs, Fail> {
        let settings = settings::read_settings(self.env.fs.as_ref(), &self.layout).map_err(|e| fail(codes::AYAR_BICIMSIZ, e))?;
        let backend = settings::read_backend_env_in(self.env.fs.as_ref(), &self.layout, self.env.arka.ortam)?;
        Ok(Inputs { settings, backend })
    }

    /// Özel alan (`is\`) ve üstü bağlantı OLAMAZ; Windows'ta `is\` korumalı DACL'le (SYSTEM +
    /// Administrators) kurulur. Sağlanamazsa güncelleyici hiçbir şey yapmaz (fail-closed).
    fn private_area_ok(&self) -> Result<(), String> {
        let fs = self.env.fs.as_ref();
        for p in [self.layout.data.clone(), self.layout.work().parent().map(Path::to_path_buf).unwrap_or_default(), self.layout.work()] {
            if fs.is_link(&p) {
                return Err(format!("{} bir bağlantı (junction/sembolik bağ) — güncelleyici özel alanı olarak kullanılmaz", p.display()));
            }
        }
        crate::platform::harden_private_dir(fs, &self.layout.work())
    }

    /// SYSTEM'in ÇALIŞTIRDIĞI ya da güvendiği her yol (DAGK-3/4): kök · `surumler\` · kurulu sürüm dizini ·
    /// `guncelleyici\` · `pgsql\` · bağlantısı çözülmüş `PG_BIN_DIR` ve PG araç ikilileri yabancı yazmaya
    /// kapalı olmalı; değilse ya da ölçülemezse hiçbir şey yapılmaz. İzni kurulum betiği yazar
    /// (`backend-hizmeti.ps1 -Uygula`), güncelleyici yalnız ÖLÇER.
    fn trusted_paths_ok(&self, inputs: &Inputs) -> Result<(), String> {
        let fs = self.env.fs.as_ref();
        let mut paths = vec![self.layout.root.clone(), self.layout.versions(), self.layout.updater_dir(), self.layout.pgsql()];
        if let Ok(Some(current)) = fs.link_target(&self.layout.current()) {
            paths.push(current);
        }
        let bin = match fs.link_target(&inputs.backend.pg_bin_dir) {
            Ok(Some(target)) => Some(target),
            Ok(None) => None,
            Err(_) => Some(inputs.backend.pg_bin_dir.clone()),
        };
        if let Some(bin) = bin {
            for tool in ["pg_dump", "pg_restore", "psql", "postgres"] {
                paths.push(bin.join(crate::platform::executable(tool)));
            }
            paths.push(bin);
        }
        for p in paths.into_iter().filter(|p| fs.exists(p)) {
            let foreign = fs.foreign_writers(&p).map_err(|e| format!("{} izinleri ölçülemedi: {e}", p.display()))?;
            if !foreign.is_empty() {
                return Err(format!(
                    "{}: güvenilmez izin ({}) — SYSTEM bunu çalıştırmaz; kurulumun izin betiği gerekir (backend-hizmeti.ps1 -Uygula)",
                    p.display(),
                    foreign.join(" · ")
                ));
            }
        }
        Ok(())
    }

    fn bare_frame(&self, tick_s: u64) -> Frame {
        let prev = self.previous_status();
        Frame {
            installed: self.installed_version().map(|v| v.0),
            policy: None,
            decision: None,
            pending: None,
            last: prev.as_ref().and_then(|p| p.last.clone()),
            last_detail: prev.and_then(|p| p.last_detail),
            tick_s,
            hold_failed: false,
        }
    }

    /// Bir tur. `stop()` doğru olursa uzun işler (indirme) güvenli noktada bırakılır. Kendini güncellemeyle gelen
    /// ikili, İLK SAĞLIKLI turunda doğrulanır (§4.2 madde 3: kilit alındı · günlük okundu · kira/HAK okundu · karar
    /// verildi · `durum.json` yazıldı) — turun yalnız bitmesi yetmez.
    pub fn tick(&self, stop: &dyn Fn() -> bool) -> TickResult {
        *self.notice.borrow_mut() = None;
        self.decided.set(false);
        self.status_after_decision.set(false);
        let r = self.tick_inner(stop);
        let healthy = self.decided.get() && self.status_after_decision.get();
        if healthy && r != TickResult::RestartForSelfUpdate && !self.healthy_marked.get() {
            if let Some(own) = &self.own_exe {
                selfupdate::on_healthy(&self.env, &self.layout, own, &self.own_version);
            }
            self.healthy_marked.set(true);
        }
        r
    }

    /// Bu süreçte sağlıklı tur ölçütünü karşılayan bir tur oldu mu (§4.2 madde 3).
    pub fn verified(&self) -> bool {
        self.healthy_marked.get()
    }

    fn tick_inner(&self, stop: &dyn Fn() -> bool) -> TickResult {
        let idle = |s: u64| TickResult::Idle(Duration::from_secs(s));
        if let Err(m) = self.private_area_ok() {
            self.log.error(&m);
            self.env.events.event(tekserp_hizmet::logfile::Level::Error, &m);
            self.write_status(self.doc(&self.bare_frame(300), State::Waiting, Some(codes::IC_HATA), &m));
            return idle(300);
        }
        let inputs = match self.inputs() {
            Ok(i) => i,
            Err((code, m)) => {
                self.log.warn(&format!("ayar okunamadı: {m}"));
                self.write_status(self.doc(&self.bare_frame(300), State::Waiting, Some(code), &m));
                return idle(300);
            }
        };
        // Yarım işlem sürdürülmeden de ÖNCE: SYSTEM'in çalıştıracağı hiçbir şey yabancı yazılabilir dizinden gelmez.
        if let Err(m) = self.trusted_paths_ok(&inputs) {
            self.log.error(&m);
            self.env.events.event(tekserp_hizmet::logfile::Level::Error, &m);
            self.write_status(self.doc(&self.bare_frame(300), State::Waiting, Some(codes::IZIN_GUVENSIZ), &m));
            return idle(300);
        }
        let tick_s = inputs.settings.tick_s.clamp(10, 3600);
        let mut journal = match Journal::open(self.env.fs.as_ref(), &self.layout.journal_file()) {
            Ok(j) => j,
            Err(e) => {
                let m = format!("işlem günlüğü açılamadı: {e}");
                self.log.error(&m);
                self.write_status(self.doc(&self.bare_frame(tick_s), State::Waiting, Some(codes::IC_HATA), &m));
                return idle(tick_s);
            }
        };
        operation::sweep_plain_secrets(&self.env, &self.layout);
        if let Some(v) = journal.unfinished() {
            self.log.warn(&format!("yarım işlem bulundu ({}) — sürdürülüyor", v.op));
            let outcome = self.resume(&inputs, &mut journal, v.plan().cloned().unwrap_or(Value::Null));
            return self.after_op(&inputs, &journal, outcome, tick_s);
        }
        self.cycle(&inputs, &mut journal, stop, tick_s)
    }

    fn ctx<'a>(&'a self, inputs: &'a Inputs, report: &'a dyn Fn(&Progress)) -> Ctx<'a> {
        Ctx {
            env: &self.env,
            layout: &self.layout,
            settings: &inputs.settings,
            backend: &inputs.backend,
            anchor: &self.anchor,
            log: &self.log,
            report,
        }
    }

    fn report_fn(&self, tick_s: u64) -> impl Fn(&Progress) + '_ {
        move |p: &Progress| {
            let mut f = self.bare_frame(tick_s);
            if let Some(prev) = self.previous_status() {
                f.policy = prev.policy;
                f.decision = prev.decision;
                f.pending = prev.pending;
            }
            let message = if p.rolling_back { format!("geri alınıyor: {}", p.step) } else { format!("uygulanıyor: {}", p.step) };
            let mut d = self.doc(&f, State::Applying, None, &message);
            d.product = Some(p.product.to_string());
            d.op_id = Some(p.op_id.to_string());
            d.step = Some(p.step.to_string());
            // PG adımı backend denemesinin parçasıdır: `surum` adayın (backend) sürümü kalır.
            if p.product != "pg" {
                d.version = Some(p.target.to_string());
                d.source_version = Some(p.source.to_string());
            }
            self.write_status(d);
        }
    }

    /// Yarım işlemi planıyla sürdürür (plan ISLEM satırındadır; yeniden HESAPLANMAZ).
    fn resume(&self, inputs: &Inputs, journal: &mut Journal, plan: Value) -> OpOutcome {
        let tick_s = inputs.settings.tick_s.clamp(10, 3600);
        let report = self.report_fn(tick_s);
        let ctx = self.ctx(inputs, &report);
        let broken = |e: String| OpOutcome::Failed(operation::step_err(codes::IC_HATA, format!("yarım işlem planı okunamadı: {e}")));
        match plan.get("tur").and_then(Value::as_str) {
            Some("PG") => match serde_json::from_value::<PgPlan>(plan) {
                Ok(p) => operation::drive(&ctx, journal, &PgOp { plan: p }),
                Err(e) => broken(e.to_string()),
            },
            _ => match serde_json::from_value::<BackendPlan>(plan) {
                Ok(p) => operation::drive(&ctx, journal, &BackendOp { plan: p }),
                Err(e) => broken(e.to_string()),
            },
        }
    }

    /// Günlükteki son TAMAMLANMIŞ işlem ve sözleşme §3.1 biçiminde sonucu.
    fn last_op(&self, journal: &Journal) -> Option<LastOp> {
        let v = journal.last_op()?;
        let result_rec = v.records.iter().rev().find(|r| r.kind == JKind::Result)?.clone();
        let plan = v.plan()?.clone();
        let outcome = operation::outcome_of(&v);
        let s = |k: &str| plan.get(k).and_then(Value::as_str).map(str::to_string);
        let is_pg = s("tur").as_deref() == Some("PG");
        let target = if is_pg { s("hedefBackend") } else { s("surum") }.unwrap_or_default();
        let source = if is_pg { s("backendSurumu") } else { s("kaynakSurum") };
        let started = plan.get("basladi").and_then(Value::as_i64).map(timefmt::iso_millis).unwrap_or_else(|| result_rec.at.clone());
        let restored = v.records.iter().any(|r| {
            r.kind == JKind::CompEnd && r.step.as_deref() == Some("GOC") && r.data.get("geriYuklendi") == Some(&Value::Bool(true))
        });
        let (result, code, message) = match &outcome {
            OpOutcome::Succeeded => ("BASARILI", None, None),
            OpOutcome::RolledBack(e) => ("GERI_DONDU", Some(e.code), Some(e.message.clone())),
            OpOutcome::Failed(e) => ("BASARISIZ", Some(e.code), Some(e.message.clone())),
        };
        Some(LastOp {
            attempt_end: !(is_pg && outcome == OpOutcome::Succeeded),
            target: target.clone(),
            approval_id: s("onayId"),
            result: UpdateResult {
                record_id: s("islemId").unwrap_or_default(),
                target,
                source,
                result: result.into(),
                kod: code.map(|c| codes::report_code(c).to_string()),
                baslangic: started,
                bitis: result_rec.at,
                data_restored: restored,
            },
            detail: LastDetail {
                product: if is_pg { "pg".into() } else { "backend".into() },
                error_code: code.map(str::to_string),
                message,
            },
            outcome,
        })
    }

    fn after_op(&self, inputs: &Inputs, journal: &Journal, outcome: OpOutcome, tick_s: u64) -> TickResult {
        let mut f = self.bare_frame(tick_s);
        if let Some(prev) = self.previous_status() {
            f.policy = prev.policy;
            f.decision = prev.decision;
            f.pending = prev.pending;
        }
        let last = self.last_op(journal);
        if let Some(l) = last.as_ref().filter(|l| l.attempt_end) {
            f.last = Some(l.result.clone());
            f.last_detail = Some(l.detail.clone());
        }
        let product = last.as_ref().map_or("backend", |l| if l.detail.product == "pg" { "pg" } else { "backend" });
        let (state, code, message) = match &outcome {
            OpOutcome::Succeeded => (State::Succeeded, None, format!("{product} güncellemesi tamamlandı")),
            OpOutcome::RolledBack(e) => (State::RolledBack, Some(e.code), format!("geri dönüldü ({}): {}", e.code, e.message)),
            OpOutcome::Failed(e) => (State::Failed, Some(e.code), format!("İNSAN GEREKİYOR ({}): {}", e.code, e.message)),
        };
        // Başarılı PG adımının ardından backend adımı bu turda koşmadıysa (süreç o arada öldü) iş sürer.
        let state = if outcome == OpOutcome::Succeeded && product == "pg" { State::Waiting } else { state };
        self.write_status(self.doc(&f, state, code, &message));
        // Son bilinen iyi (§4.2 madde 2): denemeyi bitiren ikili kanıtlanır; kanıtsız yeni ikili HATA'da geri döner.
        if let (Some(own), true) = (self.own_exe.as_ref(), last.as_ref().is_some_and(|l| l.attempt_end)) {
            let proven = !matches!(outcome, OpOutcome::Failed(_));
            if let selfupdate::AfterAttempt::Reverted(v) =
                selfupdate::after_attempt(&self.env, &self.layout, own, &self.own_version, proven)
            {
                let m = format!(
                    "yeni güncelleyici {} ilk denemesini HATA ile bitirdi — son bilinen iyi {v} geri kondu, işlemi o sürdürür",
                    self.own_version
                );
                self.log.error(&m);
                self.env.events.event(tekserp_hizmet::logfile::Level::Error, &m);
                return TickResult::RestartForSelfUpdate;
            }
        }
        if outcome == OpOutcome::Succeeded && product == "backend" {
            if let Some(t) = self.maybe_self_update(inputs) {
                return t;
            }
        }
        TickResult::Idle(Duration::from_secs(tick_s.min(60)))
    }

    fn maybe_self_update(&self, inputs: &Inputs) -> Option<TickResult> {
        let own = self.own_exe.as_ref()?;
        let (_, current_dir) = self.installed_version()?;
        let lic = policy::load(self.env.fs.as_ref(), &inputs.backend.license_dir, &self.anchor);
        // AK-3: lisans yaptırımı (K1) varken hiçbir şey yenilenmez — güncelleyici de.
        if lic.frozen {
            return None;
        }
        let trust = policy::package_trust(&self.anchor, &lic, PackageMode::Yerlesik, self.now() as f64);
        match selfupdate::stage_from(&self.env, &self.layout, own, &self.own_version, &current_dir, &trust, None) {
            Ok(Some(_)) => {
                self.log.info("güncelleyicinin yeni ikilisi yerleştirildi — yeniden başlatılıyor");
                Some(TickResult::RestartForSelfUpdate)
            }
            Ok(None) => None,
            Err(e) => {
                self.log.warn(&format!("kendini güncelleme yapılamadı (sonraki başarılı işlemde yeniden denenir): {e}"));
                None
            }
        }
    }

    /// Önce güncelleyici (§4.2 madde 1): aday paket HAZIR (doğrulandı, açıldı) ve paketteki ikili çalışandan YENİYSE
    /// backend işleminden ÖNCE kendini yeniler; yeni ikili aynı paketi yeniden doğrular ve işlemi kendisi yürütür.
    /// Açık işlem yokken çağrılır (yarım işlem turun başında sürdürülür); kaynak `surumler/<aday>`. Kendini güncelleme
    /// düşerse backend yolu BLOKLANMAZ (günlüğe yazılır, iş eski ikiliyle sürer). K1'de hiçbir şey yenilenmez (AK-3).
    fn updater_first(&self, f: &Frame, lic: &LicenseView, trust: &PackageTrust, m: &ReleaseManifest, state: State) -> Option<TickResult> {
        let own = self.own_exe.as_ref()?;
        if lic.frozen {
            return None;
        }
        if m.updater.as_ref().is_some_and(|u| version::compare(&u.surum, &self.own_version) != Some(std::cmp::Ordering::Greater)) {
            return None;
        }
        let key = format!("{}:{}", m.surum, m.paket.package_id);
        if self.self_checked.borrow().as_deref() == Some(key.as_str()) {
            return None;
        }
        let dir = self.layout.version_dir(&m.surum);
        let announced = m.updater.as_ref();
        match selfupdate::stage_from(&self.env, &self.layout, own, &self.own_version, &dir, trust, announced) {
            Ok(Some(new)) => {
                let message = format!(
                    "güncelleyici {} → {new}: {} işleminden ÖNCE kendini yeniledi — paketi yeni ikili yeniden doğrulayıp yürütecek",
                    self.own_version, m.surum
                );
                self.log.info(&format!("{}: {message}", codes::GUNCELLEYICI_ONCE));
                *self.notice.borrow_mut() = Some(Notice { code: codes::GUNCELLEYICI_ONCE.into(), message: message.clone() });
                self.write_status(self.doc(f, state, None, &message));
                Some(TickResult::RestartForSelfUpdate)
            }
            Ok(None) => {
                *self.self_checked.borrow_mut() = Some(key);
                None
            }
            Err(e) => {
                self.log.warn(&format!("önce-güncelleyici yapılamadı ({}): {e} — backend yolu eski ikiliyle sürer", m.surum));
                *self.self_checked.borrow_mut() = Some(key);
                None
            }
        }
    }

    /// DAGK-9: kira (satıcı imzalı, kısa ömürlü) kanalın güncel backend sürümünü taşır
    /// (`kanal.guncelSurumler.backend`); güncelleme sunucusunun adayı ondan ESKİYSE sunucu geride
    /// (dondurulmuş/yeniden oynatılan `son.json`) — sessiz kalmasın. Kira bir sürüme sabitlediyse
    /// (`hedefSurum`) aday bilerek eskidir, uyarı yok. Karar değişmez, yalnız görünür kılınır.
    fn server_behind(lic: &LicenseView, m: &ReleaseManifest, pinned: bool) -> Option<String> {
        if pinned {
            return None;
        }
        let current = lic.lease.as_ref()?.get("kanal")?.get("guncelSurumler")?.get("backend")?.as_str()?;
        (version::compare(current, &m.surum) == Some(std::cmp::Ordering::Greater))
            .then(|| format!("kiradaki kanal güncel sürümü {current}, güncelleme sunucusunun adayı {} — sunucu geride", m.surum))
    }

    fn policy_view(lic: &LicenseView, pol: Option<&(UpdatePolicy, PolicySource)>) -> Option<PolicyView> {
        pol.map(|(p, src)| PolicyView {
            mode: p.kip.label().into(),
            allowed: true,
            reason: None,
            source: match src {
                PolicySource::Lease => "KIRA".into(),
                PolicySource::Default => "VARSAYILAN".into(),
            },
            target: p.target.clone(),
            frozen: lic.frozen,
        })
    }

    fn cycle(&self, inputs: &Inputs, journal: &mut Journal, stop: &dyn Fn() -> bool, tick_s: u64) -> TickResult {
        let idle = TickResult::Idle(Duration::from_secs(tick_s));
        let mut f = self.bare_frame(tick_s);
        let Some((installed, current_dir)) = self.installed_version() else {
            self.write_status(self.doc(
                &f,
                State::Waiting,
                Some(codes::KURULU_SURUM_YOK),
                "current bağlantısı yok ya da bir sürüm dizinini göstermiyor",
            ));
            return idle;
        };
        let (intent, intent_problem) = match ipc::read_intent(self.env.fs.as_ref(), &self.layout) {
            IntentRead::Ok(i) => (Some(*i), None),
            IntentRead::Missing => (None, None),
            IntentRead::Invalid(m) => (None, Some(m)),
        };
        let approval: Option<Approval> = intent.as_ref().and_then(|i| i.approval.clone());
        let lic = policy::load(self.env.fs.as_ref(), &inputs.backend.license_dir, &self.anchor);
        let now = self.now();
        let pol = decision::effective_update_policy(lic.lease.as_ref(), now as f64);
        f.policy = Self::policy_view(&lic, pol.as_ref());
        let base_input = decision::Input {
            politika: pol.as_ref().map(|p| &p.0),
            guncelleme_donuk: lic.frozen,
            bakim_bitis_ms: lic.maintenance_end_ms,
            kurulu_surum: &installed,
            pg: None,
            aday: None,
            onay: None,
            now_ms: now as f64,
        };
        let pre = decision::decide(&base_input);
        self.decided.set(true);
        let last = self.last_op(journal);
        if let Some(l) = last.as_ref().filter(|l| l.attempt_end) {
            f.last = Some(l.result.clone());
            f.last_detail = Some(l.detail.clone());
        }
        // Geri alınamamış işlem (HATA): insan gerekir. Kilidi YALNIZ yeni bir panel onayı açar ve o da
        // (a) başarısız denemenin sürümüne ya da (b) ondan YENİ, imzalı bildirimle gelen adaya verilmişse;
        // (b) aday çözülünce sınanır. Başka her onay `ONAY_REDDEDILDI` — HATA sürer.
        let failed_target = last.as_ref().filter(|l| matches!(l.outcome, OpOutcome::Failed(_))).map(|l| l.target.clone());
        if let Some(l) = last.as_ref().filter(|l| matches!(l.outcome, OpOutcome::Failed(_))) {
            let Some(a) = approval.as_ref().filter(|a| Some(&a.id) != l.approval_id.as_ref()) else {
                f.decision = Some(pre);
                let m = format!(
                    "son işlem geri alınamadı ({}) — yeni bir panel onayı ya da müdahale gerekir",
                    l.result.kod.clone().unwrap_or_default()
                );
                self.write_status(self.doc(&f, State::Failed, Some(codes::INSAN_GEREKIYOR), &m));
                return idle;
            };
            if !matches!(version::compare(&a.version, &l.target), Some(std::cmp::Ordering::Equal | std::cmp::Ordering::Greater)) {
                f.decision = Some(pre);
                let m = format!("onay {} reddedildi — {}", a.version, failed_exit_rule(&l.target));
                self.write_status(self.doc(&f, State::Failed, Some(codes::ONAY_REDDEDILDI), &m));
                return idle;
            }
            f.hold_failed = true;
        }
        if !decision::needs_candidate(&pre) {
            let (code, message) = match (&pre.karar, lic.problem.as_ref()) {
                (Kind::Frozen, Some((c, m))) if pre.neden.as_deref() == Some("KIRA_YOK") => (Some(*c), m.clone()),
                _ => (None, format!("{}{}", pre.karar.label(), pre.neden.as_deref().map(|n| format!(" / {n}")).unwrap_or_default())),
            };
            let frozen_by_policy = pre.karar == Kind::Frozen && pre.neden.as_deref() == Some("POLITIKA");
            f.decision = Some(pre);
            let state = self.resting_state(last.as_ref(), &installed, None);
            if let (true, Some(p)) = (frozen_by_policy, pol.as_ref()) {
                let token = intent.as_ref().and_then(|i| i.token_at(now));
                if let Some(t) = self.frozen_self_update(inputs, &lic, &p.0, &base_input, token, &f, state, stop) {
                    return t;
                }
            }
            self.write_status(self.doc(&f, state, code, &message));
            return idle;
        }
        // ── Aday: işaretçi → imzalı bildirim ───────────────────────────────────────────────
        let Some(channel) = lic.channel.clone() else {
            self.write_status(self.doc(&f, State::Waiting, Some(codes::KIRA_GECERSIZ), "kira kanal taşımıyor"));
            return idle;
        };
        let mut trust = policy::package_trust(&self.anchor, &lic, PackageMode::Kabul, now as f64);
        let token = intent.as_ref().and_then(|i| i.token_at(now)).map(str::to_string);
        let token_problem = || -> Fail {
            match (&intent, &intent_problem) {
                (_, Some(m)) => fail(codes::NIYET_BICIMSIZ, format!("niyet okunamadı ({m}) — indirme belirteci yok")),
                (Some(i), _) if i.download.is_some() => {
                    fail(codes::BELIRTEC_SURESI_DOLDU, "indirme belirtecinin süresi doldu — backend yenisini yazacak")
                }
                _ => fail(codes::BELIRTEC_YOK, "niyet indirme belirteci taşımıyor — backend yazacak"),
            }
        };
        let server = match inputs.settings.server_base() {
            Ok(s) => s,
            Err(m) => {
                f.decision = Some(pre);
                self.write_status(self.doc(&f, State::Waiting, Some(codes::AYAR_BICIMSIZ), &m));
                return idle;
            }
        };
        let pointer = Self::pointer_for(&channel, pol.as_ref().and_then(|p| p.0.target.clone()));
        let m = match self.candidate(&server, &pointer, token.as_deref(), &trust, &channel, CANDIDATE_TTL_MS, &token_problem) {
            Ok(m) => m,
            Err((code, msg)) => {
                f.decision = Some(pre);
                self.write_status(self.doc(&f, State::Waiting, Some(code), &msg));
                return idle;
            }
        };
        // ── Karar (PG yalnız gerekirse ölçülür) ───────────────────────────────────────────
        let onay = approval.as_ref().map(Approval::for_decision);
        let mut input = decision::Input { aday: Some(&m.doc), onay: onay.as_ref(), ..base_input.clone() };
        let mut d = decision::decide(&input);
        let mut instance = None;
        let measured;
        if d.karar == Kind::NotEligible && d.neden.as_deref() == Some("PG_OLCULEMEDI") {
            let (pg, inst) = self.installed_pg(inputs);
            measured = pg;
            instance = inst;
            input.pg = measured.as_ref();
            d = decision::decide(&input);
        }
        f.decision = Some(d.clone());
        let used_approval = approval.as_ref().filter(|a| version::compare(&a.version, &m.doc.surum) == Some(std::cmp::Ordering::Equal));
        if let (Some(target), Some(a), None) = (failed_target.as_deref(), approval.as_ref(), used_approval) {
            let msg = format!("onay {} reddedildi — imzalı aday {}; {}", a.version, m.doc.surum, failed_exit_rule(target));
            self.write_status(self.doc(&f, State::Failed, Some(codes::ONAY_REDDEDILDI), &msg));
            return idle;
        }
        f.pending = Some(Pending {
            surum: m.doc.surum.clone(),
            karar: d.karar.label().into(),
            neden: d.neden.clone(),
            aralik: d.aralik.clone(),
            pg_update: d.pg_update,
            zorunlu: m.doc.zorunlu,
            summary: m.doc.notlar.ozet.clone(),
        });
        if !matches!(d.karar, Kind::Install | Kind::AwaitingApproval | Kind::AwaitingWindow) {
            let message =
                format!("{} {}{}", m.doc.surum, d.karar.label(), d.neden.as_deref().map(|n| format!(" / {n}")).unwrap_or_default());
            let state = self.resting_state(last.as_ref(), &installed, None);
            // DAGK-9: yapılacak iş yok görünürken güncelleme sunucusu geride olabilir (eski `son.json`).
            let pinned = pol.as_ref().is_some_and(|p| p.0.target.is_some());
            if let Some(why) = Self::server_behind(&lic, &m.doc, pinned) {
                self.write_status(self.doc(&f, state, Some(codes::SURUM_GERIDE), &format!("{message} — {why}")));
                return idle;
            }
            self.write_status(self.doc(&f, state, None, &message));
            return idle;
        }
        // Geri dönen sürüm kendiliğinden yeniden denenmez: aynı sürüme YENİ bir panel onayı gerekir.
        if let Some(l) = last.as_ref().filter(|l| l.attempt_end && l.outcome != OpOutcome::Succeeded && l.target == m.doc.surum) {
            let fresh = used_approval.is_some_and(|a| Some(&a.id) != l.approval_id.as_ref());
            if !fresh {
                // Karar KUR/pencere dese de bu sürüm ancak YENİ bir onayla denenir: aday onay bekler.
                if let Some(p) = f.pending.as_mut() {
                    p.karar = Kind::AwaitingApproval.label().into();
                    p.neden = None;
                    p.aralik = None;
                }
                let msg =
                    format!("{} geri dönmüştü — aynı sürüm kendiliğinden yeniden denenmez; yeni bir panel onayı gerekir", m.doc.surum);
                let state = self.resting_state(last.as_ref(), &installed, Some(&m.doc.surum));
                self.write_status(self.doc(&f, state, l.detail.error_code.as_deref(), &msg));
                return idle;
            }
        }
        // ── Hazırlık (onay/pencere beklenirken de: uygulama anında iş kısa sürsün) ─────────
        let Some(token) = token else {
            let (code, msg) = token_problem();
            self.write_status(self.doc(&f, State::Waiting, Some(code), &msg));
            return idle;
        };
        if let Err((code, msg)) = self.disk_check(&m.doc) {
            self.write_status(self.doc(&f, State::Waiting, Some(code), &msg));
            return idle;
        }
        if let Err((code, msg)) = self.prepare_backend(&f, &server, &channel, &inputs.backend.license_dir, &mut trust, &m.doc, &token, stop)
        {
            let state = if matches!(code, codes::INDIRME_HATASI | codes::INDIRME_REDDEDILDI) { State::Downloading } else { State::Waiting };
            self.write_status(self.doc(&f, state, Some(code), &msg));
            return TickResult::Idle(Duration::from_secs(tick_s.min(60)));
        }
        let pg_target = if d.pg_update { m.doc.pg.hedef.clone() } else { None };
        if let Some(target) = &pg_target {
            let Some(inst) = instance.as_ref().filter(|i| i.own()) else {
                self.write_status(self.doc(&f, State::Waiting, Some(codes::PG_PAKET), "PG güncellemesi istendi ama kendi örnek kaydı yok"));
                return idle;
            };
            if let Err((code, msg)) = self.prepare_pg(&server, &channel, &trust, &m.doc, target, inst, &token, stop) {
                self.write_status(self.doc(&f, State::Waiting, Some(code), &msg));
                return idle;
            }
        }
        // Şema hizası: paket şemanın gerisindeyse (geri indirme) HAZIR denmez, uygulanmaz — hiçbir şey değişmeden bekler.
        if let Err((code, msg)) = self.schema_check(inputs, &m.doc) {
            self.write_status(self.doc(&f, State::Waiting, Some(code), &msg));
            return idle;
        }
        // Paket HAZIR: karar KUR · ONAY_BEKLIYOR · PENCERE_BEKLIYOR farketmez, önce güncelleyici.
        if let Some(t) = self.updater_first(&f, &lic, &trust, &m.doc, State::Ready) {
            return t;
        }
        if d.karar != Kind::Install {
            let mut doc = self.doc(&f, State::Ready, None, &format!("{} hazır; {}", m.doc.surum, d.karar.label()));
            doc.planned = d.aralik.as_ref().filter(|_| d.karar == Kind::AwaitingWindow).map(|a| a.baslangic.clone());
            self.write_status(doc);
            return idle;
        }
        // ── Uygulama: bildirim bayatsa önce tazelenir ve karar yeniden verilir ─────────────
        let m = match self.candidate(&server, &pointer, Some(&token), &trust, &channel, CANDIDATE_FRESH_FOR_APPLY_MS, &token_problem) {
            Ok(fresh) if fresh.doc == m.doc => fresh,
            Ok(_) => {
                self.write_status(self.doc(
                    &f,
                    State::Waiting,
                    None,
                    "aday uygulama anında değişti — sonraki turda yeniden değerlendirilir",
                ));
                return idle;
            }
            Err((code, msg)) => {
                self.write_status(self.doc(&f, State::Waiting, Some(code), &msg));
                return idle;
            }
        };
        if let Err((code, msg)) = self.disk_check(&m.doc) {
            self.write_status(self.doc(&f, State::Waiting, Some(code), &msg));
            return idle;
        }
        if let Err((code, msg)) = self.reverify_prepared(&trust, &m.doc, pg_target.as_ref()) {
            self.log.warn(&msg);
            self.write_status(self.doc(&f, State::Waiting, Some(code), &msg));
            return idle;
        }
        let approval_id = used_approval.map(|a| a.id.clone());
        if let (Some(target), Some(inst)) = (&pg_target, instance.as_ref()) {
            let outcome = self.run_pg(inputs, journal, inst, target, &m.doc, &current_dir, &installed, approval_id.clone());
            if outcome != OpOutcome::Succeeded {
                // PG adımı düştüyse backend'e dokunulmaz (D4 §5).
                return self.after_op(inputs, journal, outcome, tick_s);
            }
        }
        let outcome = self.run_backend(inputs, journal, &m.doc, &installed, &current_dir, approval_id, used_approval.cloned());
        self.after_op(inputs, journal, outcome, tick_s)
    }

    /// Aday işaretçisi: sabitlenmiş sürüm (`hedefSurum`) kendi dizininden, yoksa kanalın son sürümü.
    fn pointer_for(channel: &str, target: Option<String>) -> Pointer {
        match target {
            Some(t) => Pointer {
                chained: release::release_file_path(channel, &t, release::CHAINED_RELEASE_MANIFEST_FILE),
                legacy: release::release_file_path(channel, &t, release::RELEASE_MANIFEST_FILE),
                family: Some(release::ChainedFamily::Surum),
                kids: Vec::new(),
                kids_from_latest: true,
            },
            None => Pointer::single(release::chained_release_pointer_path(channel), release::release_pointer_path(channel)),
        }
    }

    /// AK-3: `DONDUR` backend sürümünü dondurur, güncelleyiciyi DEĞİL. İmzalı bildirimin `guncelleyici` bloğu çalışandan
    /// YENİ bir ikili ilan ediyorsa ve aday dondurma dışında kurulabilir olurdu (HAK · bakım · kaynak sınırı · PG aynen;
    /// kip ONAYLI sayılır) paket hazırlanır ve ikili ondan yenilenir; backend'e dokunulmaz. Blok yoksa paket indirilmez.
    /// Her aksama günlüğe yazılır, durum DONDURULDU kalır. K1 (`YAPTIRIM`) buraya hiç gelmez.
    #[allow(clippy::too_many_arguments)]
    fn frozen_self_update(
        &self,
        inputs: &Inputs,
        lic: &LicenseView,
        pol: &UpdatePolicy,
        base: &decision::Input,
        token: Option<&str>,
        f: &Frame,
        state: State,
        stop: &dyn Fn() -> bool,
    ) -> Option<TickResult> {
        self.own_exe.as_ref()?;
        if lic.frozen {
            return None;
        }
        let skip = |why: String| -> Option<TickResult> {
            if self.frozen_note.borrow().as_deref() != Some(why.as_str()) {
                self.log.info(&format!("DONDUR: güncelleyici yenilemesi yok — {why}"));
                *self.frozen_note.borrow_mut() = Some(why);
            }
            None
        };
        let channel = lic.channel.clone()?;
        let server = inputs.settings.server_base().ok()?;
        let Some(token) = token else { return skip("indirme belirteci yok".into()) };
        let mut trust = policy::package_trust(&self.anchor, lic, PackageMode::Kabul, base.now_ms);
        let pointer = Self::pointer_for(&channel, pol.target.clone());
        let no_token = || fail(codes::BELIRTEC_YOK, "belirteç yok");
        let m = match self.candidate(&server, &pointer, Some(token), &trust, &channel, CANDIDATE_TTL_MS, &no_token) {
            Ok(m) => m,
            Err((code, msg)) => return skip(format!("aday okunamadı ({code}): {msg}")),
        };
        let newer =
            m.doc.updater.as_ref().is_some_and(|u| version::compare(&u.surum, &self.own_version) == Some(std::cmp::Ordering::Greater));
        if !newer {
            return None;
        }
        let thawed = UpdatePolicy { kip: decision::Mode::Approval, ..pol.clone() };
        let mut input = decision::Input { politika: Some(&thawed), aday: Some(&m.doc), onay: None, ..base.clone() };
        let mut d = decision::decide(&input);
        let measured;
        if d.karar == Kind::NotEligible && d.neden.as_deref() == Some("PG_OLCULEMEDI") {
            measured = self.installed_pg(inputs).0;
            input.pg = measured.as_ref();
            d = decision::decide(&input);
        }
        if !matches!(d.karar, Kind::Install | Kind::AwaitingApproval | Kind::AwaitingWindow) {
            return skip(format!(
                "{} dondurma dışında da kurulamazdı ({}{})",
                m.doc.surum,
                d.karar.label(),
                d.neden.map(|n| format!(" / {n}")).unwrap_or_default()
            ));
        }
        if let Err((code, msg)) = self.disk_check(&m.doc) {
            return skip(format!("{code}: {msg}"));
        }
        if let Err((code, msg)) = self.prepare_backend(f, &server, &channel, &inputs.backend.license_dir, &mut trust, &m.doc, token, stop) {
            return skip(format!("paket hazırlanamadı ({code}): {msg}"));
        }
        self.updater_first(f, lic, &trust, &m.doc, state)
    }

    /// Yapılacak iş yokken gösterilen durum: son deneme bu kurulumun sürümüne BAŞARILI geçtiyse ya da
    /// (aday verildiğinde) aday geri dönmüş sürümse sonucu korunur; aksi hâlde BEKLİYOR.
    fn resting_state(&self, last: Option<&LastOp>, installed: &str, blocked: Option<&str>) -> State {
        match last.filter(|l| l.attempt_end) {
            Some(l) if l.outcome == OpOutcome::Succeeded && l.target == installed => State::Succeeded,
            Some(l) if matches!(l.outcome, OpOutcome::RolledBack(_)) && blocked == Some(l.target.as_str()) => State::RolledBack,
            _ => State::Waiting,
        }
    }

    /// Doğrulanmış aday: önbellekteki (aynı işaretçi, `max_age`dan taze) ya da indirilip doğrulanan.
    #[allow(clippy::too_many_arguments)]
    fn candidate(
        &self,
        server: &str,
        pointer: &Pointer,
        token: Option<&str>,
        trust: &PackageTrust,
        channel: &str,
        max_age: i64,
        token_problem: &dyn Fn() -> Fail,
    ) -> Result<Checked<ReleaseManifest>, Fail> {
        let now = self.now();
        if let Some(c) = self.candidate.borrow().as_ref().filter(|c| c.pointer == pointer.chained && now - c.fetched_ms < max_age) {
            return Ok(c.manifest.clone());
        }
        let Some(token) = token else { return Err(token_problem()) };
        let checked = if let Some(family) = pointer.family {
            let mut kids = pointer.kids.clone();
            if pointer.kids_from_latest {
                kids.extend(self.latest_signer_kid(server, channel, token, trust));
            }
            self.fetch_selected(
                server,
                pointer,
                family,
                &kids,
                token,
                trust,
                "sürüm bildirimi",
                &|name, text| release::chained_release_candidate(name, text, trust, channel),
                &|jws| release::verify_release_manifest(jws, trust, channel),
            )?
        } else {
            let (path, bytes) = self.fetch_pointer(server, pointer, token, trust)?;
            let text = String::from_utf8(bytes).map_err(|_| fail(release::code::SURUM_ISARETCI, "işaretçi UTF-8 değil"))?;
            let jws_text = release::read_release_pointer(&text).map_err(|e| (e.code, format!("{path}: {}", e.message)))?;
            release::verify_release_manifest(&Value::String(jws_text), trust, channel)
                .map_err(|e| (e.code, format!("sürüm bildirimi reddedildi ({}): {}", e.code, e.message)))?
        };
        *self.candidate.borrow_mut() = Some(Candidate { fetched_ms: now, pointer: pointer.chained.clone(), manifest: checked.clone() });
        Ok(checked)
    }

    /// İşaretçi sırası (sözleşme `PAKET-ANAHTARI-KOK-ALTINDA.md` §4): önce zincirli dosya; yalnız HTTP 404'te ve gömülü
    /// `paket-*` anahtarı varken eski dosya — eski dosyanın okunuşu (hata kodu, mesaj) bugünküyle aynıdır.
    fn fetch_pointer<'p>(&self, server: &str, pointer: &'p Pointer, token: &str, trust: &PackageTrust) -> Result<(&'p str, Vec<u8>), Fail> {
        let got =
            download::fetch_small_opt(&self.env, &format!("{server}{}", pointer.chained), Some(token)).map_err(|e| (e.code, e.message))?;
        match got {
            Some(bytes) => Ok((pointer.chained.as_str(), bytes)),
            None if trust.keys.is_empty() => Err(fail(codes::MANIFEST_INDIRILEMEDI, format!("{}: HTTP 404", pointer.chained))),
            None => {
                let bytes = download::fetch_small(&self.env, &format!("{server}{}", pointer.legacy), Some(token))
                    .map_err(|e| (e.code, e.message))?;
                Ok((pointer.legacy.as_str(), bytes))
            }
        }
    }

    /// D8 seçimli okuma: zincirli adaylar (kid'siz + `kids`) getirilir ve `release::select_chained` uygulanır; HİÇBİRİ
    /// yoksa (404) ve gömülü `paket-*` anahtarı varken eski dosya (okunuşu bugünküyle aynı). Adaylardan birinde ağ
    /// hatası turu düşürür — eksik aday kümesiyle seçim yapılmaz (belirsizlikte FAIL-CLOSED).
    #[allow(clippy::too_many_arguments)]
    fn fetch_selected<T: Clone>(
        &self,
        server: &str,
        pointer: &Pointer,
        family: release::ChainedFamily,
        kids: &[String],
        token: &str,
        trust: &PackageTrust,
        label: &str,
        make: &dyn Fn(&str, &str) -> release::ChainedCandidate<T>,
        verify_legacy: &dyn Fn(&Value) -> tekserp_dogrulama::outcome::Outcome<Checked<T>>,
    ) -> Result<Checked<T>, Fail> {
        let (dir, first) = pointer.chained.rsplit_once('/').unwrap_or(("", pointer.chained.as_str()));
        let mut names = vec![first.to_string()];
        for kid in kids {
            if let Some(n) = release::chained_file_name(family, Some(kid)).filter(|n| !names.contains(n)) {
                names.push(n);
            }
        }
        let mut candidates = Vec::new();
        for name in &names {
            let url = format!("{server}{dir}/{name}");
            if let Some(bytes) = download::fetch_small_opt(&self.env, &url, Some(token)).map_err(|e| (e.code, e.message))? {
                candidates.push(match String::from_utf8(bytes) {
                    Ok(text) => make(name, &text),
                    Err(_) => release::ChainedCandidate {
                        name: name.clone(),
                        result: Err(tekserp_dogrulama::outcome::Fail {
                            code: release::code::SURUM_ISARETCI,
                            message: "işaretçi UTF-8 değil".into(),
                        }),
                    },
                });
            }
        }
        match release::select_chained(family, candidates) {
            Some(Ok(c)) => {
                if !c.rejected.is_empty() {
                    let list: Vec<String> = c.rejected.iter().map(|(n, code, _)| format!("{n} ({code})")).collect();
                    self.log.info(&format!("{label}: {dir}/{} seçildi; elenen: {}", c.name, list.join(", ")));
                }
                Ok(c.checked)
            }
            Some(Err(e)) => Err((e.code, format!("{label} reddedildi ({}): {}", e.code, e.message))),
            None if trust.keys.is_empty() => Err(fail(codes::MANIFEST_INDIRILEMEDI, format!("{}: HTTP 404", pointer.chained))),
            None => {
                let path = pointer.legacy.as_str();
                let bytes = download::fetch_small(&self.env, &format!("{server}{path}"), Some(token)).map_err(|e| (e.code, e.message))?;
                let text = String::from_utf8(bytes).map_err(|_| fail(release::code::SURUM_ISARETCI, "işaretçi UTF-8 değil"))?;
                let jws_text = release::read_release_pointer(&text).map_err(|e| (e.code, format!("{path}: {}", e.message)))?;
                verify_legacy(&Value::String(jws_text)).map_err(|e| (e.code, format!("{label} reddedildi ({}): {}", e.code, e.message)))
            }
        }
    }

    /// Kanalın `son-zincir.json`ını (KABUL güveniyle) imzalayan `pkt-*` kid — sabitlenmiş sürüm dizininde yeniden imzalı
    /// adın adayı. En iyi çaba: yokluk ya da her hata `None` (aday kümesi küçülür, kid'siz ad yine okunur).
    fn latest_signer_kid(&self, server: &str, channel: &str, token: &str, trust: &PackageTrust) -> Option<String> {
        let url = format!("{server}{}", release::chained_release_pointer_path(channel));
        let bytes = download::fetch_small_opt(&self.env, &url, Some(token)).ok()??;
        let text = String::from_utf8(bytes).ok()?;
        let jws = release::read_release_pointer(&text).ok()?;
        let m = release::verify_release_manifest(&Value::String(jws), trust, channel).ok()?;
        m.chain.is_some().then_some(m.signer_kid)
    }

    /// Kurulu PG (sözleşme §1.6): kip `pgsql\ornek.json`dan (yoksa HARİCİ: bugünkü kurulumlar), sürüm
    /// her koşumda `SHOW server_version`dan, kendi kipte derleme örnek kaydından. Ölçülemezse `None`.
    fn installed_pg(&self, inputs: &Inputs) -> (Option<InstalledPg>, Option<pgminor::Instance>) {
        let inst = pgminor::read_instance(&self.env, &self.layout);
        let (kip, bin, build) = match &inst {
            Some(i) if i.own() => (PgMode::Own, i.bin_dir.join("bin"), i.derleme.parse::<u32>().ok().filter(|b| (1..=999).contains(b))),
            Some(i) if i.kip == "harici" => (PgMode::External, inputs.backend.pg_bin_dir.clone(), None),
            Some(_) => return (None, inst),
            None => (PgMode::External, inputs.backend.pg_bin_dir.clone(), None),
        };
        let surum = tools::server_version(&self.env, &inputs.backend, &bin).ok().and_then(|v| release::pg_version_of(&v));
        (surum.map(|surum| InstalledPg { kip, surum, derleme: build }), inst)
    }

    fn ready_marker(&self, v: &str) -> PathBuf {
        self.layout.ready_markers().join(format!("{v}.json"))
    }

    // ── Kesin paket hatalarında yeniden indirme aralığı ───────────────────────────────────────

    fn backoff_file(&self) -> PathBuf {
        self.layout.work().join("ertele.json")
    }

    fn backoff_map(&self) -> Map<String, Value> {
        self.env.fs.read(&self.backoff_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    fn backoff_until(&self, key: &str) -> Option<i64> {
        self.backoff_map().get(key).and_then(|v| v.get("sonraki")).and_then(Value::as_i64).filter(|t| *t > self.now())
    }

    fn backoff_mark(&self, key: &str, failed: bool) {
        let mut m = self.backoff_map();
        if failed {
            let n = m.get(key).and_then(|v| v.get("sayi")).and_then(Value::as_u64).unwrap_or(0) + 1;
            let wait = BACKOFF_BASE_MS.saturating_mul(4_i64.saturating_pow(u32::try_from(n - 1).unwrap_or(8).min(8))).min(BACKOFF_MAX_MS);
            m.insert(key.to_string(), json!({ "sayi": n, "sonraki": self.now() + wait }));
        } else if m.remove(key).is_none() {
            return;
        }
        let _ = self.env.fs.write_atomic(&self.backoff_file(), Value::Object(m).to_string().as_bytes());
    }

    fn definitive(code: &str) -> bool {
        matches!(code, codes::PAKET_OZETI | codes::PAKET_YOL | codes::BUTUNLUK_GECERSIZ | codes::PG_PAKET)
            || code == release::code::PAKET_BAGI
            || code == release::code::PG_BAGI
    }

    /// Paket HAZIR mı; değilse indir → özet → aç → bütünlük → bağ → yerleştir (sözleşme §1.5).
    #[allow(clippy::too_many_arguments)]
    fn prepare_backend(
        &self,
        f: &Frame,
        server: &str,
        channel: &str,
        license_dir: &Path,
        trust: &mut PackageTrust,
        m: &ReleaseManifest,
        token: &str,
        stop: &dyn Fn() -> bool,
    ) -> Result<(), Fail> {
        let key = format!("paket:{}:{}", m.surum, m.paket.sha256);
        let r = self.prepare_backend_inner(f, server, channel, license_dir, trust, m, token, stop, &key);
        match &r {
            Ok(()) => self.backoff_mark(&key, false),
            Err((code, _)) if Self::definitive(code) => self.backoff_mark(&key, true),
            Err(_) => {}
        }
        r
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_backend_inner(
        &self,
        f: &Frame,
        server: &str,
        channel: &str,
        license_dir: &Path,
        trust: &mut PackageTrust,
        m: &ReleaseManifest,
        token: &str,
        stop: &dyn Fn() -> bool,
        key: &str,
    ) -> Result<(), Fail> {
        let fs = self.env.fs.as_ref();
        let dir = self.layout.version_dir(&m.surum);
        let marker = self.ready_marker(&m.surum);
        let marked = fs
            .read(&marker)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .is_some_and(|v| v.get("paketId").and_then(Value::as_str) == Some(m.paket.package_id.as_str()));
        if marked && fs.is_dir(&dir) {
            return Ok(());
        }
        let place_marker = || {
            fs.write_atomic(
                &marker,
                json!({ "surum": m.surum, "paketId": m.paket.package_id, "zaman": timefmt::iso_millis(self.now()) }).to_string().as_bytes(),
            )
            .map_err(|x| fail(codes::INDIRME_HATASI, x.to_string()))
        };
        if fs.is_dir(&dir) {
            // İşaretsiz sürüm dizini (yarım yerleştirme ya da elle konmuş): doğrulanır ve bağlanırsa kabul, değilse silinir.
            let verified = package::verify_dir(&dir, fs, trust, Some(&m.signer_kid))
                .map_err(|e| (e.code, e.message))
                .and_then(|id| release::check_package_binding(m, &id).map_err(|e| (e.code, e.message)));
            match verified {
                Ok(()) => return place_marker(),
                Err(e) if f.installed.as_deref() == Some(m.surum.as_str()) => return Err(e),
                Err((_, why)) => {
                    self.log.warn(&format!("{} doğrulanamadı ({why}), yeniden açılacak", dir.display()));
                    fs.remove_dir_all(&dir).map_err(|x| staging_fail(codes::INDIRME_HATASI, &dir, &x))?;
                }
            }
        }
        if let Some(until) = self.backoff_until(key) {
            return Err(fail(
                codes::INDIRME_ERTELENDI,
                format!("{} paketi önceki denemede doğrulanamadı — yeniden indirme {} sonra", m.surum, timefmt::iso_millis(until)),
            ));
        }
        let zip = self.layout.downloads().join(format!("{}.zip", m.surum));
        let spec = Spec {
            url: format!("{server}{}", release::release_file_path(channel, &m.surum, &m.paket.ad)),
            token: Some(token.to_string()),
            part: self.layout.downloads().join(format!("{}.zip.part", m.surum)),
            dest: zip.clone(),
            size: m.paket.boyut,
            sha256_hex: m.paket.sha256.clone(),
        };
        let mut progress = |done: u64, total: u64| self.download_progress(f, done, total);
        download::download(&self.env, &spec, &mut progress, stop).map_err(|e| (e.code, e.message))?;
        let staging = self.layout.staging_dir(&m.surum);
        fs.remove_dir_all(&staging).map_err(|x| staging_fail(codes::INDIRME_HATASI, &staging, &x))?;
        fs.create_dir_all(&self.layout.versions()).map_err(|x| staging_fail(codes::INDIRME_HATASI, &self.layout.versions(), &x))?;
        if let Err(e) = fs.extract_zip(&zip, &staging, &ExtractLimits::default()) {
            let _ = fs.remove_dir_all(&staging);
            let _ = fs.remove_file(&zip);
            let code = if e.starts_with("PAKET_YOL") { codes::PAKET_YOL } else { codes::BUTUNLUK_GECERSIZ };
            return Err(fail(code, e));
        }
        // Paketin taşıdığı PAKET iptal listesi daha yeniyse (kökle doğrulanmış) güvene ve `lisans\`e geçer.
        if policy::adopt_package_revocation(fs, license_dir, &self.anchor, &staging, trust) {
            self.log.info("paketteki daha yeni PAKET iptal listesi benimsendi");
        }
        let verified = package::verify_dir(&staging, fs, trust, Some(&m.signer_kid))
            .map_err(|e| (e.code, e.message))
            .and_then(|id| release::check_package_binding(m, &id).map_err(|e| (e.code, e.message)));
        if let Err(e) = verified {
            let _ = fs.remove_dir_all(&staging);
            let _ = fs.remove_file(&zip);
            return Err(e);
        }
        fs.rename(&staging, &dir).map_err(|x| staging_fail(codes::INDIRME_HATASI, &staging, &x))?;
        place_marker()?;
        let _ = fs.remove_file(&zip);
        self.log.info(&format!("{} hazır: indirildi, sha256 + PAKET imzası + bütünlük listesi + bildirim bağı doğrulandı", m.surum));
        Ok(())
    }

    fn download_progress(&self, f: &Frame, done: u64, total: u64) {
        let now = self.now();
        if now - *self.last_progress_ms.borrow() < 2000 && done < total {
            return;
        }
        *self.last_progress_ms.borrow_mut() = now;
        let mut d = self.doc(f, State::Downloading, None, "paket indiriliyor");
        d.progress = Some(IpcProgress { done, total });
        self.write_status(d);
    }

    /// Kendi örnekte hedef PG kuruludan yeniyse paketi hazırlar (sözleşme §1.6, D4 U0–U1).
    #[allow(clippy::too_many_arguments)]
    fn prepare_pg(
        &self,
        server: &str,
        channel: &str,
        trust: &PackageTrust,
        m: &ReleaseManifest,
        target: &PgTarget,
        inst: &pgminor::Instance,
        token: &str,
        stop: &dyn Fn() -> bool,
    ) -> Result<(), Fail> {
        let key = format!("pg:{}:{}", target.tag(), target.paket.sha256);
        let r = self.prepare_pg_inner(server, channel, trust, m, target, inst, token, stop, &key);
        match &r {
            Ok(()) => self.backoff_mark(&key, false),
            Err((code, _)) if Self::definitive(code) => self.backoff_mark(&key, true),
            Err(_) => {}
        }
        r
    }

    #[allow(clippy::too_many_arguments)]
    fn prepare_pg_inner(
        &self,
        server: &str,
        channel: &str,
        trust: &PackageTrust,
        m: &ReleaseManifest,
        target: &PgTarget,
        inst: &pgminor::Instance,
        token: &str,
        stop: &dyn Fn() -> bool,
        key: &str,
    ) -> Result<(), Fail> {
        let fs = self.env.fs.as_ref();
        let data_major =
            fs.read_untrusted(&inst.data_dir.join("PG_VERSION"), 64).ok().map(|b| String::from_utf8_lossy(&b).trim().to_string());
        if data_major.as_deref() != Some(m.pg.cizgi.to_string().as_str()) {
            return Err(fail(
                codes::PG_BUYUK_SURUM,
                format!(
                    "veri dizini ana sürümü {data_major:?}, bildirim çizgisi {} — büyük sürüm geçişi otomatik değil (runbook)",
                    m.pg.cizgi
                ),
            ));
        }
        let tag = target.tag();
        let dir = self.layout.pg_version_dir(&tag);
        let marker = self.layout.ready_markers().join(format!("pg-{tag}.json"));
        if fs.exists(&marker) && fs.is_dir(&dir) {
            return Ok(());
        }
        if let Some(until) = self.backoff_until(key) {
            return Err(fail(
                codes::INDIRME_ERTELENDI,
                format!("PG {tag} paketi önceki denemede doğrulanamadı — yeniden {} sonra", timefmt::iso_millis(until)),
            ));
        }
        // Künye: ayrı PAKET imzalı belge, bildirimin hedefiyle BAĞLANIR (ana sürüm dahil).
        // Bilinen imzacı: doğrulanmış bildirimi imzalayan `pkt-*` (yeniden imzada künye de onunla yanına yazılır).
        let kids: Vec<String> =
            Some(m.signer_kid.clone()).filter(|k| tekserp_dogrulama::paket_zinciri::is_chain_package_kid(k)).into_iter().collect();
        let pointer = Pointer {
            chained: release::pg_release_file_path(channel, &target.surum, target.derleme, release::CHAINED_PG_POINTER_FILE),
            legacy: release::pg_release_file_path(channel, &target.surum, target.derleme, release::PG_POINTER_FILE),
            family: Some(release::ChainedFamily::Pg),
            kids: kids.clone(),
            kids_from_latest: false,
        };
        let kunye = self.fetch_selected(
            server,
            &pointer,
            release::ChainedFamily::Pg,
            &kids,
            token,
            trust,
            "PG künyesi",
            &|name, text| release::chained_pg_candidate(name, text, trust),
            &|jws| release::verify_pg_package_manifest(jws, trust),
        )?;
        release::check_pg_binding(&m.pg, &kunye.doc).map_err(|e| (e.code, e.message))?;
        let zip = self.layout.downloads().join(format!("pg-{tag}.zip"));
        let spec = Spec {
            url: format!("{server}{}", release::pg_release_file_path(channel, &target.surum, target.derleme, &target.paket.ad)),
            token: Some(token.to_string()),
            part: self.layout.downloads().join(format!("pg-{tag}.zip.part")),
            dest: zip.clone(),
            size: target.paket.boyut,
            sha256_hex: target.paket.sha256.clone(),
        };
        let mut noop = |_: u64, _: u64| {};
        download::download(&self.env, &spec, &mut noop, stop).map_err(|e| (e.code, e.message))?;
        let staging = self.layout.pg_staging_dir(&tag);
        fs.remove_dir_all(&staging).map_err(|x| staging_fail(codes::PG_PAKET, &staging, &x))?;
        if fs.is_dir(&dir) {
            fs.remove_dir_all(&dir).map_err(|x| staging_fail(codes::PG_PAKET, &dir, &x))?;
        }
        let checked = fs
            .extract_zip(&zip, &staging, &ExtractLimits::default())
            .map(|_| ())
            .and_then(|()| pgminor::verify_content(&self.env, &staging, &target.content_sha256).map(|_| ()))
            .and_then(|()| {
                let icu = pgminor::icu_version(&self.env, &staging);
                if icu.as_deref() == Some(target.icu.as_str()) {
                    Ok(())
                } else {
                    Err(format!("paketin ICU'su {icu:?}, künye {}", target.icu))
                }
            })
            .and_then(|()| {
                let c = crate::env::Cmd::new(&staging.join("bin").join(crate::platform::executable("postgres")))
                    .arg("--version")
                    .timeout(Duration::from_secs(30));
                let out = self.env.procs.run(&c).map_err(|e| e.0)?;
                let text = String::from_utf8_lossy(&out.stdout).to_string();
                if out.ok() && text.trim().ends_with(&format!("(PostgreSQL) {}", target.surum)) {
                    Ok(())
                } else {
                    Err(format!("postgres --version beklenen {} değil: {}", target.surum, text.trim()))
                }
            });
        if let Err(e) = checked {
            let _ = fs.remove_dir_all(&staging);
            let _ = fs.remove_file(&zip);
            return Err(fail(codes::PG_PAKET, e));
        }
        fs.rename(&staging, &dir).map_err(|x| staging_fail(codes::PG_PAKET, &staging, &x))?;
        fs.write_atomic(&marker, json!({ "surum": tag }).to_string().as_bytes()).map_err(|x| fail(codes::PG_PAKET, x.to_string()))?;
        let _ = fs.remove_file(&zip);
        Ok(())
    }

    /// DAGK-3: hazır işareti saatler/günler önce konmuş olabilir — UYGULAMADAN HEMEN ÖNCE sürüm dizini
    /// (imza + bütünlük listesi + her dosya + bildirim bağı) ve PG güncellemesi varsa PG dizini (içerik
    /// manifestosu) yeniden doğrulanır; tutmazsa hazır işareti düşer, işlem başlamaz, sonraki tur yeniden
    /// hazırlar. Doğrulama ile kullanım arasındaki pencere izin ölçümüyle (`trusted_paths_ok`) kapanır.
    fn reverify_prepared(&self, trust: &PackageTrust, m: &ReleaseManifest, pg: Option<&PgTarget>) -> Result<(), Fail> {
        let fs = self.env.fs.as_ref();
        let backend = package::verify_dir(&self.layout.version_dir(&m.surum), fs, trust, Some(&m.signer_kid))
            .map_err(|e| (e.code, e.message))
            .and_then(|id| release::check_package_binding(m, &id).map_err(|e| (e.code, e.message)));
        if let Err((code, why)) = backend {
            let _ = fs.remove_file(&self.ready_marker(&m.surum));
            return Err((code, format!("{} uygulama anında yeniden doğrulanamadı — yeniden hazırlanacak: {why}", m.surum)));
        }
        if let Some(t) = pg {
            let tag = t.tag();
            if let Err(why) = pgminor::verify_content(&self.env, &self.layout.pg_version_dir(&tag), &t.content_sha256) {
                let _ = fs.remove_file(&self.layout.ready_markers().join(format!("pg-{tag}.json")));
                return Err((codes::PG_PAKET, format!("PG {tag} uygulama anında yeniden doğrulanamadı — yeniden hazırlanacak: {why}")));
            }
        }
        Ok(())
    }

    /// Şema hizası (`sema::verdict`, setup ve geçişle TEK kural), hazırlıktan sonra, hizmet durdurulmadan; ÜÇ sonuç:
    /// uyumlu → sürer · ileride → `SEMA_ILERIDE`, BEKLİYOR (geri indirme yok) · ölçülemedi → `SEMA_OLCULEMEDI` BİLGİ:
    /// güncelleme durmaz (göç adımı DB ister, düşerse telafiyle döner) ama kod günlüğe ve `durum.bilgi`ye yazılır.
    fn schema_check(&self, inputs: &Inputs, m: &ReleaseManifest) -> Result<(), Fail> {
        let package = sema::package_migrations(self.env.fs.as_ref(), &self.layout.version_dir(&m.surum)).map_err(|e| e.to_string());
        let db = tools::finished_migrations(&self.env, &inputs.backend);
        match sema::verdict(db, package) {
            sema::Verdict::Aligned => Ok(()),
            sema::Verdict::Unmeasured(why) => {
                let message = format!("{} için şema hizası ölçülemedi ({why}) — güncelleme bu yüzden durdurulmadı", m.surum);
                self.log.info(&format!("{}: {message}", codes::SEMA_OLCULEMEDI));
                *self.notice.borrow_mut() = Some(Notice { code: codes::SEMA_OLCULEMEDI.into(), message });
                Ok(())
            }
            sema::Verdict::Ahead(extra) => Err(fail(
                codes::SEMA_ILERIDE,
                format!(
                    "{} kurulmaz: veritabanında paketin taşımadığı {} bitmiş göç var (ilk: {}) — paket şemanın gerisinde, geri indirme yapılmaz; bu göçleri taşıyan daha yeni bir sürüm gerekir",
                    m.surum,
                    extra.len(),
                    extra[0]
                ),
            )),
        }
    }

    fn disk_check(&self, m: &ReleaseManifest) -> Result<(), Fail> {
        let need = m.paket.boyut.saturating_mul(3).saturating_add(2 * 1024 * 1024 * 1024);
        match self.env.fs.free_space(&self.layout.root) {
            Ok(free) if free < need => {
                Err(fail(codes::DISK_DOLU, format!("boş alan {} MB, en az {} MB gerekir", free / 1_048_576, need / 1_048_576)))
            }
            _ => Ok(()),
        }?;
        // Linux: imajlar Docker kökünde (çoğu zaman ayrı dosya sistemi) — açılmış imaj ≈ paket × 3 + 1 GB.
        let Some(depo) = self.env.arka.araclar.imaj_deposu(&self.env) else { return Ok(()) };
        let need = m.paket.boyut.saturating_mul(3).saturating_add(1024 * 1024 * 1024);
        match self.env.fs.free_space(&depo) {
            Ok(free) if free < need => Err(fail(
                codes::DISK_DOLU,
                format!("{} boş alanı {} MB, en az {} MB gerekir", depo.display(), free / 1_048_576, need / 1_048_576),
            )),
            _ => Ok(()),
        }
    }

    fn tools_dir(&self, old: &Path, new: &Path) -> PathBuf {
        if tools::usable_for_backup(&self.env, old) {
            old.to_path_buf()
        } else {
            new.to_path_buf()
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn run_pg(
        &self,
        inputs: &Inputs,
        journal: &mut Journal,
        inst: &pgminor::Instance,
        target: &PgTarget,
        m: &ReleaseManifest,
        current_dir: &Path,
        backend_version: &str,
        approval_id: Option<String>,
    ) -> OpOutcome {
        let tag = target.tag();
        let new_dir = self.layout.pg_version_dir(&tag);
        let old_image = match self.env.arka.pg.image_path(&self.env, &inst.hizmet) {
            Ok(p) => p,
            Err(e) => return OpOutcome::RolledBack(operation::step_err(codes::PG_YOL_HATASI, e.0)),
        };
        let Some(new_image) = self.env.arka.pg.replace_dir(&old_image, &inst.bin_dir, &new_dir) else {
            return OpOutcome::RolledBack(operation::step_err(
                codes::PG_YOL_HATASI,
                "PG hizmetinin ImagePath'i ornek.json'daki ikili dizinini göstermiyor",
            ));
        };
        let plan = PgPlan {
            kind: "PG".into(),
            op_id: crate::ids::uuid_v4(),
            approval_id,
            backend_target: m.surum.clone(),
            source_tag: inst.tag(),
            target_tag: tag,
            source_server_version: inst.surum.clone(),
            target_server_version: target.surum.clone(),
            service: inst.hizmet.clone(),
            old_dir: inst.bin_dir.clone(),
            new_dir: new_dir.clone(),
            old_image_path: old_image,
            new_image_path: new_image,
            data_dir: inst.data_dir.clone(),
            icu_changed: pgminor::icu_version(&self.env, &inst.bin_dir) != pgminor::icu_version(&self.env, &new_dir),
            backend_version: backend_version.to_string(),
            tools_dir: current_dir.to_path_buf(),
            started_ms: self.now(),
        };
        let report = self.report_fn(inputs.settings.tick_s.clamp(10, 3600));
        let ctx = self.ctx(inputs, &report);
        let value = serde_json::to_value(&plan).unwrap_or(Value::Null);
        operation::start(&ctx, journal, &PgOp { plan }, value)
    }

    #[allow(clippy::too_many_arguments)]
    fn run_backend(
        &self,
        inputs: &Inputs,
        journal: &mut Journal,
        m: &ReleaseManifest,
        installed: &str,
        current_dir: &Path,
        approval_id: Option<String>,
        approval: Option<Approval>,
    ) -> OpOutcome {
        let new_dir = self.layout.version_dir(&m.surum);
        // Ön koşul ölçümleri (backend henüz ÇALIŞIYORKEN): göç sayısı ve lisans görüntüsü.
        let migrations_before = match tools::migration_count(&self.env, &inputs.backend) {
            Ok(c) => Some(c),
            Err(e) => {
                self.log.warn(&format!("göç sayısı ölçülemedi ({e}) — göç başlarsa geri dönüşte DB yedekten geri yüklenir"));
                None
            }
        };
        let license_before = health::probe(&self.env, inputs.backend.port).and_then(|h| h.license);
        let plan = BackendPlan {
            kind: "BACKEND".into(),
            op_id: crate::ids::uuid_v4(),
            approval_id,
            source_version: installed.to_string(),
            version: m.surum.clone(),
            previous_target: current_dir.to_path_buf(),
            new_target: new_dir.clone(),
            migrations_before,
            license_before,
            package_hex: Some(m.paket.sha256.clone()),
            commit: Some(m.commit.clone()),
            started_ms: self.now(),
            approval,
            tools_dir: self.tools_dir(current_dir, &new_dir),
        };
        let report = self.report_fn(inputs.settings.tick_s.clamp(10, 3600));
        let ctx = self.ctx(inputs, &report);
        let value = serde_json::to_value(&plan).unwrap_or(Value::Null);
        operation::start(&ctx, journal, &BackendOp { plan }, value)
    }
}
