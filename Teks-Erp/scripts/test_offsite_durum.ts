// =============================================================================
// BEKÇİ — OFFSITE DURUM: "son başarılı kopya" bayatlığı tek kaynaktan, fail-closed
// =============================================================================
// NEDEN VAR: 19.09.2026'da offsite süpürme iki tur DNS'ten düştü; panel yalnız
// SON turu gördüğü için "3 saattir mi 3 gündür mü kopya yok" sorusu cevapsızdı,
// reboot'ta bellek sıfırlanıp "henüz koşmadı" kalıyordu. Karar `offsite-state.helper.ts`
// (saf, DB'siz) + `JobState` satırına taşındı. Bu dosya SAF yüklemi ölçer:
//   §1 hiç başarı yok → bayat (bilinmiyor yeşil sayılmaz)
//   §2 eşik altı → taze · eşik üstü → bayat · sınırda (tam eşik) → taze
//   §3 hedef tanımsızken bayatlık YOK (o ayrı bir kırmızı) ve alanlar boş/0
//   §4 alanlar ISO string + eşik saat cinsinden (panel sözleşmesi)
//   §5 negatif sonda: eşik yarıya inse §2'nin "taze" örneği kırmızıya döner
//      (bekçi gerçekten eşiği ölçüyor, sabiti ezberlemiyor)
//   §6 süpürücü kalıcı satırı yazıyor mu (statik: `recordJobRun(OFFSITE_JOB`)
//   §7 sağlık ucu alanları koyuyor mu (statik: `offsiteStateFields(` çağrısı)
//   §8 `JobState` audit muafiyeti BEYANLI mı (SISTEM_ISI) — sessiz kalamaz
// DB GEREKTİRMEZ. Koşum: npx tsx scripts/test_offsite_durum.ts
// =============================================================================
import fs from "fs";
import path from "path";
import {
  jobStaleness,
  offsiteStateFields,
  OFFSITE_JOB,
  OFFSITE_STALE_AFTER_MS,
  type JobStateSnapshot,
} from "../src/services/helpers/offsite-state.helper";
import { AUDIT_EXEMPT_MODELS } from "./lib/audit-muafiyeti";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail = ""): void {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const H = 60 * 60 * 1000;
const now = new Date("2026-09-22T12:00:00.000Z");
const snap = (over: Partial<JobStateSnapshot>): JobStateSnapshot => ({
  lastRunAt: now, lastOkAt: now, lastError: null, consecutiveFailures: 0, ...over,
});

console.log("=== §1 hiç başarı yok → bayat ===");
{
  const st = jobStaleness(null, OFFSITE_STALE_AFTER_MS, now);
  ok(st.stale && st.ageMs === null, "§1 lastOkAt=null ⇒ stale:true, ageMs:null (fail-closed)");
  const f = offsiteStateFields(null, true, now);
  ok(f.stale && f.lastOkAt === null && f.consecutiveFailures === 0, "§1b satır yok + hedef var ⇒ stale:true, alanlar boş");
}

console.log("=== §2 eşik ===");
{
  const taze = jobStaleness(new Date(now.getTime() - 1 * H), OFFSITE_STALE_AFTER_MS, now);
  ok(!taze.stale && taze.ageMs === 1 * H, "§2a 1 saat önce ⇒ taze");
  const bayat = jobStaleness(new Date(now.getTime() - 7 * H), OFFSITE_STALE_AFTER_MS, now);
  ok(bayat.stale && bayat.ageMs === 7 * H, "§2b 7 saat önce ⇒ bayat");
  const sinir = jobStaleness(new Date(now.getTime() - OFFSITE_STALE_AFTER_MS), OFFSITE_STALE_AFTER_MS, now);
  ok(!sinir.stale, "§2c tam eşikte ⇒ taze (aşınca bayat)");
  const gelecek = jobStaleness(new Date(now.getTime() + 5 * H), OFFSITE_STALE_AFTER_MS, now);
  ok(!gelecek.stale && gelecek.ageMs === 0, "§2d saat ileri alınmış (gelecek) ⇒ ageMs 0'a kırpılır, taze");
}

console.log("=== §3 hedef tanımsız ===");
{
  const f = offsiteStateFields(snap({ lastOkAt: new Date(now.getTime() - 48 * H), consecutiveFailures: 9, lastError: "x" }), false, now);
  ok(!f.stale, "§3 configured:false ⇒ stale:false (48 saat eski olsa da — o ayrı kırmızı)");
  ok(f.consecutiveFailures === 9 && f.lastError === "x", "§3b sayaç/hata yine taşınır (gizlenmez)");
}

console.log("=== §4 sözleşme ===");
{
  const f = offsiteStateFields(snap({ lastOkAt: new Date(now.getTime() - 2 * H), lastRunAt: now }), true, now);
  ok(f.lastOkAt === "2026-09-22T10:00:00.000Z" && f.lastRunAt === "2026-09-22T12:00:00.000Z", "§4a tarihler ISO string");
  ok(f.staleAfterHours === 6, "§4b eşik saat cinsinden = 6", `gelen ${f.staleAfterHours}`);
  ok(OFFSITE_JOB === "offsite-sweep", "§4c iş anahtarı `reportJobFailure` adıyla aynı");
}

console.log("=== §5 negatif sonda (eşik yarıya) ===");
{
  const yarim = OFFSITE_STALE_AFTER_MS / 2;
  const st = jobStaleness(new Date(now.getTime() - 4 * H), yarim, now);
  ok(st.stale, "§5 eşik 3 saate inince 4 saatlik kopya BAYAT sayılır (bekçi eşiği ölçüyor)");
}

console.log("=== §6–§8 statik kollar ===");
{
  const root = path.join(__dirname, "..");
  const sweeper = fs.readFileSync(path.join(root, "src/jobs/offsite-sweeper.ts"), "utf8");
  ok(/recordJobRun\(\s*OFFSITE_JOB/.test(sweeper), "§6 süpürücü `recordJobRun(OFFSITE_JOB, …)` ile kalıcı satırı yazıyor");
  const helper = fs.readFileSync(path.join(root, "src/services/helpers/offsite-backup.helper.ts"), "utf8");
  ok((helper.match(/offsiteStateFields\(/g) ?? []).length >= 2, "§7 sağlık ucu iki dalda da (henüz-koşmadı · normal) kalıcı alanları koyuyor");
  const beyan = AUDIT_EXEMPT_MODELS.find((m) => m.model === "JobState");
  ok(beyan?.sinif === "SISTEM_ISI", "§8 `JobState` audit muafiyeti SISTEM_ISI olarak beyanlı");
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
