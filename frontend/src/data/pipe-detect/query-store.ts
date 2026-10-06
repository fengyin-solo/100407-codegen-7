import type { DetectQuery, SortKey, SortOrder } from './types'

// 已选择的过滤/排序/翻页条件保存在本机：从详情页返回、刷新页面后仍能看到原条件与结果。
const QUERY_STORAGE_KEY = 'underground-pipeline-inspection:pipe-detect-query'
const PAGE_SIZE_DEFAULT = 10

export const DEFAULT_QUERY: DetectQuery = {
  filters: { segment: '', method: '', device: '', dateFrom: '', dateTo: '' },
  sortKey: 'updatedAt',
  sortOrder: 'desc',
  page: 1,
  size: PAGE_SIZE_DEFAULT,
}

export function loadSavedQuery(): DetectQuery {
  const fallback = {
    ...DEFAULT_QUERY,
    filters: { ...DEFAULT_QUERY.filters },
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(QUERY_STORAGE_KEY)
  if (!raw) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DetectQuery>
    return {
      filters: { ...fallback.filters, ...(parsed.filters ?? {}) },
      sortKey: (parsed.sortKey as SortKey) ?? fallback.sortKey,
      sortOrder: (parsed.sortOrder as SortOrder) ?? fallback.sortOrder,
      page: Number(parsed.page) > 0 ? Number(parsed.page) : 1,
      size: Number(parsed.size) > 0 ? Number(parsed.size) : fallback.size,
    }
  } catch {
    return fallback
  }
}

export function saveQuery(query: DetectQuery): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(QUERY_STORAGE_KEY, JSON.stringify(query))
}

export function clearSavedQuery(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.removeItem(QUERY_STORAGE_KEY)
}
