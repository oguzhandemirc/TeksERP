// =============================================================================
// SATICI CLI'si — patron bulutunda tesis · kurulum kaydı · ilk tesis yöneticisi (göç rolüyle).
//   npx tsx scripts/tesis.ts tesis-ac --tesis=<uuid> --ad="Fabrika A.Ş." [--saklama=3|13|25|tumu]
//        (önce tesisin AYRI veritabanını hazırlar — `tesis-db.ts hazirla` ile aynı; yarım kalan tamamlanır)
//   npx tsx scripts/tesis.ts tesis-durum --tesis=<uuid> --durum=AKTIF|PASIF
//   npx tsx scripts/tesis.ts kurulum-kaydet --tesis=<uuid> --kurulum=<uuid> --acik-anahtar=<x> \
//        --sinif=URETIM --moduller=patron-bulut,production.enabled --bitis=<ISO|yok> [--pasif]
//   npx tsx scripts/tesis.ts yonetici-davet --tesis=<uuid> --eposta=<e-posta> --ad="Ad Soyad" [--saat=72]
//   npx tsx scripts/tesis.ts yonetici-yeniden-davet --tesis=<uuid> --eposta=<e-posta> [--saat=72]
//        (ikisi de tesiste AKTİF hesap yöneticisi varken REDDEDİLİR; zorunluysa yalnız
//        `--zorla --talep=<talep no> --gerekce="…"` ile — talep ve gerekçe bulut denetimine yazılır)
//   npx tsx scripts/tesis.ts imha --tesis=<uuid> --isleyen="Ad Soyad" [--erken-talep=<talep no>] [--uygula]
//        (Ek-6/A §4.3: KURU KOŞUM varsayılan — tablo başına silinecek satır; `--uygula` tesisin veritabanını düşürür,
//        destek erişim kayıtlarını merkeze kopyalar ve imha kaydını merkeze yazar; yarıda kalan aynı komutla tamamlanır.
//        Hizmet açıkken ASLA; salt okuma süresi dolmadan yalnız yazılı erken talep numarasıyla.)
// Tesis/kurulum kimlikleri SATICIDAN gelir (HAK'taki `tesis.id` · `kurulumId`), burada uydurulmaz.
// Davet belirteci YALNIZ bu komutun çıktısında, BİR KEZ basılır; repoya/loga/denetime yazılmaz.
// Satıcı iç API'si kurulunca (`KURULUM_KAYNAGI=satici`) kurulum kaydı oradan dolar; bu CLI yine
// ilk yöneticiyi açar.
// =============================================================================
import type { LicenseClass } from "@prisma/client";
import { z } from "zod";
import { loadEnvFile } from "../src/lib/env";
import { TesisDbRouter } from "../src/lib/tesis-db";
import { prepareFacilityDb } from "../src/lib/tesis-db-hazirlik";
import { expectedSchemaVersion } from "../src/lib/tesis-goc";
import { cliDeps } from "./tesis-db";
import { destroyFacility } from "../src/services/facility-destruction";
import { inviteFacilityAdmin, openFacility, overrideFromArgs, registerInstallation, reinviteAdmin, setFacilityStatus } from "../src/services/vendor-admin.service";

function args(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]!] = m[2] ?? "true";
  }
  return out;
}

const Uuid = z.uuid();
function need(a: Record<string, string>, key: string): string {
  const v = a[key];
  if (!v) throw new Error(`--${key} zorunlu`);
  return v;
}
const uuidArg = (a: Record<string, string>, key: string): string => Uuid.parse(need(a, key));

function retention(v: string | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === "tumu") return null;
  const n = Number(v);
  if (![3, 13, 25].includes(n)) throw new Error("--saklama 3, 13, 25 ya da tumu olmalı");
  return n;
}

async function main(): Promise<void> {
  loadEnvFile();
  const [komut, ...rest] = process.argv.slice(2);
  const a = args(rest);
  const deps = cliDeps();
  const db = new TesisDbRouter({ role: "goc", centralUrl: deps.gocUrl, key: deps.key, schemaVersion: expectedSchemaVersion(), centralPoolMax: 2, facilityPoolMax: 2 });
  try {
    switch (komut) {
      case "tesis-ac": {
        const tesisId = uuidArg(a, "tesis");
        const h = await prepareFacilityDb(deps, tesisId);
        if (h.kind !== "hazir" && h.kind !== "zaten-hazir") throw new Error(`tesis DB'si hazır değil (${h.kind}${h.kind === "hata" ? `: ${h.message}` : ""}); \`tesis-db.ts hazirla\` ile yeniden deneyin`);
        const r = await openFacility(db, { tesisId, name: need(a, "ad"), retentionMonths: retention(a.saklama) });
        console.log(`✅ tesis ${r.tesisId} — ${r.name} (saklama: ${r.retentionMonths ?? "tümü"})`);
        break;
      }
      case "tesis-durum": {
        const durum = z.enum(["AKTIF", "PASIF"]).parse(need(a, "durum"));
        await setFacilityStatus(db, { tesisId: uuidArg(a, "tesis"), status: durum });
        console.log(`✅ tesis durumu ${durum}`);
        break;
      }
      case "kurulum-kaydet": {
        const bitis = need(a, "bitis");
        const r = await registerInstallation(db, {
          tesisId: uuidArg(a, "tesis"),
          installationId: uuidArg(a, "kurulum"),
          publicKeyX: need(a, "acik-anahtar"),
          licenseClass: z.enum(["URETIM", "TEST", "DR", "DEMO", "BAYI", "BARINDIRILAN"]).parse(need(a, "sinif")) as LicenseClass,
          modules: need(a, "moduller").split(",").map((s) => s.trim()).filter(Boolean),
          cloudUntil: bitis === "yok" ? null : new Date(z.iso.datetime().parse(bitis)),
          active: a.pasif !== "true",
        });
        console.log(`✅ kurulum ${r.installationId} — ${r.licenseClass}, patron bulutu ${r.modules.includes("patron-bulut") ? "VAR" : "yok"}`);
        break;
      }
      case "yonetici-davet":
      case "yonetici-yeniden-davet": {
        const zorla = overrideFromArgs(a);
        const g = { tesisId: uuidArg(a, "tesis"), email: need(a, "eposta"), validHours: Number(a.saat ?? "72"), ...(zorla ? { zorla } : {}) };
        const r = komut === "yonetici-davet" ? await inviteFacilityAdmin(db, { ...g, name: need(a, "ad") }) : await reinviteAdmin(db, g);
        console.log(`✅ davet hazır — hesap ${r.accountId}, bitiş ${r.expiresAt.toISOString()}`);
        console.log(`   Davet belirteci (BİR KEZ gösterilir; yöneticiye güvenli kanaldan iletin): ${r.token}`);
        break;
      }
      case "imha": {
        const tesisId = uuidArg(a, "tesis");
        const erken = a["erken-talep"];
        const r = await destroyFacility(db, { tesisId, operator: z.string().trim().min(3).max(120).parse(need(a, "isleyen")), apply: a.uygula === "true", ...(erken ? { earlyRequestRef: z.string().trim().min(3).max(60).parse(erken) } : {}) });
        if (!r.applied) {
          console.log(`🔎 KURU KOŞUM — tesis ${r.tesisId} (${r.facilityName}) · aşama ${r.phase} · neden ${r.reason}; silinecek satırlar:`);
          console.log(JSON.stringify(r.counts, null, 2));
          console.log("   Uygulamak için aynı komutu --uygula ile yeniden koşun.");
          break;
        }
        console.log(`✅ imha tamam — tesis ${r.tesisId}; veritabanı düşürüldü; kayıt ${r.recordId}`);
        console.log("   İmha tutanağı verisi (Ek-6/A §4.5; satıcı kayıtlarında saklanır, yedekten geri yüklemede yeniden koşulur):");
        console.log(JSON.stringify({ tesisId: r.tesisId, tesis: r.facilityName, neden: r.reason, hizmetBitisi: r.serviceEndedAt, saltOkunurBitis: r.readOnlyUntil, silinen: r.counts, yedektenDusme: r.backupClearBy, kayitId: r.recordId }, null, 2));
        break;
      }
      default:
        throw new Error("Komut: tesis-ac | tesis-durum | kurulum-kaydet | yonetici-davet | yonetici-yeniden-davet | imha");
    }
  } finally {
    await db.close();
  }
}

main().catch((err: Error) => {
  console.error(`⛔ ${err.message}`);
  process.exit(1);
});
