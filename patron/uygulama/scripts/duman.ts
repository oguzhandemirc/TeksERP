// YEREL API DUMANI — uygulamanın KENDİ API istemcisiyle (src/api) zincir: davet → parola → TOTP onay →
// giriş → oturum/pano → gelen kutusuna sipariş → durum oku → iptal (tekrarı aynı sonuç) → çıkış.
// Yalnız yerel _test sunucusuna karşı koşulur (127.0.0.1/localhost dışı adres RED).
//   ../sunucu/node_modules/.bin/tsx scripts/duman.ts --api=http://127.0.0.1:4631 --davet=<belirteç>
import { createHmac, randomUUID } from "node:crypto";
import { ApiError, createClient } from "../src/api/client";
import { createApi } from "../src/api/endpoints";
import type { OrderMessageBody } from "../src/api/wire";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const API = arg("api") ?? "http://127.0.0.1:4631";
const INVITE = arg("davet");
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(API)) throw new Error("duman yalnız yerel sunucuya koşulur");
if (!INVITE) throw new Error("--davet=<belirteç> zorunlu (scripts/tesis.ts yonetici-davet çıktısı)");

function base32(s: string): Buffer {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += alpha.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
function totp(secret: string, atMs = Date.now()): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const d = createHmac("sha1", base32(secret)).update(buf).digest();
  const o = d[d.length - 1]! & 0xf;
  return String((d.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
const nextStep = async () => {
  const wait = 30_000 - (Date.now() % 30_000) + 500;
  console.log(`  … TOTP tekrar koruması: sonraki adım için ${Math.round(wait / 1000)} sn`);
  await new Promise((r) => setTimeout(r, wait));
};

let token: string | null = null;
const api = createApi(createClient({ baseUrl: API, getToken: () => token }));
let step = 0;
const ok = (m: string) => console.log(`✓ ${++step}. ${m}`);
function expect(cond: unknown, m: string): asserts cond {
  if (!cond) throw new Error(`KIRMIZI: ${m}`);
}

async function main(): Promise<void> {
  const info = await api.inviteInspect(INVITE!);
  ok(`davet incelendi (${info.eposta}, tesis: ${info.tesisAd ?? "—"})`);
  const parola = `Duman-${randomUUID()}`;
  const acc = await api.inviteAccept(INVITE!, parola);
  expect(acc.totpSirri.length >= 16 && acc.otpauth.startsWith("otpauth://"), "TOTP sırrı yok");
  ok("parola belirlendi, TOTP sırrı alındı");
  await api.inviteConfirm(INVITE!, totp(acc.totpSirri));
  ok("ilk TOTP kodu onaylandı → AKTİF");

  try {
    await api.login({ eposta: info.eposta, parola, totp: "000000", istemci: "mobil" });
    throw new Error("KIRMIZI: yanlış TOTP ile giriş açıldı");
  } catch (e) {
    expect(e instanceof ApiError && e.status === 401 && e.code === "GIRIS_BASARISIZ", `yanlış TOTP 401 GIRIS_BASARISIZ değil: ${String(e)}`);
  }
  ok("yanlış TOTP → 401 GIRIS_BASARISIZ (details.code)");

  await nextStep();
  const login = await api.login({ eposta: info.eposta, parola, totp: totp(acc.totpSirri), istemci: "mobil" });
  token = login.belirtec;
  ok(`giriş (izin: ${login.hesap.izinler.length})`);

  const s = await api.session();
  expect(s.hesap.eposta === info.eposta, "oturum hesabı farklı");
  ok(`oturum: tesis '${s.tesis.ad ?? "—"}', eşitleme ${s.esitleme ? s.esitleme.sonEsitleme : "henüz yok"}`);
  try {
    await api.snapshot("ozet.siparis");
    ok("pano: ozet.siparis okundu");
  } catch (e) {
    expect(e instanceof ApiError && e.kind === "BULUNAMADI", `pano beklenmeyen hata: ${String(e)}`);
    ok(`pano: ozet.siparis henüz yok (404 ${e.code}) — fabrika eşitlemesi yok`);
  }

  const govde: OrderMessageBody = { cariKartId: randomUUID(), doviz: "TRY", kalemler: [{ urunId: randomUUID(), miktar: "125.5" }] };
  const mesajId = randomUUID();
  const m = await api.inboxCreate(mesajId, "SIPARIS", govde);
  expect(m.mesajId === mesajId && m.durum === "BEKLIYOR", "mesaj BEKLIYOR doğmadı");
  ok("gelen kutusuna sipariş yazıldı (BEKLIYOR)");
  const again = await api.inboxCreate(mesajId, "SIPARIS", govde);
  expect(again.mesajId === mesajId, "aynı mesajId tekrarında farklı kayıt");
  ok("aynı işlem kimliğiyle tekrar → aynı mesaj (idempotent)");
  const got = await api.inboxGet(mesajId);
  expect(got.durum === "BEKLIYOR", "durum okunamadı");
  const list = await api.inboxList({ durum: "BEKLIYOR" });
  expect(list.kayitlar.some((x) => x.mesajId === mesajId), "listede yok");
  ok("durum okundu (tek + liste süzgeci)");
  const c = await api.inboxCancel(mesajId);
  expect(c.durum === "IPTAL", "iptal olmadı");
  ok("yazar BEKLIYOR'da iptal etti → IPTAL");
  const c2 = await api.inboxCancel(mesajId);
  expect(c2.durum === "IPTAL" && c2.iptal === c.iptal, "ikinci iptal aynı sonucu vermedi");
  ok("ikinci iptal → aynı sonuç (idempotent; damga değişmedi)");
  await api.logout();
  token = login.belirtec;
  try {
    await api.session();
    throw new Error("KIRMIZI: çıkıştan sonra oturum yaşıyor");
  } catch (e) {
    expect(e instanceof ApiError && e.status === 401, "çıkış sonrası 401 değil");
    ok("çıkış → eski belirteç 401");
  }
  console.log(`\nDUMAN YEŞİL — ${step} adım`);
}

main().catch((e: unknown) => {
  console.error(e instanceof ApiError ? `KIRMIZI: ${e.status} ${e.code} ${e.message}` : String(e));
  process.exit(1);
});
