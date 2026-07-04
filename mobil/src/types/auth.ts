export interface JwtPayload {
  userId: string;
  username: string;
  permissions: string[];
  /** Login yanıtında gelebilir (quick-pin/kart) — JWT'de tutulmaz, banner için
   *  setAuth ile kalıcılaştırılır. Yoksa banner username'e düşer. */
  fullName?: string;
}

/** Login gövdesine eklenen cihaz tipi — backend same-type session politikası
 *  bunu kullanır (1 electron + 1 mobil serbest). Verilmezse backend 'mobile' varsayar. */
export type ClientType = 'electron' | 'mobile';

export interface LoginRequest {
  username: string;
  password: string;
  clientType?: ClientType;
  /** 'notify' politikasında çakışma onaylandığında true → ikisi de açık kalır. */
  confirmKick?: boolean;
}

export interface LoginResponse {
  success: boolean;
  data: {
    token: string;
    user: JwtPayload;
  };
  message: string;
}

/** 409 SESSION_EXISTS gövdesi ('notify' politikası) — client confirmKick ile tekrarlar. */
export interface ExistingSessionInfo {
  deviceType: ClientType;
  createdAt: string;
  deviceId: string | null;
}

export interface MobileUser {
  id: string;
  username: string;
  fullName: string;
}

export interface MobileUsersResponse {
  success: boolean;
  data: MobileUser[];
}
