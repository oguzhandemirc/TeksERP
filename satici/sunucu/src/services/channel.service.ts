// KANAL = GÜNCELLEME GRUBU (tek ortak paket, TEK-ORTAK-PAKET.md §3): satırlar `deploy/dagitim.json` gruplarıdır
// ve migration'la doğar (portal grup açmaz). Kurulum bir gruba bağlıdır (FK); kira `kanal.kod`u (= grup) ve
// `guncelSurumler`i buradan alır. `kod` DEĞİŞMEZ (indirme belirtecinin yol öneki `/<kod>/…`); sert silme yok.
// Grup olmayan eski satır `aktif=false`dır: okunur, yeni kurulum almaz, indirme belirteci basmaz.
import type { Kanal, LisansSinifi, Prisma } from "@prisma/client";
import { z } from "zod";
import { ChannelCodeSchema, VersionTextSchema } from "../lisans-protokol";
import { badRequest, notFoundError } from "../lib/errors";
import type { Db, Tx } from "../lib/prisma";

/** Güncelleme grupları, terfi sırasıyla — `deploy/dagitim.json` `gruplar` ve migration satırlarıyla aynı (check-dagitim §7). */
export const UPDATE_GROUPS = ["test", "oncu", "genel"] as const;
export type UpdateGroup = (typeof UPDATE_GROUPS)[number];

export function isUpdateGroup(code: string): code is UpdateGroup {
  return (UPDATE_GROUPS as readonly string[]).includes(code);
}

/** K-3: grup verilmeden açılan kurulumun grubu — deneme (TEST) lisansı `test`, diğer her sınıf `genel`. */
export function defaultGroupFor(licenseClass: LisansSinifi): UpdateGroup {
  return licenseClass === "TEST" ? "test" : "genel";
}

/** Pasif (emekli) kanal indirme belirteci almaz: yayın kökü yalnız grupların. Kira bu yüklemden etkilenmez. */
export function channelIssuesDownloads(channel: Pick<Kanal, "kod" | "aktif"> | null): boolean {
  return channel !== null && channel.aktif && isUpdateGroup(channel.kod);
}

/** Protokol KİRA `kanal.guncelSurumler` alanının KATI hâli (yazımda tanınmayan anahtar RED). */
export const ChannelVersionsSchema = z.strictObject({
  backend: VersionTextSchema.optional(),
  panel: VersionTextSchema.optional(),
  tablet: VersionTextSchema.optional(),
});
export type ChannelVersions = z.infer<typeof ChannelVersionsSchema>;

/** Kiraya giden sürümler: kayıtlı JSON şemaya uymuyorsa boş küme (bozuk veri kira basımını düşürmez). */
export function channelVersionsForLease(channel: Pick<Kanal, "guncelSurumler"> | null): ChannelVersions {
  if (!channel) return {};
  const parsed = ChannelVersionsSchema.safeParse(channel.guncelSurumler);
  return parsed.success ? parsed.data : {};
}

function cleanName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 200) throw badRequest("Grup adı 1–200 karakter olmalı");
  return n;
}

function cleanVersions(v: unknown): Prisma.InputJsonObject {
  const parsed = ChannelVersionsSchema.safeParse(v ?? {});
  if (!parsed.success) throw badRequest("Güncel sürümler yalnız backend · panel · tablet anahtarlarında X.Y.Z biçiminde olabilir");
  return parsed.data;
}

/** Kurulum doğarken/grubu değişirken: kod bir güncelleme grubu, satırı KAYITLI ve aktif olmalı (fail-closed). */
export async function requireChannel(db: Db, code: string): Promise<Kanal> {
  if (!ChannelCodeSchema.safeParse(code).success) throw badRequest("Güncelleme grubu kodu biçimsiz");
  if (!isUpdateGroup(code)) throw badRequest(`Güncelleme grubu değil: ${code} (gruplar: ${UPDATE_GROUPS.join(" · ")})`);
  const channel = await db.kanal.findUnique({ where: { kod: code } });
  if (!channel) throw badRequest(`Güncelleme grubu kayıtlı değil: ${code} (migration eksik)`);
  if (!channel.aktif) throw badRequest(`Güncelleme grubu pasif: ${code}`);
  return channel;
}

export async function findChannel(db: Db, channelId: string): Promise<Kanal> {
  const channel = await db.kanal.findUnique({ where: { id: channelId } });
  if (!channel) throw notFoundError("Kanal");
  return channel;
}

export async function listChannels(db: Db): Promise<(Kanal & { kurulumSayisi: number })[]> {
  const rows = await db.kanal.findMany({
    orderBy: [{ aktif: "desc" }, { sira: { sort: "asc", nulls: "last" } }, { kod: "asc" }],
    include: { _count: { select: { kurulumlar: true } } },
  });
  return rows.map(({ _count, ...k }) => ({ ...k, kurulumSayisi: _count.kurulumlar }));
}

export interface UpdateChannelInput {
  readonly channelId: string;
  readonly name?: string;
  readonly order?: number | null;
  readonly versions?: unknown;
}

function cleanOrder(order: number | null): number | null {
  if (order === null) return null;
  if (!Number.isInteger(order) || order < 1 || order > 99) throw badRequest("Sıra 1–99 arası tam sayı olmalı");
  return order;
}

/** Ad · sıra · güncel sürümler (kod, tür ve aktiflik portaldan DEĞİŞMEZ). Kira bir sonraki yoklamada yeni sürümleri taşır. */
export async function updateChannelTx(tx: Tx, g: UpdateChannelInput): Promise<Kanal> {
  const channel = await findChannel(tx, g.channelId);
  const data: Prisma.KanalUpdateInput = {
    ...(g.name === undefined ? {} : { ad: cleanName(g.name) }),
    ...(g.order === undefined ? {} : { sira: cleanOrder(g.order) }),
    ...(g.versions === undefined ? {} : { guncelSurumler: cleanVersions(g.versions) }),
  };
  if (Object.keys(data).length === 0) return channel;
  return tx.kanal.update({ where: { id: channel.id }, data });
}

/** Bayi tavanına yazılacak gruplar: tekrarsız, hepsi aktif güncelleme grubu. */
export async function cleanChannelList(db: Db, codes: readonly string[]): Promise<string[]> {
  const unique = [...new Set(codes)];
  if (unique.length > 100) throw badRequest("En çok 100 grup");
  for (const code of unique) await requireChannel(db, code);
  return unique;
}
