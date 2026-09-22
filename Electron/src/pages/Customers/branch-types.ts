export interface CustomerBranch {
  id: string;
  customerId: string;
  code: string | null;
  name: string;
  address: string | null;
  city: string | null;
  district: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  isActive: boolean;
  /** Şubenin sevk yönü; doluysa bu şubeye giden sevkiyatta carinin yönünün önüne geçer. */
  defaultDestination: "DOMESTIC" | "EXPORT" | null;
  createdAt: string;
  updatedAt: string;
}

export type CustomerBranchPayload = Omit<
  CustomerBranch,
  "id" | "customerId" | "createdAt" | "updatedAt"
>;
