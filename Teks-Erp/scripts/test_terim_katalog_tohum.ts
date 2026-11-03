// =============================================================================
// K20 — AÇILIŞ TOHUMU REJİMDEN SONRA (s8a inceleme bulgusu 2)
// =============================================================================
// Boot uzlaştırması (izin → rol şablonu → sebep → numara serisi) eksik satırı yazar ve var olanı EZMEZ; metin
// `TERIM.terbiyeIsEmri` getter'ından o anki rejimle çözülür. Rejim job'u ayrı ve sırasız koşuyordu: dokuma kapalı
// taze kurulumda (özellikle DB geç gelince) tohum bugünkü varsayılanla ("Terbiye") kalıcı yazılabiliyordu.
// Sözleşme: `reconcileCatalogsOnce` yazmadan ÖNCE rejimi DB'den çözer.
//   §1 dokuma kapalı + bellek rejimi "Terbiye" (boot varsayılanı) → doğan izin/rol/sebep satırında "Terbiye" YOK
//   §2 dokuma açık → aynı satırlar bugünkü "Terbiye" adıyla doğar (varsayılan davranış korunur)
// Yazan bekçi: yalnız `_test` DB'sinde koşar; bayrak fotoğrafa döner.
// =============================================================================
import type { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { reconcileCatalogsOnce } from "../src/jobs/permission-catalog.job";
import { terimDokumaAyarla, terimDokumaRejimi } from "../src/constants/terim";
import { invalidateFeatureFlagsCache, SETTING_KEYS } from "../src/services/system-setting.service";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
function check(l: string, ok: boolean, x = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${l}${x ? ` — ${x}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${l}${x ? ` — ${x}` : ""}`); }
}

const IZIN = "workorder:distribute";
const SABLON = "MOBILE_HIZLI_IS_EMRI";
const SEBEP = { kind: "WORK_ORDER_PLAN_CHANGE" as const, code: "YANLIS_GIRILMIS" };
const ANAHTARLAR = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DOKUMA_ENABLED] as const;

async function bayrakYaz(dokuma: boolean): Promise<void> {
  for (const key of ANAHTARLAR) {
    const value = key === SETTING_KEYS.DOKUMA_ENABLED ? dokuma : true;
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  invalidateFeatureFlagsCache();
}

async function satirlariSil(): Promise<void> {
  await prisma.permission.deleteMany({ where: { code: IZIN } });
  await prisma.permissionTemplate.deleteMany({ where: { code: SABLON } });
  await prisma.reasonPreset.deleteMany({ where: SEBEP });
}

async function metinler(): Promise<string[]> {
  const izin = await prisma.permission.findUnique({ where: { code: IZIN }, select: { description: true } });
  const sablon = await prisma.permissionTemplate.findFirst({ where: { code: SABLON }, select: { name: true, description: true } });
  const sebep = await prisma.reasonPreset.findFirst({ where: SEBEP, select: { fullText: true } });
  return [izin?.description ?? "(yok)", sablon?.name ?? "(yok)", sablon?.description ?? "(yok)", sebep?.fullText ?? "(yok)"];
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) {
    console.error(`⛔ ${engel}`);
    fail++;
    return;
  }
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: [...ANAHTARLAR] } } });
  try {
    console.log("§1 dokuma kapalı, bellek rejimi boot varsayılanında");
    await bayrakYaz(false);
    terimDokumaAyarla(true);
    await satirlariSil();
    await reconcileCatalogsOnce();
    const m1 = await metinler();
    check("§1a rejim DB'den çözüldü (dokuma kapalı)", terimDokumaRejimi() === false);
    check("§1b dört metin doğdu", m1.every((t) => t !== "(yok)"), m1.join(" | "));
    check("§1c hiçbirinde 'Terbiye' yok", m1.every((t) => !/terbiye/i.test(t)), m1.join(" | "));

    console.log("§2 dokuma açık → bugünkü ad");
    await bayrakYaz(true);
    terimDokumaAyarla(false);
    await satirlariSil();
    await reconcileCatalogsOnce();
    const m2 = await metinler();
    check("§2a rejim açık", terimDokumaRejimi() === true);
    check("§2b izin + şablon adı + sebep 'Terbiye' taşır", /terbiye/i.test(m2[0]!) && /terbiye/i.test(m2[1]!) && /terbiye/i.test(m2[3]!), m2.join(" | "));
  } finally {
    for (const key of ANAHTARLAR) {
      const eski = foto.find((f) => f.key === key);
      if (eski) await prisma.systemSetting.update({ where: { key }, data: { value: eski.value as Prisma.InputJsonValue } });
      else await prisma.systemSetting.deleteMany({ where: { key } });
    }
    invalidateFeatureFlagsCache();
  }
}

void main().finally(async () => {
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
});
