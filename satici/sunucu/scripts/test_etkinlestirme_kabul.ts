// =============================================================================
// ETKİNLEŞTİRME ↔ İLK KURULUM KABULÜ (Ek-7 §5; kullanıcı kararı 2026-09-30) — gerçek satıcı süreci + kendi _test DB'si.
// Kodu TÜKETECEK etkinleştirme kurulum imzalı kabul belgesi (`tekserp-kabul`) taşımalı; yoksa ya da belge bu anahtarla
// imzalı değilse · şema dışıysa · tanınmayan metinse · kutuları eksik/fazlaysa 409 KABUL_GEREKLI + details.neden ve
// kod/nonce TÜKETİLMEZ (ucuz ön denetim). Kabullü etkinleştirme kabulü AYNI tx'te kurulum kaydına
// `SOZLESME_KABUL_EDILDI` olarak yazar (kaynakKayitId = kabulId, kanıt belge kod taşımaz, etkinleşmeden 1 ms önce);
// tüketilmiş kodun ağ tekrarı kabul istemez; çevrimdışı zarf (/v1/cevrimdisi) aynı kapıdan geçer; aynı kabul ikinci
// etkinleştirmede ikinci satır doğurmaz; portal kurulum ayrıntısı kabulü taşır.
// NEGATİF SONDA (dosya dışı mutasyon, geri alındı; sonuç commit mesajında): S1 kapı kaldırıldı (`requireAcceptance`
// çağrısı yok) · S2 kutu denetimi gevşetildi (eksik kutu kabul) · S3 kabul satırı yazılmadı.
// Koşum: npx tsx scripts/test_etkinlestirme_kabul.ts
// =============================================================================
import { randomUUID } from "node:crypto";
import {
  ACCEPTANCE_TEXTS,
  ENDPOINTS,
  TYP,
  installationKeyId,
  signJws,
  signRequest,
  verifyAcceptance,
  wrapEnvelope,
} from "../src/lisans-protokol";
import { kurulumAnahtariUret } from "../../../Teks-Erp/scripts/lib/lisans-fikstur";
import {
  anahtarOrtamiKur,
  etkinlestirmeGovdesi,
  gonder,
  hedefDbKapisi,
  imzaliPost,
  kabulBelgesi,
  kapat,
  kontrol,
  kurulumFiksturu,
  sonuc,
  sunucuBaslat,
  temizleKurulumlar,
} from "./lib/test-ortam";

const ACCEPTANCE_EVENT = "SOZLESME_KABUL_EDILDI";

async function main(): Promise<void> {
  hedefDbKapisi();
  const ortam = await anahtarOrtamiKur();
  const { f, ctx } = ortam;
  const { prisma } = await import("../src/lib/prisma");
  const { installationDetail } = await import("../src/portal/queries");
  const svc = await import("../src/services/entitlement.service");
  const temizlenecek: string[] = [];
  const sunucu = await sunucuBaslat(ortam);
  const metin = ACCEPTANCE_TEXTS.at(-1)!;
  try {
    console.log("\n§1 fikstür + katalog");
    kontrol("§1a katalogda en az bir metin (son satır güncel)", !!metin && metin.kutular.length >= 1, metin ? `${metin.kimlik} · ${metin.kutular.join(",")}` : "boş");
    const k = await kurulumFiksturu(ctx);
    temizlenecek.push(k.kurulumDbId);
    const nonceSay = () => prisma.nonceDefteri.count({ where: { kurulumId: k.kurulumDbId } });
    const post = (govde: unknown, anahtar = f.kurulum) => imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, { kurulumId: k.kurulumId, amac: "etkinlestir", anahtar, govde });
    const temel = (kabul: string | null) => etkinlestirmeGovdesi({ kod: k.kod, kurulumId: k.kurulumId, anahtar: f.kurulum, parmakIzi: f.parmakIzi, kabul });

    console.log("\n§2 ⭐ kabulsüz/geçersiz kabul → 409 KABUL_GEREKLI (kod ve nonce tüketilmez)");
    const nonce0 = await nonceSay();
    const red = async (ad: string, kabul: string | null, neden: string) => {
      const r = await post(temel(kabul));
      const d = r.json.details as { neden?: string } | undefined;
      kontrol(`${ad} → 409 KABUL_GEREKLI (neden ${neden}), TR ileti`, r.status === 409 && r.kod === "KABUL_GEREKLI" && d?.neden === neden && /kabul/i.test(String(r.json.message)), `${r.status} ${r.kod} ${d?.neden ?? "—"}`);
    };
    await red("§2a kabul alanı YOK (eski fabrika/panel)", null, "YOK");
    const yabanci = kurulumAnahtariUret();
    await red("§2b başka anahtarla imzalı kabul", kabulBelgesi(yabanci), "IMZA");
    const gecerli = kabulBelgesi(f.kurulum);
    const [b, y, s] = gecerli.split(".");
    const yuk = JSON.parse(Buffer.from(y!, "base64url").toString("utf8")) as Record<string, unknown>;
    const kurcali = `${b}.${Buffer.from(JSON.stringify({ ...yuk, kabulEden: { ...(yuk.kabulEden as object), unvan: "Stajyer" } })).toString("base64url")}.${s}`;
    await red("§2c kurcalanmış kabul yükü (imza tutmaz)", kurcali, "IMZA");
    await red("§2d tanınmayan metin kimliği", kabulBelgesi(f.kurulum, { metin: { kimlik: "KM-2099.1", ozet: metin.ozet } }), "METIN");
    await red("§2e doğru kimlik, YANLIŞ özet (başka metin gösterilmiş)", kabulBelgesi(f.kurulum, { metin: { kimlik: metin.kimlik, ozet: "0".repeat(64) } }), "METIN");
    await red("§2f eksik kutu", kabulBelgesi(f.kurulum, { kutular: metin.kutular.slice(1) }), "KUTU");
    await red("§2g fazla (metinde olmayan) kutu", kabulBelgesi(f.kurulum, { kutular: [...metin.kutular, "99"] }), "KUTU");
    const kid = installationKeyId(f.kurulum.x);
    const semaDisi = signJws({ typ: TYP.KABUL, kid, payload: { ...yuk, kabulEden: { ad: "X" } }, privateKey: f.kurulum.privateKey });
    await red("§2h şema dışı kabul (kabulEden eksik)", semaDisi, "SEMA");
    const baskaTur = signJws({ typ: TYP.ISTEK, kid, payload: yuk, privateKey: f.kurulum.privateKey });
    await red("§2i başka belge türü (typ tekserp-istek)", baskaTur, "IMZA");
    const hala = await prisma.etkinlestirmeKodu.findFirstOrThrow({ where: { kurulumId: k.kurulumDbId } });
    kontrol("§2j ⭐ reddedilen istekler kodu TÜKETMEDİ, nonce defterine yazılmadı (ön denetim nonce'tan önce)", hala.durum === "AKTIF" && (await nonceSay()) === nonce0, `kod=${hala.durum} nonce ${nonce0}→${await nonceSay()}`);
    kontrol("§2k kurulum kaydına kabul satırı düşmedi", (await prisma.kurulumKaydi.count({ where: { kurulumId: k.kurulumDbId } })) === 0);

    console.log("\n§3 ⭐ kabullü etkinleştirme → kabul kurulum kaydında");
    const kabulId = randomUUID();
    const belge = kabulBelgesi(f.kurulum, { kabulId });
    const ok = await post(temel(belge));
    kontrol("§3a 200", ok.status === 200, `${ok.status} ${ok.kod ?? ""}`);
    const kayit = await prisma.kurulumKaydi.findMany({ where: { kurulumId: k.kurulumDbId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const kabulSatiri = kayit.find((r) => r.olay === ACCEPTANCE_EVENT);
    const etkin = kayit.find((r) => r.olay === "ETKINLESTI");
    kontrol("§3b SOZLESME_KABUL_EDILDI satırı: kaynakKayitId = kabulId, anahtar = kurulum anahtarı, yapan kurulum", kabulSatiri?.kaynakKayitId === kabulId && kabulSatiri.anahtarKimligi === kid && kabulSatiri.yapan === "kurulum");
    kontrol("§3c kronoloji: kabul etkinleşmeden ÖNCE (aynı tx, +1 ms)", !!kabulSatiri && !!etkin && kabulSatiri.createdAt.getTime() < etkin.createdAt.getTime(), kayit.map((r) => `${r.olay}@${r.createdAt.toISOString()}`).join(" · "));
    const ayrinti = (kabulSatiri?.ayrinti ?? {}) as { belge?: string; kabulEden?: { ad?: string; unvan?: string }; metin?: { kimlik?: string }; kodId?: string };
    const yeniden = verifyAcceptance(ayrinti.belge, { publicKeyX: f.kurulum.x });
    kontrol("§3d ⭐ saklanan belge kurulum anahtarıyla SONRADAN da doğrulanır (kanıt)", yeniden.ok && yeniden.doc.kabulId === kabulId, yeniden.ok ? "" : yeniden.neden);
    kontrol("§3e ayrıntı: kabul eden ad/unvan + metin kimliği + kod KİMLİĞİ", ayrinti.kabulEden?.unvan === "Genel Müdür" && ayrinti.metin?.kimlik === metin.kimlik && ayrinti.kodId === hala.id);
    kontrol("§3f kurulum kaydında etkinleştirme KODU yok (düz metin · son 4)", !JSON.stringify(kayit).includes(k.kod) && !JSON.stringify(kayit).includes(k.kod.slice(-9)));
    const denetim = await prisma.denetim.findFirst({ where: { varlikId: k.kurulumDbId, olay: "KURULUM_ETKINLESTI" } });
    kontrol("§3g denetim ayak izi kabul kimliğini taşır", JSON.stringify(denetim?.ozet ?? {}).includes(kabulId), JSON.stringify(denetim?.ozet ?? null).slice(0, 120));

    console.log("\n§4 ağ tekrarı ve ikinci etkinleştirme");
    const tekrar = await post(temel(null));
    kontrol("§4a tüketilmiş kodun ağ tekrarı (aynı anahtar) kabulsüz de 200 — önceki sonuç", tekrar.status === 200, `${tekrar.status} ${tekrar.kod ?? ""}`);
    const kod2 = await svc.createActivationCode(ctx, { installationDbId: k.kurulumDbId, actor: "bekci" });
    const ikinci = await imzaliPost(sunucu.genel, ENDPOINTS.ACTIVATE, {
      kurulumId: k.kurulumId,
      amac: "etkinlestir",
      anahtar: f.kurulum,
      govde: etkinlestirmeGovdesi({ kod: kod2.code, kurulumId: k.kurulumId, anahtar: f.kurulum, parmakIzi: f.parmakIzi, kabul: belge }),
    });
    const kabulSayisi = await prisma.kurulumKaydi.count({ where: { kurulumId: k.kurulumDbId, olay: ACCEPTANCE_EVENT } });
    kontrol("§4b aynı anahtar + yeni kod + AYNI kabul → 200 YENIDEN_ETKINLESTI, kabul satırı İKİNCİ kez yazılmaz", ikinci.status === 200 && kabulSayisi === 1 && (await prisma.kurulumKaydi.count({ where: { kurulumId: k.kurulumDbId, olay: "YENIDEN_ETKINLESTI" } })) === 1, `${ikinci.status} ${ikinci.kod ?? ""} kabul=${kabulSayisi}`);

    console.log("\n§5 ⭐ çevrimdışı zarf (/v1/cevrimdisi) aynı kapıdan geçer");
    const k2 = await kurulumFiksturu(ctx);
    temizlenecek.push(k2.kurulumDbId);
    const zarfAnahtari = kurulumAnahtariUret();
    const zarfla = (kabul: string | null) => {
      const govde = JSON.stringify(etkinlestirmeGovdesi({ kod: k2.kod, kurulumId: null, anahtar: zarfAnahtari, parmakIzi: f.parmakIzi, kabul }));
      const istek = signRequest({ installationId: null, purpose: "etkinlestir", body: govde, key: { privateKey: zarfAnahtari.privateKey, nowMs: Date.now() } });
      return gonder(`${sunucu.genel}${ENDPOINTS.OFFLINE}`, { govde: JSON.stringify({ v: 1, zarf: wrapEnvelope(istek, govde) }) });
    };
    const zarfRed = await zarfla(null);
    kontrol("§5a kabulsüz zarf → 409 KABUL_GEREKLI (QR yolu da reddeder)", zarfRed.status === 409 && zarfRed.kod === "KABUL_GEREKLI", `${zarfRed.status} ${zarfRed.kod}`);
    const zarfOk = await zarfla(kabulBelgesi(zarfAnahtari));
    const zarfKabul = await prisma.kurulumKaydi.count({ where: { kurulumId: k2.kurulumDbId, olay: ACCEPTANCE_EVENT } });
    kontrol("§5b kabullü zarf → 200, kabul kurulum kaydında", zarfOk.status === 200 && zarfKabul === 1, `${zarfOk.status} ${zarfOk.kod ?? ""} kabul=${zarfKabul}`);

    console.log("\n§6 portal kurulum ayrıntısı kabulü gösterir");
    const det = (await installationDetail(prisma, k.kurulumDbId)) as { kurulumKaydi?: Array<{ olay: string; ayrinti: unknown }> };
    const portalKabul = det.kurulumKaydi?.find((r) => r.olay === ACCEPTANCE_EVENT);
    kontrol("§6a ayrıntının kurulum kaydında kabul satırı + kabul eden", !!portalKabul && JSON.stringify(portalKabul.ayrinti).includes("Bekçi Yetkili"));
  } finally {
    await sunucu.durdur();
    await temizleKurulumlar(temizlenecek, ortam.kidler);
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
