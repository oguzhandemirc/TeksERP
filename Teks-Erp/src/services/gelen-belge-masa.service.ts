// =============================================================================
// GELEN BELGE — tablet "Belge masası" bağlamı (Gülkesim K23; salt okuma)
// =============================================================================
// Masa ekranı `gelen-belge:write` taşır; makine listesi (`station:read`) ve rota önerisi (plan ucu, `gelen-belge:read`)
// başka izinlerin arkasında. Burada yalnız ön seçim için gereken dar alanlar döner; kural yazım ucunda kalır
// (plan makinesi istasyon kapısı `quickStart`ta, rota kapsaması `create`te).
// =============================================================================
import prisma from "../lib/prisma";
import { KURSUN_DISPATCH_STATION_WHERE } from "./helpers/quality-station.helper";
import { suggestRoute, type RouteSuggestion } from "./gelen-belge-rota-onerisi.service";

export interface DeskKursunMachine {
  id: string;
  code: string;
  name: string;
  stationId: string;
}

/** Kurşun istasyonlarının AKTİF makineleri (kurşun dağıtımıyla aynı istasyon yüklemi; opt-in alan listesi). */
export async function listDeskKursunMachines(): Promise<DeskKursunMachine[]> {
  return prisma.machine.findMany({
    where: { isActive: true, station: KURSUN_DISPATCH_STATION_WHERE },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, code: true, name: true, stationId: true },
  });
}

/** Sahibin rota önerisi — plan ucu / otomatik iş emriyle TEK zincir (`suggestRoute`); sahip yoksa fabrika varsayılanı. */
export async function deskRouteSuggestion(ownerCustomerId: string | null): Promise<RouteSuggestion> {
  return suggestRoute({ ownerCustomerId });
}
