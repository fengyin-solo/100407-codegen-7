import { SEED_REPORTS } from './seed'
import type { DetectReport } from './types'

/** 检测报告专用持久化。
 * 与通用 local-store 分开：通用表是整表覆盖写，这里要做「读最新值 + 版本号 CAS」，
 * 读穿透 localStorage（不用内存缓存），这样同一浏览器多标签页并发提交时，
 * 后写的一方会因版本号不匹配而失败，最终只落一个当前版本。 */

const STORAGE_KEY = 'underground-pipeline-inspection:pipe-detect-reports'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedIfNeeded(): DetectReport[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(SEED_REPORTS)
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seeded = clone(SEED_REPORTS)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
  try {
    return JSON.parse(raw) as DetectReport[]
  } catch {
    const seeded = clone(SEED_REPORTS)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    return seeded
  }
}

/** 每次都从 localStorage 读最新值，跨标签页的提交立即可见。 */
export function listReports(): DetectReport[] {
  return seedIfNeeded()
}

export function getReport(id: number): DetectReport | null {
  return listReports().find((report) => report.id === id) ?? null
}

function persist(reports: DetectReport[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reports))
  }
}

export type CasOutcome =
  | { ok: true; report: DetectReport }
  | { ok: false; reason: 'missing'; latest: null }
  | { ok: false; reason: 'version'; latest: DetectReport }

/** 原子更新单条报告：expectedVersion 与库中当前版本一致才写入，写入后版本由变更方负责递增。 */
export function updateReportCas(
  id: number,
  expectedVersion: number,
  mutate: (current: DetectReport) => DetectReport,
): CasOutcome {
  const reports = listReports()
  const index = reports.findIndex((report) => report.id === id)
  if (index < 0) {
    return { ok: false, reason: 'missing', latest: null }
  }
  const current = reports[index]
  if (current.version !== expectedVersion) {
    return { ok: false, reason: 'version', latest: current }
  }
  const updated = mutate(clone(current))
  const next = [...reports]
  next[index] = updated
  persist(next)
  return { ok: true, report: updated }
}

/** 回到示例数据（重置用）。 */
export function resetReports(): DetectReport[] {
  const seeded = clone(SEED_REPORTS)
  persist(seeded)
  return seeded
}

export function reportStorageKey(): string {
  return STORAGE_KEY
}
