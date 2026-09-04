// =============================================================================
// TeksERP — Bağlı istemci defterinin okunabilir hâli
// =============================================================================
// Süreç-içi defteri (`lib/client-registry`) ekranın ihtiyacı olan yüke çevirir:
// kullanıcı adlarını ve makine adlarını çözer, aktiflik hükmünü verir.
//
// Neden servis: route katmanında Prisma client import'u YASAK (CLAUDE.md katman
// kuralı, eslint `no-restricted-imports` ile zorlanıyor). Defterin kendisi saf
// bellek olsa da, adları çözmek için DB'ye bakılıyor — o okuma buraya ait.
// =============================================================================

import { CLIENT_VERSION_POLICIES } from "../config/client-version-policy";
import {
  CLIENT_ACTIVE_WINDOW_MS,
  CLIENT_RETENTION_MS,
  isClientActive,
  listClients,
} from "../lib/client-registry";
import prisma from "../lib/prisma";
import { ACTOR_SELECT } from "./helpers/system-account.helper";

export const ClientRegistryService = {
  async snapshot(now = Date.now()) {
    const rows = listClients(now);

    // Kullanıcı adları: defterde YALNIZ id yaşar — isim değişirse ekran bayat
    // basmasın ve isteğin sıcak yolu bir metin taşımak zorunda kalmasın.
    const userIds = [...new Set(rows.map((r) => r.lastUserId).filter((v): v is string => !!v))];
    const users =
      userIds.length > 0
        ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: ACTOR_SELECT })
        : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    // Makine ADI İSTEMCİDEN GELMEZ, `Device.name`den çözülür: künye başlığı
    // uydurulabilir bir metindir ve onu bir yönetim ekranına basmak, listeye
    // istemci-kontrollü bir gösterim alanı açardı. Ad zaten sistemde bir yerde
    // yaşıyor (Cihazlar ekranı, yöneticinin verdiği etiket) — ikinci bir
    // adlandırma yüzeyi açmıyoruz. Web istemcisinin `Device` satırı yoktur → null.
    const instanceIds = rows.map((r) => r.instanceId);
    const devices =
      instanceIds.length > 0
        ? await prisma.device.findMany({
            where: { deviceId: { in: instanceIds } },
            select: { deviceId: true, name: true, kind: true },
          })
        : [];
    const deviceById = new Map(devices.map((d) => [d.deviceId, d]));

    return {
      /** "Aktif" eşiği — TEK KAYNAK (arayüzün metni bundan üretilir). */
      activeWindowMs: CLIENT_ACTIVE_WINDOW_MS,
      /** Satırın listede kalma süresi — aktiflikten AYRI. */
      retentionMs: CLIENT_RETENTION_MS,
      /** Sunucu saati — istemci saati sapmışsa "N dk önce" yanlış olmasın. */
      now: new Date(now).toISOString(),
      /** Defter bu andan beri topluyor (restart'ta boşalır — ekran söyler). */
      serverStartedAt: new Date(now - Math.floor(process.uptime() * 1000)).toISOString(),
      clients: rows.map((r) => {
        const u = r.lastUserId ? userById.get(r.lastUserId) : undefined;
        const d = deviceById.get(r.instanceId);
        return {
          instanceId: r.instanceId,
          kind: r.kind,
          version: r.version,
          /** Yayındaki güncel sürüm — "geride mi" kıyasını istemci yapar. */
          expectedVersion: r.kind
            ? (CLIENT_VERSION_POLICIES[r.kind]?.currentVersion ?? null)
            : null,
          deviceName: d?.name ?? null,
          deviceKind: d?.kind ?? null,
          /** null = BİLİNMİYOR (kimliksiz istek), "kimse yok" DEĞİL. */
          lastUser: u
            ? {
                id: u.id,
                username: u.username,
                fullName: u.fullName,
                // ⚠️ 2026-09-04: satıcı hesabı GİZLENMEZ, maskelenmez —
                // gerçek adıyla görünür (system-account.helper başlığı).
                isSystemAccount: u.isSystemAccount,
              }
            : null,
          firstSeenAt: new Date(r.firstSeenAt).toISOString(),
          lastSeenAt: new Date(r.lastSeenAt).toISOString(),
          active: isClientActive(r, now),
        };
      }),
    };
  },
};
