// =============================================================================
// Bekçi: ALARM DÜRTMESİ BİRLEŞİR (perf B-02) — DB'siz
// Çalıştır: npx tsx scripts/test_loom_alarm_durtme.ts
// =============================================================================
// Makine sinyali akışında her duruş yazımı motoru dürter; dürtmeler tek kuyrukta birleşir:
// son dürtmeden `debounce` sonra tek tur, ama ilk dürtmeden `maxWait`ten geç değil.
//   §1 saf gecikme hesabı (`nudgeDelayMs`) — sessizlik penceresi, tavan kırpması, negatif yok
//   §2 birleştirici: 200 ardışık dürtme → tek tur · kesintisiz akışta en geç tavanla tur · tur sonrası yeni pencere
//   §3 motor sabitleri: debounce ≤ tavan ≤ 30 sn kadansı; `nudgeLoomAlarm` birleştiriciden geçer (doğrudan `tick()` yok)
// Negatif sondalar (kırmızı görüldü, geri alındı): `nudgeDelayMs` tavanı yok saydı (`return debounceMs`) → §1b+§1c+§2b ·
// `nudge()` önceki zamanlayıcıyı silmedi → §2a+§2b+§2d (200 tur) · `nudgeLoomAlarm` gövdesi `tick()` → §3b.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createNudgeCoalescer, nudgeDelayMs } from "../src/jobs/nudge-coalescer";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

/** Sahte saat + zamanlayıcı: `ilerle(ms)` vadesi gelen zamanlayıcıları sırayla çalıştırır. */
function sahteSaat() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (h: unknown) => { timers.delete(h as number); },
    ilerle(ms: number) {
      const hedef = t + ms;
      for (;;) {
        const sirada = [...timers.entries()].filter(([, v]) => v.at <= hedef).sort((a, b) => a[1].at - b[1].at)[0];
        if (!sirada) break;
        timers.delete(sirada[0]);
        t = sirada[1].at;
        sirada[1].fn();
      }
      t = hedef;
    },
    bekleyen: () => timers.size,
  };
}

console.log("\n=== Alarm dürtmesi birleşir (B-02) ===");
console.log("\n§1 — saf gecikme");
check("§1a ilk dürtme: sessizlik penceresi", nudgeDelayMs(1000, 1000, 2000, 5000) === 2000);
check("§1b tavana yaklaşınca kalan süreyle kırpılır", nudgeDelayMs(4000, 1000, 2000, 5000) === 2000 && nudgeDelayMs(5000, 1000, 2000, 5000) === 1000);
check("§1c tavan geçmişse hemen (negatif yok)", nudgeDelayMs(9000, 1000, 2000, 5000) === 0);

console.log("\n§2 — birleştirici");
{
  const s = sahteSaat();
  let tur = 0;
  const c = createNudgeCoalescer({ debounceMs: 2000, maxWaitMs: 5000, fire: () => { tur++; }, now: s.now, setTimer: s.setTimer, clearTimer: s.clearTimer });
  for (let i = 0; i < 200; i++) c.nudge();
  check("§2a 200 ardışık dürtme tek zamanlayıcıda birleşir", s.bekleyen() === 1 && tur === 0 && c.pending());
  s.ilerle(2000);
  check("§2a' sessizlikten sonra TEK tur", tur === 1 && !c.pending(), `tur=${tur}`);

  // Kesintisiz akış: her 500 ms bir dürtme, 12 sn — tavan sayesinde tur ≥ 2, ve her tur ≤ 5 sn arayla.
  const s2 = sahteSaat();
  const anlar: number[] = [];
  const c2 = createNudgeCoalescer({ debounceMs: 2000, maxWaitMs: 5000, fire: () => anlar.push(s2.now()), now: s2.now, setTimer: s2.setTimer, clearTimer: s2.clearTimer });
  for (let i = 0; i < 24; i++) { c2.nudge(); s2.ilerle(500); }
  check("§2b kesintisiz akışta motor aç kalmaz (tavanla tur)", anlar.length >= 2 && anlar[0] === 5000, anlar.join(","));
  const araliklar = anlar.slice(1).map((a, i) => a - anlar[i]!);
  check("§2c turlar en çok tavan aralığıyla", araliklar.every((d) => d <= 5000), araliklar.join(","));
  c2.cancel();
  check("§2d cancel bekleyen zamanlayıcıyı siler", !c2.pending() && s2.bekleyen() === 0);
}

console.log("\n§3 — motorun bağı (statik)");
{
  const job = readFileSync(join(__dirname, "..", "src", "jobs", "loom-alarm.job.ts"), "utf8");
  const deb = Number(/LOOM_ALARM_NUDGE_DEBOUNCE_MS = (\d+) \* 1000/.exec(job)?.[1]);
  const max = Number(/LOOM_ALARM_NUDGE_MAX_WAIT_MS = (\d+) \* 1000/.exec(job)?.[1]);
  const kadans = Number(/CHECK_INTERVAL_MS = (\d+) \* 1000/.exec(job)?.[1]);
  check("§3a debounce ≤ tavan < kadans (dürtme turdan hızlı)", deb > 0 && deb <= max && max < kadans, `${deb}/${max}/${kadans}`);
  const govde = /export function nudgeLoomAlarm\(\): void \{([\s\S]*?)\n\}/.exec(job)?.[1] ?? "";
  check("§3b nudgeLoomAlarm birleştiriciden geçer, doğrudan tur açmaz", /nudges\.nudge\(\)/.test(govde) && !/\btick\(\)/.test(govde), govde.trim());
}

console.log(`\nSonuç: ${pass} geçti, ${fail} kaldı`);
process.exitCode = fail > 0 ? 1 : 0;
