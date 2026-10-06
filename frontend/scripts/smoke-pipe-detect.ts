/* 管道检测服务冒烟测试：node 运行，localStorage 用内存 Map 垫片。
 * 覆盖：状态派生 / 非法与空过滤保留输入 / 分页排序 / 轮次不覆盖 /
 * 结论冲突保留与采用依据 / 同页并发只落一个版本 / 跨标签 CAS / 未完成不显示已完成。
 * 打包：node_modules/@esbuild/<平台>/bin/esbuild scripts/smoke-pipe-detect.ts \
 *        --bundle --platform=node --format=esm --alias:@=./src --outfile=scripts/.smoke.mjs
 */

// ---- 浏览器垫片 ----
const memory = new Map<string, string>()
class FakeLocalStorage {
  getItem(key: string) {
    return memory.has(key) ? (memory.get(key) as string) : null
  }
  setItem(key: string, value: string) {
    memory.set(key, String(value))
  }
}
;(globalThis as any).window = { localStorage: new FakeLocalStorage(), setTimeout }
;(globalThis as any).localStorage = (globalThis as any).window.localStorage

import assert from 'node:assert'
import {
  adoptHistoricalRound,
  deriveStatus,
  getReport,
  hasConflict,
  queryReports,
  reportStats,
  saveRetestDraft,
  startRetest,
  submitRetest,
} from '@/api/pipe-detect-service'
import { RESULT_CODES } from '@/data/pipe-detect/types'
import type { ReportQuery } from '@/data/pipe-detect/types'
import { reportStorageKey } from '@/data/pipe-detect/report-store'

let passed = 0
function step(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}
async function asyncStep(name: string, fn: () => Promise<void>) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

const baseQuery: ReportQuery = {
  segment: '',
  method: '',
  device: '',
  dateFrom: '',
  dateTo: '',
  sortField: 'detectDate',
  sortOrder: 'desc',
  page: 1,
  size: 10,
}

async function main() {
  console.log('1) 列表查询与派生状态')
  step('种子数据共 24 条报告', () => {
    const out = queryReports(baseQuery)
    assert.ok(out.ok)
    if (out.ok) assert.strictEqual(out.result.total, 24)
  })
  step('统计卡片：待检测2 / 检测中3 / 需复测5 / 已完成14 / 冲突8', () => {
    const s = reportStats()
    assert.strictEqual(s.waiting, 2, `waiting=${s.waiting}`)
    assert.strictEqual(s.running, 3, `running=${s.running}`)
    assert.strictEqual(s.retest, 5, `retest=${s.retest}`)
    assert.strictEqual(s.done, 14, `done=${s.done}`)
    assert.strictEqual(s.conflict, 8, `conflict=${s.conflict}`)
  })
  step('含未完成轮次的报告（PD-012/013/022）一律是检测中，绝不显示已完成', () => {
    for (const id of [12, 13, 22]) {
      assert.strictEqual(deriveStatus(getReport(id)!), '检测中', `id=${id}`)
    }
    assert.strictEqual(deriveStatus(getReport(14)!), '待检测') // 已排期未进场
    assert.strictEqual(deriveStatus(getReport(15)!), '待检测') // 无轮次
  })

  console.log('2) 过滤：非法输入保留并逐字段报错')
  step('结束日期早于开始日期 -> 返回字段级错误', () => {
    const out = queryReports({ ...baseQuery, dateFrom: '2026-09-01', dateTo: '2026-08-01' })
    assert.ok(!out.ok && out.fields.some((f) => f.field === 'dateTo'))
  })
  step('非法日期 2026-02-30 被识别', () => {
    const out = queryReports({ ...baseQuery, dateFrom: '2026-02-30' })
    assert.ok(!out.ok && out.fields.some((f) => f.field === 'dateFrom'))
  })
  step('不在范围内的检测方式被拒绝', () => {
    const out = queryReports({ ...baseQuery, method: '射线探伤' })
    assert.ok(!out.ok && out.fields.some((f) => f.field === 'method'))
  })

  console.log('3) 过滤命中与空结果')
  step('按管段关键字「滨河路」命中 1 条 PD-2026-001', () => {
    const out = queryReports({ ...baseQuery, segment: '滨河路' })
    assert.ok(out.ok && out.result.total === 1 && out.result.items[0].reportNo === 'PD-2026-001')
  })
  step('按方式=声呐检测可匹配历史轮次含声呐的报告', () => {
    const out = queryReports({ ...baseQuery, method: '声呐检测' })
    assert.ok(out.ok && out.result.total >= 5)
  })
  step('无命中返回空结果（合法查询 ok=true、total=0）', () => {
    const out = queryReports({ ...baseQuery, segment: '不存在的管段XYZ' })
    assert.ok(out.ok && out.result.items.length === 0)
  })
  step('日期区间只返回最近检测日期落在区间内的报告', () => {
    const out = queryReports({ ...baseQuery, dateFrom: '2026-10-01', dateTo: '2026-10-31' })
    assert.ok(out.ok && out.result.items.length > 0)
    if (out.ok) {
      for (const item of out.result.items) {
        assert.ok(item.detectDate >= '2026-10-01' && item.detectDate <= '2026-10-31', item.reportNo)
      }
    }
  })

  console.log('4) 排序与分页')
  step('默认按检测日期倒序', () => {
    const out = queryReports(baseQuery)
    assert.ok(out.ok)
    if (out.ok) {
      const dates = out.result.items.map((i) => i.detectDate).filter(Boolean)
      assert.deepStrictEqual(dates, [...dates].sort().reverse())
    }
  })
  step('每页 5 条：第 1 页 5 条、第 5 页 4 条、页码越界收敛到末页', () => {
    const p1 = queryReports({ ...baseQuery, size: 5, page: 1 })
    const p5 = queryReports({ ...baseQuery, size: 5, page: 5 })
    const p99 = queryReports({ ...baseQuery, size: 5, page: 99 })
    assert.ok(p1.ok && p5.ok && p99.ok)
    if (p1.ok && p5.ok && p99.ok) {
      assert.strictEqual(p1.result.items.length, 5)
      assert.strictEqual(p5.result.items.length, 4)
      assert.strictEqual(p99.result.page, 5)
    }
  })
  step('按长度升序排列', () => {
    const out = queryReports({ ...baseQuery, sortField: 'lengthM', sortOrder: 'asc', size: 50 })
    assert.ok(out.ok)
    if (out.ok) {
      const lens = out.result.items.map((i) => i.lengthM)
      assert.deepStrictEqual(lens, [...lens].sort((a, b) => a - b))
    }
  })

  console.log('5) 结论冲突保留与当前采用依据')
  step('PD-005 冲突且采用第 2 轮（CZ），原始第 1 轮 OK 仍保留', () => {
    const r = getReport(5)!
    assert.strictEqual(hasConflict(r), true)
    assert.strictEqual(r.adoptedSeq, 2)
    assert.strictEqual(r.rounds[0].resultCode, 'OK')
    assert.strictEqual(r.rounds[1].resultCode, 'CZ')
  })
  step('PD-007 冲突但人工采用第 1 轮历史结论，两轮都在', () => {
    const r = getReport(7)!
    assert.strictEqual(hasConflict(r), true)
    assert.strictEqual(r.adoptedSeq, 1)
    assert.strictEqual(r.rounds[1].resultCode, 'BX')
  })
  step('PD-021 两轮结论一致 => 不算冲突', () => {
    assert.strictEqual(hasConflict(getReport(21)!), false)
  })

  console.log('6) 复测流程：发起/草稿/提交，原始报告不覆盖，未完成不结案')
  const targetId = 3 // PD-003 单轮 BX 已完成
  const v0 = getReport(targetId)!.version

  await asyncStep('发起复测：新增第 2 轮进行中，版本+1，状态变检测中', async () => {
    const r = await startRetest(targetId, v0)
    assert.ok(r.ok, r.message)
    assert.strictEqual(getReport(targetId)!.rounds.length, 2)
    assert.strictEqual(deriveStatus(getReport(targetId)!), '检测中')
  })
  await asyncStep('已有进行中轮次时再次发起被拒绝', async () => {
    const r = await startRetest(targetId, v0 + 1)
    assert.strictEqual(r.ok, false)
  })
  await asyncStep('保存草稿后仍是检测中，原始第 1 轮结论不变', async () => {
    const r = await saveRetestDraft({
      id: targetId,
      method: 'CCTV检测',
      device: 'CCTV机器人-B型',
      inspector: '测试员',
      lengthM: 285,
      detectDate: '2026-10-06',
      remark: '草稿',
      expectedVersion: v0 + 1,
    })
    assert.ok(r.ok, r.message)
    assert.strictEqual(deriveStatus(getReport(targetId)!), '检测中')
    assert.strictEqual(getReport(targetId)!.rounds[0].resultCode, 'BX')
  })
  await asyncStep('基于过期版本提交结论 -> CAS 拒绝并返回最新版本号（跨标签并发）', async () => {
    const r = await submitRetest({
      id: targetId,
      method: 'CCTV检测',
      device: 'CCTV机器人-B型',
      inspector: '测试员',
      lengthM: 285,
      detectDate: '2026-10-06',
      completedDate: '2026-10-06',
      resultCode: 'OK',
      remark: '',
      adoptLatest: true,
      adoptedSeq: 0,
      adoptBasis: '测试依据',
      expectedVersion: v0,
    })
    assert.strictEqual(r.ok, false)
    assert.ok(r.latestVersion !== undefined)
  })
  await asyncStep('草稿缺必填项（人员为空）被拒绝', async () => {
    const r = await saveRetestDraft({
      id: targetId,
      method: 'CCTV检测',
      device: 'CCTV机器人-B型',
      inspector: '',
      lengthM: 285,
      detectDate: '2026-10-06',
      remark: '',
      expectedVersion: getReport(targetId)!.version,
    })
    assert.strictEqual(r.ok, false)
  })
  await asyncStep('提交冲突复测结论：两轮都保留、采用第2轮、状态变已完成', async () => {
    const v = getReport(targetId)!.version
    const r = await submitRetest({
      id: targetId,
      method: 'CCTV检测',
      device: 'CCTV机器人-B型',
      inspector: '测试员',
      lengthM: 285,
      detectDate: '2026-10-06',
      completedDate: '2026-10-06',
      resultCode: 'OK',
      remark: '复测合格',
      adoptLatest: true,
      adoptedSeq: 0,
      adoptBasis: '初检缺陷经复核为误判，采用第2轮合格结论，初检报告存档',
      expectedVersion: v,
    })
    assert.ok(r.ok, r.message)
    const after = getReport(targetId)!
    assert.strictEqual(after.rounds[0].resultCode, 'BX') // 原始未覆盖
    assert.strictEqual(after.rounds[1].resultCode, 'OK')
    assert.strictEqual(after.adoptedSeq, 2)
    assert.strictEqual(hasConflict(after), true)
    assert.strictEqual(deriveStatus(after), '已完成')
  })
  await asyncStep('会商后改采用历史第 1 轮：依据留痕、版本+1、各轮结论保留', async () => {
    const v = getReport(targetId)!.version
    const r = await adoptHistoricalRound(targetId, 1, '专项会商确认维持初检破裂定级', v)
    assert.ok(r.ok, r.message)
    assert.strictEqual(getReport(targetId)!.adoptedSeq, 1)
    assert.strictEqual(getReport(targetId)!.version, v + 1)
    assert.strictEqual(getReport(targetId)!.rounds[1].resultCode, 'OK')
  })

  console.log('7) 同页并发提交：进程内提交锁只放一个')
  const cId = 1
  const cv = getReport(cId)!.version
  await asyncStep('发起一轮复测后并发两次提交：恰一个成功，最终版本只 +1', async () => {
    const started = await startRetest(cId, cv)
    assert.ok(started.ok, started.message)
    const cv2 = getReport(cId)!.version
    const payload = {
      id: cId,
      method: 'CCTV检测' as const,
      device: 'CCTV机器人-A型' as const,
      inspector: '并发测试',
      lengthM: 420,
      detectDate: '2026-10-06',
      completedDate: '2026-10-06',
      resultCode: 'AZ' as (typeof RESULT_CODES)[number],
      remark: '',
      adoptLatest: true,
      adoptedSeq: 0,
      adoptBasis: '并发提交测试依据',
      expectedVersion: cv2,
    }
    const [a, b] = await Promise.all([submitRetest({ ...payload }), submitRetest({ ...payload })])
    assert.notStrictEqual(a.ok, b.ok, '必须恰有一个成功')
    assert.strictEqual(getReport(cId)!.version, cv2 + 1)
  })

  console.log('8) 持久化')
  step('报告写在独立 localStorage 键，与通用条目表互不影响', () => {
    assert.strictEqual(reportStorageKey(), 'underground-pipeline-inspection:pipe-detect-reports')
    assert.ok(memory.has('underground-pipeline-inspection:pipe-detect-reports'))
  })

  console.log(`\n全部 ${passed} 项断言通过 ✅`)
}

main().catch((err) => {
  console.error('冒烟测试失败 ❌', err)
  process.exit(1)
})
