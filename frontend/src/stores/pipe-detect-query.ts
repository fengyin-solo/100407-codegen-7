import { defineStore } from 'pinia'

import type { ReportFilter, SortField, SortOrder } from '@/data/pipe-detect/types'

/** 检索台状态。
 * 关键约定：只有「校验通过、查询成功」的条件才会调用 commit* 持久化到 localStorage，
 * 非法输入停留在输入绑定上（组件本地），不污染已保存条件；
 * 从单条报告详情返回时，页面按这里保存的过滤、排序与页码恢复，仍能查看上次结果。 */

const STORAGE_KEY = 'underground-pipeline-inspection:pipe-detect-query'

export const DEFAULT_FILTER: ReportFilter = {
  segment: '',
  method: '',
  device: '',
  dateFrom: '',
  dateTo: '',
}

type PersistedState = {
  filter: ReportFilter
  sortField: SortField
  sortOrder: SortOrder
  page: number
  size: number
}

function loadPersisted(): PersistedState | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as PersistedState
    if (!parsed.filter) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export const usePipeDetectQueryStore = defineStore('pipe-detect-query', {
  state: () => {
    const restored = loadPersisted()
    return {
      // 最近一次成功查询并保存的条件，也是返回检索台时恢复的条件。
      filter: { ...(restored?.filter ?? DEFAULT_FILTER) } as ReportFilter,
      sortField: (restored?.sortField ?? 'detectDate') as SortField,
      sortOrder: (restored?.sortOrder ?? 'desc') as SortOrder,
      page: restored?.page ?? 1,
      size: restored?.size ?? 10,
      restored: restored !== null,
    }
  },
  actions: {
    persist() {
      const state: PersistedState = {
        filter: { ...this.filter },
        sortField: this.sortField,
        sortOrder: this.sortOrder,
        page: this.page,
        size: this.size,
      }
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      }
    },
    /** 查询成功后固化过滤条件并回到第一页。 */
    commitFilter(filter: ReportFilter) {
      this.filter = { ...filter }
      this.page = 1
      this.persist()
    },
    setSort(field: SortField) {
      if (this.sortField === field) {
        this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc'
      } else {
        this.sortField = field
        this.sortOrder = field === 'reportNo' ? 'asc' : 'desc'
      }
      this.page = 1
      this.persist()
    },
    setPage(page: number) {
      this.page = page
      this.persist()
    },
    setSize(size: number) {
      this.size = size
      this.page = 1
      this.persist()
    },
    reset() {
      this.filter = { ...DEFAULT_FILTER }
      this.sortField = 'detectDate'
      this.sortOrder = 'desc'
      this.page = 1
      this.size = 10
      this.persist()
    },
    dismissRestored() {
      this.restored = false
    },
  },
})
