import apiClient from "./apiClient";
import { createCrudService } from "./crudService";
import type { ApiResponse } from "@/types/api";
import type { User } from "@/types/models";

const crudOps = createCrudService<User>("/api/users");

export interface RegisterRequest {
  username: string;
  password: string;
  fullName: string;
}

export const userService = {
  ...crudOps,

  register(data: RegisterRequest): Promise<ApiResponse<User>> {
    return apiClient
      .post<ApiResponse<User>>("/api/auth/register", data)
      .then((r) => r.data);
  },
};
