import {
  DETECT_DEVICES,
  DETECT_METHODS,
  RESULT_CODES,
  RESULT_LABELS,
} from '@/data/pipe-detect/types'
import type {
  DetectReport,
  DetectRound,
  InvalidField,
  ReportFilter,
  ReportListItem,
  ReportQuery,
  ReportQueryResult,
  ReportStatus,
  SaveDraftInput,
  ServiceResult,
  SubmitRetestInput,
} from '@/data/pipe-detect/types'
import { getReport, listReports, resetReports, updateReportCas } from '@/data/pipe-detect/report-store'

// 纯前端没有真实网络时延，这里模拟一次提交往返：期间再次点击会被进程内提交锁拦下。
const NETWORK_DELAY_MS = 250
const inflight = new Set<number>()

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isDate(value: string): boolean {
  const match = DATE_RE.exec(value)
  if (!match) {
    return false
  }
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1) {
    return false
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

// ---- 派生：报告状态严格由轮次数据决定，页面不能手工改成已完成 ----

export function completedRounds(report: DetectReport): DetectRound[] {
  return report.rounds.filter((round) => round.completedDate !== null)
}

export function latestRound(report: DetectReport): DetectRound | null {
  return report.rounds.length ? report.rounds[report.rounds.length - 1] : null
}

/** 已完成轮次出现过两种及以上结论代码，即存在结论冲突。 */
export function hasConflict(report: DetectReport): boolean {
  const codes = new Set(completedRounds(report).map((round) => round.resultCode))
  return codes.size >= 2
}

export function deriveStatus(report: DetectReport): ReportStatus {
  if (report.rounds.length === 0) {
    return '待检测'
  }
  // 已进场但有轮次未完成，只能是检测中，绝不允许显示成已完成。
  if (report.rounds.some((round) => round.started && round.completedDate === null)) {
    return '检测中'
  }
  // 只有已排期未进场的轮次：仍算待检测。
  if (report.rounds.every((round) => !round.started)) {
    return '待检测'
  }
  // 进场轮次全部完成：待复测/待裁定的不结案，其余按当前采用依据结案。
  if (report.pendingRetest) {
    return '需复测'
  }
  return '已完成'
}

function adoptedRound(report: DetectReport): DetectRound | null {
  return report.rounds.find((round) => round.seq === report.adoptedSeq && round.completedDate !== null) ?? null
}

export function toListItem(report: DetectReport): ReportListItem {
  const latest = latestRound(report)
  const adopted = adoptedRound(report)
  return {
    id: report.id,
    reportNo: report.reportNo,
    segment: report.segment,
    method: latest?.method ?? '',
    device: latest?.device ?? '',
    detectDate: latest?.detectDate ?? '',
    lengthM: latest?.lengthM ?? 0,
    status: deriveStatus(report),
    roundCount: report.rounds.length,
    hasConflict: hasConflict(report),
    version: report.version,
    adoptedSeq: report.adoptedSeq,
    currentResultLabel: adopted?.resultCode ? RESULT_LABELS[adopted.resultCode] : '暂无结论',
  }
}

// ---- 过滤校验：非法条件保留输入并逐字段说明 ----

export function validateFilter(filter: ReportFilter): InvalidField[] {
  const errors: InvalidField[] = []
  const segment = filter.segment.trim()
  if (segment.length > 30) {
    errors.push({ field: 'segment', message: '检测管段关键字不能超过 30 个字' })
  }
  if (filter.method.trim() !== '' && !DETECT_METHODS.includes(filter.method.trim() as (typeof DETECT_METHODS)[number])) {
    errors.push({ field: 'method', message: '检测方式不在可选范围内，请从下拉项选择' })
  }
  if (filter.device.trim() !== '' && !DETECT_DEVICES.includes(filter.device.trim() as (typeof DETECT_DEVICES)[number])) {
    errors.push({ field: 'device', message: '检测设备不在可选范围内，请从下拉项选择' })
  }
  const from = filter.dateFrom.trim()
  const to = filter.dateTo.trim()
  if (from !== '' && !isDate(from)) {
    errors.push({ field: 'dateFrom', message: '开始日期格式应为 YYYY-MM-DD' })
  }
  if (to !== '' && !isDate(to)) {
    errors.push({ field: 'dateTo', message: '结束日期格式应为 YYYY-MM-DD' })
  }
  if (from !== '' && to !== '' && isDate(from) && isDate(to) && from > to) {
    errors.push({ field: 'dateTo', message: '结束日期不能早于开始日期' })
  }
  return errors
}

export type QueryOutcome =
  | { ok: true; result: ReportQueryResult }
  | { ok: false; message: string; fields: InvalidField[] }

function matchFilter(report: DetectReport, filter: ReportFilter): boolean {
  const segment = filter.segment.trim()
  if (segment !== '' && !report.segment.toLowerCase().includes(segment.toLowerCase())) {
    return false
  }
  if (filter.method !== '' && !report.rounds.some((round) => round.method === filter.method)) {
    return false
  }
  if (filter.device !== '' && !report.rounds.some((round) => round.device === filter.device)) {
    return false
  }
  const latest = latestRound(report)
  const date = latest?.detectDate ?? ''
  if (filter.dateFrom !== '' && (date === '' || date < filter.dateFrom)) {
    return false
  }
  if (filter.dateTo !== '' && (date === '' || date > filter.dateTo)) {
    return false
  }
  return true
}

/** 检索台查询：校验 → 过滤 → 排序 → 分页。查询成功才允许保存条件（由页面负责持久化）。 */
export function queryReports(query: ReportQuery): QueryOutcome {
  const filter: ReportFilter = {
    segment: query.segment,
    method: query.method,
    device: query.device,
    dateFrom: query.dateFrom.trim(),
    dateTo: query.dateTo.trim(),
  }
  const errors = validateFilter(filter)
  if (errors.length > 0) {
    return { ok: false, message: '过滤条件不合法，已保留输入，请按提示修改后再查询', fields: errors }
  }

  let matched = listReports()
    .filter((report) => matchFilter(report, filter))
    .map(toListItem)

  const dir = query.sortOrder === 'asc' ? 1 : -1
  matched = matched.sort((a, b) => {
    let cmp: number
    if (query.sortField === 'reportNo') {
      cmp = a.reportNo.localeCompare(b.reportNo)
    } else if (query.sortField === 'lengthM') {
      cmp = a.lengthM - b.lengthM
    } else {
      // 无检测日期（待检测）的记录永远排在最后。
      if (a.detectDate === '' && b.detectDate === '') cmp = 0
      else if (a.detectDate === '') cmp = 1
      else if (b.detectDate === '') cmp = -1
      else cmp = a.detectDate.localeCompare(b.detectDate)
    }
    return cmp === 0 ? a.id - b.id : cmp * dir
  })

  const total = matched.length
  const size = query.size
  const pageCount = Math.max(1, Math.ceil(total / size))
  const page = Math.min(Math.max(1, query.page), pageCount)
  const items = matched.slice((page - 1) * size, page * size)
  return { ok: true, result: { items, total, page, size } }
}

export type ReportStats = {
  total: number
  waiting: number
  running: number
  retest: number
  done: number
  conflict: number
}

export function reportStats(): ReportStats {
  const reports = listReports()
  const stats: ReportStats = { total: reports.length, waiting: 0, running: 0, retest: 0, done: 0, conflict: 0 }
  for (const report of reports) {
    switch (deriveStatus(report)) {
      case '待检测':
        stats.waiting += 1
        break
      case '检测中':
        stats.running += 1
        break
      case '需复测':
        stats.retest += 1
        break
      case '已完成':
        stats.done += 1
        break
    }
    if (hasConflict(report)) {
      stats.conflict += 1
    }
  }
  return stats
}

// ---- 写操作：进程内提交锁 + 版本号 CAS，并发提交只落一个当前版本 ----

async function withLock<T>(id: number, action: () => ServiceResult<T>): Promise<ServiceResult<T>> {
  if (inflight.has(id)) {
    return {
      ok: false,
      message: '该报告已有提交正在处理，请勿重复提交；并发提交只会保留一个当前版本',
    }
  }
  inflight.add(id)
  try {
    await delay(NETWORK_DELAY_MS)
    return action()
  } finally {
    inflight.delete(id)
  }
}

function validateRoundPayload(input: {
  method: string
  device: string
  inspector: string
  lengthM: number
  detectDate: string
}): string {
  if (!DETECT_METHODS.includes(input.method as (typeof DETECT_METHODS)[number])) {
    return '请选择检测方式'
  }
  if (!DETECT_DEVICES.includes(input.device as (typeof DETECT_DEVICES)[number])) {
    return '请选择检测设备'
  }
  if (input.inspector.trim() === '') {
    return '请填写检测人员'
  }
  if (!Number.isFinite(input.lengthM) || input.lengthM <= 0) {
    return '检测长度必须是大于 0 的数字'
  }
  if (!isDate(input.detectDate)) {
    return '检测日期格式应为 YYYY-MM-DD'
  }
  return ''
}

/** 发起复测：追加一轮进行中的复测，不触碰任何历史轮次。 */
export async function startRetest(id: number, expectedVersion: number): Promise<ServiceResult<DetectReport>> {
  return withLock(id, () => {
    // 进程锁已排除同页并发；这里先读一次做业务校验，版本一致性仍由 CAS 兜底（含跨标签页）。
    const current = getReport(id)
    if (!current) {
      return { ok: false, message: '检测报告不存在或已被删除' }
    }
    if (!current.rounds.some((round) => round.completedDate !== null)) {
      return { ok: false, message: '初检尚未完成，不能发起复测；请先完成初检并形成结论', latestVersion: current.version }
    }
    if (current.rounds.some((round) => round.started && round.completedDate === null)) {
      return { ok: false, message: '已有进行中的检测轮次，请先完成或保存该轮草稿后再发起复测', latestVersion: current.version }
    }
    const seq = current.rounds.length + 1
    const outcome = updateReportCas(id, expectedVersion, (report) => {
      const nextRound: DetectRound = {
        seq: report.rounds.length + 1,
        kind: '复测',
        started: true,
        method: '',
        device: '',
        inspector: '',
        lengthM: 0,
        detectDate: '',
        completedDate: null,
        resultCode: null,
        remark: '',
      }
      return { ...report, version: report.version + 1, pendingRetest: true, rounds: [...report.rounds, nextRound] }
    })
    if (!outcome.ok) {
      return casFailure(outcome)
    }
    return { ok: true, message: `已发起第 ${seq} 轮复测，请录入检测信息`, data: outcome.report }
  })
}

function casFailure(outcome: { reason: 'missing' | 'version'; latest: DetectReport | null }): ServiceResult<DetectReport> {
  if (outcome.reason === 'missing' || !outcome.latest) {
    return { ok: false, message: '检测报告不存在或已被删除' }
  }
  const latest = outcome.latest
  return {
    ok: false,
    message: `报告内容已被其他操作更新（当前版本 v${latest.version}），本次提交未写入，请刷新后基于最新版本重试`,
    latestVersion: latest.version,
  }
}

/** 保存复测草稿：轮次仍未完成，报告保持「检测中」，绝不变为已完成。 */
export async function saveRetestDraft(input: SaveDraftInput): Promise<ServiceResult<DetectReport>> {
  const payloadError = validateRoundPayload(input)
  if (payloadError) {
    return { ok: false, message: payloadError }
  }
  return withLock(input.id, () => {
    let businessError = ''
    const outcome = updateReportCas(input.id, input.expectedVersion, (current) => {
      const index = current.rounds.findIndex((round) => round.started && round.completedDate === null)
      if (index < 0) {
        businessError = '没有进行中的复测轮次可保存，请先发起复测'
        return current
      }
      const round = current.rounds[index]
      const updated: DetectRound = {
        ...round,
        method: input.method,
        device: input.device,
        inspector: input.inspector.trim(),
        lengthM: input.lengthM,
        detectDate: input.detectDate,
        remark: input.remark,
      }
      const rounds = [...current.rounds]
      rounds[index] = updated
      return { ...current, version: current.version + 1, rounds }
    })
    if (!outcome.ok) {
      return casFailure(outcome)
    }
    if (businessError) {
      return { ok: false, message: businessError, latestVersion: outcome.report.version }
    }
    return { ok: true, message: '复测草稿已保存（检测尚未完成，不会按已完成统计）', data: outcome.report }
  })
}

/** 提交复测结论：完成进行中的轮次（历史轮次原样保留），记录采用依据，版本 +1。 */
export async function submitRetest(input: SubmitRetestInput): Promise<ServiceResult<DetectReport>> {
  const payloadError = validateRoundPayload(input)
  if (payloadError) {
    return { ok: false, message: payloadError }
  }
  if (!isDate(input.completedDate)) {
    return { ok: false, message: '完成日期格式应为 YYYY-MM-DD' }
  }
  if (input.completedDate < input.detectDate) {
    return { ok: false, message: '完成日期不能早于检测日期' }
  }
  if (!RESULT_CODES.includes(input.resultCode)) {
    return { ok: false, message: '请选择复测结论' }
  }
  if (input.adoptBasis.trim() === '') {
    return { ok: false, message: '请填写当前采用依据，说明结论冲突时以哪一轮为准' }
  }
  if (!input.adoptLatest && input.adoptedSeq <= 0) {
    return { ok: false, message: '采用历史轮次时请指定具体轮次' }
  }

  return withLock(input.id, () => {
    let businessError = ''
    let completedSeq = 0
    const outcome = updateReportCas(input.id, input.expectedVersion, (current) => {
      const index = current.rounds.findIndex((round) => round.started && round.completedDate === null)
      if (index < 0) {
        businessError = '没有进行中的复测轮次，无法提交结论'
        return current
      }
      const latestCompletedDate = current.rounds
        .filter((item) => item.completedDate !== null)
        .map((item) => item.completedDate as string)
        .sort()
        .pop()
      if (latestCompletedDate && input.completedDate < latestCompletedDate) {
        businessError = '完成日期不能早于历史检测的完成日期，请核对后再提交'
        return current
      }
      const round = current.rounds[index]
      const chosenSeq = input.adoptLatest ? round.seq : input.adoptedSeq
      const targetExists =
        chosenSeq === round.seq || current.rounds.some((item) => item.seq === chosenSeq && item.completedDate !== null)
      if (!targetExists) {
        businessError = `第 ${chosenSeq} 轮不是已完成的检测轮次，无法作为采用依据`
        return current
      }
      const completed: DetectRound = {
        ...round,
        method: input.method,
        device: input.device,
        inspector: input.inspector.trim(),
        lengthM: input.lengthM,
        detectDate: input.detectDate,
        completedDate: input.completedDate,
        resultCode: input.resultCode,
        remark: input.remark,
      }
      const rounds = [...current.rounds]
      rounds[index] = completed
      completedSeq = completed.seq
      return {
        ...current,
        version: current.version + 1,
        adoptedSeq: chosenSeq,
        adoptBasis: input.adoptBasis.trim(),
        pendingRetest: false,
        rounds,
      }
    })
    if (!outcome.ok) {
      return casFailure(outcome)
    }
    if (businessError) {
      return { ok: false, message: businessError, latestVersion: outcome.report.version }
    }
    const conflict = hasConflict(outcome.report)
    return {
      ok: true,
      message: conflict
        ? `第 ${completedSeq} 轮复测结论已保存，与历史结论不一致；各轮结论均已保留，当前按第 ${outcome.report.adoptedSeq} 轮结论采用，依据：${outcome.report.adoptBasis}`
        : `第 ${completedSeq} 轮复测结论已保存，报告当前版本 v${outcome.report.version}`,
      data: outcome.report,
    }
  })
}

/** 会商后改采用某一历史轮次结论（不新增检测，不改写历史，只切换当前依据）。 */
export async function adoptHistoricalRound(
  id: number,
  seq: number,
  basis: string,
  expectedVersion: number,
): Promise<ServiceResult<DetectReport>> {
  if (basis.trim() === '') {
    return { ok: false, message: '请填写采用依据' }
  }
  return withLock(id, () => {
    let businessError = ''
    const outcome = updateReportCas(id, expectedVersion, (current) => {
      const target = current.rounds.find((round) => round.seq === seq && round.completedDate !== null)
      if (!target) {
        businessError = `第 ${seq} 轮不是已完成的检测轮次，无法采用`
        return current
      }
      return { ...current, version: current.version + 1, adoptedSeq: seq, adoptBasis: basis.trim(), pendingRetest: false }
    })
    if (!outcome.ok) {
      return casFailure(outcome)
    }
    if (businessError) {
      return { ok: false, message: businessError, latestVersion: outcome.report.version }
    }
    return { ok: true, message: `当前采用依据已切换为第 ${seq} 轮结论，历史报告原样保留`, data: outcome.report }
  })
}

export { getReport, resetReports, RESULT_LABELS }

/** 导出当前筛选结果为 CSV。 */
export function reportsCsv(items: ReportListItem[]): { filename: string; content: string } {
  const header = ['检测编号', '检测管段', '检测方式', '检测设备', '最近检测日期', '检测长度(m)', '报告状态', '轮次数', '结论冲突', '当前版本', '当前结论']
  const lines = [header.join(',')]
  for (const item of items) {
    lines.push(
      [
        item.reportNo,
        item.segment,
        item.method,
        item.device,
        item.detectDate,
        item.lengthM,
        item.status,
        item.roundCount,
        item.hasConflict ? '是' : '否',
        `v${item.version}`,
        item.currentResultLabel,
      ].join(','),
    )
  }
  return { filename: '管道检测报告检索结果.csv', content: `﻿${lines.join('\n')}` }
}
