<template>
  <section class="page" data-module="pipe_detect">
    <header class="page-head">
      <div>
        <h2>管道检测报告检索台</h2>
        <p class="page-desc">
          按检测管段、检测方式、检测设备和检测日期检索检测报告，支持翻页与排序；点击任意一行可定位到该条检测记录的完整轮次与采用依据。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出当前结果</button>
        <button class="btn ghost" type="button" @click="resetSeed">恢复示例报告</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div v-if="queryStore.restored" class="notice-banner">
      <span>已按上次保存的查询条件恢复（含过滤、排序与第 {{ queryStore.page }} 页）。</span>
      <button class="link" type="button" @click="queryStore.dismissRestored()">知道了</button>
    </div>

    <form class="filter-bar filter-grid" @submit.prevent="search">
      <label class="filter-item">
        <span>检测管段</span>
        <input v-model="draft.segment" placeholder="如：滨河路W01" :class="{ invalid: errorOf('segment') }" />
      </label>
      <label class="filter-item">
        <span>检测方式</span>
        <select v-model="draft.method" :class="{ invalid: errorOf('method') }">
          <option value="">全部方式</option>
          <option v-for="method in DETECT_METHODS" :key="method" :value="method">{{ method }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>检测设备</span>
        <select v-model="draft.device" :class="{ invalid: errorOf('device') }">
          <option value="">全部设备</option>
          <option v-for="device in DETECT_DEVICES" :key="device" :value="device">{{ device }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>检测日期（起）</span>
        <input v-model="draft.dateFrom" type="date" :class="{ invalid: errorOf('dateFrom') }" />
      </label>
      <label class="filter-item">
        <span>检测日期（止）</span>
        <input v-model="draft.dateTo" type="date" :class="{ invalid: errorOf('dateTo') }" />
      </label>
      <div class="filter-actions">
        <button class="btn primary" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="clearFilters">重置条件</button>
      </div>
    </form>

    <div v-if="fieldErrors.length || errorMessage" class="error-panel">
      <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
      <ul v-if="fieldErrors.length" class="error-list">
        <li v-for="item in fieldErrors" :key="item.field" class="error-text">· {{ item.message }}（输入内容已保留）</li>
      </ul>
    </div>

    <div v-if="appliedSummary" class="applied-bar">当前条件：{{ appliedSummary }}</div>

    <table class="data-table report-table">
      <thead>
        <tr>
          <th class="sortable" :class="sortClass('reportNo')" @click="changeSort('reportNo')">检测编号</th>
          <th>检测管段</th>
          <th>检测方式</th>
          <th>检测设备</th>
          <th class="sortable" :class="sortClass('detectDate')" @click="changeSort('detectDate')">最近检测日期</th>
          <th class="sortable num" :class="sortClass('lengthM')" @click="changeSort('lengthM')">检测长度(m)</th>
          <th>当前结论</th>
          <th>报告状态</th>
          <th>轮次</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          class="data-row"
          :class="{ conflict: row.hasConflict }"
          tabindex="0"
          @click="openDetail(row.id)"
          @keydown.enter="openDetail(row.id)"
        >
          <td>{{ row.reportNo }}<span class="version-tag">v{{ row.version }}</span></td>
          <td>{{ row.segment }}</td>
          <td>{{ row.method || '—' }}</td>
          <td>{{ row.device || '—' }}</td>
          <td>{{ row.detectDate || '未排期' }}</td>
          <td class="num">{{ row.lengthM || '—' }}</td>
          <td>
            {{ row.currentResultLabel }}
            <span v-if="row.hasConflict" class="conflict-tag" title="各轮结论不一致，详情中可查看每轮结论与当前采用依据">结论冲突</span>
          </td>
          <td><span class="status-badge" :class="`s-${row.status}`">{{ row.status }}</span></td>
          <td>{{ row.roundCount }} 轮</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="9" class="empty-state">
            没有符合条件的检测报告。可放宽管段关键字、日期区间或检测方式后重新查询；当前输入已保留。
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot report-foot">
      <span>共 {{ total }} 条检测报告，第 {{ page }} / {{ pageCount }} 页</span>
      <div class="pager">
        <label class="page-size">
          每页
          <select :value="queryStore.size" @change="onSizeChange">
            <option :value="5">5</option>
            <option :value="10">10</option>
            <option :value="20">20</option>
          </select>
          条
        </label>
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button class="btn" type="button" :disabled="page >= pageCount" @click="goPage(page + 1)">下一页</button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { queryReports, reportStats, reportsCsv, resetReports } from '@/api/pipe-detect-service'
import { DETECT_DEVICES, DETECT_METHODS } from '@/data/pipe-detect/types'
import type {
  InvalidField,
  ReportFilter,
  ReportListItem,
  SortField,
} from '@/data/pipe-detect/types'
import { usePipeDetectQueryStore } from '@/stores/pipe-detect-query'

const router = useRouter()
const queryStore = usePipeDetectQueryStore()

// 输入草稿与「已保存条件」分离：非法输入留在草稿里，不覆盖已保存条件。
// 进入页面（含详情返回）时用已保存条件回填，做到「返回仍能查看」。
const draft = reactive<ReportFilter>({ ...queryStore.filter })

const rows = ref<ReportListItem[]>([])
const total = ref(0)
const page = ref(1)
const fieldErrors = ref<InvalidField[]>([])
const errorMessage = ref('')

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / queryStore.size)))

const statsCards = computed(() => {
  const stats = reportStats()
  return [
    { label: '报告总数', value: stats.total },
    { label: '待检测', value: stats.waiting },
    { label: '检测中', value: stats.running },
    { label: '需复测 / 待裁定', value: stats.retest },
    { label: '已完成', value: stats.done },
    { label: '结论冲突', value: stats.conflict },
  ]
})

const appliedSummary = computed(() => {
  const parts: string[] = []
  const filter = queryStore.filter
  if (filter.segment.trim()) parts.push(`管段含「${filter.segment.trim()}」`)
  if (filter.method) parts.push(`方式=${filter.method}`)
  if (filter.device) parts.push(`设备=${filter.device}`)
  if (filter.dateFrom || filter.dateTo) parts.push(`日期 ${filter.dateFrom || '最早'} ~ ${filter.dateTo || '最新'}`)
  return parts.length ? parts.join('，') : ''
})

function errorOf(field: InvalidField['field']): boolean {
  return fieldErrors.value.some((item) => item.field === field)
}

function runQuery() {
  const outcome = queryReports({
    ...queryStore.filter,
    sortField: queryStore.sortField,
    sortOrder: queryStore.sortOrder,
    page: queryStore.page,
    size: queryStore.size,
  })
  if (!outcome.ok) {
    // 已保存条件理论上始终合法；防御性地保留输入并说明。
    fieldErrors.value = outcome.fields
    errorMessage.value = outcome.message
    return
  }
  fieldErrors.value = []
  errorMessage.value = ''
  rows.value = outcome.result.items
  total.value = outcome.result.total
  page.value = outcome.result.page
  if (outcome.result.page !== queryStore.page) {
    // 请求页超出范围（结果变少）时对齐到实际页并持久化。
    queryStore.setPage(outcome.result.page)
  }
}

function search() {
  // 先拿输入草稿试查：只有校验通过、查询成功，条件才保存；非法或为空结果都保留输入。
  const probe = queryReports({
    ...draft,
    sortField: queryStore.sortField,
    sortOrder: queryStore.sortOrder,
    page: 1,
    size: queryStore.size,
  })
  if (!probe.ok) {
    fieldErrors.value = probe.fields
    errorMessage.value = probe.message
    return
  }
  queryStore.commitFilter({ ...draft })
  fieldErrors.value = []
  errorMessage.value = ''
  runQuery()
}

function clearFilters() {
  queryStore.reset()
  Object.assign(draft, { ...queryStore.filter })
  fieldErrors.value = []
  errorMessage.value = ''
  runQuery()
}

function changeSort(field: SortField) {
  queryStore.setSort(field)
  runQuery()
}

function sortClass(field: SortField): string {
  if (queryStore.sortField !== field) {
    return ''
  }
  return queryStore.sortOrder === 'asc' ? 'sort-asc' : 'sort-desc'
}

function goPage(target: number) {
  if (target < 1 || target > pageCount.value) {
    return
  }
  queryStore.setPage(target)
  runQuery()
}

function onSizeChange(event: Event) {
  queryStore.setSize(Number((event.target as HTMLSelectElement).value))
  runQuery()
}

function openDetail(id: number) {
  router.push({ name: 'pipe_detect_detail', params: { id: String(id) } })
}

function exportRows() {
  // 导出按当前已保存条件与排序的完整匹配结果（不受分页限制）。
  const outcome = queryReports({
    ...queryStore.filter,
    sortField: queryStore.sortField,
    sortOrder: queryStore.sortOrder,
    page: 1,
    size: Math.max(1, total.value),
  })
  // total=0 时上面只用于试探条件；导出空结果就是一行表头。
  const items = outcome.ok && total.value > 0 ? outcome.result.items : []
  const { filename, content } = reportsCsv(items)
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

function resetSeed() {
  resetReports()
  queryStore.reset()
  Object.assign(draft, { ...queryStore.filter })
  fieldErrors.value = []
  errorMessage.value = ''
  runQuery()
}

onMounted(runQuery)
</script>
