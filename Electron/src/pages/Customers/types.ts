import type { CompanyType } from "@/types/enums";

export interface Customer {
  id: string;
  code: string;
  name: string;
  taxNumber: string | null;
  type: CompanyType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
