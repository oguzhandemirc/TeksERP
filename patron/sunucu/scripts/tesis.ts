// =============================================================================
// SATICI CLI'si — patron bulutunda tesis · kurulum kaydı · ilk tesis yöneticisi (göç rolüyle).
//   npx tsx scripts/tesis.ts tesis-ac --tesis=<uuid> --ad="Fabrika A.Ş." [--saklama=3|13|25|tumu]
//   npx tsx scripts/tesis.ts tesis-durum --tesis=<uuid> --durum=AKTIF|PASIF
//   npx tsx scripts/tesis.ts kurulum-kaydet --tesis=<uuid> --kurulum=<uuid> --acik-anahtar=<x> \
//        --sinif=URETIM --moduller=patron-bulut,production.enabled --bitis=<ISO|yok> [--pasif]
//   npx tsx scripts/tesis.ts yonetici-davet --tesis=<uuid> --eposta=<e-posta> --ad="Ad Soyad" [--saat=72]
//   npx tsx scripts/tesis.ts yonetici-yeniden-davet --tesis=<uuid> --eposta=<e-posta> [--saat=72]
// Tesis/kurulum kimlikleri SATICIDAN gelir (HAK'taki `tesis.id` · `kurulumId`), burada uydurulmaz.
// Davet belirteci YALNIZ bu komutun çıktısında, BİR KEZ basılır; repoya/loga/denetime yazılmaz.
// Satıcı iç API'si kurulunca (`KURULUM_KAYNAGI=satici`) kurulum kaydı oradan dolar; bu CLI yine
// ilk yöneticiyi açar.
// =============================================================================
import type { LicenseClass } from "@prisma/client";
import { z } from "zod";
import { closeDatabase, createDatabase } from "../src/lib/db";
import { loadEnvFile } from "../src/lib/env";
import { inviteFacilityAdmin, openFacility, registerInstallation, reinviteAdmin, setFacilityStatus } from "../src/services/vendor-admin.service";

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
  const url = process.env.GOC_DATABASE_URL;
  if (!url) throw new Error("GOC_DATABASE_URL tanımlı değil");
  if (decodeURIComponent(new URL(url).pathname.slice(1)).startsWith("tekserp_fabrika_")) throw new Error("Fabrika verisi sınıfındaki DB'ye yazılmaz");
  const db = createDatabase(url, "goc", 2);
  try {
    switch (komut) {
      case "tesis-ac": {
        const r = await openFacility(db.prisma, { tesisId: uuidArg(a, "tesis"), name: need(a, "ad"), retentionMonths: retention(a.saklama) });
        console.log(`✅ tesis ${r.tesisId} — ${r.name} (saklama: ${r.retentionMonths ?? "tümü"})`);
        break;
      }
      case "tesis-durum": {
        const durum = z.enum(["AKTIF", "PASIF"]).parse(need(a, "durum"));
        await setFacilityStatus(db.prisma, { tesisId: uuidArg(a, "tesis"), status: durum });
        console.log(`✅ tesis durumu ${durum}`);
        break;
      }
      case "kurulum-kaydet": {
        const bitis = need(a, "bitis");
        const r = await registerInstallation(db.prisma, {
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
        const g = { tesisId: uuidArg(a, "tesis"), email: need(a, "eposta"), validHours: Number(a.saat ?? "72") };
        const r = komut === "yonetici-davet" ? await inviteFacilityAdmin(db.prisma, { ...g, name: need(a, "ad") }) : await reinviteAdmin(db.prisma, g);
        console.log(`✅ davet hazır — hesap ${r.accountId}, bitiş ${r.expiresAt.toISOString()}`);
        console.log(`   Davet belirteci (BİR KEZ gösterilir; yöneticiye güvenli kanaldan iletin): ${r.token}`);
        break;
      }
      default:
        throw new Error("Komut: tesis-ac | tesis-durum | kurulum-kaydet | yonetici-davet | yonetici-yeniden-davet");
    }
  } finally {
    await closeDatabase(db);
  }
}

main().catch((err: Error) => {
  console.error(`⛔ ${err.message}`);
  process.exit(1);
});
