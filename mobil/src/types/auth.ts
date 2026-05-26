export interface JwtPayload {
  userId: string;
  username: string;
  permissions: string[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  data: {
    token: string;
    user: JwtPayload;
  };
  message: string;
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
