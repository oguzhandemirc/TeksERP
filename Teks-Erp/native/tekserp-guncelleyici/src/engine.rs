//! Motor — hizmetin her turu: yarım işlem varsa ÖNCE onu sonuçlandır; yoksa niyet → kira politikası →
//! manifest (imza) → paket (indir · sha256 · aç · bütünlük) → HAZIR → pencere/onay → uygula (§5–§8).
//! Her turun sonunda `durum.json` (yalnız değiştiyse) yazılır. Hiçbir karar niyetten YETKİ almaz:
//! niyet yalnız "ne zaman bakılacağı" ve belirteçtir; kurulabilirlik imzalı kira + manifestten gelir.
use crate::codes;
use crate::download::{self, Spec};
use crate::env::Env;
use crate::health;
use crate::ipc::{self, Intent, IntentRead, PolicyView, Progress as IpcProgress, State, StatusDoc};
use crate::journal::Journal;
use crate::layout::Layout;
use crate::manifest::{self, Manifest};
use crate::operation::{self, BackendOp, BackendPlan, Ctx, OpOutcome, Progress};
use crate::package::{self, ExtractLimits};
use crate::pgminor::{self, PgOp, PgPlan};
use crate::policy::{self, Decision, Mode, Policy, VersionVerdict};
use crate::selfupdate;
use crate::settings::{self, BackendEnv, UpdaterSettings};
use crate::tools::{self, Runtime};
use crate::trust::TrustAnchor;
use crate::version;
use serde_json::{json, Value};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tekserp_hizmet::logfile::RotatingLog;
use tekserp_hizmet::timefmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TickResult {
    /// Bir sonraki tura kadar bekle (niyet değişirse erken uyan).
    Idle(Duration),
    /// Yeni ikiliyle yeniden başlatılmak için çık (§10).
    RestartForSelfUpdate,
}

pub struct Engine {
    pub env: Env,
    pub layout: Layout,
    pub anchor: TrustAnchor,
    pub log: Arc<RotatingLog>,
    /// Çalışan ikilinin yolu (kendini güncelleme); test `None` verir.
    pub own_exe: Option<PathBuf>,
    last_status: RefCell<Option<StatusDoc>>,
    last_progress_ms: RefCell<i64>,
}

struct Inputs {
    settings: UpdaterSettings,
    backend: BackendEnv,
}

/// Biten (ya da sürdürülen) işlemin durum yazımı için özeti.
struct OpReport {
    outcome: OpOutcome,
    product: &'static str,
    intent_id: Option<String>,
    op_id: String,
    source: String,
    target: String,
}

fn b64u_to_hex(d: &str) -> Option<String> {
    download::hex_of_b64u(d)
}

impl Engine {
    pub fn new(env: Env, layout: Layout, anchor: TrustAnchor, log: Arc<RotatingLog>, own_exe: Option<PathBuf>) -> Engine {
        Engine { env, layout, anchor, log, own_exe, last_status: RefCell::new(None), last_progress_ms: RefCell::new(0) }
    }

    fn now(&self) -> i64 {
        self.env.clock.now_ms()
    }

    fn status(&self, mut doc: StatusDoc) {
        doc.at = timefmt::iso_millis(self.now());
        let changed = self.last_status.borrow().as_ref().is_none_or(|p| !p.same_as(&doc) || p.progress != doc.progress);
        if changed {
            if let Err(e) = ipc::write_status(self.env.fs.as_ref(), &self.layout, &doc) {
                self.log.warn(&format!("durum.json yazılamadı: {e}"));
            }
            *self.last_status.borrow_mut() = Some(doc);
        }
    }

    fn base(&self, state: State, installed: Option<&str>) -> StatusDoc {
        let mut d = StatusDoc::new(state, String::new());
        d.installed_version = installed.map(str::to_string);
        d
    }

    fn waiting(&self, installed: Option<&str>, code: Option<&str>, message: &str) -> StatusDoc {
        let mut d = self.base(State::Waiting, installed);
        d.error_code = code.map(str::to_string);
        d.message = Some(message.to_string());
        d
    }

    /// Kurulu sürüm: `current` bağlantısının hedef dizininin adı.
    pub fn installed_version(&self) -> Option<(String, PathBuf)> {
        let target = self.env.fs.link_target(&self.layout.current()).ok().flatten()?;
        let name = target.file_name()?.to_string_lossy().into_owned();
        version::parse(&name).map(|_| (name, target))
    }

    fn inputs(&self) -> Result<Inputs, (String, &'static str)> {
        let settings = settings::read_settings(self.env.fs.as_ref(), &self.layout).map_err(|e| (e, codes::AYAR_BICIMSIZ))?;
        let backend = settings::read_backend_env(self.env.fs.as_ref(), &self.layout).map_err(|e| (e, codes::AYAR_BICIMSIZ))?;
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
        #[cfg(windows)]
        crate::windows::harden_private_dir(&self.layout.work()).map_err(|e| format!("özel alan kurulamadı: {e}"))?;
        #[cfg(not(windows))]
        fs.create_dir_all(&self.layout.work()).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Bir tur. `stop()` doğru olursa uzun işler (indirme) güvenli noktada bırakılır.
    pub fn tick(&self, stop: &dyn Fn() -> bool) -> TickResult {
        let idle = |s: u64| TickResult::Idle(Duration::from_secs(s));
        if let Err(m) = self.private_area_ok() {
            self.log.error(&m);
            self.env.events.event(tekserp_hizmet::logfile::Level::Error, &m);
            self.status(self.waiting(None, Some(codes::IC_HATA), &m));
            return idle(300);
        }
        let inputs = match self.inputs() {
            Ok(i) => i,
            Err((m, code)) => {
                self.log.warn(&format!("ayar okunamadı: {m}"));
                self.status(self.waiting(self.installed_version().as_ref().map(|v| v.0.as_str()), Some(code), &m));
                return idle(300);
            }
        };
        let tick_s = inputs.settings.tick_s.clamp(10, 3600);
        let mut journal = match Journal::open(self.env.fs.as_ref(), &self.layout.journal_file()) {
            Ok(j) => j,
            Err(e) => {
                self.log.error(&format!("işlem günlüğü açılamadı: {e}"));
                self.status(self.waiting(None, Some(codes::IC_HATA), &format!("işlem günlüğü açılamadı: {e}")));
                return idle(tick_s);
            }
        };
        operation::sweep_plain_secrets(&self.env, &self.layout);
        if let Some(v) = journal.unfinished() {
            self.log.warn(&format!("yarım işlem bulundu ({}) — sürdürülüyor", v.op));
            let outcome = self.resume(&inputs, &mut journal, v.plan().cloned().unwrap_or(Value::Null));
            return self.after_op(&inputs, outcome, tick_s);
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

    fn report_fn(&self) -> impl Fn(&Progress) + '_ {
        move |p: &Progress| {
            let mut d = self.base(State::Applying, None);
            d.product = p.product.to_string();
            d.source_version = Some(p.source.to_string());
            d.version = Some(p.target.to_string());
            d.installed_version = self.installed_version().map(|v| v.0);
            d.step = Some(p.step.to_string());
            d.op_id = Some(p.op_id.to_string());
            d.intent_id = p.intent_id.map(str::to_string);
            d.message = Some(if p.rolling_back { format!("geri alınıyor: {}", p.step) } else { format!("uygulanıyor: {}", p.step) });
            self.status(d);
        }
    }

    fn resume(&self, inputs: &Inputs, journal: &mut Journal, plan: Value) -> OpReport {
        let report = self.report_fn();
        let ctx = self.ctx(inputs, &report);
        let broken = |product: &'static str, e: String| OpReport {
            outcome: OpOutcome::Failed(operation::step_err(codes::IC_HATA, format!("yarım işlem planı okunamadı: {e}"))),
            product,
            intent_id: None,
            op_id: String::new(),
            source: String::new(),
            target: String::new(),
        };
        match plan.get("tur").and_then(Value::as_str) {
            Some("PG") => match serde_json::from_value::<PgPlan>(plan) {
                Ok(p) => {
                    let op = PgOp { plan: p };
                    let outcome = operation::drive(&ctx, journal, &op);
                    let p = op.plan;
                    OpReport { outcome, product: "pg", intent_id: p.intent_id, op_id: p.op_id, source: p.source_tag, target: p.target_tag }
                }
                Err(e) => broken("pg", e.to_string()),
            },
            _ => match serde_json::from_value::<BackendPlan>(plan) {
                Ok(p) => {
                    let op = BackendOp { plan: p };
                    let outcome = operation::drive(&ctx, journal, &op);
                    let p = op.plan;
                    OpReport {
                        outcome,
                        product: "backend",
                        intent_id: p.intent_id,
                        op_id: p.op_id,
                        source: p.source_version,
                        target: p.version,
                    }
                }
                Err(e) => broken("backend", e.to_string()),
            },
        }
    }

    fn outcome_status(&self, r: &OpReport) -> StatusDoc {
        let installed = self.installed_version().map(|v| v.0);
        let (state, code, message) = match &r.outcome {
            OpOutcome::Succeeded => (State::Succeeded, None, format!("{} {} → {} kuruldu", r.product, r.source, r.target)),
            OpOutcome::RolledBack(e) => (State::RolledBack, Some(e.code.to_string()), format!("geri dönüldü ({}): {}", e.code, e.message)),
            OpOutcome::Failed(e) => (State::Failed, Some(e.code.to_string()), format!("İNSAN GEREKİYOR ({}): {}", e.code, e.message)),
        };
        let mut d = self.base(state, installed.as_deref());
        d.product = r.product.to_string();
        d.source_version = Some(r.source.clone());
        d.version = Some(r.target.clone());
        d.error_code = code;
        d.message = Some(message);
        d.op_id = Some(r.op_id.clone());
        d.intent_id = r.intent_id.clone();
        d
    }

    fn after_op(&self, inputs: &Inputs, r: OpReport, tick_s: u64) -> TickResult {
        self.status(self.outcome_status(&r));
        if r.outcome == OpOutcome::Succeeded && r.product == "backend" {
            if let Some(t) = self.maybe_self_update(inputs) {
                return t;
            }
        }
        TickResult::Idle(Duration::from_secs(tick_s.min(60)))
    }

    fn maybe_self_update(&self, _inputs: &Inputs) -> Option<TickResult> {
        let own = self.own_exe.as_ref()?;
        let (_, current_dir) = self.installed_version()?;
        match selfupdate::stage(&self.env, &self.layout, own, &current_dir) {
            Ok(true) => {
                self.log.info("güncelleyicinin yeni ikilisi yerleştirildi — yeniden başlatılıyor");
                Some(TickResult::RestartForSelfUpdate)
            }
            Ok(false) => None,
            Err(e) => {
                self.log.warn(&format!("kendini güncelleme yapılamadı (sonraki başarılı işlemde yeniden denenir): {e}"));
                None
            }
        }
    }

    /// Bu niyetin günlükteki SON sonucu (işlem günlüğü tek doğru kaynaktır: `durum.json` yazılmadan
    /// ölünse bile sonuç buradan türer).
    fn last_report(&self, journal: &Journal, intent: &Intent) -> Option<OpReport> {
        let last = journal.last_op()?;
        let plan = last.plan()?.clone();
        if plan.get("niyetId").and_then(Value::as_str) != Some(intent.id.as_str()) {
            return None;
        }
        last.result()?;
        let outcome = operation::outcome_of(&last);
        let s = |k: &str| plan.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
        let product = if s("tur") == "PG" { "pg" } else { "backend" };
        Some(OpReport {
            outcome,
            product,
            intent_id: Some(intent.id.clone()),
            op_id: s("islemId"),
            source: s("kaynakSurum"),
            target: s("surum"),
        })
    }

    fn cycle(&self, inputs: &Inputs, journal: &mut Journal, stop: &dyn Fn() -> bool, tick_s: u64) -> TickResult {
        let idle = TickResult::Idle(Duration::from_secs(tick_s));
        let Some((installed, current_dir)) = self.installed_version() else {
            self.status(self.waiting(None, Some(codes::KURULU_SURUM_YOK), "current bağlantısı yok ya da bir sürüm dizinini göstermiyor"));
            return idle;
        };
        let intent = match ipc::read_intent(self.env.fs.as_ref(), &self.layout) {
            IntentRead::Missing => {
                self.keep_or_wait(Some(&installed), codes::NIYET_YOK, "backend'den güncelleme niyeti yok");
                return idle;
            }
            IntentRead::Invalid(m) => {
                self.status(self.waiting(Some(&installed), Some(codes::NIYET_BICIMSIZ), &m));
                return idle;
            }
            IntentRead::Ok(i) => *i,
        };
        let pol = match policy::load(self.env.fs.as_ref(), &inputs.backend.license_dir, &self.anchor, self.now()) {
            Ok(p) => p,
            Err(e) => {
                self.status(self.waiting(Some(&installed), Some(e.code), &e.message));
                return idle;
            }
        };
        let view =
            PolicyView { mode: pol.mode.label().into(), allowed: pol.mode != Mode::Frozen, reason: pol.frozen_reason.map(str::to_string) };
        let last = self.last_report(journal, &intent);
        if let Some(prev) = last.as_ref().filter(|r| r.outcome != OpOutcome::Succeeded) {
            let mut d = self.outcome_status(prev);
            d.message =
                Some(format!("{} — aynı niyet yeniden denenmez; yeni onay ya da yeni sürüm gerekir", d.message.unwrap_or_default()));
            d.policy = Some(view);
            self.status(d);
            return idle;
        }
        match policy::version_verdict(&pol, &installed, &intent.version) {
            VersionVerdict::UpToDate => {
                match last.as_ref().filter(|r| r.product == "backend") {
                    Some(done) => self.status(self.outcome_status(done)),
                    None => self.keep_or_wait(Some(&installed), "", "kurulu sürüm güncel"),
                }
                return idle;
            }
            VersionVerdict::NotAllowed(m) => {
                let mut d = self.waiting(Some(&installed), Some(codes::SURUM_IZINSIZ), &m);
                d.version = Some(intent.version.clone());
                d.policy = Some(view);
                self.status(d);
                return idle;
            }
            VersionVerdict::Allowed => {}
        }
        if pol.mode == Mode::Frozen {
            let mut d = self.waiting(Some(&installed), pol.frozen_reason, "güncelleme dondurulmuş (kira)");
            d.version = Some(intent.version.clone());
            d.intent_id = Some(intent.id.clone());
            d.policy = Some(view);
            self.status(d);
            return idle;
        }
        let server = match inputs.settings.server_base() {
            Ok(s) => s,
            Err(m) => {
                self.status(self.waiting(Some(&installed), Some(codes::AYAR_BICIMSIZ), &m));
                return idle;
            }
        };
        let manifest = match self.manifest(&server, &intent, &pol, &installed) {
            Ok(m) => m,
            Err((code, m)) => {
                let mut d = self.waiting(Some(&installed), Some(code), &m);
                d.version = Some(intent.version.clone());
                d.intent_id = Some(intent.id.clone());
                d.policy = Some(view);
                self.status(d);
                return idle;
            }
        };
        let instance = pgminor::read_instance(&self.env, &self.layout);
        if let Err((code, m)) = self.external_pg_gate(inputs, &manifest, instance.as_ref()) {
            let mut d = self.waiting(Some(&installed), Some(code), &m);
            d.version = Some(intent.version.clone());
            d.policy = Some(view);
            self.status(d);
            return idle;
        }
        let pkg_hex = b64u_to_hex(&manifest.package.sha256);
        if let Err((code, m)) = self.prepare_backend(&server, &intent, &manifest, &pol, &installed, stop) {
            let state =
                if code == codes::INDIRME_HATASI || code == codes::BELIRTEC_SURESI_DOLDU { State::Downloading } else { State::Waiting };
            let mut d = self.base(state, Some(&installed));
            d.error_code = Some(code.to_string());
            d.message = Some(m);
            d.version = Some(intent.version.clone());
            d.intent_id = Some(intent.id.clone());
            d.policy = Some(view);
            self.status(d);
            return TickResult::Idle(Duration::from_secs(tick_s.min(60)));
        }
        let pg_pending = match self.prepare_pg(&server, &intent, &manifest, instance.as_ref(), stop) {
            Ok(p) => p,
            Err((code, m)) => {
                let mut d = self.waiting(Some(&installed), Some(code), &m);
                d.version = Some(intent.version.clone());
                d.policy = Some(view);
                self.status(d);
                return idle;
            }
        };
        match policy::decide(&pol, &intent, self.now()) {
            Decision::Wait(at, why) => {
                let mut d = self.base(State::Ready, Some(&installed));
                d.version = Some(intent.version.clone());
                d.source_version = Some(installed.clone());
                d.intent_id = Some(intent.id.clone());
                d.planned = at.map(timefmt::iso_millis);
                d.message = Some(format!("paket doğrulandı; {why}"));
                d.policy = Some(view);
                self.status(d);
                return idle;
            }
            Decision::Blocked(code, why) => {
                let mut d = self.waiting(Some(&installed), Some(code), &why);
                d.version = Some(intent.version.clone());
                d.policy = Some(view);
                self.status(d);
                return idle;
            }
            Decision::Apply => {}
        }
        if let Err((code, m)) = self.disk_check(&manifest) {
            self.status(self.waiting(Some(&installed), Some(code), &m));
            return idle;
        }
        if let Some((inst, target)) = pg_pending {
            let r = self.run_pg(inputs, journal, &intent, &inst, &target, &manifest, &current_dir, &installed);
            if r.outcome != OpOutcome::Succeeded {
                // PG adımı düştüyse backend'e dokunulmaz (D4 §5).
                self.status(self.outcome_status(&r));
                return idle;
            }
        }
        let outcome = self.run_backend(inputs, journal, &intent, &manifest, &installed, &current_dir, pkg_hex);
        self.after_op(inputs, outcome, tick_s)
    }

    /// Son durum bir işlem sonucuysa (BAŞARILI/GERİ DÖNDÜ/HATA) korunur; değilse BEKLİYOR yazılır.
    fn keep_or_wait(&self, installed: Option<&str>, code: &str, message: &str) {
        let prev = self.last_status.borrow().clone().or_else(|| ipc::read_status(self.env.fs.as_ref(), &self.layout));
        if let Some(mut p) = prev.filter(|p| matches!(p.state, State::Succeeded | State::RolledBack | State::Failed)) {
            p.installed_version = installed.map(str::to_string);
            self.status(p);
            return;
        }
        self.status(self.waiting(installed, (!code.is_empty()).then_some(code), message));
    }

    fn manifest(&self, server: &str, intent: &Intent, pol: &Policy, installed: &str) -> Result<Manifest, (&'static str, String)> {
        if !ipc::valid_manifest_path(&intent.manifest_path, &pol.channel) {
            return Err((codes::NIYET_BICIMSIZ, format!("manifest yolu kanal ({}) öneki altında değil", pol.channel)));
        }
        let fs = self.env.fs.as_ref();
        let stored = self.layout.manifests().join(format!("{}.jws", intent.version));
        let text = match fs.read(&stored).ok().and_then(|b| String::from_utf8(b).ok()) {
            Some(t) => t,
            None => {
                let token = intent.download.as_ref().map(|d| d.token.as_str());
                let bytes = download::fetch_small(&self.env, &format!("{server}{}", intent.manifest_path), token)
                    .map_err(|e| (e.code, e.message))?;
                String::from_utf8(bytes).map_err(|_| (codes::MANIFEST_GECERSIZ, "manifest UTF-8 değil".to_string()))?
            }
        };
        let m = manifest::verify(&text, &self.anchor).map_err(|e| {
            let _ = fs.remove_file(&stored);
            (codes::MANIFEST_GECERSIZ, e)
        })?;
        let reject = |code: &'static str, msg: String| {
            let _ = fs.remove_file(&stored);
            Err((code, msg))
        };
        if m.channel != pol.channel {
            return reject(codes::MANIFEST_GECERSIZ, format!("manifest {} kanalının, kurulum {}", m.channel, pol.channel));
        }
        if m.version != intent.version {
            return reject(codes::MANIFEST_GECERSIZ, format!("manifest sürümü {}, niyet {}", m.version, intent.version));
        }
        if !m.package.path.starts_with(&format!("/{}/backend/", pol.channel)) {
            return reject(codes::MANIFEST_GECERSIZ, "paket yolu kanalın backend dizini altında değil".into());
        }
        if let Some(min) = &m.min_source {
            if version::compare(installed, min) == Some(std::cmp::Ordering::Less) {
                return reject(
                    codes::KAYNAK_SURUM_ESKI,
                    format!("{} doğrudan kurulamaz: kurulu {installed}, en az {min} gerekir", m.version),
                );
            }
        }
        if let Err(e) = package::check_key_class(&m.kid, pol.license_class.as_deref()) {
            return reject(e.code, e.message);
        }
        if fs.read(&stored).is_err() {
            let _ = fs.write_atomic(&stored, text.trim().as_bytes());
        }
        Ok(m)
    }

    /// Harici PG kipinde (ya da örnek kaydı yoksa) `pg.enAz` denetimi — altındaysa backend RED (D4 §7).
    fn external_pg_gate(&self, inputs: &Inputs, m: &Manifest, instance: Option<&pgminor::Instance>) -> Result<(), (&'static str, String)> {
        let Some(pg) = &m.pg else { return Ok(()) };
        let Some(min) = &pg.min else { return Ok(()) };
        if instance.is_some_and(pgminor::Instance::own) {
            return Ok(());
        }
        let v = tools::server_version(&self.env, &inputs.backend, &inputs.backend.pg_bin_dir)
            .map_err(|e| (codes::PG_SURUM_ESKI, format!("harici PostgreSQL sürümü ölçülemedi: {e}")))?;
        let num = |s: &str| s.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
        if num(&v) < num(min) {
            return Err((
                codes::PG_SURUM_ESKI,
                format!("harici PostgreSQL {v}, bu sürüm en az {min} ister (kendi örneğe taşıma: D4 runbook'u)"),
            ));
        }
        Ok(())
    }

    fn ready_marker(&self, v: &str) -> PathBuf {
        self.layout.ready_markers().join(format!("{v}.json"))
    }

    /// Paket HAZIR mı; değilse indir → aç → doğrula → yerleştir.
    fn prepare_backend(
        &self,
        server: &str,
        intent: &Intent,
        m: &Manifest,
        pol: &Policy,
        installed: &str,
        stop: &dyn Fn() -> bool,
    ) -> Result<(), (&'static str, String)> {
        let fs = self.env.fs.as_ref();
        let dir = self.layout.version_dir(&m.version);
        let marker = self.ready_marker(&m.version);
        if fs.exists(&marker) && fs.is_dir(&dir) {
            return Ok(());
        }
        if fs.is_dir(&dir) {
            // İşaretsiz sürüm dizini (yarım yerleştirme ya da elle konmuş): doğrulanırsa kabul, değilse silinir.
            match package::verify_dir(&self.env, &dir, &self.anchor, &m.version, &pol.channel, pol.license_class.as_deref()) {
                Ok(_) => {
                    let _ = fs.write_atomic(
                        &marker,
                        json!({ "surum": m.version, "zaman": timefmt::iso_millis(self.now()) }).to_string().as_bytes(),
                    );
                    return Ok(());
                }
                Err(e) => {
                    if version::compare(&m.version, installed) == Some(std::cmp::Ordering::Equal) {
                        return Err((e.code, e.message));
                    }
                    self.log.warn(&format!("{} doğrulanamadı ({}), yeniden açılacak", dir.display(), e.message));
                    fs.remove_dir_all(&dir).map_err(|x| (codes::INDIRME_HATASI, x.to_string()))?;
                }
            }
        }
        let Some(tok) = intent.download.as_ref() else {
            return Err((codes::BELIRTEC_SURESI_DOLDU, "niyet indirme belirteci taşımıyor".into()));
        };
        let exp = tekserp_dogrulama::iso::date_parse_ms(&tok.expires);
        if !(exp.is_finite() && (self.now() as f64) < exp) {
            return Err((codes::BELIRTEC_SURESI_DOLDU, "indirme belirtecinin süresi doldu — backend yenisini yazacak".into()));
        }
        let zip = self.layout.downloads().join(format!("{}.zip", m.version));
        let spec = Spec {
            url: format!("{server}{}", m.package.path),
            token: Some(tok.token.clone()),
            part: self.layout.downloads().join(format!("{}.zip.part", m.version)),
            dest: zip.clone(),
            size: m.package.size,
            sha256_b64u: m.package.sha256.clone(),
        };
        let mut progress = |done: u64, total: u64| self.download_progress(intent, installed, done, total);
        download::download(&self.env, &spec, &mut progress, stop).map_err(|e| (e.code, e.message))?;
        let staging = self.layout.staging_dir(&m.version);
        fs.remove_dir_all(&staging).map_err(|x| (codes::INDIRME_HATASI, x.to_string()))?;
        fs.create_dir_all(&self.layout.versions()).map_err(|x| (codes::INDIRME_HATASI, x.to_string()))?;
        if let Err(e) = fs.extract_zip(&zip, &staging, &ExtractLimits::default()) {
            let _ = fs.remove_dir_all(&staging);
            let code = if e.starts_with("PAKET_YOL") { codes::PAKET_YOL } else { codes::PAKET_BUTUNLUK };
            return Err((code, e));
        }
        if let Err(e) = package::verify_dir(&self.env, &staging, &self.anchor, &m.version, &pol.channel, pol.license_class.as_deref()) {
            let _ = fs.remove_dir_all(&staging);
            return Err((e.code, e.message));
        }
        fs.rename(&staging, &dir).map_err(|x| (codes::INDIRME_HATASI, x.to_string()))?;
        fs.write_atomic(&marker, json!({ "surum": m.version, "zaman": timefmt::iso_millis(self.now()) }).to_string().as_bytes())
            .map_err(|x| (codes::INDIRME_HATASI, x.to_string()))?;
        let _ = fs.remove_file(&zip);
        self.log.info(&format!("{} hazır: indirildi, sha256 + PAKET imzası + bütünlük listesi doğrulandı", m.version));
        Ok(())
    }

    fn download_progress(&self, intent: &Intent, installed: &str, done: u64, total: u64) {
        let now = self.now();
        if now - *self.last_progress_ms.borrow() < 2000 && done < total {
            return;
        }
        *self.last_progress_ms.borrow_mut() = now;
        let mut d = self.base(State::Downloading, Some(installed));
        d.version = Some(intent.version.clone());
        d.intent_id = Some(intent.id.clone());
        d.progress = Some(IpcProgress { done, total });
        d.message = Some("paket indiriliyor".into());
        self.status(d);
    }

    /// Kendi örnekte hedef PG kuruludan farklıysa PG paketini hazırlar; bekleyen PG işi döner.
    fn prepare_pg(
        &self,
        server: &str,
        intent: &Intent,
        m: &Manifest,
        instance: Option<&pgminor::Instance>,
        stop: &dyn Fn() -> bool,
    ) -> Result<Option<(pgminor::Instance, crate::manifest::PgTarget)>, (&'static str, String)> {
        let (Some(pg), Some(inst)) = (&m.pg, instance) else { return Ok(None) };
        let Some(target) = &pg.target else { return Ok(None) };
        if !inst.own() || pgminor::tag_of(target) == inst.tag() {
            return Ok(None);
        }
        let fs = self.env.fs.as_ref();
        let data_major =
            fs.read_untrusted(&inst.data_dir.join("PG_VERSION"), 64).ok().map(|b| String::from_utf8_lossy(&b).trim().to_string());
        if data_major.as_deref() != Some(pg.line.as_str()) {
            return Err((
                codes::PG_BUYUK_SURUM,
                format!("veri dizini ana sürümü {data_major:?}, paket {} — büyük sürüm geçişi otomatik değil (runbook)", pg.line),
            ));
        }
        let tag = pgminor::tag_of(target);
        let dir = self.layout.pg_version_dir(&tag);
        let marker = self.layout.ready_markers().join(format!("pg-{tag}.json"));
        if fs.exists(&marker) && fs.is_dir(&dir) {
            return Ok(Some((inst.clone(), target.clone())));
        }
        if !target.package.path.starts_with(&format!("/{}/backend/", m.channel)) {
            return Err((codes::PG_PAKET, "PG paket yolu kanalın backend dizini altında değil".into()));
        }
        let Some(tok) = intent.download.as_ref() else {
            return Err((codes::BELIRTEC_SURESI_DOLDU, "niyet indirme belirteci taşımıyor".into()));
        };
        let zip = self.layout.downloads().join(format!("pg-{tag}.zip"));
        let spec = Spec {
            url: format!("{server}{}", target.package.path),
            token: Some(tok.token.clone()),
            part: self.layout.downloads().join(format!("pg-{tag}.zip.part")),
            dest: zip.clone(),
            size: target.package.size,
            sha256_b64u: target.package.sha256.clone(),
        };
        let mut noop = |_: u64, _: u64| {};
        download::download(&self.env, &spec, &mut noop, stop).map_err(|e| (e.code, e.message))?;
        let staging = self.layout.pg_staging_dir(&tag);
        fs.remove_dir_all(&staging).map_err(|x| (codes::PG_PAKET, x.to_string()))?;
        if fs.is_dir(&dir) {
            fs.remove_dir_all(&dir).map_err(|x| (codes::PG_PAKET, x.to_string()))?;
        }
        if let Err(e) = fs.extract_zip(&zip, &staging, &ExtractLimits::default()) {
            let _ = fs.remove_dir_all(&staging);
            return Err((codes::PG_PAKET, e));
        }
        let check = pgminor::verify_content(&self.env, &staging, &target.content_sha256).and_then(|_| {
            let c = crate::env::Cmd::new(&staging.join("bin").join(if cfg!(windows) { "postgres.exe" } else { "postgres" }))
                .arg("--version")
                .timeout(Duration::from_secs(30));
            let out = self.env.procs.run(&c).map_err(|e| e.0)?;
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            if out.ok() && text.contains(&format!("(PostgreSQL) {}", target.version)) {
                Ok(())
            } else {
                Err(format!("postgres --version beklenen {} değil: {}", target.version, text.trim()))
            }
        });
        if let Err(e) = check {
            let _ = fs.remove_dir_all(&staging);
            return Err((codes::PG_PAKET, e));
        }
        fs.rename(&staging, &dir).map_err(|x| (codes::PG_PAKET, x.to_string()))?;
        fs.write_atomic(&marker, json!({ "surum": tag }).to_string().as_bytes()).map_err(|x| (codes::PG_PAKET, x.to_string()))?;
        let _ = fs.remove_file(&zip);
        Ok(Some((inst.clone(), target.clone())))
    }

    fn disk_check(&self, m: &Manifest) -> Result<(), (&'static str, String)> {
        let need = m.package.size.saturating_mul(3).saturating_add(2 * 1024 * 1024 * 1024);
        match self.env.fs.free_space(&self.layout.root) {
            Ok(free) if free < need => {
                Err((codes::DISK_DOLU, format!("boş alan {} MB, en az {} MB gerekir", free / 1_048_576, need / 1_048_576)))
            }
            _ => Ok(()),
        }
    }

    fn tools_dir(&self, old: &Path, new: &Path) -> PathBuf {
        if Runtime::of(old).usable_for_backup(&self.env) {
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
        intent: &Intent,
        inst: &pgminor::Instance,
        target: &crate::manifest::PgTarget,
        m: &Manifest,
        current_dir: &Path,
        backend_version: &str,
    ) -> OpReport {
        let tag = pgminor::tag_of(target);
        let new_dir = self.layout.pg_version_dir(&tag);
        let not_started = |e: operation::StepError| OpReport {
            outcome: OpOutcome::RolledBack(e),
            product: "pg",
            intent_id: Some(intent.id.clone()),
            op_id: String::new(),
            source: inst.tag(),
            target: tag.clone(),
        };
        let old_image = match self.env.svc.image_path(&inst.hizmet) {
            Ok(p) => p,
            Err(e) => return not_started(operation::step_err(codes::PG_YOL_HATASI, e.0)),
        };
        let Some(new_image) = pgminor::replace_dir(&old_image, &inst.bin_dir, &new_dir) else {
            return not_started(operation::step_err(
                codes::PG_YOL_HATASI,
                "PG hizmetinin ImagePath'i ornek.json'daki ikili dizinini göstermiyor",
            ));
        };
        let icu_changed = pgminor::icu_version(&self.env, &inst.bin_dir) != pgminor::icu_version(&self.env, &new_dir);
        let reindex = m.pg.as_ref().is_some_and(|p| p.reindex_icu);
        let plan = PgPlan {
            kind: "PG".into(),
            op_id: crate::ids::uuid_v4(),
            intent_id: Some(intent.id.clone()),
            source_tag: inst.tag(),
            target_tag: tag.clone(),
            source_server_version: inst.surum.clone(),
            target_server_version: target.version.clone(),
            service: inst.hizmet.clone(),
            old_dir: inst.bin_dir.clone(),
            new_dir,
            old_image_path: old_image,
            new_image_path: new_image,
            data_dir: inst.data_dir.clone(),
            icu_changed,
            reindex_icu: reindex,
            backend_version: backend_version.to_string(),
            tools_dir: current_dir.to_path_buf(),
            started_ms: self.now(),
        };
        let report = self.report_fn();
        let ctx = self.ctx(inputs, &report);
        let value = serde_json::to_value(&plan).unwrap_or(Value::Null);
        let op = PgOp { plan };
        let outcome = operation::start(&ctx, journal, &op, value);
        let p = op.plan;
        OpReport { outcome, product: "pg", intent_id: p.intent_id, op_id: p.op_id, source: p.source_tag, target: p.target_tag }
    }

    #[allow(clippy::too_many_arguments)]
    fn run_backend(
        &self,
        inputs: &Inputs,
        journal: &mut Journal,
        intent: &Intent,
        m: &Manifest,
        installed: &str,
        current_dir: &Path,
        pkg_hex: Option<String>,
    ) -> OpReport {
        let new_dir = self.layout.version_dir(&m.version);
        // Ön koşul ölçümleri (backend henüz ÇALIŞIYORKEN): göç sayısı ve lisans görüntüsü.
        let migrations_before = match tools::migration_count(&self.env, &inputs.backend) {
            Ok(c) => Some(c),
            Err(e) => {
                self.log.warn(&format!("göç sayısı ölçülemedi ({e}) — göç başlarsa geri dönüşte DB yedekten geri yüklenir"));
                None
            }
        };
        let license_before = health::probe(&self.env, inputs.backend.port).and_then(|h| h.license);
        let commit = self
            .env
            .fs
            .read(&new_dir.join("PAKET.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| v.get("commit").and_then(Value::as_str).map(str::to_string));
        let plan = BackendPlan {
            kind: "BACKEND".into(),
            op_id: crate::ids::uuid_v4(),
            intent_id: Some(intent.id.clone()),
            source_version: installed.to_string(),
            version: m.version.clone(),
            previous_target: current_dir.to_path_buf(),
            new_target: new_dir.clone(),
            migrations_before,
            license_before,
            package_hex: pkg_hex,
            commit,
            started_ms: self.now(),
            approval: intent.approval.clone(),
            tools_dir: self.tools_dir(current_dir, &new_dir),
        };
        let report = self.report_fn();
        let ctx = self.ctx(inputs, &report);
        let value = serde_json::to_value(&plan).unwrap_or(Value::Null);
        let op = BackendOp { plan };
        let outcome = operation::start(&ctx, journal, &op, value);
        let p = op.plan;
        OpReport { outcome, product: "backend", intent_id: p.intent_id, op_id: p.op_id, source: p.source_version, target: p.version }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn hex_conversion() {
        let b = tekserp_dogrulama::b64::encode(&[0xab; 32]);
        assert_eq!(super::b64u_to_hex(&b).unwrap(), "ab".repeat(32));
    }
}
