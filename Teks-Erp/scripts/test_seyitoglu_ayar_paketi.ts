// =============================================================================
// SEYİTOĞLU AYAR PAKETİ — BEKÇİ (2026-10-31, SY-L1 + SY-I1; TASARIM §13, §10, §15.1)
// =============================================================================
// `scripts/seyitoglu-ayar-paketi.ts` varsayılan KURU KOŞUDUR: listeler, yazmaz.
//   ① SAF — kurulum planı (sebep · vardiya · salon) VAR olanı yaratmaz, fabrikanın kendi
//      vardiyası varsa vardiya eklemez; paket anahtar/alan tekil, hizmet paketiyle çakışmaz.
//   ② CANLI — kuru koşu ayar + audit + sebep + vardiya + istasyon parmak izini değiştirmez;
//      her ayarı eski → yeni ve her kurulum satırını listeler; kodda olmayan ayarı
//      "ayar sonraki dilimde" diye RAPORLAR (sessizce düşürmez).
//   ③ KULLANIM — `--apply` kullanıcısız / bilinmeyen argüman çıkış 2, yazım 0.
//   ④ UYGULAMA — sebep yazım yolu servis üzerinden (audit), ikinci plan EXISTS (idempotent).
// Koşum: DATABASE_URL=<test DB> npx tsx scripts/test_seyitoglu_ayar_paketi.ts
// NEGATİF SONDA — 2026-10-31: kuru koşu dalına `systemSetting.updateMany` + rapordan "ayar sonraki
// dilimde" silindi + vardiya SKIP dalı kapatıldı → 14/4, §1c · §2c · §2e · §3c kırmızı (taban 18/0); cp ile geri alındı.
// SY-F3K §2g: paketten `kk1.weightEntryEnabled` satırı silinince §2g ❌ (3/4); geri alındı.
// =============================================================================
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { HIZMET_AYAR_PAKETI } from "./hizmet-ayar-paketi";
import { SEYITOGLU_SETTINGS } from "./seyitoglu-ayar-paketi";
import {
  applySetup,
  planSetup,
  planSetupFromDb,
  SEYITOGLU_SHIFTS,
  SEYITOGLU_STOP_REASONS,
  type SetupState,
  type StopReasonSeed,
} from "./lib/seyitoglu-kurulum-verisi";
import { testActorId } from "./fixture-test-user";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0,
  fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

const SCRIPT = path.join(__dirname, "seyitoglu-ayar-paketi.ts");

function run(args: string[]): { code: number | null; out: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { env: process.env, encoding: "utf8", timeout: 180_000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

async function fingerprint(): Promise<string> {
  const settings = await prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
  const reasons = await prisma.reasonPreset.findMany({ orderBy: [{ kind: "asc" }, { code: "asc" }] });
  const shifts = await prisma.shiftDefinition.findMany({ orderBy: { code: "asc" } });
  const stations = await prisma.station.count();
  const logs = await prisma.systemLog.count();
  return JSON.stringify({ settings, reasons, shifts, stations, logs });
}

const slug = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const fold = (s: string): string => s.toLowerCase();

function state(p: Partial<SetupState>): SetupState {
  return {
    stopReasonCodes: new Set(),
    stopReasonLabelsFolded: new Set(),
    systemCatalogMissing: [],
    activeShiftCount: 0,
    shiftCodes: new Set(),
    activeWeavingHallCount: 0,
    ...p,
  };
}

async function main(): Promise<void> {
  // ── §1 SAF ──
  const empty = planSetup(state({ systemCatalogMissing: ["X"] }), slug, fold);
  check(
    "§1a boş fabrikada sebep + vardiya + salon CREATE, eksik sistem kataloğu MISSING",
    empty.filter((r) => r.action === "CREATE").length === SEYITOGLU_STOP_REASONS.length + SEYITOGLU_SHIFTS.length + 1 &&
      empty.find((r) => r.group === "REASON_CATALOG")?.action === "MISSING",
    empty.map((r) => r.action).join(","),
  );
  const full = planSetup(
    state({
      stopReasonCodes: new Set([slug(SEYITOGLU_STOP_REASONS[0].label)]),
      stopReasonLabelsFolded: new Set([fold(SEYITOGLU_STOP_REASONS[1].label)]),
      activeShiftCount: SEYITOGLU_SHIFTS.length,
      shiftCodes: new Set(SEYITOGLU_SHIFTS.map((s) => s.code)),
      activeWeavingHallCount: 2,
    }),
    slug,
    fold,
  );
  check("§1b her şey varken (kod ya da ad eşleşmesi) CREATE yok", full.every((r) => r.action === "EXISTS"), full.map((r) => r.action).join(","));
  const ownShifts = planSetup(state({ activeShiftCount: 2 }), slug, fold).filter((r) => r.group === "SHIFT");
  check("§1c fabrikanın kendi vardiyası varsa paket vardiya EKLEMEZ (SKIP)", ownShifts.every((r) => r.action === "SKIP"), ownShifts.map((r) => r.action).join(","));
  const keys = SEYITOGLU_SETTINGS.map((p) => p.anahtar);
  const fields = SEYITOGLU_SETTINGS.map((p) => p.alan);
  check("§1d paket anahtarları ve alanları tekil", new Set(keys).size === keys.length && new Set(fields).size === fields.length);
  // Fabrika türünden bağımsız kimlik ayarı iki pakette de bilerek aynı değerle durur (2026-11-01).
  const ORTAK_BILEREK = new Set(["auth.trustedDeviceDays", "auth.rememberLastUser"]);
  const shared = keys.filter((k) => !ORTAK_BILEREK.has(k) && HIZMET_AYAR_PAKETI.some((h) => h.anahtar === k));
  check("§1e hizmet paketiyle ortak anahtar yok (beyanlı kimlik ayarı hariç)", shared.length === 0, shared.join(","));
  const ortakFark = [...ORTAK_BILEREK].filter(
    (k) => JSON.stringify(SEYITOGLU_SETTINGS.find((p) => p.anahtar === k)?.hedef) !== JSON.stringify(HIZMET_AYAR_PAKETI.find((p) => p.anahtar === k)?.hedef),
  );
  check("§1e' beyanlı ortak anahtar iki pakette aynı hedefte", ortakFark.length === 0, ortakFark.join(","));

  // ── §2 CANLI kuru koşu ── §4 YAZAR → fixture DB (_test) zorunlu.
  const block = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (block) {
    check("§2 hedef DB test DB'si", false, block);
    return;
  }
  const { SETTING_KEYS } = await import("../src/services/system-setting.service");
  const known = new Set<string>(Object.values(SETTING_KEYS));
  const before = await fingerprint();
  const dry = run([]);
  check("§2a kuru koşu çıkış 0", dry.code === 0, `kod=${dry.code} ${dry.out.split("\n").slice(-3).join(" | ")}`);
  check("§2b kuru koşu 'yazılan 0' diyor", /KURU KOŞU — \d+ ayar değişecekti, \d+ kurulum kaydı yaratılacaktı; yazılan 0/.test(dry.out));
  check("§2c kuru koşu sonrası ayar + audit + sebep + vardiya + istasyon parmak izi AYNI", (await fingerprint()) === before);
  const listed = SEYITOGLU_SETTINGS.filter((p) => dry.out.includes(p.anahtar)).length;
  check("§2d kuru koşu paketin HER ayarını listeliyor", listed === SEYITOGLU_SETTINGS.length, `${listed}/${SEYITOGLU_SETTINGS.length}`);
  const absent = SEYITOGLU_SETTINGS.filter((p) => !known.has(p.anahtar));
  const reported = absent.filter((p) => new RegExp(`ANAHTAR_YOK +${p.anahtar.replace(/\./g, "\\.")}:.*ayar sonraki dilimde: ${p.dilim}`).test(dry.out));
  check(
    "§2e kodda olmayan her ayar 'ayar sonraki dilimde' diye raporlanıyor",
    reported.length === absent.length,
    `${reported.length}/${absent.length} (${absent.map((p) => p.anahtar).join(", ") || "hepsi kodda"})`,
  );
  // SY-F3K (sunum provası 2026-11-01): KK1 doğuşu + levent bağı + otomatik tüketim + KK1 kg girişi pakette, kodda VAR.
  const provaKeys: Array<[string, unknown]> = [
    ["dokuma.rollBirth", "KK1_LABEL_OR_ORDER"],
    ["devere.mountTracking", true],
    ["devere.autoConsume", true],
    ["kk1.weightEntryEnabled", true],
  ];
  const provaListed = provaKeys.filter(([k, v]) => known.has(k) && dry.out.split("\n").some((l) => !l.includes("ANAHTAR_YOK") && l.includes(`${k}:`) && l.endsWith(`→ ${JSON.stringify(v)}`)));
  check("§2g kuru koşu KK1 doğuşu + devere bağı/tüketimi + KK1 kg girişini hedef değerle listeliyor", provaListed.length === provaKeys.length, `${provaListed.length}/${provaKeys.length}`);
  const setupListed = [...SEYITOGLU_STOP_REASONS.map((r) => r.label), ...SEYITOGLU_SHIFTS.map((s) => s.name), "Dokuma Salonu"].filter(
    (l) => dry.out.includes(l),
  );
  check("§2f kuru koşu sebep + vardiya + salon satırlarını listeliyor", setupListed.length === SEYITOGLU_STOP_REASONS.length + SEYITOGLU_SHIFTS.length + 1);

  // ── §3 KULLANIM ──
  check("§3a --apply kullanıcısız → çıkış 2", run(["--apply"]).code === 2);
  check("§3b bilinmeyen argüman → çıkış 2", run(["--uygula"]).code === 2);
  check("§3c kullanım hatalarından sonra parmak izi AYNI", (await fingerprint()) === before);

  // ── §4 UYGULAMA yolu — test sebebiyle (vardiya/salon ortak DB'de başka bekçileri etkilerdi) ──
  const stamp = Date.now().toString(36).toUpperCase();
  const seed: StopReasonSeed[] = [{ label: `TEST SYL1 ${stamp}`, stopLossClass: "UNPLANNED" }];
  const rows = (await planSetupFromDb(seed, [])).filter((r) => r.group === "REASON");
  check("§4a test sebebi CREATE planında", rows.length === 1 && rows[0].action === "CREATE");
  const logBefore = await prisma.systemLog.count();
  try {
    const written = await applySetup(rows, await testActorId(), seed, []);
    check("§4b bir kayıt yazıldı", written === 1, `yazılan=${written}`);
    const again = (await planSetupFromDb(seed, [])).filter((r) => r.group === "REASON");
    check("§4c ikinci plan EXISTS (idempotent)", again[0]?.action === "EXISTS", again[0]?.action);
    check("§4d audit satırı yazıldı (servis yolu)", (await prisma.systemLog.count()) > logBefore);
  } finally {
    await prisma.reasonPreset.deleteMany({ where: { kind: "MACHINE_STOP", label: seed[0].label } });
  }
}

main()
  .catch((e) => {
    fail++;
    console.error(`❌ beklenmeyen hata: ${(e as Error).message}`);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
  });
