//! Çökme güvenli işlem sürücüsü (§7) + backend güncellemesinin adımları (§8).
//!
//! Sürücü GENELDİR (backend ve PG küçük sürüm işlemleri aynı makineyi kullanır): her adım önce
//! BAŞLADI satırı diske iner, sonra koşar, sonra BİTTİ; hata HATA satırı yazar ve telafiler ters
//! sırada koşar (TELAFİ_BAŞLADI/BİTTİ). Süreç herhangi bir anda ölürse `drive` aynı günlükle yeniden
//! çağrılır: yarım adım DEVAM (adımlar tekrarlanabilir yazılmıştır) ya da işlem türünün dediği gibi
//! GERİ AL; yarım geri alma da sürdürülür. Son durum her zaman ikisinden biridir: BAŞARILI (yeni
//! sürüm + uygulanmış göç) ya da GERİ DÖNDÜ (eski sürüm + işlem öncesi DB); sağlanamazsa HATA (insan).
use crate::codes;
use crate::env::{Env, SvcState};
use crate::health::{self, Criteria, LicenseHealth};
use crate::history::{self, InstallRecord};
use crate::ipc::Approval;
use crate::journal::{Journal, Kind, OpView};
use crate::layout::Layout;
use crate::settings::{BackendEnv, UpdaterSettings};
use crate::tools::{self, MigrationCount, Runtime};
use crate::trust::TrustAnchor;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tekserp_hizmet::contract;
use tekserp_hizmet::logfile::{Level, RotatingLog};
use tekserp_hizmet::timefmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepError {
    pub code: &'static str,
    pub message: String,
}

pub fn step_err(code: &'static str, message: impl Into<String>) -> StepError {
    StepError { code, message: message.into() }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpOutcome {
    Succeeded,
    RolledBack(StepError),
    Failed(StepError),
}

/// Durum bildirimi (motor `durum.json`a yazar): hangi işlem, hangi adım, geri alma mı.
pub struct Progress<'a> {
    pub op_id: &'a str,
    pub product: &'a str,
    pub source: &'a str,
    pub target: &'a str,
    pub approval_id: Option<&'a str>,
    pub step: &'a str,
    pub rolling_back: bool,
}

pub struct Ctx<'a> {
    pub env: &'a Env,
    pub layout: &'a Layout,
    pub settings: &'a UpdaterSettings,
    pub backend: &'a BackendEnv,
    pub anchor: &'a TrustAnchor,
    pub log: &'a RotatingLog,
    pub report: &'a dyn Fn(&Progress),
}

impl Ctx<'_> {
    pub fn now_iso(&self) -> String {
        timefmt::iso_millis(self.env.clock.now_ms())
    }
}

pub trait Operation {
    fn op_id(&self) -> &str;
    fn product(&self) -> &'static str;
    fn source(&self) -> &str;
    fn target(&self) -> &str;
    /// Bu işlemi tetikleyen panel onayı (`onayId`); pencere/otomatik kipte `None`.
    fn approval_id(&self) -> Option<&str>;
    fn steps(&self) -> &'static [&'static str];
    /// Yarımda kalan bu adımda açılış GERİ AL mı yapar (varsayılan DEVAM).
    fn rollback_if_interrupted(&self, step: &str) -> bool;
    fn run_step(&self, ctx: &Ctx, view: &OpView, step: &str) -> Result<Value, StepError>;
    fn has_compensation(&self, step: &str) -> bool;
    /// Telafi; dönen veri TELAFİ_BİTTİ satırına yazılır (ör. DB geri yüklendi mi).
    fn compensate(&self, ctx: &Ctx, view: &OpView, step: &str) -> Result<Value, StepError>;
    /// Sonuçtan sonra en iyi çaba (geçmiş satırı, kurulum kaydı) — hata işlemi değiştirmez.
    fn after_result(&self, ctx: &Ctx, view: &OpView, outcome: &OpOutcome);
}

fn record(ctx: &Ctx, journal: &mut Journal, op: &str, kind: Kind, step: Option<&str>, data: Value) -> Result<(), StepError> {
    journal
        .append(ctx.env.fs.as_ref(), op, kind, step, data, ctx.now_iso())
        .map_err(|e| step_err(codes::IC_HATA, format!("işlem günlüğü yazılamadı: {e}")))
}

fn view(journal: &Journal, op: &str) -> OpView {
    journal.last_op().filter(|v| v.op == op).unwrap_or(OpView { op: op.to_string(), records: vec![] })
}

fn progress(ctx: &Ctx, op: &dyn Operation, step: &str, rolling_back: bool) {
    (ctx.report)(&Progress {
        op_id: op.op_id(),
        product: op.product(),
        source: op.source(),
        target: op.target(),
        approval_id: op.approval_id(),
        step,
        rolling_back,
    });
}

/// İşlemi başlatır (ISLEM satırı + plan) ve sürer.
pub fn start(ctx: &Ctx, journal: &mut Journal, op: &dyn Operation, plan: Value) -> OpOutcome {
    ctx.log.info(&format!("işlem {} başlıyor: {} {} → {}", op.op_id(), op.product(), op.source(), op.target()));
    ctx.env.events.event(Level::Info, &format!("Güncelleme başladı: {} {} → {}", op.product(), op.source(), op.target()));
    if let Err(e) = record(ctx, journal, op.op_id(), Kind::Begin, None, plan) {
        return OpOutcome::Failed(e);
    }
    drive(ctx, journal, op)
}

/// Günlüğün söylediği yerden sürer (yeni ya da yarım işlem).
pub fn drive(ctx: &Ctx, journal: &mut Journal, op: &dyn Operation) -> OpOutcome {
    let id = op.op_id().to_string();
    loop {
        let v = view(journal, &id);
        if v.result().is_some() {
            return outcome_of(&v);
        }
        if v.rolling_back() {
            return rollback(ctx, journal, op);
        }
        let Some(step) = op.steps().iter().copied().find(|s| !v.ended(s)) else {
            return finish(ctx, journal, op, OpOutcome::Succeeded, json!({ "sonuc": "BASARILI" }));
        };
        if v.began(step) && op.rollback_if_interrupted(step) {
            ctx.log.warn(&format!("işlem {id}: {step} yarımda kalmış — geri alınıyor"));
            let data = json!({ "hataKodu": codes::KESINTI, "mesaj": format!("{step} adımı yarımda kaldı (süreç kesildi)") });
            if let Err(e) = record(ctx, journal, &id, Kind::Error, Some(step), data) {
                return OpOutcome::Failed(e);
            }
            continue;
        }
        progress(ctx, op, step, false);
        ctx.log.info(&format!("işlem {id}: {step} başlıyor"));
        if let Err(e) = record(ctx, journal, &id, Kind::StepBegin, Some(step), Value::Null) {
            return OpOutcome::Failed(e);
        }
        let v = view(journal, &id);
        match op.run_step(ctx, &v, step) {
            Ok(data) => {
                ctx.log.info(&format!("işlem {id}: {step} bitti"));
                if let Err(e) = record(ctx, journal, &id, Kind::StepEnd, Some(step), data) {
                    return OpOutcome::Failed(e);
                }
            }
            Err(e) => {
                ctx.log.error(&format!("işlem {id}: {step} HATA {} — {}", e.code, e.message));
                if let Err(j) = record(ctx, journal, &id, Kind::Error, Some(step), json!({ "hataKodu": e.code, "mesaj": e.message })) {
                    return OpOutcome::Failed(j);
                }
            }
        }
    }
}

/// Günlükten okunan kod metnini sözleşmedeki sabite eşler (tanınmayan → `IC_HATA`).
pub fn static_code(c: &str) -> &'static str {
    ALL_CODES.iter().copied().find(|x| *x == c).unwrap_or(codes::IC_HATA)
}

/// Günlüğe yazılmış sonucu okur (yarım değilse).
pub fn outcome_of(v: &OpView) -> OpOutcome {
    let r = v.result().cloned().unwrap_or(Value::Null);
    let code = |k: &str| -> &'static str { static_code(r.get(k).and_then(Value::as_str).unwrap_or(codes::IC_HATA)) };
    let message = r.get("mesaj").and_then(Value::as_str).unwrap_or_default().to_string();
    match r.get("sonuc").and_then(Value::as_str) {
        Some("BASARILI") => OpOutcome::Succeeded,
        Some("GERI_DONDU") => OpOutcome::RolledBack(step_err(code("hataKodu"), message)),
        _ => OpOutcome::Failed(step_err(code("hataKodu"), message)),
    }
}

fn finish(ctx: &Ctx, journal: &mut Journal, op: &dyn Operation, outcome: OpOutcome, data: Value) -> OpOutcome {
    if let Err(e) = record(ctx, journal, op.op_id(), Kind::Result, None, data) {
        return OpOutcome::Failed(e);
    }
    let v = view(journal, op.op_id());
    op.after_result(ctx, &v, &outcome);
    match &outcome {
        OpOutcome::Succeeded => {
            ctx.log.info(&format!("işlem {} BAŞARILI", op.op_id()));
            ctx.env.events.event(Level::Info, &format!("Güncelleme başarılı: {} {} → {}", op.product(), op.source(), op.target()));
        }
        OpOutcome::RolledBack(e) => {
            ctx.log.warn(&format!("işlem {} GERİ DÖNDÜ ({}): {}", op.op_id(), e.code, e.message));
            ctx.env.events.event(
                Level::Warn,
                &format!("Güncelleme geri alındı ({}): {} {} kaldı — {}", e.code, op.product(), op.source(), e.message),
            );
        }
        OpOutcome::Failed(e) => {
            ctx.log.error(&format!("işlem {} HATA ({}): {}", op.op_id(), e.code, e.message));
            ctx.env.events.event(Level::Error, &format!("Güncelleme TAMAMLANAMADI, insan gerekiyor ({}): {}", e.code, e.message));
        }
    }
    outcome
}

fn rollback(ctx: &Ctx, journal: &mut Journal, op: &dyn Operation) -> OpOutcome {
    let id = op.op_id().to_string();
    let (_, code, message) = view(journal, &id).error().unwrap_or((String::new(), codes::KESINTI.to_string(), "yarım işlem".into()));
    let code = static_code(&code);
    for step in op.steps().iter().rev().copied() {
        let v = view(journal, &id);
        if !v.began(step) || v.comp_ended(step) || !op.has_compensation(step) {
            continue;
        }
        progress(ctx, op, &format!("GERI_DON:{step}"), true);
        ctx.log.info(&format!("işlem {id}: {step} telafisi başlıyor"));
        if let Err(e) = record(ctx, journal, &id, Kind::CompBegin, Some(step), Value::Null) {
            return OpOutcome::Failed(e);
        }
        let v = view(journal, &id);
        match op.compensate(ctx, &v, step) {
            Ok(data) => {
                if let Err(e) = record(ctx, journal, &id, Kind::CompEnd, Some(step), data) {
                    return OpOutcome::Failed(e);
                }
            }
            Err(e) => {
                let data = json!({ "sonuc": "HATA", "hataKodu": e.code, "mesaj": e.message, "ilkHata": code });
                return finish(ctx, journal, op, OpOutcome::Failed(e), data);
            }
        }
    }
    finish(
        ctx,
        journal,
        op,
        OpOutcome::RolledBack(step_err(code, message.clone())),
        json!({ "sonuc": "GERI_DONDU", "hataKodu": code, "mesaj": message }),
    )
}

const ALL_CODES: &[&str] = &[
    codes::KESINTI,
    codes::IC_HATA,
    codes::HIZMET_YOK,
    codes::HIZMET_DURMADI,
    codes::HIZMET_BASLAMADI,
    codes::YEDEK_HATASI,
    codes::GECIS_HATASI,
    codes::GOC_HATASI,
    codes::GOC_ZAMAN_ASIMI,
    codes::SAGLIK_ZAMAN_ASIMI,
    codes::SAGLIK_SURUM,
    codes::SAGLIK_DB,
    codes::SAGLIK_LISANS,
    codes::SAGLIK_LISANS_OLCULEMEDI,
    codes::GERI_YUKLEME_HATASI,
    codes::GERI_DONUS_SAGLIKSIZ,
    codes::BUTUNLUK_GECERSIZ,
    codes::DISK_DOLU,
    codes::PG_DURMADI,
    codes::PG_BASLAMADI,
    codes::PG_SURUM_UYUSMAZ,
    codes::PG_ICU_HATASI,
    codes::PG_YOL_HATASI,
];

// ── Hizmet yardımcıları ─────────────────────────────────────────────────────────────────────────

pub fn wait_state(ctx: &Ctx, name: &str, want: SvcState, timeout: Duration) -> bool {
    let deadline = ctx.env.clock.now_ms() + i64::try_from(timeout.as_millis()).unwrap_or(i64::MAX);
    loop {
        if ctx.env.svc.state(name).is_ok_and(|s| s == want) {
            return true;
        }
        if ctx.env.clock.now_ms() >= deadline {
            return false;
        }
        ctx.env.clock.sleep(Duration::from_millis(500));
    }
}

pub fn stop_service(ctx: &Ctx, name: &str, code_missing: &'static str, code_stuck: &'static str) -> Result<(), StepError> {
    match ctx.env.svc.state(name) {
        Ok(SvcState::Missing) => return Err(step_err(code_missing, format!("{name} hizmeti yok"))),
        Ok(SvcState::Stopped) => return Ok(()),
        _ => {}
    }
    ctx.env.svc.stop(name).map_err(|e| step_err(code_stuck, e.0))?;
    if !wait_state(ctx, name, SvcState::Stopped, ctx.settings.stop_timeout()) {
        return Err(step_err(code_stuck, format!("{name} {} sn içinde durmadı", ctx.settings.stop_timeout().as_secs())));
    }
    Ok(())
}

pub fn start_service(ctx: &Ctx, name: &str, args: &[&str], code: &'static str) -> Result<(), StepError> {
    ctx.env.svc.start(name, args).map_err(|e| step_err(code, e.0))?;
    if !wait_state(ctx, name, SvcState::Running, Duration::from_secs(120)) {
        return Err(step_err(code, format!("{name} 120 sn içinde çalışır duruma gelmedi")));
    }
    Ok(())
}

// ── Backend güncellemesi (§8) ────────────────────────────────────────────────────────────────────

pub const BACKEND_STEPS: &[&str] = &["BACKEND_DURDUR", "YEDEK", "GECIS", "GOC", "DOGRULAMA", "BASLAT", "ONAY"];

/// İşlemin kararları — ISLEM satırına yazılır, yeniden başlayan süreç yeniden HESAPLAMAZ.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackendPlan {
    #[serde(rename = "tur")]
    pub kind: String,
    #[serde(rename = "islemId")]
    pub op_id: String,
    #[serde(rename = "onayId")]
    pub approval_id: Option<String>,
    #[serde(rename = "kaynakSurum")]
    pub source_version: String,
    #[serde(rename = "surum")]
    pub version: String,
    #[serde(rename = "oncekiHedef")]
    pub previous_target: PathBuf,
    #[serde(rename = "yeniHedef")]
    pub new_target: PathBuf,
    #[serde(rename = "gocOnce")]
    pub migrations_before: Option<MigrationCount>,
    #[serde(rename = "lisansOnce")]
    pub license_before: Option<LicenseHealth>,
    /// Zip'in sha256'sı (hex, imzalı bildirimden).
    #[serde(rename = "paketOzeti")]
    pub package_hex: Option<String>,
    #[serde(rename = "commit")]
    pub commit: Option<String>,
    #[serde(rename = "basladi")]
    pub started_ms: i64,
    #[serde(rename = "onay")]
    pub approval: Option<Approval>,
    /// Yedek/geri yükleme aracının alındığı sürüm dizini (eski sürüm araç taşıyorsa o, yoksa yeni).
    #[serde(rename = "araclar")]
    pub tools_dir: PathBuf,
}

pub struct BackendOp {
    pub plan: BackendPlan,
}

const KEY_NAME: &str = "guncelleme";

fn same_path(a: &Path, b: &Path) -> bool {
    if cfg!(windows) {
        a.to_string_lossy().trim_end_matches('\\').eq_ignore_ascii_case(b.to_string_lossy().trim_end_matches('\\'))
    } else {
        a == b
    }
}

pub fn switch_link(ctx: &Ctx, link: &Path, target: &Path, code: &'static str) -> Result<(), StepError> {
    let fs = ctx.env.fs.as_ref();
    if fs.link_target(link).ok().flatten().is_some_and(|t| same_path(&t, target)) {
        return Ok(());
    }
    if !fs.is_dir(target) {
        return Err(step_err(code, format!("hedef dizin yok: {}", target.display())));
    }
    fs.set_link(link, target).map_err(|e| step_err(code, format!("bağlantı değiştirilemedi: {e}")))?;
    match fs.link_target(link) {
        Ok(Some(t)) if same_path(&t, target) => Ok(()),
        other => Err(step_err(code, format!("bağlantı doğrulanamadı: {other:?}"))),
    }
}

/// Düz sır süpürmesi (her turun başında, en iyi çaba): geçici anahtarın düz yarıları ve düz döküm
/// kopyaları diskte kalmaz — adımlar ihtiyaç duyduklarını kendileri yeniden üretir.
pub fn sweep_plain_secrets(env: &Env, layout: &Layout) {
    let fs = env.fs.as_ref();
    for op in fs.list(&layout.keys_root()).unwrap_or_default() {
        for n in fs.list(&layout.op_keys(&op)).unwrap_or_default() {
            if n.ends_with(".tksec") || n.ends_with(".tksec.gecici") {
                let _ = fs.remove_file(&layout.op_keys(&op).join(n));
            }
        }
    }
    for op in fs.list(&layout.update_backups()).unwrap_or_default() {
        for n in ["db.dump", "db.dump.geri"] {
            let p = layout.update_backup_dir(&op).join(n);
            if fs.exists(&p) {
                let _ = fs.remove_file(&p);
            }
        }
    }
}

/// Güncelleme öncesi şifreli yedek (§8.3) — backend DURMUŞKEN; tekrarlanabilir (işaret dosyası varsa
/// yeniden alınmaz). Alıcılar: kurulumun `*.tkpub`leri + işleme özgü geçici anahtar (DPAPI'yle sarılı).
pub fn take_backup(ctx: &Ctx, op_id: &str, tools_dir: &Path) -> Result<Value, StepError> {
    let fs = ctx.env.fs.as_ref();
    let dir = ctx.layout.update_backup_dir(op_id);
    let marker = dir.join("yedek.json");
    if let Ok(b) = fs.read(&marker) {
        if let Ok(v) = serde_json::from_slice::<Value>(&b) {
            return Ok(v);
        }
    }
    let e = |m: String| step_err(codes::YEDEK_HATASI, m);
    fs.remove_dir_all(&dir).map_err(|x| e(x.to_string()))?;
    fs.create_dir_all(&dir).map_err(|x| e(x.to_string()))?;
    let dump = dir.join("db.dump");
    tools::pg_dump(ctx.env, ctx.backend, &dump, ctx.settings.backup_timeout()).map_err(e)?;
    tools::pg_restore_list(ctx.env, ctx.backend, &dump).map_err(e)?;
    let rt = Runtime::of(tools_dir);
    let keys = ctx.layout.op_keys(op_id);
    let protected = keys.join(format!("{KEY_NAME}.tksec.dpapi"));
    let public = keys.join(format!("{KEY_NAME}.tkpub"));
    let plain = keys.join(format!("{KEY_NAME}.tksec"));
    if !(fs.exists(&protected) && fs.exists(&public)) {
        fs.remove_dir_all(&keys).map_err(|x| e(x.to_string()))?;
        fs.create_dir_all(&keys).map_err(|x| e(x.to_string()))?;
        tools::backup_keygen(ctx.env, &rt, &keys, &plain).map_err(e)?;
        let secret = fs.read(&plain).map_err(|x| e(format!("geçici anahtar okunamadı: {x}")))?;
        let wrapped = ctx.env.protect.protect(&secret).map_err(|x| e(format!("geçici anahtar sarılamadı: {x}")))?;
        fs.write_atomic(&protected, &wrapped).map_err(|x| e(x.to_string()))?;
    }
    // Sarıldıktan sonra düz yarı HER koşumda silinir: silmeden önce ölen süreç onu diskte bırakmasın.
    fs.remove_file(&plain).map_err(|x| e(x.to_string()))?;
    let mut recipients: Vec<PathBuf> = fs
        .list(&ctx.backend.backup_key_dir)
        .unwrap_or_default()
        .into_iter()
        .filter(|n| n.to_ascii_lowercase().ends_with(".tkpub"))
        .map(|n| ctx.backend.backup_key_dir.join(n))
        .collect();
    let own_recipients = recipients.len();
    recipients.push(public);
    let enc = dir.join("db.dump.tkenc");
    tools::backup_encrypt(ctx.env, &rt, &dump, &enc, &recipients, ctx.settings.backup_timeout()).map_err(e)?;
    fs.remove_file(&dump).map_err(|x| e(x.to_string()))?;
    let size = fs.file_len(&enc).map_err(|x| e(x.to_string()))?;
    let info = json!({ "dosya": "db.dump.tkenc", "boyut": size, "kurulumAlicisi": own_recipients, "zaman": ctx.now_iso() });
    fs.write_atomic(&marker, info.to_string().as_bytes()).map_err(|x| e(x.to_string()))?;
    Ok(info)
}

/// Güncelleme öncesi yedekten geri yükleme (geçici anahtar DPAPI'den açılır, düz kopyası hemen silinir).
pub fn restore_backup(ctx: &Ctx, op_id: &str, tools_dir: &Path, expect: Option<MigrationCount>) -> Result<(), StepError> {
    let fs = ctx.env.fs.as_ref();
    let e = |m: String| step_err(codes::GERI_YUKLEME_HATASI, m);
    let dir = ctx.layout.update_backup_dir(op_id);
    let enc = dir.join("db.dump.tkenc");
    if !fs.exists(&enc) {
        return Err(e("güncelleme öncesi yedek yok".into()));
    }
    let keys = ctx.layout.op_keys(op_id);
    let temp_key = keys.join(format!("{KEY_NAME}.tksec.gecici"));
    let plain = dir.join("db.dump.geri");
    // Önceki (ölmüş) denemenin düz artıkları önce gider.
    fs.remove_file(&temp_key).map_err(|x| e(x.to_string()))?;
    fs.remove_file(&plain).map_err(|x| e(x.to_string()))?;
    let wrapped = fs.read(&keys.join(format!("{KEY_NAME}.tksec.dpapi"))).map_err(|x| e(format!("geçici anahtar okunamadı: {x}")))?;
    let secret = ctx.env.protect.unprotect(&wrapped).map_err(|x| e(format!("geçici anahtar açılamadı: {x}")))?;
    fs.write_atomic(&temp_key, &secret).map_err(|x| e(x.to_string()))?;
    let rt = Runtime::of(tools_dir);
    let decrypted = tools::backup_decrypt(ctx.env, &rt, &enc, &plain, &temp_key, ctx.settings.backup_timeout());
    let _ = fs.remove_file(&temp_key);
    decrypted.map_err(e)?;
    tools::pg_restore_list(ctx.env, ctx.backend, &plain).map_err(e)?;
    tools::restore_db(ctx.env, ctx.backend, &plain, ctx.settings.backup_timeout()).map_err(e)?;
    let _ = fs.remove_file(&plain);
    if let Some(before) = expect {
        let now = tools::migration_count(ctx.env, ctx.backend).map_err(|m| e(format!("geri yükleme sonrası ölçülemedi: {m}")))?;
        if now != before {
            return Err(e(format!("geri yüklenen DB'nin göç sayısı {now:?}, beklenen {before:?}")));
        }
    }
    Ok(())
}

impl BackendOp {
    fn criteria(&self, version: &str, license: bool) -> Criteria {
        Criteria { version: version.to_string(), require_license: license, baseline: self.plan.license_before.clone() }
    }

    fn health(&self, ctx: &Ctx, version: &str, license: bool) -> Result<Value, StepError> {
        health::wait_healthy(ctx.env, ctx.backend.port, &self.criteria(version, license), ctx.settings.health_timeout())
            .map(|h| json!({ "surum": h.version, "lisans": h.license }))
            .map_err(|(code, m)| step_err(code, m))
    }

    fn migrate(&self, ctx: &Ctx) -> Result<Value, StepError> {
        let rt = Runtime::of(&self.plan.new_target);
        let out = tools::migrate_deploy(ctx.env, &rt, &self.plan.new_target, ctx.backend, ctx.settings.migrate_timeout())
            .map_err(|m| step_err(codes::GOC_HATASI, m))?;
        if out.timed_out {
            return Err(step_err(
                codes::GOC_ZAMAN_ASIMI,
                format!("migrate deploy {} sn'de bitmedi", ctx.settings.migrate_timeout().as_secs()),
            ));
        }
        if !out.ok() {
            return Err(step_err(codes::GOC_HATASI, tools::describe_failure("migrate deploy", &out)));
        }
        let after = tools::migration_count(ctx.env, ctx.backend)
            .map_err(|m| step_err(codes::GOC_HATASI, format!("göç sonrası ölçülemedi: {m}")))?;
        Ok(json!({ "gocSonra": after }))
    }

    fn restart_backend(&self, ctx: &Ctx, args: &[&str]) -> Result<(), StepError> {
        stop_service(ctx, ctx.settings.backend_service(), codes::HIZMET_YOK, codes::HIZMET_DURMADI)?;
        start_service(ctx, ctx.settings.backend_service(), args, codes::HIZMET_BASLAMADI)
    }

    /// Göç DB'yi değiştirmiş olabilir mi? Ölçülemiyorsa EVET (fail-closed: geri yükle).
    fn db_changed(&self, ctx: &Ctx, view: &OpView) -> bool {
        let Some(before) = self.plan.migrations_before else { return true };
        if let Some(after) =
            view.step_data("GOC").and_then(|d| d.get("gocSonra")).and_then(|a| serde_json::from_value::<MigrationCount>(a.clone()).ok())
        {
            return after != before;
        }
        tools::migration_count(ctx.env, ctx.backend) != Ok(before)
    }

    fn commit(&self, ctx: &Ctx, view: &OpView) -> Result<Value, StepError> {
        let fs = ctx.env.fs.as_ref();
        let after =
            view.step_data("GOC").and_then(|d| d.get("gocSonra")).and_then(|a| serde_json::from_value::<MigrationCount>(a.clone()).ok());
        let rec = InstallRecord {
            op_id: &self.plan.op_id,
            kind: "KURULUM",
            now_ms: ctx.env.clock.now_ms(),
            started_ms: self.plan.started_ms,
            commit: self.plan.commit.as_deref(),
            package_hex: self.plan.package_hex.as_deref(),
            previous: Some(&self.plan.source_version),
            new: &self.plan.version,
            migrations_before: self.plan.migrations_before.map(|m| m.finished),
            migrations_after: after.map(|m| m.finished),
            data_encrypted: true,
        };
        history::append(fs, ctx.layout, &rec).map_err(|x| step_err(codes::IC_HATA, format!("kurulum kaydı yazılamadı: {x}")))?;
        self.prune(ctx);
        Ok(json!({ "kurulumKaydi": true }))
    }

    /// Budama (en iyi çaba): `current` + bir önceki sürüm kalır; son 3 güncelleme yedeği; yalnız bu işlemin anahtarı.
    fn prune(&self, ctx: &Ctx) {
        let fs = ctx.env.fs.as_ref();
        let keep: Vec<String> = [&self.plan.new_target, &self.plan.previous_target]
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect();
        for name in fs.list(&ctx.layout.versions()).unwrap_or_default() {
            let stale_staging = name.starts_with(".hazirlik-");
            if stale_staging || (crate::version::parse(&name).is_some() && !keep.contains(&name)) {
                let _ = fs.remove_dir_all(&ctx.layout.versions().join(&name));
            }
        }
        let mut backups: Vec<(String, String)> = fs
            .list(&ctx.layout.update_backups())
            .unwrap_or_default()
            .into_iter()
            .map(|n| {
                let at = fs
                    .read(&ctx.layout.update_backup_dir(&n).join("yedek.json"))
                    .ok()
                    .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                    .and_then(|v| v.get("zaman").and_then(Value::as_str).map(str::to_string))
                    .unwrap_or_default();
                (at, n)
            })
            .collect();
        backups.sort();
        let excess = backups.len().saturating_sub(3);
        for (_, n) in backups.into_iter().take(excess) {
            if n != self.plan.op_id {
                let _ = fs.remove_dir_all(&ctx.layout.update_backup_dir(&n));
            }
        }
        for n in fs.list(&ctx.layout.keys_root()).unwrap_or_default() {
            if n != self.plan.op_id {
                let _ = fs.remove_dir_all(&ctx.layout.op_keys(&n));
            }
        }
    }
}

impl Operation for BackendOp {
    fn op_id(&self) -> &str {
        &self.plan.op_id
    }
    fn product(&self) -> &'static str {
        "backend"
    }
    fn source(&self) -> &str {
        &self.plan.source_version
    }
    fn target(&self) -> &str {
        &self.plan.version
    }
    fn approval_id(&self) -> Option<&str> {
        self.plan.approval_id.as_deref()
    }
    fn steps(&self) -> &'static [&'static str] {
        BACKEND_STEPS
    }
    fn rollback_if_interrupted(&self, step: &str) -> bool {
        // Yarım göç: DB'nin hangi hâlde kaldığı bilinmez — yedekten dönülür, sonraki niyet yeniden dener.
        step == "GOC"
    }

    fn run_step(&self, ctx: &Ctx, view: &OpView, step: &str) -> Result<Value, StepError> {
        match step {
            "BACKEND_DURDUR" => {
                stop_service(ctx, ctx.settings.backend_service(), codes::HIZMET_YOK, codes::HIZMET_DURMADI).map(|()| Value::Null)
            }
            "YEDEK" => take_backup(ctx, &self.plan.op_id, &self.plan.tools_dir),
            "GECIS" => switch_link(ctx, &ctx.layout.current(), &self.plan.new_target, codes::GECIS_HATASI).map(|()| Value::Null),
            "GOC" => self.migrate(ctx),
            "DOGRULAMA" => {
                self.restart_backend(ctx, &[contract::VERIFY_ARG])?;
                self.health(ctx, &self.plan.version, true)
            }
            "BASLAT" => {
                self.restart_backend(ctx, &[])?;
                self.health(ctx, &self.plan.version, true)
            }
            "ONAY" => self.commit(ctx, view),
            other => Err(step_err(codes::IC_HATA, format!("bilinmeyen adım {other}"))),
        }
    }

    fn has_compensation(&self, step: &str) -> bool {
        matches!(step, "BACKEND_DURDUR" | "GECIS" | "GOC" | "DOGRULAMA" | "BASLAT")
    }

    fn compensate(&self, ctx: &Ctx, view: &OpView, step: &str) -> Result<Value, StepError> {
        match step {
            "BASLAT" | "DOGRULAMA" => {
                stop_service(ctx, ctx.settings.backend_service(), codes::HIZMET_YOK, codes::HIZMET_DURMADI).map(|()| Value::Null)
            }
            "GOC" => {
                if self.db_changed(ctx, view) {
                    ctx.log.warn(&format!(
                        "işlem {}: göç DB'yi değiştirdi (ya da ölçülemedi) — güncelleme öncesi yedekten geri yükleniyor",
                        self.plan.op_id
                    ));
                    restore_backup(ctx, &self.plan.op_id, &self.plan.tools_dir, self.plan.migrations_before)
                        .map(|()| json!({ "geriYuklendi": true }))
                } else {
                    Ok(json!({ "geriYuklendi": false }))
                }
            }
            "GECIS" => switch_link(ctx, &ctx.layout.current(), &self.plan.previous_target, codes::GECIS_HATASI).map(|()| Value::Null),
            "BACKEND_DURDUR" => {
                start_service(ctx, ctx.settings.backend_service(), &[], codes::GERI_DONUS_SAGLIKSIZ)?;
                self.health(ctx, &self.plan.source_version, false).map(|_| Value::Null).map_err(|e| {
                    step_err(codes::GERI_DONUS_SAGLIKSIZ, format!("önceki sürüm sağlıklı başlamadı: {} {}", e.code, e.message))
                })
            }
            _ => Ok(Value::Null),
        }
    }

    fn after_result(&self, ctx: &Ctx, view: &OpView, outcome: &OpOutcome) {
        let fs = ctx.env.fs.as_ref();
        let (result, code) = match outcome {
            OpOutcome::Succeeded => (crate::ipc::State::Succeeded, None),
            OpOutcome::RolledBack(e) => (crate::ipc::State::RolledBack, Some(e.code.to_string())),
            OpOutcome::Failed(e) => (crate::ipc::State::Failed, Some(e.code.to_string())),
        };
        let after =
            view.step_data("GOC").and_then(|d| d.get("gocSonra")).and_then(|a| serde_json::from_value::<MigrationCount>(a.clone()).ok());
        if !matches!(outcome, OpOutcome::Succeeded) && view.began("GECIS") {
            let rec = InstallRecord {
                op_id: &self.plan.op_id,
                kind: "GERI_ALMA",
                now_ms: ctx.env.clock.now_ms(),
                started_ms: self.plan.started_ms,
                commit: None,
                package_hex: None,
                previous: Some(&self.plan.version),
                new: &self.plan.source_version,
                migrations_before: after.map(|m| m.finished),
                migrations_after: self.plan.migrations_before.map(|m| m.finished),
                data_encrypted: true,
            };
            if let Err(e) = history::append(fs, ctx.layout, &rec) {
                ctx.log.warn(&format!("geri alma kaydı yazılamadı: {e}"));
            }
        }
        let restored = view
            .records
            .iter()
            .any(|r| r.kind == Kind::CompEnd && r.step.as_deref() == Some("GOC") && r.data.get("geriYuklendi") == Some(&Value::Bool(true)));
        let line = crate::ipc::HistoryLine {
            v: 1,
            op_id: self.plan.op_id.clone(),
            approval_id: self.plan.approval_id.clone(),
            product: "backend".into(),
            backend_target: None,
            source_version: self.plan.source_version.clone(),
            version: self.plan.version.clone(),
            result,
            error_code: code.as_deref().map(|c| codes::report_code(c).to_string()),
            detail_code: code,
            data_restored: restored,
            started: timefmt::iso_millis(self.plan.started_ms),
            finished: ctx.now_iso(),
            migrations: crate::ipc::MigrationCounts {
                before: self.plan.migrations_before.map(|m| m.finished),
                after: after.map(|m| m.finished),
            },
            backup: view.ended("YEDEK").then(|| self.plan.op_id.clone()),
            approval: self.plan.approval.clone(),
        };
        if let Err(e) = crate::ipc::append_history(fs, ctx.layout, &line) {
            ctx.log.warn(&format!("geçmiş satırı yazılamadı: {e}"));
        }
    }
}
