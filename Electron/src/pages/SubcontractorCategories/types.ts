export interface SubcontractorCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count?: { subcontractors: number; workOrderSteps: number };
  createdAt: string;
  updatedAt: string;
}
