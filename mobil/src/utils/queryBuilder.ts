import type { QueryParams } from '../types/api';

export function buildQueryString(params: Partial<QueryParams>): string {
  const sp = new URLSearchParams();

  if (params.page && params.page > 1) sp.set('page', String(params.page));
  if (params.pageSize && params.pageSize !== 20) sp.set('pageSize', String(params.pageSize));
  if (params.sortBy && params.sortBy !== 'createdAt') sp.set('sortBy', params.sortBy);
  if (params.sortOrder && params.sortOrder !== 'desc') sp.set('sortOrder', params.sortOrder);
  if (params.search) sp.set('search', params.search);

  if (params.filters) {
    for (const [k, v] of Object.entries(params.filters)) {
      if (!v || (Array.isArray(v) && v.length === 0)) continue;
      const val = Array.isArray(v) ? v.join(',') : v;
      if (val) sp.set(`filter[${k}]`, val);
    }
  }

  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}
