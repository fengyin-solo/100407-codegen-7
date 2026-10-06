/** 管道检测报告检索台的领域类型。
 * 与通用 EntryRow 分开：检测报告按「轮次」组织，一轮初检加若干轮复测，
 * 原始报告永不覆盖，当前版本由轮次完成情况与采用依据派生。 */

/** 检测方式（过滤下拉与录入共用）。 */
export const DETECT_METHODS = ['CCTV检测', 'QV潜望镜', '声呐检测', '闭水试验', '管道内窥'] as const
export type DetectMethod = (typeof DETECT_METHODS)[number]

/** 检测设备。 */
export const DETECT_DEVICES = [
  'CCTV机器人-A型',
  'CCTV机器人-B型',
  'QV潜望镜-Q200',
  '声呐剖面仪-S9',
  '闭水试压装置-CW1',
] as const
export type DetectDevice = (typeof DETECT_DEVICES)[number]

/** 检测结果结论代码：OK 合格，其余为不同缺陷等级。结论冲突按「代码不同」判定。 */
export const RESULT_CODES = ['OK', 'BX', 'AZ', 'CZ'] as const
export type ResultCode = (typeof RESULT_CODES)[number]

export const RESULT_LABELS: Record<ResultCode, string> = {
  OK: '合格无缺陷',
  BX: '结构性缺陷',
  AZ: '破裂（2级）',
  CZ: '错口（3级）',
}

/** 一轮检测：初检或复测。同一条报告可追加多轮，已完成的轮次一律保留。 */
export type DetectRound = {
  /** 第 1 轮为初检，2、3… 为复测。 */
  seq: number
  kind: '初检' | '复测'
  /** 是否已进场开检：false=仅排期（待检测），true=检测中/已完成。 */
  started: boolean
  method: string
  device: string
  inspector: string
  lengthM: number
  /** 计划/进场检测日期。 */
  detectDate: string
  /** 完成出结果的日期；未完成轮次为 null，绝不算作已完成结论。 */
  completedDate: string | null
  resultCode: ResultCode | null
  remark: string
}

/** 一条管道检测报告：管段维度，轮次只增不改不覆盖。 */
export type DetectReport = {
  id: number
  reportNo: string
  segment: string
  material: string
  diameterMm: number
  /** 当前报告版本：每提交一轮结论 +1。并发提交用 expectedVersion 做 CAS。 */
  version: number
  adoptedSeq: number
  /** 当前采用依据：说明为什么采用某一轮结论。 */
  adoptBasis: string
  /** 已发现缺陷/结论冲突，等待复测或会商核实；派生「需复测」状态用。 */
  pendingRetest: boolean
  rounds: DetectRound[]
}

/** 非法过滤条件的逐字段说明。 */
export type InvalidField = {
  field: keyof ReportFilter
  message: string
}

/** 报告状态严格由轮次派生：待检测 / 检测中 / 需复测 / 已完成。 */
export type ReportStatus = '待检测' | '检测中' | '需复测' | '已完成'

/** 列表过滤条件（草稿与已查询条件同构，日期为闭区间）。 */
export type ReportFilter = {
  segment: string
  method: string
  device: string
  dateFrom: string
  dateTo: string
}

export type SortField = 'detectDate' | 'reportNo' | 'lengthM'
export type SortOrder = 'asc' | 'desc'

export type ReportQuery = ReportFilter & {
  sortField: SortField
  sortOrder: SortOrder
  page: number
  size: number
}

/** 列表行：报告字段 + 派生展示字段。 */
export type ReportListItem = {
  id: number
  reportNo: string
  segment: string
  method: string
  device: string
  detectDate: string
  lengthM: number
  status: ReportStatus
  roundCount: number
  hasConflict: boolean
  version: number
  adoptedSeq: number
  currentResultLabel: string
}

export type ReportQueryResult = {
  items: ReportListItem[]
  total: number
  page: number
  size: number
}

/** 提交复测结论的入参。 */
export type SubmitRetestInput = {
  id: number
  method: string
  device: string
  inspector: string
  lengthM: number
  detectDate: string
  completedDate: string
  resultCode: ResultCode
  remark: string
  /** adoptLatest=true 采用本轮；否则采用 adoptedSeq 指定的历史轮次。 */
  adoptLatest: boolean
  adoptedSeq: number
  adoptBasis: string
  expectedVersion: number
}

/** 保存复测草稿的入参（未完成轮次，状态不得变已完成）。 */
export type SaveDraftInput = {
  id: number
  method: string
  device: string
  inspector: string
  lengthM: number
  detectDate: string
  remark: string
  expectedVersion: number
}

/** 服务动作结果：冲突时带上服务端最新版本供页面刷新。 */
export type ServiceResult<T = undefined> = {
  ok: boolean
  message: string
  data?: T
  /** CAS 冲突时，当前已落库的最新版本号。 */
  latestVersion?: number
}
