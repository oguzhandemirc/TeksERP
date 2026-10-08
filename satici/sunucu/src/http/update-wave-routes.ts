// GÜNCELLEME DALGASI PORTAL ROTALARI (F1a — docs/design/GUNCELLEYICI-SAGLAMLIK.md §6.2): dalga listesi/ayrıntısı
// (aşama başına sonuç sayaçları, uyarı, ek onay gereği) · dalga aç · sonraki aşamaya geç · aşamayı geri çek. Yazma
// `guncelleme:dalga`; her yazma işlem kimliği + gerekçe taşır, karar dalga defterine ve denetime yazılır. Aşamayı
// yalnız bu uçlar değiştirir (AK-2: otomatik ilerletme/durdurma yok).
import { z } from "zod";
import { ChannelCodeSchema } from "../lisans-protokol";
import { prisma } from "../lib/prisma";
import { WAVE_MAX_STAGE, WaveOpenSchema, advanceWaveTx, openWaveTx, retreatWaveTx } from "../services/update-wave.service";
import { listWaves, waveDetail } from "../services/update-wave-view.service";
import { ClientTokenSchema, ReasonSchema, bodyOf, idParam, portalAction, queryText, type PortalRouteDef } from "./portal-http";

const Stage = z.number().int().min(0).max(WAVE_MAX_STAGE);
const OpenBody = WaveOpenSchema.extend({ clientToken: ClientTokenSchema, sebep: ReasonSchema });
const AdvanceBody = z.strictObject({ clientToken: ClientTokenSchema, beklenenAsama: Stage, sebep: ReasonSchema, onay: z.boolean().optional() });
const RetreatBody = z.strictObject({ clientToken: ClientTokenSchema, beklenenAsama: Stage, hedefAsama: Stage.optional(), sebep: ReasonSchema });
const withPath = (body: object, id: string) => ({ ...body, _yol: id });

export const UPDATE_WAVE_PORTAL_ROUTES: readonly PortalRouteDef[] = [
  {
    method: "get",
    path: "/guncelleme-dalgalari",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => {
      const channel = queryText(c.req, "kanal", 40);
      if (channel !== undefined && !ChannelCodeSchema.safeParse(channel).success) return { data: [] };
      return { data: await listWaves(prisma, { channel }) };
    },
  },
  {
    method: "get",
    path: "/guncelleme-dalgalari/:id",
    permission: "portal:oku",
    kimlik: "OKUMA",
    handler: async (c) => ({ data: await waveDetail(prisma, idParam(c.req, "id", "Güncelleme dalgası")) }),
  },
  {
    method: "post",
    path: "/guncelleme-dalgalari",
    permission: "guncelleme:dalga",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const b = bodyOf(c, OpenBody);
      return portalAction(c, {
        action: "GUNCELLEME_DALGASI_AC",
        clientToken: b.clientToken,
        body: b,
        run: (tx) => openWaveTx(tx, { channelCode: b.kanalKodu, version: b.surum, previousVersion: b.oncekiSurum ?? null, reason: b.sebep, actor: c.session.actor }),
        respond: (w) => ({ data: w }),
        audit: (w) => [{ event: "GUNCELLEME_DALGASI_ACILDI", entity: "GuncellemeDalgasi", entityId: w.id, summary: { kanal: w.kanalKodu, surum: w.surum, oncekiSurum: w.oncekiSurum, sebep: b.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/guncelleme-dalgalari/:id/ilerlet",
    permission: "guncelleme:dalga",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Güncelleme dalgası");
      const b = bodyOf(c, AdvanceBody);
      return portalAction(c, {
        action: "GUNCELLEME_DALGASI_ILERLET",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => advanceWaveTx(tx, { waveId: id, expectedStage: b.beklenenAsama, reason: b.sebep, actor: c.session.actor, confirmed: b.onay === true }),
        respond: (r) => ({ data: { dalga: r.dalga, kayit: r.kayit, zil: r.zil } }),
        audit: (r) => [{ event: "GUNCELLEME_DALGASI_ILERLETILDI", entity: "GuncellemeDalgasi", entityId: id, summary: { onceki: r.kayit.oncekiAsama, yeni: r.kayit.yeniAsama, ekOnay: r.kayit.ekOnay, sebep: b.sebep } }],
      });
    },
  },
  {
    method: "post",
    path: "/guncelleme-dalgalari/:id/geri-cek",
    permission: "guncelleme:dalga",
    kimlik: "ISLEM_KIMLIGI",
    handler: async (c) => {
      const id = idParam(c.req, "id", "Güncelleme dalgası");
      const b = bodyOf(c, RetreatBody);
      return portalAction(c, {
        action: "GUNCELLEME_DALGASI_GERI_CEK",
        clientToken: b.clientToken,
        body: withPath(b, id),
        run: (tx) => retreatWaveTx(tx, { waveId: id, expectedStage: b.beklenenAsama, targetStage: b.hedefAsama, reason: b.sebep, actor: c.session.actor }),
        respond: (r) => ({ data: { dalga: r.dalga, kayit: r.kayit, zil: r.zil } }),
        audit: (r) => [{ event: "GUNCELLEME_DALGASI_GERI_CEKILDI", entity: "GuncellemeDalgasi", entityId: id, summary: { onceki: r.kayit.oncekiAsama, yeni: r.kayit.yeniAsama, sebep: b.sebep } }],
      });
    },
  },
];
