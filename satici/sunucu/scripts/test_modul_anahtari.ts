// =============================================================================
// BEKÇİ — MODÜL ANAHTARI KASASI + KİRAYA SARMA (Faz 2d, gerçek satıcı süreci + kendi `_test` DB)
// =============================================================================
// §1 kasa: düz anahtar DB'ye girmez (kasa anahtarıyla sarılı, kid = özet) · tekrar güvenli · aynı
//    modül×sürüm başka anahtarla 409.
// §2 etkinleştirme X25519 taşıyınca kira HAK'taki modülün anahtarını taşır; kurulumun özel yarısıyla
//    açılır, başka kurulumun anahtarı AÇAMAZ.
// §3 K2 dondurma → sonraki kirada o modülün anahtarı YOK; geri alınca döner.
// §4 X25519'suz etkinleşen (eski) kurulum: kirada anahtar yok; ilk yoklama anahtarı bildirir → kayıt
//    defterinde SIFRELEME_ANAHTARI + kirada anahtar. HAK'ta olmayan modülün anahtarı hiç sarılmaz.
// Sondalar (✓K): dondurma denetimi (`frozen`) kaldırılırsa §3a · HAK süzgeci kaldırılırsa §4d kırmızı.
// Kasa satırı silinmez (tetikleyici): bekçinin satırları sonda `aktif=false` (emeklilik) olur.
// =============================================================================
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { ENDPOINTS, parseJws, type LeaseDoc } from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import { unwrapModuleKey } from "../../../Teks-Erp/src/lib/license/module-key";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  hedefDbKapisi,
  imzaliPost,
  kapat,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
  yoklamaGovdesi,
  type Yanit,
} from "./lib/test-ortam";

const MODUL = "depo.multiEnabled";

function kiraOf(y: Yanit): LeaseDoc | null {
  if (y.status !== 200) return null;
  const p = parseJws(y.json.kira);
  return p.ok ? (p.value.payload as unknown as LeaseDoc) : null;
}

function x25519(): { ozel: string; acik: string } {
  const jwk = generateKeyPairSync("x25519").privateKey.export({ format: "jwk" });
  return { ozel: String(jwk.d), acik: String(jwk.x) };
}

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { importModuleKey } = await import("../src/services/module-key.service");
  const svc = await import("../src/services/sanction.service");
  const temizlenecek: string[] = [];
  const kidler: string[] = [];
  const sunucu = await sunucuBaslat(ortam);
  try {
    console.log("\n§1 kasa");
    const surum = ((await prisma.modulAnahtari.aggregate({ where: { modul: MODUL }, _max: { surum: true } }))._max.surum ?? 0) + 1;
    const anahtar = randomBytes(32);
    const alim = await importModuleKey(ctx, { modul: MODUL, surum, anahtar, yapan: "bekci" });
    kidler.push(alim.kid);
    const satir = await prisma.modulAnahtari.findUniqueOrThrow({ where: { kid: alim.kid } });
    kontrol("§1a kasaya alındı, düz anahtar DB'de YOK (sarılı)", alim.yeni && !satir.sarili.includes(anahtar.toString("base64url")) && ctx.moduleVault.open(satir.sarili, alim.kid)?.equals(anahtar) === true);
    kontrol("§1b aynı dosya ikinci kez → dokunulmaz", (await importModuleKey(ctx, { modul: MODUL, surum, anahtar, yapan: "bekci" })).yeni === false);
    let cakisma = "";
    try {
      await importModuleKey(ctx, { modul: MODUL, surum, anahtar: randomBytes(32), yapan: "bekci" });
    } catch (e) {
      cakisma = `${(e as { status?: number }).status} ${(e as { code?: string }).code}`;
    }
    kontrol("§1c aynı modül×sürüm başka anahtar → 409", cakisma.startsWith("409"), cakisma);

    console.log("\n§2 etkinleştirme X25519 taşır → kirada anahtar");
    const kAnahtar = kurulumAnahtariUret();
    const alici = x25519();
    const k = await kurulumFiksturu(ctx, { moduller: ["production.enabled", MODUL] });
    temizlenecek.push(k.kurulumDbId);
    const et = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar: kAnahtar,
      govde: { ...etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar: kAnahtar, parmakIzi: f.parmakIzi }), sifrelemeAnahtari: alici.acik },
    });
    let kira = kiraOf(et);
    const hak = kira?.modulAnahtarlari?.find((g) => g.kid === alim.kid);
    const acildi = hak ? unwrapModuleKey(hak.sarma, alici.ozel, MODUL) : null;
    kontrol("§2a kirada modül anahtarı var, kurulumun özel yarısıyla açılır = kasadaki anahtar", !!acildi?.ok && Buffer.from(acildi.value.anahtar, "base64url").equals(anahtar), `${et.status} ${et.kod ?? ""}`);
    const baska = hak ? unwrapModuleKey(hak.sarma, x25519().ozel, MODUL) : null;
    kontrol("§2b ✓K başka kurulumun X25519'u AÇAMAZ", baska !== null && !baska.ok && baska.code === "MODUL_SARMA_ACILAMADI", baska && !baska.ok ? baska.code : "açıldı");
    let uc = kira?.kiraId ?? null;
    const yokla = async (ek: Record<string, unknown> = {}): Promise<LeaseDoc | null> => {
      const y = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
        kurulumId: k.kurulumId,
        amac: "yokla",
        anahtar: kAnahtar,
        govde: { ...yoklamaGovdesi({ sonKiraId: uc, hak: { hakId: k.hakId, surum: 1 }, parmakIzi: f.parmakIzi }), ...ek },
      });
      const doc = kiraOf(y);
      if (doc) uc = doc.kiraId;
      return doc;
    };

    console.log("\n§3 K2 dondurma");
    const k2 = await svc.applySanction({ installationDbId: k.kurulumDbId, actor: "bekci", level: "K2", modules: [MODUL], reason: "modül ödenmedi" });
    kira = await yokla();
    kontrol("§3a ✓K K2 → kirada o modülün anahtarı YOK", !!kira && kira.yaptirim.donmusModuller.includes(MODUL) && !(kira.modulAnahtarlari ?? []).some((g) => g.modul === MODUL));
    await svc.revertSanction({ actionId: k2.id, actor: "bekci", reason: "ödeme geldi" });
    kira = await yokla();
    kontrol("§3b geri alınınca anahtar döner", (kira?.modulAnahtarlari ?? []).some((g) => g.kid === alim.kid));

    console.log("\n§4 eski kurulum (etkinleşmede X25519 yok)");
    const eAnahtar = kurulumAnahtariUret();
    const e = await kurulumFiksturu(ctx, { moduller: ["production.enabled"] });
    temizlenecek.push(e.kurulumDbId);
    const eEt = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: e.kurulumId,
      amac: "etkinlestir",
      anahtar: eAnahtar,
      govde: etkinlestirmeGovdesi({ kod: e.kod, kurulumId: e.kurulumId, anahtar: eAnahtar, parmakIzi: f.parmakIzi }),
    });
    const eKira = kiraOf(eEt);
    kontrol("§4a X25519'suz kira → modulAnahtarlari alanı YOK (eski kira ile aynı biçim)", !!eKira && eKira.modulAnahtarlari === undefined);
    const eAlici = x25519();
    const eY = await imzaliPost(sunucu.genel, ENDPOINTS.POLL, {
      kurulumId: e.kurulumId,
      amac: "yokla",
      anahtar: eAnahtar,
      govde: { ...yoklamaGovdesi({ sonKiraId: eKira?.kiraId ?? null, hak: { hakId: e.hakId, surum: 1 }, parmakIzi: f.parmakIzi }), sifrelemeAnahtari: eAlici.acik },
    });
    const eInst = await prisma.kurulum.findUniqueOrThrow({ where: { id: e.kurulumDbId } });
    const kayit = await prisma.kurulumKaydi.count({ where: { kurulumId: e.kurulumDbId, olay: "SIFRELEME_ANAHTARI" } });
    kontrol("§4b ilk yoklama X25519'u kaydeder + kurulum kaydı (defter)", eY.status === 200 && eInst.sifrelemeAnahtari === eAlici.acik && kayit === 1, `${eY.status} ${eY.kod ?? ""}`);
    kontrol("§4c ✓K HAK'ta olmayan modülün anahtarı SARILMAZ (kasada olsa bile)", !(kiraOf(eY)?.modulAnahtarlari ?? []).some((g) => g.modul === MODUL));
  } finally {
    await sunucu.durdur();
    await prisma.modulAnahtari.updateMany({ where: { kid: { in: kidler } }, data: { aktif: false } });
    await temizleKurulumlar([...new Set(temizlenecek)], ortam.kidler);
    ortam.temizle();
    await kapat();
  }
  sonuc();
}

main().catch(async (err: Error) => {
  console.error(`❌ bekçi çöktü: ${err.stack ?? err.message}`);
  await kapat();
  process.exit(1);
});
