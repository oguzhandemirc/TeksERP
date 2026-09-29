// SENARYO L — L30 (Faz 2d): K2 donmuş modül → şifreli modül AÇILMAZ, çekirdek çalışır. Gerçek satıcı
// CLI'ı modül anahtarını üretip KASAYA alır; ana fabrikanın (C) gerçek kirası anahtarı kurulumun
// X25519'una sarılı taşır ve kurulumun özel yarısıyla açılır → mühürlü paket açılır. Portal K2 sonrası
// yeni kirada anahtar YOK (çekirdek açamaz: MODUL_DONMUS) → paket açılamaz; çekirdek uçları 200.
// Geri alınca anahtar döner. Kasa satırı silinmez: sonda `aktif=false` (emeklilik).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { PG_SESSION_OPTIONS } from "../../src/lib/pg-session";
import { LICENSE_FILES } from "../../src/lib/license/store";
import { tsLicenseCore } from "../../src/lib/license/license-core";
import { openModulePackage, sealModulePackage } from "../../src/lib/license/encrypted-module";
import type { RootKey } from "../../src/lib/license/protocol";
import type { Yanit } from "./senaryo-lisans-istemci";
import { SATICI_KOKU } from "./senaryo-lisans-surec";
import { fixtureHedefEngeli } from "./hedef-db-kapisi";

type Kontrol = (ad: string, ok: boolean, ayrinti?: string) => boolean;
const MODUL = "depo.multiEnabled";

export async function l30ModulOlc(g: {
  readonly kok: string;
  readonly saticiEnv: NodeJS.ProcessEnv;
  readonly saticiDbUrl: string;
  readonly lisansDizini: string;
  readonly capaDosyasi: string;
  readonly yokla: () => Promise<unknown>;
  readonly yaptirim: (govde: Record<string, unknown>) => Promise<Yanit>;
  readonly geriAl: (eylemId: string) => Promise<Yanit>;
  readonly istek: (yontem: string, yol: string) => Promise<Yanit>;
  readonly kontrol: Kontrol;
}): Promise<void> {
  // Kendi havuzunu (satıcı kasası temizliği) kurduğu için hedefi kendisi de sınar: fabrika fikstür DB'si +
  // satıcı yalnız `*_test` (koşucunun kapısı atlanarak doğrudan çağrılırsa da fail-closed).
  const saticiAdi = new URL(g.saticiDbUrl).pathname.replace(/^\//, "");
  const engel = fixtureHedefEngeli() ?? (saticiAdi.endsWith("_test") && !saticiAdi.startsWith("tekserp_fabrika_") ? null : `satıcı hedefi '${saticiAdi}' yalnız *_test olabilir`);
  if (engel) throw new Error(`L30 hedef kapısı: ${engel}`);
  const dizin = fs.mkdtempSync(path.join(g.kok, "modul-anahtari-"));
  // Kasa satırı silinmez ve modül×sürüm tekildir: her koşum kendi sürümüyle (saniye damgası) girer.
  const surum = Math.floor(Date.now() / 1000);
  const cli = (argv: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/modul-anahtari.ts", ...argv], { cwd: SATICI_KOKU, env: g.saticiEnv, encoding: "utf8", timeout: 60_000 });
  const u = cli(["uret", `--modul=${MODUL}`, `--surum=${surum}`, `--dizin=${dizin}`]);
  const dosya = path.join(dizin, `${MODUL}.${surum}.json`);
  const ice = u.status === 0 ? cli(["ice-aktar", `--dosya=${dosya}`]) : u;
  g.kontrol("satıcı CLI: modül anahtarı üretildi (0600) ve kasaya alındı", ice.status === 0 && (fs.statSync(dosya).mode & 0o077) === 0, (ice.stdout || ice.stderr).trim().slice(-160));
  const kayit = JSON.parse(fs.readFileSync(dosya, "utf8")) as { kid: string; anahtar: string };
  const anahtar = Buffer.from(kayit.anahtar, "base64url");
  const paket = sealModulePackage({ code: Buffer.from("module.exports = 'senaryo-l30';"), key: anahtar, modul: MODUL, paket: "depo-multi", surum, kid: kayit.kid });
  const roots = JSON.parse(fs.readFileSync(g.capaDosyasi, "utf8")) as RootKey[];
  const kiradanAc = () => {
    const oku = (ad: string) => fs.readFileSync(path.join(g.lisansDizini, ad), "utf8").trim();
    const x = (JSON.parse(oku(LICENSE_FILES.KEY)) as { x25519: { d: string } | null }).x25519;
    if (!x) return { ok: false as const, code: "SIFRELEME_ANAHTARI_YOK" };
    return tsLicenseCore.unwrapLeaseModuleKey({ lease: oku(LICENSE_FILES.LEASE), entitlement: oku(LICENSE_FILES.ENTITLEMENT), privateKeyX: x.d, modul: MODUL, kid: kayit.kid, roots });
  };
  try {
    await g.yokla();
    const once = kiradanAc();
    const acilan = once.ok ? openModulePackage(paket, Buffer.from(once.value.anahtar, "base64url")) : null;
    g.kontrol("ana (C) kirası anahtarı kurulumun X25519'una sarılı taşır → şifreli paket açılır", acilan?.code.toString() === "module.exports = 'senaryo-l30';", once.ok ? "" : once.code);
    const k2 = await g.yaptirim({ kademe: "K2", moduller: [MODUL] });
    g.kontrol("portal K2 [depo.multiEnabled] → 201", k2.status === 201, `${k2.status} ${k2.kod ?? ""}`);
    await g.yokla();
    const sonra = kiradanAc();
    g.kontrol("K2 sonrası kirada anahtar YOK → çekirdek açamaz (MODUL_DONMUS), şifreli modül açılmaz", !sonra.ok && sonra.code === "MODUL_DONMUS", sonra.ok ? "açtı" : sonra.code);
    const siparis = await g.istek("GET", "/api/orders");
    const saglik = await g.istek("GET", "/api/feature-flags");
    g.kontrol("çekirdek çalışır: GET /api/orders + /api/feature-flags → 200", siparis.status === 200 && saglik.status === 200, `${siparis.status}/${saglik.status}`);
    const geri = await g.geriAl(String(k2.veri.id));
    await g.yokla();
    const donus = kiradanAc();
    g.kontrol("K2 geri alınınca anahtar kiraya döner", geri.status === 201 && donus.ok, donus.ok ? "" : donus.code);
  } finally {
    const pool = new Pool({ connectionString: g.saticiDbUrl, options: PG_SESSION_OPTIONS });
    await pool.query(`UPDATE modul_anahtari SET aktif = false, "updatedAt" = now() WHERE kid = $1`, [kayit.kid]).catch(() => undefined);
    await pool.end().catch(() => undefined);
    anahtar.fill(0);
    fs.rmSync(dizin, { recursive: true, force: true });
  }
}
