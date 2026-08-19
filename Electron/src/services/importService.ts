// =============================================================================
// Toplu içe aktarım — client servisi (backend /api/import)
// =============================================================================
// Tasarım: docs/design/IMPORT-EXPORT-TASARIM.md
//
// ⚠️ Tipler backend `src/services/import/import.types.ts`in AYNASIDIR (Electron
// backend'i import edemez — mobil `permissions.ts` ile aynı durum). Sütun tipi
// veya sonuç alanı eklerken İKİSİ birlikte güncellenir.

import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export type ImportColumnType = "text" | "number" | "int" | "bool" | "date" | "enum" | "lookup";

export interface ImportEnumValue {
  value: string;
  label: string;
}

export interface ImportColumn {
  key: string;
  label: string;
  type: ImportColumnType;
  required?: boolean;
  enumValues?: ImportEnumValue[];
  lookup?: { entity: string; by: "code" | "name"; multiple?: boolean };
  maxLen?: number;
  help?: string;
  example?: string;
  createOnly?: boolean;
  readOnly?: boolean;
  /** Gruplu şablonda ALT SATIR sütunu (ör. rota adımı). */
  child?: boolean;
}

export type ImportRowAction = "CREATE" | "UPDATE" | "SKIP" | "ERROR";

export interface ImportRowIssue {
  column?: string;
  message: string;
}

export interface ImportRowResult {
  rowNo: number;
  rowNos?: number[];
  action: ImportRowAction;
  key?: string | null;
  label?: string | null;
  targetId?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
}

export interface ImportSummary {
  total: number;
  create: number;
  update: number;
  skip: number;
  error: number;
  warning: number;
}

export interface ImportPreviewResult {
  entity: string;
  rows: ImportRowResult[];
  summary: ImportSummary;
  unknownColumns: string[];
}

export interface ImportApplyResult extends ImportPreviewResult {
  runId: string;
  status: "APPLIED" | "PARTIAL" | "FAILED";
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  durationMs: number;
  stoppedAtRowNo?: number;
}

export interface ImportTemplateSpec {
  entity: string;
  label: string;
  keyColumns: string[];
  columns: ImportColumn[];
  notes: string[];
}

export interface ImportEntityInfo {
  entity: string;
  label: string;
  keyColumns: string[];
  canWrite: boolean;
  canRead: boolean;
}

export interface ImportRunRow {
  id: string;
  entity: string;
  fileName: string | null;
  rowCount: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  status: "APPLIED" | "PARTIAL" | "FAILED";
  durationMs: number;
  stoppedAtRowNo: number | null;
  createdAt: string;
  user: { id: string; username: string; fullName: string } | null;
}

export interface ImportRunDetail extends ImportRunRow {
  options: { mode?: string; onError?: string } | null;
  errorReport: ImportRowResult[] | null;
  clientToken: string | null;
}

export interface ImportOptions {
  mode?: "upsert" | "createOnly" | "updateOnly";
  onError?: "abort" | "skip";
  clientToken?: string;
  fileName?: string;
}

export interface ImportRowInput {
  rowNo: number;
  cells: Record<string, string>;
}

export interface ImportExportPayload {
  entity: string;
  label: string;
  columns: ImportColumn[];
  rows: Array<Record<string, string>>;
}

const base = "/api/import";

export const importService = {
  entities: (): Promise<ApiResponse<ImportEntityInfo[]>> =>
    apiClient.get<ApiResponse<ImportEntityInfo[]>>(`${base}/entities`).then((r) => r.data),

  template: (entity: string): Promise<ApiResponse<ImportTemplateSpec>> =>
    apiClient.get<ApiResponse<ImportTemplateSpec>>(`${base}/${entity}/template`).then((r) => r.data),

  preview: (
    entity: string,
    rows: ImportRowInput[],
    options: ImportOptions,
  ): Promise<ApiResponse<ImportPreviewResult>> =>
    apiClient
      .post<ApiResponse<ImportPreviewResult>>(`${base}/${entity}/preview`, { rows, options })
      .then((r) => r.data),

  apply: (
    entity: string,
    rows: ImportRowInput[],
    options: ImportOptions,
  ): Promise<ApiResponse<ImportApplyResult>> =>
    apiClient
      .post<ApiResponse<ImportApplyResult>>(`${base}/${entity}/apply`, { rows, options })
      .then((r) => r.data),

  runs: (params?: { entity?: string; limit?: number }): Promise<ApiResponse<ImportRunRow[]>> =>
    apiClient.get<ApiResponse<ImportRunRow[]>>(`${base}/runs`, { params }).then((r) => r.data),

  run: (id: string): Promise<ApiResponse<ImportRunDetail>> =>
    apiClient.get<ApiResponse<ImportRunDetail>>(`${base}/runs/${id}`).then((r) => r.data),

  /** Round-trip veri dışa aktarımı (içe aktarım şablonuyla aynı sütunlar). */
  exportData: (entity: string): Promise<ApiResponse<ImportExportPayload>> =>
    apiClient.get<ApiResponse<ImportExportPayload>>(`${base}/${entity}/export`).then((r) => r.data),
};
