//! Turlar arası bekleme: süre dolana, durdurma istenene ya da niyet dosyası DEĞİŞENE dek (panelden
//! onay gelince beklemeden tepki verilsin). Niyet 2 sn'de bir okunur (küçük dosya).
use crate::env::Env;
use crate::layout::Layout;
use std::time::Duration;

pub fn until_change_or(env: &Env, layout: &Layout, max: Duration, stop: &dyn Fn() -> bool) {
    let before = env.fs.read(&layout.intent_file()).ok();
    let deadline = env.clock.now_ms() + i64::try_from(max.as_millis()).unwrap_or(i64::MAX);
    while env.clock.now_ms() < deadline {
        if stop() {
            return;
        }
        env.clock.sleep(Duration::from_secs(2));
        if env.fs.read(&layout.intent_file()).ok() != before {
            return;
        }
    }
}
