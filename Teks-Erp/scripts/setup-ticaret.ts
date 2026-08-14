// =============================================================================
// TİCARET KURULUMU — BOOTSTRAP (veri ÜRETMEYEN)
// =============================================================================
// Reçete:  docs/ops/TICARET-KURULUM.md   (bu betik oranın §1 · §2 · §3'ünü yapar)
//
//   npx tsx scripts/setup-ticaret.ts --user <kullanıcı>                 → KURU ANLATIM
//   npx tsx scripts/setup-ticaret.ts --user <kullanıcı> --apply         → uygular (onay sorar)
//   npx tsx scripts/setup-ticaret.ts --user <kullanıcı> --apply --yes   → etkileşimsiz
//   … [--actor <kullanıcı>]   denetim izinde görünecek aktör (varsayılan: admin, yoksa hedef)
//
// ── NE YAPAR (üç adım, hepsi idempotent) ─────────────────────────────────────
//   1) `finance.enabled`        → true   (ön muhasebe modülü)
//   2) `finance.pricingEnabled` → true   (operasyon ekranlarında fiyat/para birimi)
//   3) `WEB_TRADE` yetki şablonunu verilen kullanıcıya MERGE eder
//   4) Varsayılan depoyu garantiler (`ensureDefaultWarehouse`)
//
// ── NE YAPMAZ (ve bu bilinçlidir) ────────────────────────────────────────────
// • VERİ ÜRETMEZ: fatura, tahsilat, çek, top, sipariş, cari kart YOK. Demo verisi
//   isteniyorsa `npm run seed:ticaret-demo` (o DB-adı kapılıdır ve öyle kalmalı).
// • KASA/BANKA HESABI AÇMAZ. Hesap adı ("Merkez Kasa" / "Ziraat TL") bir İŞLETME
//   kararıdır ve uydurulmuş bir ad sonradan düzeltilse bile ekstre/fiş geçmişinde
//   kalır. Reçete onu panelden yaptırır (§4) — açılış bakiyeleriyle birlikte.
// • HİÇBİR ŞEYİ GERİ ALMAZ: bayrak kapatmaz, izin sökmez, kayıt silmez. Tek yön.
//
// ── DB-ADI KAPISI YOKTUR (bilinçli) ──────────────────────────────────────────
// `seed-ticaret-demo.ts` adında 'demo'/'ticaret' geçmeyen veritabanında başlamadan
// çıkar; çünkü o VERİ ÜRETİR. Bu betik GERÇEK müşteri DB'sinde koşmak için vardır,
// dolayısıyla aynı kapı burada özelliği tümden kullanılamaz yapardı. Korumanın
// yerini üç şey alır: (a) varsayılan KURU ANLATIM, (b) `--apply` öncesi bağlanılan
// veritabanı adını da basan onay adımı, (c) yıkıcı yüzeyin hiç olmaması.
//
// ── ÖN KONTROLLER YAZMA ÖNCESİ KOŞAR ─────────────────────────────────────────
// Kullanıcı yoksa/silinmişse ya da `WEB_TRADE` şablonu DB'de yoksa HİÇBİR ŞEY
// yazılmaz. Gerekçe: yarım uygulanmış kurulum — bayraklar açık, kullanıcı yetkisiz —
// tam olarak bu reçetenin önlemeye çalıştığı sessiz hâldir ("ekran deploy edildi,
// kimse açamıyor"). Tekrar koşmak idempotent olduğu için bedava.
// =============================================================================
import { createInterface } from "node:readline";
import prisma, { pool } from "../src/lib/prisma";
import { systemSettingService } from "../src/services/system-setting.service";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";

/** Ticaret kurulumunun yetki paketi — `constants/role-template-catalog.ts` ile aynı kod. */
export const TRADE_TEMPLATE_CODE = "WEB_TRADE";

export type StepKey =
  | "finance.enabled"
  | "finance.pricingEnabled"
  | "role:WEB_TRADE"
  | "warehouse:default";

/**
 * `yapılacak` yalnız KURU ANLATIM'da, `yapıldı`/`atlandı` yalnız `--apply`'da çıkar.
 * İdempotentliğin ölçüsü budur: ikinci `--apply` koşumunda hepsi `atlandı` olmalı.
 */
export type StepStatus = "yapıldı" | "atlandı" | "yapılacak";

export interface SetupStep {
  key: StepKey;
  title: string;
  status: StepStatus;
  detail: string;
}

export interface SetupReport {
  apply: boolean;
  /** Bağlanılan veritabanı — onay ekranında da basılır (yanlış DB'ye koşmanın panzehiri). */
  database: string;
  username: string;
  actorUsername: string;
  steps: SetupStep[];
  /**
   * Kullanıcıda OLMAYAN `WEB_TRADE` izin kodları — **SON DURUM**.
   * Kuru anlatımda "eklenecek"; `--apply` sonrası **boş OLMALIDIR** (dolu ise
   * merge yarım kalmıştır ve rapor bunu söyler).
   */
  missingPermissionCodes: string[];
  /** Satırı VAR ama süresi geçmiş/henüz başlamamış izinler — merge onları ATLAR (aşağıdaki nota bak). */
  timeLimitedPermissionCodes: string[];
}

export class SetupTicaretError extends Error {}

// -----------------------------------------------------------------------------
// Yardımcılar
// -----------------------------------------------------------------------------

/** Bağlanılan veritabanının adı. `new URL` — elle string kesmek `?schema=` ve
 *  kullanıcı adındaki `@` hallerinde sessizce yanlış ad üretir. */
export function currentDatabaseName(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new SetupTicaretError("DATABASE_URL tanımsız — .env dosyasını kontrol edin.");
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

function step(key: StepKey, title: string, status: StepStatus, detail: string): SetupStep {
  return { key, title, status, detail };
}

// -----------------------------------------------------------------------------
// Çekirdek — CLI'dan bağımsız (bekçi bunu doğrudan çağırır)
// -----------------------------------------------------------------------------

export interface SetupOptions {
  /** Yetki paketinin verileceği kullanıcının `username`'i. */
  username: string;
  /** Denetim izinde "kim yaptı" — varsayılan `admin`, o da yoksa hedef kullanıcı. */
  actorUsername?: string;
  /** `false` (varsayılan) → TEK BAYT YAZILMAZ. */
  apply: boolean;
}

/**
 * Ticaret kurulumunu planlar (ve `apply` ise uygular).
 *
 * ⚠️ `apply=false` iken bu fonksiyon HİÇBİR YAZMA çağrısı yapmaz — `setFeatureFlags`,
 * `applyTemplate` ve `ensureDefaultWarehouse` (kendisi de yazar) o dalda hiç
 * çağrılmaz. Bekçi bunu "önce/sonra sayımları eşit" ile ölçer; buraya eklenecek
 * her yeni adımda aynı ayrımı koru.
 */
export async function runTicaretSetup(opts: SetupOptions): Promise<SetupReport> {
  const database = currentDatabaseName();

  // ── ÖN KONTROL 1: hedef kullanıcı ─────────────────────────────────────────
  const user = await prisma.user.findUnique({
    where: { username: opts.username },
    select: { id: true, username: true, fullName: true, isActive: true, deletedAt: true },
  });
  if (!user) {
    throw new SetupTicaretError(
      `'${opts.username}' adlı kullanıcı bulunamadı.\n` +
        "   Önce Yönetim → Yetkilendirme → Kullanıcılar'dan açın, sonra bu betiği tekrar koşun.",
    );
  }
  if (user.deletedAt) {
    throw new SetupTicaretError(
      `'${opts.username}' kullanıcısı KALICI OLARAK SİLİNMİŞ — yetki verilemez. Yeni bir kullanıcı açın.`,
    );
  }
  if (!user.isActive) {
    throw new SetupTicaretError(
      `'${opts.username}' kullanıcısı PASİF. Yetki vermek onu aktifleştirmez ve kullanıcı yine\n` +
        "   giriş yapamaz. Önce panelden aktifleştirin, sonra bu betiği tekrar koşun.",
    );
  }

  // ── ÖN KONTROL 2: yetki şablonu ───────────────────────────────────────────
  // Şablon boot uzlaştırmasıyla (`jobs/role-template-catalog.job.ts`) gelir.
  // Yoksa backend hiç açılmamış demektir; sessizce geçmek kullanıcıyı "giriş
  // yapıyor ama hiçbir ekranı açamıyor" hâlinde bırakırdı.
  const template = await prisma.permissionTemplate.findUnique({
    where: { code: TRADE_TEMPLATE_CODE },
    select: {
      id: true,
      name: true,
      isActive: true,
      permissions: { select: { permissionId: true, permission: { select: { code: true } } } },
    },
  });
  if (!template) {
    throw new SetupTicaretError(
      `'${TRADE_TEMPLATE_CODE}' yetki şablonu bu veritabanında YOK.\n` +
        "   Şablonlar migration'la değil BOOT UZLAŞTIRMASIYLA gelir (kural: kodu deploy etmek =\n" +
        "   rolleri getirmek). Backend'i en az bir kez ayağa kaldırıp kapatın, sonra tekrar koşun.",
    );
  }
  if (!template.isActive) {
    throw new SetupTicaretError(
      `'${template.name}' şablonu PASİF — bu, "bu rolü kullanmıyorum" kararıdır ve betik onu\n` +
        "   kendiliğinden geri açmaz. Yönetim → Yetkilendirme → Yetki Şablonları'ndan geri açın.",
    );
  }

  // ── Aktör ─────────────────────────────────────────────────────────────────
  // Denetim izi "sistem yöneticisi verdi" desin diye önce admin denenir
  // (seed-ticaret-demo emsali); bulunamazsa hedef kullanıcının kendisi.
  const actorName = opts.actorUsername ?? "admin";
  const actor = await prisma.user.findUnique({
    where: { username: actorName },
    select: { id: true, username: true },
  });
  if (opts.actorUsername && !actor) {
    throw new SetupTicaretError(`--actor '${opts.actorUsername}' adlı kullanıcı bulunamadı.`);
  }
  const actorId = actor?.id ?? user.id;
  const actorUsername = actor?.username ?? user.username;

  const steps: SetupStep[] = [];

  // ── 1-2) REJİM BAYRAKLARI ─────────────────────────────────────────────────
  // Zaten `true` olan bayrağa YAZILMAZ: `set()` her çağrıda audit satırı yazar ve
  // feature-flag cache'ini bayatlatır. "Atlandı" hem doğru hem ucuz.
  const flags = (await systemSettingService.getFeatureFlags()).data!;
  // ⚠️ Yük NESNESİ elle yazılır, `{ [alan]: true }` ile ÜRETİLMEZ: hesaplanmış
  // anahtar `Partial<FeatureFlags>`in alan adını kaybettirir ve yanlış yazılan bir
  // anahtar `setFeatureFlags`in `hasOwnProperty` kapılarından SESSİZCE düşerdi
  // (bayrak açılmaz, hata da çıkmaz — `z.object` sessiz allowlist dersinin ikizi).
  const flagPlan: Array<{ key: StepKey; title: string; current: boolean; payload: Parameters<typeof systemSettingService.setFeatureFlags>[0] }> = [
    {
      key: "finance.enabled",
      title: "Ön muhasebe modülü (finance.enabled)",
      current: flags.financeEnabled,
      payload: { financeEnabled: true },
    },
    {
      key: "finance.pricingEnabled",
      title: "Fiyat/para birimi alanları (finance.pricingEnabled)",
      current: flags.pricingEnabled,
      payload: { pricingEnabled: true },
    },
  ];

  for (const f of flagPlan) {
    if (f.current === true) {
      steps.push(step(f.key, f.title, "atlandı", "zaten AÇIK"));
      continue;
    }
    if (!opts.apply) {
      steps.push(step(f.key, f.title, "yapılacak", "KAPALI → AÇILACAK"));
      continue;
    }
    await systemSettingService.setFeatureFlags(f.payload, actorId);
    steps.push(step(f.key, f.title, "yapıldı", "KAPALI → AÇIK"));
  }

  // ── 3) YETKİ ŞABLONU ──────────────────────────────────────────────────────
  const codeById = new Map(template.permissions.map((p) => [p.permissionId, p.permission.code]));
  const templatePermIds = [...codeById.keys()];

  // ⚠️ "VAR" ölçüsü SATIRIN VARLIĞIDIR — `applyTemplate` merge dalı da tam olarak
  // buna bakar. Süre kontrolü eklemek betiği kalıcı olarak idempotentSİZ yapardı
  // (her koşum "eksik" der, merge her koşum atlar). Süreli satırlar ayrıca
  // UYARI olarak raporlanır: merge onları atlar ama kullanıcı izni KULLANAMAZ.
  const owned = await prisma.userPermission.findMany({
    where: { userId: user.id, permissionId: { in: templatePermIds } },
    select: { permissionId: true, validFrom: true, validUntil: true },
  });
  const ownedIds = new Set(owned.map((o) => o.permissionId));
  const now = new Date();
  const timeLimitedPermissionCodes = owned
    .filter((o) => (o.validFrom && o.validFrom > now) || (o.validUntil && o.validUntil < now))
    .map((o) => codeById.get(o.permissionId) ?? o.permissionId)
    .sort();

  const missingIds = templatePermIds.filter((id) => !ownedIds.has(id));
  const idToCode = (ids: readonly string[]) => ids.map((id) => codeById.get(id) ?? id).sort();
  const roleTitle = `Yetki paketi '${template.name}' → ${user.username}`;

  // ⚠️ `missingPermissionCodes` RAPORDA SON DURUMU söyler, "başlangıçta neyi
  // eksiktin"i değil. Uygulama dalında merge'den SONRA yeniden okunur — böylece
  // alan bir de KENDİ KENDİNİ DOĞRULAYAN kontrol olur: merge sessizce yarım
  // kalırsa (şablon satırı arada silinir, FK düşer) rapor "hâlâ eksik" der.
  // Ön-hesaplanan `missingIds` yalnız KAÇ TANE eklendiğini yazmak için kalır.
  let missingPermissionCodes = idToCode(missingIds);

  if (missingIds.length === 0) {
    steps.push(
      step("role:WEB_TRADE", roleTitle, "atlandı", `${templatePermIds.length} iznin tamamı zaten var`),
    );
  } else if (!opts.apply) {
    steps.push(
      step(
        "role:WEB_TRADE",
        roleTitle,
        "yapılacak",
        `${missingIds.length}/${templatePermIds.length} izin EKLENECEK`,
      ),
    );
  } else {
    await PermissionManagementService.applyTemplate(user.id, template.id, "merge", actorId);
    const nowOwned = new Set(
      (
        await prisma.userPermission.findMany({
          where: { userId: user.id, permissionId: { in: templatePermIds } },
          select: { permissionId: true },
        })
      ).map((o) => o.permissionId),
    );
    missingPermissionCodes = idToCode(templatePermIds.filter((id) => !nowOwned.has(id)));
    steps.push(
      step("role:WEB_TRADE", roleTitle, "yapıldı", `${missingIds.length} izin eklendi (merge)`),
    );
  }

  // ── 4) VARSAYILAN DEPO ────────────────────────────────────────────────────
  // ⚠️ `ensureDefaultWarehouse` KENDİSİ YAZAR (yoksa yaratır, varsayılansızsa en
  // eskisini terfi ettirir) → KURU ANLATIM'da ÇAĞRILAMAZ. Kuru dal aynı kararı
  // salt-okunur sorgularla ÖNCEDEN SÖYLER; iki dalın kuralı ayrışırsa betik
  // "yapacağım" dediğinden başkasını yapar.
  const wTitle = "Varsayılan depo";
  const defaultWarehouse = await prisma.warehouse.findFirst({
    where: { isDefault: true },
    select: { id: true, name: true, code: true },
  });
  if (defaultWarehouse) {
    steps.push(
      step("warehouse:default", wTitle, "atlandı", `zaten var: ${defaultWarehouse.name} (${defaultWarehouse.code})`),
    );
  } else if (!opts.apply) {
    const oldest = await prisma.warehouse.findFirst({
      orderBy: { createdAt: "asc" },
      select: { name: true, code: true },
    });
    steps.push(
      step(
        "warehouse:default",
        wTitle,
        "yapılacak",
        oldest
          ? `varsayılan işaretli değil → en eski depo terfi edecek: ${oldest.name} (${oldest.code})`
          : 'hiç depo yok → "Merkez Depo" (DP-MERKEZ) açılacak',
      ),
    );
  } else {
    const res = await ensureDefaultWarehouse();
    steps.push(
      step(
        "warehouse:default",
        wTitle,
        res.action === "exists" ? "atlandı" : "yapıldı",
        res.action === "created"
          ? `oluşturuldu: ${res.name}`
          : res.action === "promoted"
            ? `terfi ettirildi: ${res.name}`
            : `zaten var: ${res.name}`,
      ),
    );
  }

  return {
    apply: opts.apply,
    database,
    username: user.username,
    actorUsername,
    steps,
    missingPermissionCodes,
    timeLimitedPermissionCodes,
  };
}

// -----------------------------------------------------------------------------
// Rapor yazımı
// -----------------------------------------------------------------------------

const STATUS_MARK: Record<StepStatus, string> = {
  "yapıldı": "✅ yapıldı ",
  "atlandı": "➖ atlandı ",
  "yapılacak": "🔸 yapılacak",
};

export function formatReport(r: SetupReport): string {
  const out: string[] = [];
  out.push(`Veritabanı : ${r.database}`);
  out.push(`Kullanıcı  : ${r.username}`);
  out.push(`Aktör      : ${r.actorUsername}`);
  out.push("");
  for (const s of r.steps) {
    out.push(`  ${STATUS_MARK[s.status]}  ${s.title}`);
    out.push(`               ${s.detail}`);
  }
  if (r.missingPermissionCodes.length > 0) {
    out.push("");
    out.push(
      `  ${r.apply ? "⚠️ HÂLÂ EKSİK" : "Eklenecek"} izinler (${r.missingPermissionCodes.length}):`,
    );
    out.push(`    ${r.missingPermissionCodes.join(" · ")}`);
  }
  if (r.timeLimitedPermissionCodes.length > 0) {
    out.push("");
    out.push("  ⚠️ SÜRELİ/GEÇMİŞ izin satırı var — şablon merge'ü bunları ATLAR ve kullanıcı");
    out.push("     izni yine KULLANAMAZ. Panelden süre sınırını kaldırın:");
    out.push(`    ${r.timeLimitedPermissionCodes.join(" · ")}`);
  }
  return out.join("\n");
}

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

interface Cli {
  username: string | null;
  actorUsername?: string;
  apply: boolean;
  yes: boolean;
}

export function parseArgs(argv: readonly string[]): Cli {
  const read = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    return v && !v.startsWith("--") ? v : undefined;
  };
  return {
    username: read("--user") ?? null,
    actorUsername: read("--actor"),
    apply: argv.includes("--apply"),
    yes: argv.includes("--yes"),
  };
}

const USAGE = `Kullanım:
  npx tsx scripts/setup-ticaret.ts --user <kullanıcı>                 # KURU ANLATIM (yazmaz)
  npx tsx scripts/setup-ticaret.ts --user <kullanıcı> --apply         # uygular (onay sorar)
  npx tsx scripts/setup-ticaret.ts --user <kullanıcı> --apply --yes   # etkileşimsiz onay
  … [--actor <kullanıcı>]                                             # denetim izindeki aktör

Reçetenin tamamı: docs/ops/TICARET-KURULUM.md`;

/** "evet" yazılmadıkça false. Onay TTY'de sorulur; boruda `--yes` şarttır. */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
    return answer.trim().toLowerCase() === "evet";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (!cli.username) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  console.log(`=== Ticaret kurulumu — ${cli.apply ? "UYGULAMA" : "KURU ANLATIM"} ===\n`);

  // --apply'da ÖNCE planı (kuru anlatımı) bas, sonra onay iste. Onay ekranında
  // veritabanı adı da vardır: yanlış DB'ye koşmanın tek ucuz panzehiri budur.
  if (cli.apply) {
    const plan = await runTicaretSetup({
      username: cli.username,
      actorUsername: cli.actorUsername,
      apply: false,
    });
    console.log(formatReport(plan));

    const pending = plan.steps.filter((s) => s.status === "yapılacak");
    if (pending.length === 0) {
      console.log("\nYapacak iş yok — kurulum zaten uygulanmış.");
      return;
    }

    if (!cli.yes) {
      // ⚠️ TTY yoksa SESSİZCE devam ETME: boruya bağlı bir koşum, sorulan soruyu
      // hiç görmeden "evet" saymış olurdu.
      if (!process.stdin.isTTY) {
        console.error(
          "\n⛔ Onay alınamadı: bu oturum etkileşimli değil.\n" +
            "   Etkileşimsiz ortamda (CI / uzak oturum) onayı açıkça verin: --yes",
        );
        process.exitCode = 1;
        return;
      }
      const ok = await confirm(`\n${pending.length} adım uygulanacak. Onaylıyor musunuz? (evet/hayır) `);
      if (!ok) {
        console.log("İptal edildi — hiçbir şey yazılmadı.");
        return;
      }
    }
    console.log("");
  }

  const report = await runTicaretSetup({
    username: cli.username,
    actorUsername: cli.actorUsername,
    apply: cli.apply,
  });
  console.log(formatReport(report));

  if (!cli.apply) {
    console.log("\nKURU ANLATIM — hiçbir şey yazılmadı. Uygulamak için: --apply");
    return;
  }

  console.log(
    "\n✅ Bootstrap tamam. SIRADAKİ ELLE ADIMLAR (docs/ops/TICARET-KURULUM.md):\n" +
      "   §4 kasa/banka hesapları + AÇILIŞ bakiyeleri  (blockNegativeCash'ten ÖNCE)\n" +
      "   §5 kur girişi / TCMB\n" +
      "   §6 cari kartlar + devir bakiyeleri\n" +
      "   §7 opsiyonel bayraklar\n" +
      "   §8 doğrulama turu (admin ile DEĞİL, ticaret kullanıcısıyla)\n" +
      `   Not: '${report.username}' yetkileri yenilendiyse çıkış→giriş yapmalı.`,
  );
}

if (require.main === module) {
  main()
    .catch((e) => {
      if (e instanceof SetupTicaretError) {
        console.error(`\n⛔ ${e.message}\n`);
      } else {
        console.error("Beklenmeyen hata:", e);
      }
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
      await pool.end();
    });
}
