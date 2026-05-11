export interface FabricProperty {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
