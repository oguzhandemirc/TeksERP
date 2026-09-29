// Uygulamanın çağırdığı HER uç burada (yol şablonu + yöntem). Ayna bekçisi bu tabloyu sunucunun
// `API_ROUTES`uyla karşılaştırır — sunucuda olmayan uca istek yazılamaz.
import type { ApiClient, Query } from "./client";
import type {
  Account,
  AccountInviteResult,
  Device,
  CustomerMessageBody,
  FacilityStatus,
  InboxItemKind,
  InboxItem,
  InboxStatus,
  InviteAccepted,
  InviteConfirmed,
  InviteInfo,
  LoginResponse,
  NotificationItem,
  NotificationSettings,
  NotificationSettingsView,
  OrderMessageBody,
  Page,
  PermissionCatalog,
  ProjectionRecord,
  ReportRequest,
  ReportRequestDetail,
  Snapshot,
  SnapshotRefresh,
} from "./wire";

export const ENDPOINTS = {
  login: ["post", "/oturum/ac"],
  inviteInspect: ["post", "/davet/incele"],
  inviteAccept: ["post", "/davet/kabul"],
  inviteConfirm: ["post", "/davet/onay"],
  session: ["get", "/oturum"],
  logout: ["post", "/oturum/kapat"],
  changePassword: ["post", "/oturum/parola"],
  permissions: ["get", "/izinler"],
  list: ["get", "/veri/:projeksiyon"],
  record: ["get", "/veri/:projeksiyon/:id"],
  snapshot: ["get", "/anlik/:projeksiyon"],
  refresh: ["post", "/tazele"],
  inboxCreate: ["post", "/gelen-kutusu"],
  inboxList: ["get", "/gelen-kutusu"],
  inboxGet: ["get", "/gelen-kutusu/:mesajId"],
  inboxCancel: ["post", "/gelen-kutusu/:mesajId/iptal"],
  reportCreate: ["post", "/raporlar"],
  reportList: ["get", "/raporlar"],
  reportGet: ["get", "/raporlar/:id"],
  reportCancel: ["post", "/raporlar/:id/iptal"],
  accountList: ["get", "/hesaplar"],
  accountCreate: ["post", "/hesaplar"],
  accountUpdate: ["patch", "/hesaplar/:id"],
  accountStatus: ["post", "/hesaplar/:id/durum"],
  accountReset: ["post", "/hesaplar/:id/sifirla"],
  deviceRegister: ["post", "/cihazlar"],
  deviceList: ["get", "/cihazlar"],
  deviceRemove: ["post", "/cihazlar/:id/kaldir"],
  notificationSettings: ["get", "/bildirim/ayarlar"],
  notificationSettingsSet: ["post", "/bildirim/ayarlar"],
  notificationFacilityDefaults: ["post", "/bildirim/tesis-varsayilani"],
  notificationHistory: ["get", "/bildirimler"],
} as const satisfies Record<string, readonly ["get" | "post" | "patch", string]>;

type Name = keyof typeof ENDPOINTS;

export function pathOf(name: Name, params: Readonly<Record<string, string>> = {}): string {
  return ENDPOINTS[name][1].replace(/:([A-Za-z]+)/g, (_m, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`Yol parametresi eksik: ${k}`);
    return encodeURIComponent(v);
  });
}

export interface ListParams {
  readonly imlec?: string;
  readonly limit?: number;
  readonly durum?: string;
  readonly cariKartId?: string;
}

export function createApi(c: ApiClient) {
  const q = (p: ListParams): Query => ({ imlec: p.imlec, limit: p.limit, durum: p.durum, cariKartId: p.cariKartId });
  return {
    login: (b: { eposta: string; parola: string; totp: string; istemci?: "mobil" | "web" }) => c.post<LoginResponse>(pathOf("login"), b),
    inviteInspect: (davet: string) => c.post<InviteInfo>(pathOf("inviteInspect"), { davet }),
    inviteAccept: (davet: string, parola: string) => c.post<InviteAccepted>(pathOf("inviteAccept"), { davet, parola }),
    inviteConfirm: (davet: string, totp: string) => c.post<InviteConfirmed>(pathOf("inviteConfirm"), { davet, totp }),
    session: () => c.get<FacilityStatus>(pathOf("session")),
    logout: () => c.post<null>(pathOf("logout"), {}),
    changePassword: (b: { mevcutParola: string; yeniParola: string; totp: string }) => c.post<null>(pathOf("changePassword"), b),
    permissions: () => c.get<PermissionCatalog>(pathOf("permissions")),
    list: (projeksiyon: string, p: ListParams = {}) => c.get<Page<ProjectionRecord>>(pathOf("list", { projeksiyon }), q(p)),
    record: (projeksiyon: string, id: string) => c.get<ProjectionRecord>(pathOf("record", { projeksiyon, id })),
    snapshot: (projeksiyon: string) => c.get<Snapshot>(pathOf("snapshot", { projeksiyon })),
    /** Ekran açılınca `ozet` zili (S47) — içerik taşımaz; aralığa saygı `lib/refresh.ts`te. */
    refresh: () => c.post<SnapshotRefresh>(pathOf("refresh"), {}),
    inboxCreate: (mesajId: string, tur: InboxItemKind, govde: OrderMessageBody | CustomerMessageBody) =>
      c.post<InboxItem>(pathOf("inboxCreate"), { mesajId, tur, govde }),
    inboxList: (p: { durum?: InboxStatus; imlec?: string; limit?: number } = {}) => c.get<Page<InboxItem>>(pathOf("inboxList"), p),
    inboxGet: (mesajId: string) => c.get<InboxItem>(pathOf("inboxGet", { mesajId })),
    inboxCancel: (mesajId: string) => c.post<InboxItem>(pathOf("inboxCancel", { mesajId }), {}),
    reportCreate: (clientToken: string, raporAnahtari: string, parametreler: Record<string, unknown>) =>
      c.post<ReportRequest>(pathOf("reportCreate"), { clientToken, raporAnahtari, parametreler }),
    reportList: (p: { imlec?: string; limit?: number } = {}) => c.get<Page<ReportRequest>>(pathOf("reportList"), p),
    reportGet: (id: string) => c.get<ReportRequestDetail>(pathOf("reportGet", { id })),
    reportCancel: (id: string) => c.post<ReportRequest>(pathOf("reportCancel", { id }), {}),
    accountList: () => c.get<Account[]>(pathOf("accountList")),
    accountCreate: (b: { clientToken: string; eposta: string; ad: string; sablon?: string; izinler?: string[] }) =>
      c.post<AccountInviteResult>(pathOf("accountCreate"), b),
    accountUpdate: (id: string, b: { clientToken: string; ad?: string; izinler?: string[] }) => c.patch<Account>(pathOf("accountUpdate", { id }), b),
    accountStatus: (id: string, b: { clientToken: string; durum: "AKTIF" | "KILITLI" | "PASIF" }) => c.post<Account>(pathOf("accountStatus", { id }), b),
    accountReset: (id: string, clientToken: string) => c.post<AccountInviteResult>(pathOf("accountReset", { id }), { clientToken }),
    deviceRegister: (b: { platform: "ios" | "android" | "web"; belirtec: string; ad?: string }) => c.post<Device>(pathOf("deviceRegister"), b),
    deviceList: () => c.get<Device[]>(pathOf("deviceList")),
    deviceRemove: (id: string) => c.post<Device>(pathOf("deviceRemove", { id }), {}),
    notificationSettings: () => c.get<NotificationSettingsView>(pathOf("notificationSettings")),
    notificationSettingsSet: (ayarlar: NotificationSettings | null) => c.post<NotificationSettingsView>(pathOf("notificationSettingsSet"), { ayarlar }),
    notificationFacilityDefaults: (ayarlar: NotificationSettings) => c.post<NotificationSettingsView>(pathOf("notificationFacilityDefaults"), { ayarlar }),
    notificationHistory: (p: { imlec?: string; limit?: number } = {}) => c.get<Page<NotificationItem>>(pathOf("notificationHistory"), p),
  };
}

export type Api = ReturnType<typeof createApi>;
