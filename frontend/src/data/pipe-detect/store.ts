import { SEED_DETECT_REPORTS } from './seed'
import type { DetectReport } from './types'

// 管道检测报告单独存放：通用模块那份占位数据没有轮次/版本概念，混用会丢字段。
const STORAGE_KEY = 'underground-pipeline-inspection:pipe-detect-reports'
const STORAGE_VERSION = 1

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedReports(): DetectReport[] {
  return clone(SEED_DETECT_REPORTS)
}

function readStorage(): DetectReport[] {
  const fallback = seedReports()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, reports: fallback }),
    )
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as { version?: number; reports?: DetectReport[] }
    if (!Array.isArray(parsed.reports)) {
      throw new Error('bad payload')
    }
    return parsed.reports
  } catch {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, reports: fallback }),
    )
    return fallback
  }
}

let cache: DetectReport[] | null = null

export function detectReports(): DetectReport[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/** 整表替换：服务层完成版本校验后调用，保证并发提交只落一个当前版本。 */
export function persistDetectReports(reports: DetectReport[]): void {
  cache = reports
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, reports }),
    )
  }
}

export function resetDetectReports(): DetectReport[] {
  const reports = seedReports()
  persistDetectReports(reports)
  return reports
}

export function detectStorageKey(): string {
  return STORAGE_KEY
}

/** 仅供规则验证脚本使用：清掉内存缓存，模拟刷新后从 localStorage 重新装载。 */
export function _resetCacheForTest(): void {
  cache = null
}
