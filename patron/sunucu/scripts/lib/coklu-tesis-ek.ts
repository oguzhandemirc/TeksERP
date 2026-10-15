// `test_coklu_tesis` §5–§9 (A2 dilimi; dosya boyu sınırı için ayrı, `test_` öneki yok → koşucu saymaz):
//   §5 davet "mevcut hesabımla bağlan" · incele bayt-eşit · her ret girişle AYNI 401 · §6 tesis yöneticisi sıfırlaması
//   (paylaşımlı kimlik 409) · §7 satıcı kimlik sıfırlaması (zorlama + denetim + yabancı davet yeniden sırlayamaz) ·
//   §8 cihaz kaydı bütün üyeliklerde + push yükü tesisi · §9 merkez kimliğinin kapanışı ve 30 gün sonra silinmesi.
import { createHash, randomUUID } from "node:crypto";
import { acceptInvite, confirmInvite } from "../../src/auth/invite.service";
import { LOGIN_FAILURE_FLOOR_MS, newToken } from "../../src/auth/session.service";
import { CloudError } from "../../src/lib/errors";
import { withCentral, withTesis } from "../../src/lib/tenant";
import { webPushPayload } from "../../src/push/transports";
import { purgeCentralIdentities } from "../../src/services/maintenance";
import { inviteFacilityAdmin, reinviteAdmin, resetIdentity } from "../../src/services/vendor-admin.service";
import type { FacilityChoice, LoginResponse } from "../../src/wire/api";
import { TEST_PAROLASI, api, kontrol, totpKodu, type Ortam, type TestHesabi, type Yanit } from "./test-ortam";

export interface Kurgu {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly d: string;
  readonly e: string;
  readonly k: TestHesabi;
  readonly l: TestHesabi;
  /** K'nin B'deki hesabı. */
  readonly kB: string;
  readonly yonA: TestHesabi;
  readonly yonD: TestHesabi;
  /** K'nin güncel parolası ve TOTP sırrı (§3 parolayı, §7 sırrı değiştirir). */
  parola: string;
  sir: string;
}

export async function giris(o: Ortam, h: Pick<TestHesabi, "eposta" | "sir">, g: { tesisId?: string; parola?: string; totp?: string; ilerletme?: boolean } = {}): Promise<Yanit> {
  if (g.ilerletme !== false) o.saat.ilerlet(31_000);
  const govde = { eposta: h.eposta, parola: g.parola ?? TEST_PAROLASI, totp: g.totp ?? totpKodu(h.sir, o.saat.simdi()), ...(g.tesisId ? { tesisId: g.tesisId } : {}) };
  return api(o, "POST", "/api/oturum/ac", { govde });
}

export const veri = (r: Yanit): LoginResponse => r.json.data as LoginResponse;
export const idler = (l: readonly FacilityChoice[] | undefined): string => (l ?? []).map((t) => t.id).join(",");
export const oturumTesisi = async (o: Ortam, belirtec: string): Promise<string | number> => {
  const r = await api(o, "GET", "/api/oturum", { belirtec });
  return r.status === 200 ? ((r.json.data as { tesis: { id: string } }).tesis.id ?? "") : r.status;
};
const kH = (s: Kurgu) => ({ eposta: s.k.eposta, sir: s.sir });
const denetim = (o: Ortam, tesisId: string, entityId: string) =>
  withTesis(o.goc, { tesisId }, (tx) => tx.accountAudit.findMany({ where: { tesisId, entityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
const kimlikOf = (o: Ortam, eposta: string) => withCentral(o.goc, {}, (tx) => tx.identity.findUnique({ where: { emailDigest: o.anahtar.emailDigest(eposta) } }));

export async function bagla(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§5 davet: mevcut hesabımla bağlan");
  const yok = `yok-${randomUUID().slice(0, 8)}@ornek.test`;
  const davetK = await inviteFacilityAdmin(o.goc, { tesisId: s.e, email: s.k.eposta, name: "Davetli", validHours: 24 }, o.saat.simdi());
  const davetYok = await inviteFacilityAdmin(o.goc, { tesisId: s.e, email: yok, name: "Davetli", validHours: 24 }, o.saat.simdi());
  const incele = async (davet: string, eposta: string) => JSON.stringify((await api(o, "POST", "/api/davet/incele", { govde: { davet } })).json).replace(eposta, "<eposta>");
  const [iK, iYok] = [await incele(davetK.token, s.k.eposta), await incele(davetYok.token, yok)];
  kontrol("§5a ⭐ `davet/incele` yanıtı kimlik VAR (K) / YOK için BAYT-EŞİT (e-posta dışında)", iK === iYok && iK.includes('"success":true'), iK.slice(0, 160));
  const ref = await giris(o, { eposta: yok, sir: s.sir }, { parola: s.parola });
  const bag = async (davet: string, eposta: string, g: { parola?: string; totp?: string; sir?: string } = {}) => {
    o.saat.ilerlet(31_000);
    const t0 = Date.now();
    const govde = { davet, eposta, parola: g.parola ?? s.parola, totp: g.totp ?? totpKodu(g.sir ?? s.sir, o.saat.simdi()) };
    const r = await api(o, "POST", "/api/davet/bagla", { govde });
    return { r, ms: Date.now() - t0 };
  };
  const retler = {
    parola: await bag(davetK.token, s.k.eposta, { parola: "yanlis-parola-coklu-2026" }),
    totp: await bag(davetK.token, s.k.eposta, { totp: "000000" }),
    eposta: await bag(davetK.token, s.l.eposta, { parola: TEST_PAROLASI, sir: s.l.sir }),
    kimlikYok: await bag(davetYok.token, yok),
    davetYok: await bag(newToken(s.e).token, s.k.eposta),
  };
  const hepsi = Object.values(retler);
  kontrol(
    "§5b ⭐ yanlış parola · yanlış TOTP · e-posta uyuşmazlığı · kimlik yok · davet yok → girişle AYNI 401 (gövde bayt-eşit)",
    ref.status === 401 && hepsi.every((x) => x.r.status === 401 && JSON.stringify(x.r.json) === JSON.stringify(ref.json)),
    Object.entries(retler).map(([k, x]) => `${k}:${x.r.status}:${x.r.json.details?.code}`).join(" "),
  );
  kontrol(`§5c her ret süre tabanını bekler (≥ ${LOGIN_FAILURE_FLOOR_MS} ms)`, hepsi.every((x) => x.ms >= LOGIN_FAILURE_FLOOR_MS - 20), hepsi.map((x) => x.ms).join(","));
  const izler = (await denetim(o, s.e, davetK.accountId)).filter((r) => r.event !== "YONETICI_DAVET");
  kontrol(
    "§5d davetin denetimi sebepsiz TEK tip ret izi (3 ret, kimliğin varlığı okunmaz)",
    izler.length === 3 && izler.every((r) => r.event === "DAVET_BAGLAMA_REDDEDILDI" && JSON.stringify(Object.keys((r.summary ?? {}) as object)) === JSON.stringify(Object.keys((izler[0]!.summary ?? {}) as object))),
    izler.map((r) => r.event).join(","),
  );
  const ok = await bag(davetK.token, s.k.eposta);
  const liste = veri(await giris(o, kH(s), { parola: s.parola }));
  kontrol("§5e ⭐ doğru üçlüyle bağla 200 AKTİF · tek girişte A, B ve E listelenir", ok.r.status === 200 && JSON.stringify(ok.r.json.data) === JSON.stringify({ eposta: s.k.eposta, durum: "AKTIF" }) && idler(liste.tesisler) === [s.a, s.b, s.e].join(","), idler(liste.tesisler));
  const tekrar = await bag(davetK.token, s.k.eposta);
  kontrol("§5f davet tek kullanımlık: tekrar bağla aynı 401", tekrar.r.status === 401 && JSON.stringify(tekrar.r.json) === JSON.stringify(ref.json));
}

const sifirla = (o: Ortam, yon: TestHesabi, id: string) => api(o, "POST", `/api/hesaplar/${id}/sifirla`, { belirtec: yon.belirtec, govde: { clientToken: randomUUID() } });

export async function sifirlama(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§6 tesis yöneticisi sıfırlaması");
  const r = await sifirla(o, s.yonA, s.k.accountId);
  const hesap = await withTesis(o.goc, { tesisId: s.a }, (tx) => tx.account.findUnique({ where: { id: s.k.accountId }, select: { status: true, identityId: true } }));
  kontrol(
    "§6a ⭐ çok üyelikli kimlikte tesis yöneticisi sıfırlaması 409 KIMLIK_PAYLASIMLI · hesap AKTİF ve bağlı kalır",
    r.status === 409 && r.json.details?.code === "KIMLIK_PAYLASIMLI" && hesap?.status === "AKTIF" && hesap.identityId !== null,
    `${r.status} ${r.json.details?.code}`,
  );
  kontrol("§6b ret iletisi tesis adı/sayısı anmaz", !/Beta|Gama|Epsilon|\d/.test(r.json.message ?? ""), r.json.message ?? "");
  const tek = await sifirla(o, s.yonD, s.l.accountId);
  kontrol("§6c tek üyelikli kimlikte sıfırlama çalışır (200, yeni davet)", tek.status === 200 && typeof (tek.json.data as { davet?: unknown }).davet === "string", `${tek.status}`);
  const yeniden = await reinviteAdmin(o.goc, { tesisId: s.b, email: s.k.eposta, validHours: 24 }, o.saat.simdi()).then(() => null, (e: unknown) => e);
  const bHesap = await withTesis(o.goc, { tesisId: s.b }, (tx) => tx.account.findUnique({ where: { id: s.kB }, select: { status: true } }));
  kontrol("§6d satıcının yönetici yeniden daveti de paylaşımlı kimlikte 409 KIMLIK_PAYLASIMLI (hesap AKTİF kalır)", yeniden instanceof CloudError && yeniden.code === "KIMLIK_PAYLASIMLI" && bHesap?.status === "AKTIF", yeniden instanceof CloudError ? yeniden.code : String(yeniden));
}

export async function saticiZorlama(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§7 satıcı CLI kimlik sıfırlaması");
  const zorlamasiz = await resetIdentity(o.goc, { tesisId: s.a, email: s.k.eposta, validHours: 24 }, o.saat.simdi()).then(() => null, (e: unknown) => e);
  kontrol("§7a zorlamasız kimlik sıfırlaması RED (400 GOVDE_GECERSIZ)", zorlamasiz instanceof CloudError && zorlamasiz.code === "GOVDE_GECERSIZ");
  const acB = veri(await giris(o, kH(s), { parola: s.parola, tesisId: s.b })).belirtec;
  const zorla = { talep: "TLP-2026-77", gerekce: "telefon kaybı; kimlik telefonla doğrulandı" };
  const r = await resetIdentity(o.goc, { tesisId: s.a, email: s.k.eposta, validHours: 24, zorla }, o.saat.simdi());
  const izA = (await denetim(o, s.a, s.k.accountId)).filter((x) => x.event === "KIMLIK_SIFIRLANDI");
  const izB = (await denetim(o, s.b, s.kB)).filter((x) => x.event === "KIMLIK_SIFIRLANDI");
  const ozA = (izA[0]?.summary ?? {}) as Record<string, unknown>;
  kontrol(
    "§7b ⭐ zorlama denetime yazılır: sıfırlanan tesiste talep + gerekçe (aktör satici-cli), öteki üyelikte talep",
    izA.length === 1 && izA[0]!.actor === "satici-cli" && ozA.talep === zorla.talep && ozA.gerekce === zorla.gerekce && izB.length === 1 && (izB[0]!.summary as Record<string, unknown>).talep === zorla.talep,
    JSON.stringify(ozA),
  );
  kontrol("§7c bütün tesislerde oturum kapanır ve giriş durur (401)", (await oturumTesisi(o, acB)) === 401 && (await giris(o, kH(s), { parola: s.parola })).status === 401);
  const yabanci = await inviteFacilityAdmin(o.goc, { tesisId: s.d, email: s.k.eposta, name: "Yabancı", validHours: 24, zorla: { talep: "BEKCI", gerekce: "bekçi: yabancı davet sondası" } }, o.saat.simdi());
  const yk = await acceptInvite(o.ctx, { token: yabanci.token, password: "saldirgan-parolasi-2026" });
  o.saat.ilerlet(31_000);
  const yo = await confirmInvite(o.ctx, { token: yabanci.token, totp: totpKodu(yk.totpSirri, o.saat.simdi()) }).then(() => null, (e: unknown) => e);
  kontrol("§7d ⭐ başka tesisin daveti sıfırlanmış kimliği yeniden SIRLAYAMAZ (onay 409 DAVET_ETKINLESTIRILEMEDI)", yo instanceof CloudError && yo.code === "DAVET_ETKINLESTIRILEMEDI", yo instanceof CloudError ? yo.code : String(yo));
  const kabul = await acceptInvite(o.ctx, { token: r.token, password: "bekci-kurtarilan-parola-2026" });
  o.saat.ilerlet(31_000);
  await confirmInvite(o.ctx, { token: r.token, totp: totpKodu(kabul.totpSirri, o.saat.simdi()) });
  s.parola = "bekci-kurtarilan-parola-2026";
  s.sir = kabul.totpSirri;
  const g = await giris(o, kH(s), { parola: s.parola });
  kontrol("§7e satıcı davetini kişi kabul edince kimlik yeniden sırlanır: tek girişte A, B, E yine listelenir", g.status === 200 && idler(veri(g).tesisler) === [s.a, s.b, s.e].join(","), idler(veri(g).tesisler));
}

export async function cihazlar(o: Ortam, s: Kurgu): Promise<void> {
  console.log("\n§8 cihaz kaydı bütün üyeliklerde + push yükü");
  const belirtec = veri(await giris(o, kH(s), { parola: s.parola })).belirtec;
  const tok = `ExponentPushToken[${randomUUID()}]`;
  const tokenHash = createHash("sha256").update(tok, "utf8").digest("hex");
  const kayit = await api(o, "POST", "/api/cihazlar", { belirtec, govde: { platform: "android", belirtec: tok } });
  const satirlar = async (aktif: boolean) => {
    const out: string[] = [];
    for (const t of [s.a, s.b, s.c, s.e]) {
      const n = await withTesis(o.goc, { tesisId: t }, (tx) => tx.pushDevice.count({ where: { tesisId: t, tokenHash, active: aktif } }));
      if (n > 0) out.push(t);
    }
    return out.join(",");
  };
  kontrol("§8a ⭐ cihaz kaydı kimliğin her AKTİF üyeliğinde tesis başına satır yaratır (A, B, E; KİLİTLİ C yok)", kayit.status === 201 && (await satirlar(true)) === [s.a, s.b, s.e].join(","), await satirlar(true));
  const id = (kayit.json.data as { id: string }).id;
  const kaldir = await api(o, "POST", `/api/cihazlar/${id}/kaldir`, { belirtec, govde: {} });
  const [acik, pasif] = [await satirlar(true), await satirlar(false)];
  kontrol("§8b cihazı kaldırmak bütün üyeliklerde pasife çeker", kaldir.status === 200 && acik === "" && pasif === [s.a, s.b, s.e].join(","), `${kaldir.status} açık=${acik} pasif=${pasif}`);
  const web = JSON.parse(webPushPayload({ id: "n", title: "t", body: "b", route: "/pano", tesisId: s.b })) as Record<string, unknown>;
  kontrol("§8c ⭐ web push gövdesi tesisi taşır (`tesisId`)", web.tesisId === s.b && web.rota === "/pano" && web.bildirimId === "n");
}

export async function kimlikSilme(o: Ortam, s: Kurgu, m: TestHesabi): Promise<void> {
  console.log("\n§9 merkez kimliğinin kapanışı + 30 gün sonra silinmesi");
  const durum = await api(o, "POST", `/api/hesaplar/${m.accountId}/durum`, { belirtec: s.yonD.belirtec, govde: { clientToken: randomUUID(), durum: "PASIF" } });
  const once = await kimlikOf(o, m.eposta);
  await purgeCentralIdentities(o.ctx, o.saat.simdi());
  const kapali = once ? await withCentral(o.goc, {}, (tx) => tx.identity.findUnique({ where: { id: once.id } })) : null;
  const kK = await kimlikOf(o, s.k.eposta);
  kontrol("§9a ⭐ bağlı üyeliği kalmayan kimlik PASİF (kapanış anı dolu); çok üyelikli kimlik AKTİF kalır", durum.status === 200 && kapali?.status === "PASIF" && kapali.closedAt !== null && kK?.status === "AKTIF", `${durum.status} ${kapali?.status}`);
  o.saat.ilerlet(29 * 86_400_000);
  await purgeCentralIdentities(o.ctx, o.saat.simdi());
  const erken = kapali ? await withCentral(o.goc, {}, (tx) => tx.identity.findUnique({ where: { id: kapali.id } })) : null;
  kontrol("§9b 30 gün dolmadan sır durur", erken?.passwordHash !== null && erken?.identityPurgedAt === null);
  o.saat.ilerlet(2 * 86_400_000);
  await purgeCentralIdentities(o.ctx, o.saat.simdi());
  const silik = kapali ? await withCentral(o.goc, {}, (tx) => tx.identity.findUnique({ where: { id: kapali.id } })) : null;
  const uyelik = kapali ? await withCentral(o.goc, {}, (tx) => tx.loginRoute.count({ where: { identityId: kapali.id } })) : -1;
  kontrol(
    "§9c ⭐ 30 gün sonra tombstone: parola + TOTP NULL, e-posta özeti anlamsız (e-posta serbest), üyelik satırı yok, satır kalır",
    silik !== null && silik.passwordHash === null && silik.totpSecretSealed === null && silik.totpLastStep === null && silik.identityPurgedAt !== null && silik.emailDigest !== o.anahtar.emailDigest(m.eposta) && /^[0-9a-f]{64}$/.test(silik.emailDigest) && uyelik === 0,
    `${silik?.status} üyelik=${uyelik}`,
  );
  kontrol("§9d e-posta özeti artık hiçbir kimliğe çözülmez", (await kimlikOf(o, m.eposta)) === null);
}
