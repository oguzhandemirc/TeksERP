// =============================================================================
// TeksERP - Dynamic Query Parser
// =============================================================================
// Converts frontend query params into Prisma-compatible where/orderBy/skip/take.
// Usage: GET /api/items?page=1&pageSize=20&sortBy=name&sortOrder=asc&filter[itemType]=YARN&search=poplin
// =============================================================================

import { Request } from "express";
import { QueryParams } from "../types/api.types";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Parse query parameters from the Express request.
 */
export function parseQueryParams(req: Request): QueryParams {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || DEFAULT_PAGE);
  const rawPageSize = parseInt(req.query.pageSize as string, 10) || DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(1, rawPageSize), MAX_PAGE_SIZE);

  const sortBy = (req.query.sortBy as string) || "createdAt";
  const sortOrder = (req.query.sortOrder as string)?.toLowerCase() === "asc" ? "asc" : "desc";

  const search = req.query.search as string | undefined;

  // Parse filter[fieldName]=value from query
  const filters: Record<string, string | string[]> = {};
  for (const key of Object.keys(req.query)) {
    const match = key.match(/^filter\[(.+)]$/);
    if (match) {
      const fieldName = match[1];
      const value = req.query[key];
      if (typeof value === "string") {
        filters[fieldName] = value;
      } else if (Array.isArray(value)) {
        filters[fieldName] = value.filter((v): v is string => typeof v === "string");
      }
    }
  }

  return { page, pageSize, sortBy, sortOrder, filters, search };
}

/**
 * Build Prisma `where` clause from parsed filters.
 * Supports: exact match, enum match, comma-separated IN, boolean.
 */
export function buildWhereClause(
  filters: Record<string, string | string[]>,
  searchFields?: string[],
  search?: string
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      where[field] = { in: value };
    } else if (value.includes(",")) {
      where[field] = { in: value.split(",").map((v) => v.trim()) };
    } else if (value === "true" || value === "false") {
      where[field] = value === "true";
    } else {
      where[field] = value;
    }
  }

  // Full-text search across multiple fields via OR + contains
  if (search && searchFields && searchFields.length > 0) {
    where.OR = searchFields.map((field) => ({
      [field]: { contains: search, mode: "insensitive" },
    }));
  }

  return where;
}

/**
 * Build Prisma `orderBy` clause.
 */
export function buildOrderByClause(
  sortBy: string,
  sortOrder: "asc" | "desc"
): Record<string, string> {
  return { [sortBy]: sortOrder };
}

/**
 * Calculate Prisma skip/take from page & pageSize.
 */
export function buildPagination(page: number, pageSize: number): { skip: number; take: number } {
  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}
