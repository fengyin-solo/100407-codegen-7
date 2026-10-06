/** 管道检测报告领域模型：一份报告对应一根管段的一次检测安排，可挂多轮检测（初检 + 多次复测）。 */

export type DetectStatus = '待检测' | '检测中' | '已完成' | '需复测'

export type RoundKind = '初检' | '复测'

/** 单轮检测结果。一旦落库只允许追加，不允许改写——复测不能覆盖原始报告。 */
export type DetectRound = {
  round: number
  kind: RoundKind
  method: string
  device: string
  inspector: string
  detectedDate: string
  length: string
  conclusion: string
  defects: string
  remark: string
  submittedAt: string
}

export type DetectReport = {
  id: number
  code: string
  segment: string
  /** 已完成取最近一轮方式；未完成取计划方式，便于按方式过滤到待办。 */
  method: string
  device: string
  inspector: string
  /** 最近一轮实际检测日期；未完成报告为空串，页面不得把它展示成已检测。 */
  detectDate: string
  scheduledDate: string
  length: string
  /** 当前采用结论的摘要（始终来自被采用轮次，未完成时为空串）。 */
  conclusion: string
  status: DetectStatus
  /** 乐观锁版本：任何流转 +1，并发提交靠它保证只有一个当前版本落库。 */
  version: number
  rounds: DetectRound[]
  /** 当前采用的是第几轮；未完成时为 null。 */
  adoptedRound: number | null
  adoptedBasis: string
  /** 历史轮次里是否出现过合格/不合格相互冲突。 */
  conflict: boolean
  createdAt: string
  updatedAt: string
}

export type DetectFilters = {
  segment: string
  method: string
  device: string
  dateFrom: string
  dateTo: string
}

export type SortKey = 'code' | 'segment' | 'method' | 'device' | 'detectDate' | 'status' | 'updatedAt'
export type SortOrder = 'asc' | 'desc'

export type DetectQuery = {
  filters: DetectFilters
  sortKey: SortKey
  sortOrder: SortOrder
  page: number
  size: number
}

export type FieldErrors = Partial<Record<keyof DetectFilters, string>>

export type DetectPageResult = {
  ok: boolean
  errors: FieldErrors
  items: DetectReport[]
  total: number
  page: number
  size: number
}

export type RoundInput = {
  version: number
  method: string
  device: string
  inspector: string
  detectedDate: string
  length: string
  conclusion: string
  defects: string
  remark: string
}

export type RetestInput = {
  version: number
  method: string
  device: string
  inspector: string
  scheduledDate: string
  remark: string
}

export type AdoptInput = {
  version: number
  round: number
  basis: string
}

export type DetectActionResult = {
  ok: boolean
  message: string
  report?: DetectReport
}

export const DETECT_METHODS = ['CCTV检测', 'QV检测', '声呐检测', '闭水试验', '人工目视'] as const

export const DETECT_STATUSES: DetectStatus[] = ['待检测', '检测中', '已完成', '需复测']

export const PAGE_SIZE_OPTIONS = [10, 20, 50]
