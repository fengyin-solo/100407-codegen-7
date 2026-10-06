import { detectReports, persistDetectReports } from '@/data/pipe-detect/store'
import {
  DETECT_METHODS,
  type AdoptInput,
  type DetectActionResult,
  type DetectFilters,
  type DetectPageResult,
  type DetectQuery,
  type DetectReport,
  type DetectRound,
  type FieldErrors,
  type RetestInput,
  type RoundInput,
  type SortKey,
} from '@/data/pipe-detect/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const VERSION_CONFLICT_MESSAGE = '报告已被其他人提交过新版本，请刷新后基于最新版本再提交'

function nowStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}+08:00`
}

function isPassConclusion(conclusion: string): boolean {
  // 合格类结论：含「合格」且不带「不」；其余（不合格、未见改善、仍存在…）一律按不合格处理。
  return conclusion.includes('合格') && !conclusion.includes('不')
}

function roundPass(round: DetectRound): boolean {
  return isPassConclusion(round.conclusion)
}

function nextId(reports: DetectReport[]): number {
  return reports.reduce((max, report) => Math.max(max, report.id), 0) + 1
}

function latestRound(report: DetectReport): DetectRound | null {
  return report.rounds.length ? report.rounds[report.rounds.length - 1] : null
}

/** 校验过滤条件；不合法时返回逐字段错误，页面保留用户输入。 */
export function validateDetectFilters(filters: DetectFilters): FieldErrors {
  const errors: FieldErrors = {}
  if (filters.segment.length > 40) {
    errors.segment = '检测管段最多输入 40 个字'
  }
  if (filters.dateFrom.trim() && !DATE_RE.test(filters.dateFrom.trim())) {
    errors.dateFrom = '开始日期格式应为 YYYY-MM-DD'
  }
  if (filters.dateTo.trim() && !DATE_RE.test(filters.dateTo.trim())) {
    errors.dateTo = '结束日期格式应为 YYYY-MM-DD'
  }
  if (
    !errors.dateFrom &&
    !errors.dateTo &&
    filters.dateFrom.trim() &&
    filters.dateTo.trim() &&
    filters.dateFrom.trim() > filters.dateTo.trim()
  ) {
    errors.dateFrom = '开始日期不能晚于结束日期'
  }
  return errors
}

function matchFilters(report: DetectReport, filters: DetectFilters): boolean {
  const segment = filters.segment.trim()
  if (segment && !report.segment.includes(segment)) {
    return false
  }
  const method = filters.method.trim()
  if (method && report.method !== method) {
    return false
  }
  const device = filters.device.trim()
  if (device && !report.device.includes(device)) {
    return false
  }
  // 日期过滤针对实际检测日期；未完成报告没有实际日期，不会被日期条件命中（不得显示成已完成）。
  const from = filters.dateFrom.trim()
  const to = filters.dateTo.trim()
  if ((from || to) && !report.detectDate) {
    return false
  }
  if (from && report.detectDate < from) {
    return false
  }
  if (to && report.detectDate > to) {
    return false
  }
  return true
}

const SORT_GETTERS: Record<SortKey, (report: DetectReport) => string> = {
  code: (report) => report.code,
  segment: (report) => report.segment,
  method: (report) => report.method,
  device: (report) => report.device,
  detectDate: (report) => report.detectDate,
  status: (report) => report.status,
  updatedAt: (report) => report.updatedAt,
}

function sortReports(
  reports: DetectReport[],
  sortKey: SortKey,
  sortOrder: 'asc' | 'desc',
): DetectReport[] {
  const getter = SORT_GETTERS[sortKey]
  const factor = sortOrder === 'asc' ? 1 : -1
  return [...reports].sort((a, b) => {
    const av = getter(a)
    const bv = getter(b)
    // 空值（未完成报告的检测日期）始终排到最后，不受升降序影响。
    if (!av && bv) {
      return 1
    }
    if (av && !bv) {
      return -1
    }
    if (av === bv) {
      return a.id - b.id
    }
    return av > bv ? factor : -factor
  })
}

function clampPage(page: number, total: number, size: number): number {
  const pages = Math.max(1, Math.ceil(total / size))
  return Math.min(Math.max(1, Math.floor(page)), pages)
}

export function queryDetectReports(query: DetectQuery): DetectPageResult {
  const errors = validateDetectFilters(query.filters)
  if (Object.keys(errors).length > 0) {
    // 条件不合法：不执行查询，输入原样保留，由调用方逐字段说明。
    return { ok: false, errors, items: [], total: 0, page: 1, size: query.size }
  }
  const matched = detectReports().filter((report) => matchFilters(report, query.filters))
  const sorted = sortReports(matched, query.sortKey, query.sortOrder)
  const page = clampPage(query.page, sorted.length, query.size)
  const start = (page - 1) * query.size
  return {
    ok: true,
    errors: {},
    items: sorted.slice(start, start + query.size),
    total: sorted.length,
    page,
    size: query.size,
  }
}

export function getDetectReport(id: number): DetectReport | null {
  return detectReports().find((report) => report.id === id) ?? null
}

export function detectDeviceOptions(): string[] {
  const devices = new Set<string>()
  for (const report of detectReports()) {
    if (report.device.trim()) {
      devices.add(report.device)
    }
  }
  return [...devices].sort()
}

export function detectStats(): {
  total: number
  pending: number
  running: number
  completed: number
  needRetest: number
} {
  const reports = detectReports()
  return {
    total: reports.length,
    pending: reports.filter((report) => report.status === '待检测').length,
    running: reports.filter((report) => report.status === '检测中').length,
    completed: reports.filter((report) => report.status === '已完成').length,
    needRetest: reports.filter((report) => report.status === '需复测').length,
  }
}

function fail(message: string): DetectActionResult {
  return { ok: false, message }
}

function requireVersion(
  reports: DetectReport[],
  id: number,
  version: number,
): { report?: DetectReport; index?: number; error?: DetectActionResult } {
  const index = reports.findIndex((item) => item.id === id)
  if (index < 0) {
    return { error: fail(`没有找到编号为 ${id} 的检测报告`) }
  }
  if (reports[index].version !== version) {
    return { error: fail(VERSION_CONFLICT_MESSAGE) }
  }
  return { report: reports[index], index }
}

function syncFromRound(
  report: DetectReport,
  round: DetectRound,
  stamp: string,
): DetectReport {
  const previousAdopted = report.adoptedRound
    ? report.rounds.find((item) => item.round === report.adoptedRound) ?? null
    : null
  // 复测结论与历史采用结论冲突：合格判定相反才算冲突，两轮都留档。
  const conflict = previousAdopted
    ? report.conflict || roundPass(round) !== roundPass(previousAdopted)
    : false
  let adoptedBasis = report.adoptedBasis
  if (!previousAdopted) {
    adoptedBasis = roundPass(round)
      ? '初检结论完整可信，直接采用第1轮初检结果'
      : '初检判定不合格，当前按第1轮初检结论执行，待缺陷处理后复测'
  } else if (roundPass(round) !== roundPass(previousAdopted)) {
    adoptedBasis = roundPass(round)
      ? `第${round.round}轮复测结论由不合格转为合格，按“复测覆盖验收”采用第${round.round}轮结果；第${previousAdopted.round}轮${previousAdopted.kind}结论留档`
      : `第${round.round}轮复测结论由合格转为不合格，按“复测覆盖验收”采用第${round.round}轮结果；第${previousAdopted.round}轮${previousAdopted.kind}结论留档`
  } else {
    adoptedBasis = `第${round.round}轮复测与第${previousAdopted.round}轮${previousAdopted.kind}结论一致，继续采用最新第${round.round}轮结果`
  }
  const status = roundPass(round) ? '已完成' : '需复测'
  return {
    ...report,
    method: round.method,
    device: round.device,
    inspector: round.inspector,
    detectDate: round.detectedDate,
    length: round.length,
    conclusion: round.conclusion,
    status,
    version: report.version + 1,
    rounds: [...report.rounds, round],
    adoptedRound: round.round,
    adoptedBasis,
    conflict,
    updatedAt: stamp,
  }
}

function validateRoundInput(
  input: Pick<RoundInput, 'method' | 'device' | 'inspector' | 'detectedDate' | 'length' | 'conclusion'>,
): string {
  if (!input.method || !DETECT_METHODS.includes(input.method as (typeof DETECT_METHODS)[number])) {
    return '请选择有效的检测方式'
  }
  if (!input.device.trim()) {
    return '检测设备不能为空'
  }
  if (!input.inspector.trim()) {
    return '检测人员不能为空'
  }
  if (!DATE_RE.test(input.detectedDate.trim())) {
    return '检测日期格式应为 YYYY-MM-DD'
  }
  if (!input.length.trim()) {
    return '检测长度不能为空'
  }
  if (!input.conclusion.trim()) {
    return '检测结论不能为空'
  }
  return ''
}

/** 开始检测：待检测 → 检测中。未完成的报告不会产生任何轮次与完成结论。 */
export function startDetect(id: number, version: number): DetectActionResult {
  const reports = [...detectReports()]
  const check = requireVersion(reports, id, version)
  if (check.error || check.index === undefined) {
    return check.error ?? fail('操作失败')
  }
  const report = reports[check.index]
  if (report.status !== '待检测') {
    return fail(`当前状态为「${report.status}」，不能开始检测`)
  }
  const stamp = nowStamp()
  const updated: DetectReport = {
    ...report,
    status: '检测中',
    version: report.version + 1,
    updatedAt: stamp,
  }
  reports[check.index] = updated
  persistDetectReports(reports)
  return { ok: true, message: '已开始检测，当前状态「检测中」', report: updated }
}

/** 提交检测结果（初检结果）：追加第 1 轮，报告进入已完成/需复测。 */
export function submitDetectResult(id: number, input: RoundInput): DetectActionResult {
  const reports = [...detectReports()]
  const check = requireVersion(reports, id, input.version)
  if (check.error || check.index === undefined) {
    return check.error ?? fail('操作失败')
  }
  const report = reports[check.index]
  if (report.status !== '检测中') {
    return fail(`当前状态为「${report.status}」，只有检测中的报告能录入结果`)
  }
  if (report.rounds.length > 0) {
    return fail('该报告已存在检测轮次，录入结果不能覆盖已有报告')
  }
  const validation = validateRoundInput(input)
  if (validation) {
    return fail(validation)
  }
  const round: DetectRound = {
    round: 1,
    kind: '初检',
    method: input.method,
    device: input.device.trim(),
    inspector: input.inspector.trim(),
    detectedDate: input.detectedDate.trim(),
    length: input.length.trim(),
    conclusion: input.conclusion.trim(),
    defects: input.defects.trim(),
    remark: input.remark.trim(),
    submittedAt: nowStamp(),
  }
  const updated = syncFromRound(report, round, round.submittedAt)
  reports[check.index] = updated
  persistDetectReports(reports)
  return {
    ok: true,
    message: `初检结果已提交，当前采用第1轮结论，报告状态「${updated.status}」`,
    report: updated,
  }
}

/** 发起复测：已完成/需复测 → 待检测（排期），历史轮次原样保留。 */
export function requestRetest(id: number, input: RetestInput): DetectActionResult {
  const reports = [...detectReports()]
  const check = requireVersion(reports, id, input.version)
  if (check.error || check.index === undefined) {
    return check.error ?? fail('操作失败')
  }
  const report = reports[check.index]
  if (report.status !== '已完成' && report.status !== '需复测') {
    return fail(`当前状态为「${report.status}」，不能发起复测`)
  }
  if (!DATE_RE.test(input.scheduledDate.trim())) {
    return fail('复测日期格式应为 YYYY-MM-DD')
  }
  if (!input.method || !DETECT_METHODS.includes(input.method as (typeof DETECT_METHODS)[number])) {
    return fail('请选择有效的检测方式')
  }
  if (!input.device.trim()) {
    return fail('检测设备不能为空')
  }
  if (!input.inspector.trim()) {
    return fail('检测人员不能为空')
  }
  const stamp = nowStamp()
  const updated: DetectReport = {
    ...report,
    method: input.method,
    device: input.device.trim(),
    inspector: input.inspector.trim(),
    scheduledDate: input.scheduledDate.trim(),
    // 复测排期后新轮次尚未完成，实际检测日期清空；历史轮次与采用结论原样保留。
    detectDate: '',
    conclusion: latestRound(report)?.conclusion ?? '',
    status: '待检测',
    version: report.version + 1,
    updatedAt: stamp,
  }
  reports[check.index] = updated
  persistDetectReports(reports)
  return { ok: true, message: '复测已排期，历史检测结果保留不变，当前状态「待检测」', report: updated }
}

/**
 * 提交复测结果：追加新一轮，绝不修改历史轮次。
 * 同一时刻只能有一个复测处于待检测/检测中，这里不额外限制，由状态流转保证。
 */
export function submitRetestResult(id: number, input: RoundInput): DetectActionResult {
  const reports = [...detectReports()]
  const check = requireVersion(reports, id, input.version)
  if (check.error || check.index === undefined) {
    return check.error ?? fail('操作失败')
  }
  const report = reports[check.index]
  if (report.rounds.length === 0) {
    return fail('该报告没有初检结果，不能走复测入口')
  }
  if (report.status !== '检测中') {
    return fail('只有完成排期并已开始的复测，才能提交复测结果')
  }
  const validation = validateRoundInput(input)
  if (validation) {
    return fail(validation)
  }
  const round: DetectRound = {
    round: report.rounds.length + 1,
    kind: '复测',
    method: input.method,
    device: input.device.trim(),
    inspector: input.inspector.trim(),
    detectedDate: input.detectedDate.trim(),
    length: input.length.trim(),
    conclusion: input.conclusion.trim(),
    defects: input.defects.trim(),
    remark: input.remark.trim(),
    submittedAt: nowStamp(),
  }
  const updated = syncFromRound(report, round, round.submittedAt)
  reports[check.index] = updated
  persistDetectReports(reports)
  const conflictNote = updated.conflict ? '，与历史结论存在冲突，两轮结论均已留档' : ''
  return {
    ok: true,
    message: `复测结果已提交为第${round.round}轮并标记为当前采用依据${conflictNote}，报告状态「${updated.status}」`,
    report: updated,
  }
}

/** 人工调整采用依据：在保留全部轮次的前提下切换当前采用轮次。 */
export function adoptDetectRound(id: number, input: AdoptInput): DetectActionResult {
  const reports = [...detectReports()]
  const check = requireVersion(reports, id, input.version)
  if (check.error || check.index === undefined) {
    return check.error ?? fail('操作失败')
  }
  const report = reports[check.index]
  const target = report.rounds.find((round) => round.round === input.round)
  if (!target) {
    return fail(`第${input.round}轮检测结果不存在，无法采用`)
  }
  if (!input.basis.trim()) {
    return fail('请填写采用依据说明')
  }
  const conflict =
    report.rounds.length > 1 &&
    report.rounds.some((round) => roundPass(round) !== roundPass(target))
  const stamp = nowStamp()
  const updated: DetectReport = {
    ...report,
    adoptedRound: target.round,
    adoptedBasis: input.basis.trim(),
    conflict,
    method: target.method,
    device: target.device,
    inspector: target.inspector,
    detectDate: target.detectedDate,
    length: target.length,
    conclusion: target.conclusion,
    version: report.version + 1,
    updatedAt: stamp,
  }
  reports[check.index] = updated
  persistDetectReports(reports)
  return { ok: true, message: `当前采用依据已切换为第${target.round}轮${target.kind}结论`, report: updated }
}

/** 安排一份新的检测报告（登记）。 */
export function createDetectReport(input: {
  segment: string
  method: string
  device: string
  inspector: string
  scheduledDate: string
  length: string
}): DetectActionResult {
  if (!input.segment.trim()) {
    return fail('检测管段不能为空')
  }
  if (!input.method || !DETECT_METHODS.includes(input.method as (typeof DETECT_METHODS)[number])) {
    return fail('请选择有效的检测方式')
  }
  if (!input.device.trim()) {
    return fail('检测设备不能为空')
  }
  if (!input.inspector.trim()) {
    return fail('检测人员不能为空')
  }
  if (!DATE_RE.test(input.scheduledDate.trim())) {
    return fail('计划日期格式应为 YYYY-MM-DD')
  }
  if (!input.length.trim()) {
    return fail('检测长度不能为空')
  }
  const reports = [...detectReports()]
  const stamp = nowStamp()
  const id = nextId(reports)
  const report: DetectReport = {
    id,
    code: `JC-2026-${String(id).padStart(4, '0')}`,
    segment: input.segment.trim(),
    method: input.method,
    device: input.device.trim(),
    inspector: input.inspector.trim(),
    detectDate: '',
    scheduledDate: input.scheduledDate.trim(),
    length: input.length.trim(),
    conclusion: '',
    status: '待检测',
    version: 1,
    rounds: [],
    adoptedRound: null,
    adoptedBasis: '',
    conflict: false,
    createdAt: stamp,
    updatedAt: stamp,
  }
  reports.push(report)
  persistDetectReports(reports)
  return { ok: true, message: `检测报告 ${report.code} 已登记，当前状态「待检测」`, report }
}

export function exportDetectCsv(filters: DetectFilters): { filename: string; content: string } {
  const reports = detectReports().filter((report) => matchFilters(report, filters))
  const header = [
    '检测编号',
    '检测管段',
    '检测方式',
    '检测设备',
    '检测人员',
    '计划日期',
    '检测日期',
    '检测长度',
    '当前采用结论',
    '检测状态',
    '版本',
    '轮次数',
    '冲突',
    '采用依据',
  ]
  const escapeCell = (value: string | number | boolean | null) => {
    const text = value === null ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [header.join(',')]
  for (const report of reports) {
    lines.push(
      [
        report.code,
        report.segment,
        report.method,
        report.device,
        report.inspector,
        report.scheduledDate,
        report.detectDate,
        report.length,
        report.conclusion,
        report.status,
        report.version,
        report.rounds.length,
        report.conflict ? '结论冲突' : '',
        report.adoptedBasis,
      ]
        .map(escapeCell)
        .join(','),
    )
  }
  return { filename: '管道检测报告清单.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadDetectCsv(filters: DetectFilters): void {
  const { filename, content } = exportDetectCsv(filters)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export const DETECT_VERSION_CONFLICT_MESSAGE = VERSION_CONFLICT_MESSAGE
