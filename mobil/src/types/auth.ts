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
