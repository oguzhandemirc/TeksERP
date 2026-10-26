// =============================================================================
// BEKÇİ — BİLDİRİM ZİLİ (içeriksiz SSE hub'ı + uzun yoklama, N1-ZIL, plan §3.9)
// Çalıştır: npx tsx scripts/run-all-tests.ts test_bildirim_zil
// =============================================================================
// NEDEN: üç tuzak sessiz bozulur — sıkıştırma akışı tamponlar (zil hiç gelmez, istemci yoklamaya
// düşer, kimse fark etmez), açık akış kapanışı 5 sn zorla çıkışa sürükler, uzun bağlantı gecikme
// tablosunu "yavaş uç" diye kirletir. Süreç içi sunucu (127.0.0.1:0; ikinci kalıcı süreç yok), ham
// `node:http` istemcisi (fetch gzip'i çözer ve tamponlamayı gizlerdi), kendi kullanıcıları.
//   §1 oturumsuz 401 · bayrak kapalı 409
//   §2 ⭐ `Accept-Encoding: gzip` ile ilk olay (`merhaba`) < 1 sn, gövde sıkıştırılmamış, SSE başlıkları
//   §3 `: ping` gelir (aralık env ile kısaltıldı)
//   §4 6. akış EN ESKİYİ kapatır (`kapat {neden:fazla}`), kullanıcı başı 5 kalır
//   §5 ⭐ outbox olayı → (pg_notify → dağıtıcı → kanca) → `zil` < 2 sn, içeriksiz {k, rev, alarmRev}
//   §6 uzun yoklama: eski rev hemen döner, güncel rev zil gelince döner
//   §7 ⭐ gecikme tablosuna zil/bekle satırı düşmez (özet düşer — körlük zemini)
//   §8 yetki değişimi akışı kapatır (`yetki`); oturum iptali yeniden doğrulamada kapatır (`oturum`)
//   §9 ⭐ kapanış: `closeAll` bütün akışları bitirir, ardından server.close < 1 sn (5 sn zorla çıkış yok)
//
//   §9d server.ts kapanışında `shutdownNotifications()` (→ `closeAllBells`) `server.close`tan ÖNCE
//
// NEGATİF SONDA (2026-10-24, md5 ile birebir geri alındı; temel 25/0, §9d eklenmeden önce):
//   1a compression filtresi kaldırıldı, `no-transform` duruyor → 25/0 (ikinci kat tek başına korur — bilinçli)
//   1b filtre + `no-transform` ikisi kaldırıldı → 19/6 (§2a "gelmedi", §2b `br`, §2c, §2d, §3, §4b)
//   2  latency muafiyeti kapatıldı → §7a ❌ (zil + bekle anahtarı düştü)
//   3  grantPermission'daki `closeUserBells` kaldırıldı → §8a ❌
//   4  `closeAll` akışları kapatmıyor → §9a ❌ + §9c ❌ (server.close 4000 ms'de bitmedi = zorla çıkış)
// =============================================================================
process.env.TEKSERP_BILDIRIM_ZIL_PING_MS = "300";
process.env.TEKSERP_BILDIRIM_ZIL_DOGRULAMA_MS = "400";

import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { emitNotification } from "../src/services/helpers/notification-emit.helper";
import { reconcileNotificationJobs, stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { latencySnapshot } from "../src/services/latency-stats.service";
import { bellHubResetForTest, bellHubStateForTest, closeAll } from "../src/services/notification-bell-hub";
import { PermissionManagementService } from "../src/services/permission-management.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { BildirimFikstur } from "./lib/bildirim-http-fikstur";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exit(1);
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detay ? ` — ${detay}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

const TAG = `bzil-${Date.now().toString(36)}`;
const fx = new BildirimFikstur(TAG);
const outboxKeys: string[] = [];
const BASLANGIC = new Date();
const TUR = "siparis.patron-siparisi";
let statsIlk: { factoryDay: Date; events: number } | null | undefined;

interface Olay { ad: string; veri: any; an: number }
interface Akis {
  status: number;
  headers: http.IncomingHttpHeaders;
  olaylar: Olay[];
  pingler: number;
  bitti: boolean;
  bittiAn: number;
  acildi: number;
  req: http.ClientRequest;
  bekle: (pred: () => boolean, ms: number) => Promise<boolean>;
}

/** Ham SSE istemcisi: gövdeyi ÇÖZMEZ — sıkıştırılmış akış olay üretemez (tamponlama görünür olur). */
function akisAc(token: string | null, ekBaslik: Record<string, string> = {}): Promise<Akis> {
  return new Promise((resolve, reject) => {
    const acildi = Date.now();
    const req = http.get(`${fx.base}/api/bildirim/zil`, {
      headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...ekBaslik },
    });
    req.on("error", reject);
    req.on("response", (res) => {
      const a: Akis = {
        status: res.statusCode ?? 0, headers: res.headers, olaylar: [], pingler: 0, bitti: false, bittiAn: 0, acildi, req,
        bekle: async (pred, ms) => {
          const son = Date.now() + ms;
          while (Date.now() < son) {
            if (pred()) return true;
            await new Promise((r) => setTimeout(r, 20));
          }
          return pred();
        },
      };
      let tampon = "";
      res.setEncoding("utf8");
      res.on("data", (parca: string) => {
        tampon += parca;
        let i: number;
        while ((i = tampon.indexOf("\n\n")) >= 0) {
          const blok = tampon.slice(0, i);
          tampon = tampon.slice(i + 2);
          if (blok.startsWith(": ping")) { a.pingler++; continue; }
          const ad = /^event: (.+)$/m.exec(blok)?.[1];
          const veri = /^data: (.+)$/m.exec(blok)?.[1];
          if (ad) a.olaylar.push({ ad, veri: veri ? JSON.parse(veri) : null, an: Date.now() });
        }
      });
      const kapan = () => { if (!a.bitti) { a.bitti = true; a.bittiAn = Date.now(); } };
      res.on("end", kapan);
      res.on("close", kapan);
      resolve(a);
    });
  });
}

const olayVar = (a: Akis, ad: string) => () => a.olaylar.some((o) => o.ad === ad);

async function govde(): Promise<void> {
  await fx.ac();
  const a = await fx.kullanici("a", ["order:read", "order:write"]); // patron siparişinin varsayılan alıcısı order:write
  const b = await fx.kullanici("b", ["order:read"]);

  // §1
  const anonim = await akisAc(null);
  anonim.req.destroy();
  check("§1a oturumsuz zil 401", anonim.status === 401);
  await fx.bayrak(false);
  const kapali = await akisAc(a.token);
  kapali.req.destroy();
  check("§1b bayrak kapalı zil 409", kapali.status === 409);
  await fx.bayrak(true);

  // §2 gzip'li istek
  const z1 = await akisAc(a.token, { "Accept-Encoding": "gzip, deflate, br" });
  const geldi = await z1.bekle(olayVar(z1, "merhaba"), 1000);
  const merhaba = z1.olaylar.find((o) => o.ad === "merhaba");
  check("§2a ⭐ gzip'li istekte `merhaba` < 1 sn", geldi && !!merhaba && merhaba.an - z1.acildi < 1000, merhaba ? `${merhaba.an - z1.acildi} ms` : "gelmedi");
  check("§2b gövde sıkıştırılmadı (content-encoding yok)", z1.headers["content-encoding"] === undefined, String(z1.headers["content-encoding"]));
  check("§2c SSE başlıkları (event-stream · no-transform · X-Accel-Buffering)",
    String(z1.headers["content-type"]).startsWith("text/event-stream") && /no-transform/.test(String(z1.headers["cache-control"])) && z1.headers["x-accel-buffering"] === "no");
  check("§2d `merhaba` içeriksiz {epoch, rev, alarmRev}", !!merhaba && Object.keys(merhaba.veri).sort().join(",") === "alarmRev,epoch,rev");

  // §3 ping
  check("§3 `: ping` gelir", await z1.bekle(() => z1.pingler > 0, 2000), `${z1.pingler} ping`);

  // §4 kullanıcı başı 5
  const ek: Akis[] = [];
  for (let i = 0; i < 4; i++) {
    const s = await akisAc(a.token);
    await s.bekle(olayVar(s, "merhaba"), 1000);
    ek.push(s);
  }
  check("§4a 5 akış açık", bellHubStateForTest().perUser[a.id] === 5);
  const altinci = await akisAc(a.token);
  await altinci.bekle(olayVar(altinci, "merhaba"), 1000);
  const eskiKapandi = await z1.bekle(() => z1.bitti, 1000);
  const neden = z1.olaylar.find((o) => o.ad === "kapat")?.veri?.neden;
  check("§4b 6. akış EN ESKİYİ kapatır (`kapat {neden:fazla}`)", eskiKapandi && neden === "fazla", String(neden));
  check("§4c kullanıcı başı 5 kalır, diğerleri açık", bellHubStateForTest().perUser[a.id] === 5 && ek.every((s) => !s.bitti) && !altinci.bitti);
  for (const s of ek) s.req.destroy();
  await altinci.bekle(() => bellHubStateForTest().perUser[a.id] === 1, 1000);
  check("§4d istemci kopunca hub sayacı düşer", bellHubStateForTest().perUser[a.id] === 1, JSON.stringify(bellHubStateForTest().perUser[a.id]));

  // §5 outbox → zil (gerçek yol: emit tx → pg_notify → LISTEN → dağıtıcı → kanca)
  const calisiyor = await reconcileNotificationJobs({ sweepMs: 60_000 });
  check("§5a dağıtıcı bayrakla başladı", calisiyor);
  await new Promise((r) => setTimeout(r, 300)); // LISTEN kurulsun
  const once = altinci.olaylar.length;
  statsIlk = await prisma.notificationDailyStats.findFirst({ where: { kind: TUR }, orderBy: { factoryDay: "desc" }, select: { factoryDay: true, events: true } });
  const key = `${TAG}-${randomUUID()}`;
  outboxKeys.push(key);
  const t0 = Date.now();
  await prisma.$transaction((tx) => emitNotification(tx, TUR, { type: "order", id: null, key }, { belgeNo: key, musteri: "Deneme" }, { actorUserId: b.id }));
  const zilGeldi = await altinci.bekle(() => altinci.olaylar.slice(once).some((o) => o.ad === "zil"), 2000);
  const z = altinci.olaylar.slice(once).find((o) => o.ad === "zil");
  check("§5b ⭐ outbox olayı → zil < 2 sn", zilGeldi && !!z && z.an - t0 < 2000, z ? `${z.an - t0} ms` : "gelmedi");
  check("§5c zil içeriksiz {k:'kutu', rev, alarmRev}", !!z && z.veri.k === "kutu" && Object.keys(z.veri).sort().join(",") === "alarmRev,k,rev" && z.veri.rev >= 1);
  const ozet = await fx.istek(a.token, "GET", "/api/bildirim/ozet");
  check("§5d zilden sonra özet satırı sayar (veri REST'ten)", ozet.json?.data?.okunmamis >= 1 && ozet.json?.data?.rev === z?.veri.rev, JSON.stringify(ozet.json?.data));
  check("§5e özet `vardiyaBitis` taşır (süren vardiya yoksa null; erteleme menüsü buna göre pasifler)", ozet.json?.data !== undefined && "vardiyaBitis" in ozet.json.data, JSON.stringify(ozet.json?.data));
  stopNotificationJobs();

  // §6 uzun yoklama
  const rev = ozet.json?.data?.rev as number;
  const epoch = ozet.json?.data?.epoch as number;
  const t1 = Date.now();
  const eski = await fx.istek(a.token, "GET", `/api/bildirim/bekle?rev=${rev + 7}&epoch=${epoch}`);
  check("§6a eski rev → hemen döner (degisti:true)", eski.status === 200 && eski.json?.data?.degisti === true && Date.now() - t1 < 1000);
  const t2 = Date.now();
  const bekleyen = fx.istek(a.token, "GET", `/api/bildirim/bekle?rev=${rev}&epoch=${epoch}`);
  await new Promise((r) => setTimeout(r, 300));
  const satir = (await prisma.notificationInbox.findFirst({ where: { userId: a.id }, select: { id: true } }))!;
  await fx.istek(a.token, "POST", `/api/bildirim/${satir.id}/okundu`); // kendi işareti de zil çalar
  const sonuc = await bekleyen;
  const sure = Date.now() - t2;
  check("§6b güncel rev bekler, zil gelince döner (≪ 25 sn)", sonuc.status === 200 && sonuc.json?.data?.degisti === true && sure >= 250 && sure < 3000, `${sure} ms`);
  check("§6c başka epoch → hemen döner", (await fx.istek(a.token, "GET", `/api/bildirim/bekle?rev=${rev + 1}&epoch=1`)).json?.data?.degisti === true);

  // §7 gecikme ölçümü
  const anahtarlar = latencySnapshot().routes.map((r) => r.route);
  const zilSatiri = anahtarlar.filter((k) => /\/api\/bildirim\/(zil|bekle)/.test(k));
  check("§7a ⭐ gecikme tablosunda zil/bekle anahtarı YOK", zilSatiri.length === 0, zilSatiri.join(", ") || "yok");
  check("§7b körlük zemini: özet ucu ölçülüyor", anahtarlar.some((k) => k.includes("/api/bildirim/ozet")), anahtarlar.filter((k) => k.includes("bildirim")).join(", "));

  // §8 yetki değişimi + oturum iptali
  const yb = await akisAc(b.token);
  await yb.bekle(olayVar(yb, "merhaba"), 1000);
  const izin = (await prisma.permission.findUnique({ where: { code: "license:view" }, select: { id: true } }))!;
  await PermissionManagementService.grantPermission(b.id, { permissionId: izin.id }, undefined);
  const ybKapandi = await yb.bekle(() => yb.bitti, 1000);
  check("§8a izin ataması akışı kapatır (`yetki`)", ybKapandi && yb.olaylar.some((o) => o.ad === "kapat" && o.veri?.neden === "yetki"));
  const oturumluToken = await fx.giris(b.username);
  const yo = await akisAc(oturumluToken);
  await yo.bekle(olayVar(yo, "merhaba"), 1000);
  await prisma.session.updateMany({ where: { userId: b.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "test" } });
  const yoKapandi = await yo.bekle(() => yo.bitti, 2000);
  check("§8b oturum iptali yeniden doğrulamada akışı kapatır (`oturum`)", yoKapandi && yo.olaylar.some((o) => o.ad === "kapat" && o.veri?.neden === "oturum"));

  // §9 kapanış
  const k1 = await akisAc(a.token);
  const k2 = await akisAc(a.token);
  await k2.bekle(olayVar(k2, "merhaba"), 1000);
  const kapatilan = closeAll();
  const bitti = await k1.bekle(() => k1.bitti && k2.bitti && altinci.bitti, 1000);
  check("§9a ⭐ closeAll bütün akışları bitirir", bitti && kapatilan >= 3, `${kapatilan} akış`);
  const red = await akisAc(a.token);
  red.req.destroy();
  check("§9b kapanırken yeni akış 503", red.status === 503);
  const server = fx.server!;
  const t3 = Date.now();
  const kapandi = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 4000);
    server.close(() => { clearTimeout(t); resolve(true); });
  });
  check("§9c ⭐ ardından server.close < 1 sn (zorla çıkışa düşmez)", kapandi && Date.now() - t3 < 1000, `${Date.now() - t3} ms`);
  fx.server = null;
  bellHubResetForTest();
  const kaynak = readFileSync(join(__dirname, "..", "src", "server.ts"), "utf8");
  const iKapanis = kaynak.indexOf("function gracefulShutdown(");
  const iZil = kaynak.indexOf("shutdownNotifications()", iKapanis);
  const iDinleyici = kaynak.indexOf("server.close(", iKapanis);
  const job = readFileSync(join(__dirname, "..", "src", "jobs", "notification-dispatch.job.ts"), "utf8");
  const govdeJob = job.slice(job.indexOf("export function shutdownNotifications("));
  check("§9d server.ts kapanışı zili dinleyicilerden ÖNCE kapatır (`shutdownNotifications` → `closeAllBells`)",
    iKapanis > 0 && iZil > iKapanis && iDinleyici > 0 && iZil < iDinleyici && /closeAllBells\(\)/.test(govdeJob.slice(0, 400)),
    `${iZil} < ${iDinleyici}`);
}

async function main(): Promise<void> {
  console.log("\n=== Bildirim zili (SSE hub) ===\n");
  try {
    await govde();
  } finally {
    stopNotificationJobs();
    try {
      if (outboxKeys.length) {
        await prisma.notificationOutbox.deleteMany({ where: { subjectKey: { in: outboxKeys } } });
        // Olay görebilen HER kullanıcıya dağıtıldı: bu koşumda doğan satırlar silinir, günlük sayaç geri döner.
        await prisma.notificationInbox.deleteMany({ where: { kind: TUR, createdAt: { gte: BASLANGIC } } });
        const gun = await prisma.notificationDailyStats.findFirst({ where: { kind: TUR }, orderBy: { factoryDay: "desc" } });
        if (gun && statsIlk === null) await prisma.notificationDailyStats.delete({ where: { id: gun.id } });
        else if (gun && statsIlk) await prisma.notificationDailyStats.update({ where: { id: gun.id }, data: { events: statsIlk.events } });
      }
      await fx.kapat();
    } catch (err) {
      fail++;
      console.error("❌ temizlik başarısız", err);
    }
  }
}

main()
  .catch((err) => {
    fail++;
    console.error("❌ beklenmeyen hata", err);
  })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
