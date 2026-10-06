// GÜNCELLEME GRUBU (tek ortak paket, TEK-ORTAK-PAKET.md §3.4): kurulumun indirme grubu YALNIZ doğrulanmış
// kiranın `kanal.kod`undan gelir. Pasif (emekli) kanalın kirası da kod taşır; grup sayılmaz → null.
// Küme `deploy/dagitim.json` `gruplar` ve satıcı `UPDATE_GROUPS` ile aynı sırada (check-dagitim §7).

/** Güncelleme grupları, terfi sırasıyla. */
export const UPDATE_GROUPS = ["test", "oncu", "genel"] as const;
export type UpdateGroup = (typeof UPDATE_GROUPS)[number];

const GROUP_CODE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Kira kanal kodu → grup; kira yok, biçimsiz ya da üç gruptan biri değil → null (istemci güncelleme denetlemez). */
export function updateGroupOf(leaseChannelCode: string | null | undefined): UpdateGroup | null {
  if (typeof leaseChannelCode !== "string" || !GROUP_CODE.test(leaseChannelCode)) return null;
  return (UPDATE_GROUPS as readonly string[]).includes(leaseChannelCode) ? (leaseChannelCode as UpdateGroup) : null;
}
