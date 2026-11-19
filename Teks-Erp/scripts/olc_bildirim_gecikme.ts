// =============================================================================
// ÖLÇÜM — bildirim uçtan uca gecikmesi: emit tx COMMIT → gelen kutusu satırı + zil sinyali
// =============================================================================
// Gerçek zamanlayıcıyla (gözetmen + 5 sn süpürme + LISTEN dürtmesi) ölçer; zil, hub'a abone edilen sahte
// SSE yanıtına `event: zil` yazıldığı an. Kip `--kip ardisik` (aralıklı tek olaylar) · `patlama` (eşzamanlı) ·
// `supurme` (LISTEN yok: dürtmesiz yalnız 5 sn süpürme, karşılaştırma için). Yalnız `_test` DB.
// Kullanım: npx tsx scripts/olc_bildirim_gecikme.ts [--n 50] [--kip ardisik|patlama|supurme] [--aralik 300]
// =============================================================================
import { randomUUID } from "node:crypto";
import * as bcrypt from "bcryptjs";
import type { Response } from "express";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { emitNotification } from "../src/services/helpers/notification-emit.helper";
import { subscribe } from "../src/services/notification-bell-hub";
import { reconcileNotificationJobs, stopNotificationJobs } from "../src/jobs/notification-dispatch.job";
import { runNotificationDispatchOnce } from "../src/services/notification-dispatch.service";
import type { NotificationKind } from "../src/constants/notification-catalog";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) throw new Error(`DURDURULDU — ${engel}`);

const arg = (ad: string, vars: string): string => {
  const i = process.argv.indexOf(`--${ad}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : vars;
};
const N = Number(arg("n", "50"));
const KIP = arg("kip", "ardisik");
const ARALIK = Number(arg("aralik", "300"));
const OLAY: NotificationKind = "siparis.patron-siparisi";
const ek = Date.now().toString(36);
const BASLANGIC = new Date(Date.now() - 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sahte SSE yanıtı: her `event: zil` yazımının anını kaydeder. */
function sahteAkis(zil: number[]): Response {
  const res = {
    statusCode: 0,
    status() { return res; },
    setHeader() { return res; },
    flushHeaders() {},
    socket: { setNoDelay() {} },
    on() { return res; },
    end() {},
    write(chunk: string) {
      if (chunk.startsWith("event: zil")) zil.push(performance.now());
      return true;
    },
  };
  return res as unknown as Response;
}

function yuzdelik(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}

async function main(): Promise<void> {
  const key = SETTING_KEYS.BILDIRIM_GELEN_KUTUSU_ENABLED;
  const ilk = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
  const perms = await prisma.permission.findMany({ where: { code: { in: ["order:read", "order:write"] } }, select: { id: true } });
  const u = await prisma.user.create({
    data: { username: `olc_gecikme_${ek}`, fullName: `TEST-OLCUM ${ek}`, passwordHash: await bcrypt.hash(randomUUID(), 4) },
    select: { id: true },
  });
  for (const p of perms) await prisma.userPermission.create({ data: { userId: u.id, permissionId: p.id } });
  const zil: number[] = [];
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value: true }, update: { value: true } });
    // supurme: dürtmesiz taban — süpürme 5 sn, LISTEN açılmasın diye zamanlayıcı yerine elle 5 sn tur.
    let supurucu: NodeJS.Timeout | null = null;
    if (KIP === "supurme") {
      supurucu = setInterval(() => void runNotificationDispatchOnce(), 5_000);
    } else {
      await reconcileNotificationJobs();
      await sleep(500);
    }
    subscribe(u.id, sahteAkis(zil), async () => true);
    const commitler: number[] = [];
    const tek = async (i: number) => {
      await prisma.$transaction((tx) => emitNotification(tx, OLAY, { type: "order", id: null, key: `olc-${ek}-${i}` }, { siparisNo: `O${i}` }, { actorUserId: null }));
      commitler[i] = performance.now();
    };
    const t0 = performance.now();
    if (KIP === "patlama") {
      await Promise.all(Array.from({ length: N }, (_, i) => tek(i)));
    } else {
      for (let i = 0; i < N; i++) {
        const zilOnce = zil.length;
        await tek(i);
        const son = performance.now() + 8_000;
        while (zil.length === zilOnce && performance.now() < son) await sleep(5);
        await sleep(KIP === "supurme" ? Math.random() * 1000 : ARALIK);
      }
    }
    // Patlama: son satır kutuya girene dek bekle.
    const son = performance.now() + 15_000;
    while (performance.now() < son) {
      const c = (await prisma.notificationInbox.aggregate({ where: { userId: u.id }, _sum: { count: true } }))._sum.count ?? 0;
      if (c >= N) break;
      await sleep(20);
    }
    if (supurucu) clearInterval(supurucu);
    const satir = (await prisma.notificationInbox.aggregate({ where: { userId: u.id }, _sum: { count: true } }))._sum.count ?? 0;
    let sureler: number[];
    if (KIP === "patlama") {
      const sonCommit = Math.max(...commitler);
      sureler = [zil[zil.length - 1]! - sonCommit];
      console.log(`patlama: ${N} eşzamanlı emit · commit penceresi ${(sonCommit - t0).toFixed(0)} ms · zil sayısı ${zil.length} · son commit → son zil ${sureler[0]!.toFixed(0)} ms`);
    } else {
      sureler = commitler.map((c) => (zil.find((z) => z >= c) ?? Number.NaN) - c);
    }
    const ok = sureler.filter((x) => Number.isFinite(x));
    console.log(`kip=${KIP} n=${N} · kutu sayacı (count toplamı) ${satir}/${N} · zil eşleşen ${ok.length}`);
    if (ok.length) {
      console.log(`commit → zil (ms): p50 ${yuzdelik(ok, 50).toFixed(0)} · p95 ${yuzdelik(ok, 95).toFixed(0)} · en çok ${Math.max(...ok).toFixed(0)} · en az ${Math.min(...ok).toFixed(0)}`);
    }
  } finally {
    stopNotificationJobs();
    await prisma.notificationInbox.deleteMany({ where: { userId: u.id } });
    await prisma.notificationOutbox.deleteMany({ where: { kind: OLAY, subjectKey: { startsWith: `olc-${ek}-` }, createdAt: { gte: BASLANGIC } } });
    await prisma.userPermission.deleteMany({ where: { userId: u.id } });
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    if (ilk) await prisma.systemSetting.update({ where: { key }, data: { value: ilk.value as never } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
