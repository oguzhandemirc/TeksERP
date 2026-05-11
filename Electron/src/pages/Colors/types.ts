export interface Color {
  id: string;
  code: string;
  name: string;
  hex: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
