<template>
  <section class="page" data-module="pipe_detect">
    <header class="page-head">
      <div>
        <h2>管道检测报告检索台</h2>
        <p class="page-desc">
          按检测管段、检测方式、检测设备和检测日期检索报告，支持翻页、排序并定位到单条检测记录；
          同一管段多轮复测结果并存，复测不覆盖原始报告。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showCreate = true">登记检测报告</button>
        <button class="btn" type="button" @click="exportRows">导出结果清单</button>
        <button class="btn ghost" type="button" @click="resetData">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statsCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in legend" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar filter-grid" @submit.prevent="search">
      <label class="filter-item">
        <span>检测管段</span>
        <input v-model="query.filters.segment" placeholder="如：光明路 / WS-A12" />
      </label>
      <label class="filter-item">
        <span>检测方式</span>
        <select v-model="query.filters.method">
          <option value="">全部方式</option>
          <option v-for="method in DETECT_METHODS" :key="method" :value="method">{{ method }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>检测设备</span>
        <input v-model="query.filters.device" list="detect-device-options" placeholder="设备编号或名称" />
        <datalist id="detect-device-options">
          <option v-for="device in deviceOptions" :key="device" :value="device" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>检测日期 起</span>
        <input v-model="query.filters.dateFrom" placeholder="YYYY-MM-DD" />
      </label>
      <label class="filter-item">
        <span>检测日期 止</span>
        <input v-model="query.filters.dateTo" placeholder="YYYY-MM-DD" />
      </label>
      <div class="filter-actions">
        <button class="btn primary" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </div>
    </form>

    <p v-if="hasFilterError" class="form-error" role="alert">
      过滤条件不合法，已保留输入内容，请修正后再查询：
      <span v-for="(message, field) in fieldErrors" :key="field" class="error-chip">
        {{ filterLabel(field) }}：{{ message }}
      </span>
    </p>
    <p v-else-if="notice" class="form-error" role="status">{{ notice }}</p>

    <table class="data-table detect-table">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            :class="{ sortable: column.sortKey, sorted: query.sortKey === column.sortKey }"
            @click="column.sortKey && toggleSort(column.sortKey)"
          >
            {{ column.label }}
            <span v-if="column.sortKey" class="sort-arrow">{{ sortArrow(column.sortKey) }}</span>
          </th>
          <th>当前状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          :class="{ 'row-conflict': row.conflict, 'row-pinned': pinnedId === row.id }"
        >
          <td>{{ row.code }}<span v-if="row.rounds.length > 1" class="round-badge">
            {{ row.rounds.length }}轮
          </span></td>
          <td>{{ row.segment }}</td>
          <td>{{ row.method }}</td>
          <td>{{ row.device }}</td>
          <td>
            <template v-if="row.detectDate">{{ row.detectDate }}</template>
            <template v-else>
              <span class="muted">计划 {{ row.scheduledDate }}</span>
              <em class="not-done">（未完成）</em>
            </template>
          </td>
          <td>{{ row.length }}</td>
          <td>
            <template v-if="row.conclusion">{{ row.conclusion }}</template>
            <span v-else class="muted">— 暂无结论 —</span>
            <span v-if="row.conflict" class="conflict-flag" title="复测结论与历史结论冲突，详情中可见全部轮次">结论冲突</span>
          </td>
          <td>
            <span class="status-tag" :class="statusClass(row.status)">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openReport(row.id)">查看报告</button>
            <button class="link" type="button" @click="locate(row.id)">定位</button>
          </td>
        </tr>
        <tr v-if="hasFilterError">
          <td :colspan="columns.length + 2" class="empty-state">
            过滤条件不合法，未执行查询；输入内容已保留，请按上方提示修正
          </td>
        </tr>
        <tr v-else-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            没有符合当前条件的检测报告；条件已保留，可调整后重新查询
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot detect-foot">
      <span>共 {{ total }} 条检测报告{{ hasFilterError ? '（条件不合法，未统计）' : '' }}</span>
      <div class="pager">
        <label class="page-size">
          每页
          <select v-model.number="query.size" @change="changePageSize">
            <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }}</option>
          </select>
          条
        </label>
        <button class="btn" type="button" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span class="page-info">第 {{ page }} / {{ totalPages || 1 }} 页</span>
        <button
          class="btn"
          type="button"
          :disabled="page >= totalPages"
          @click="goPage(page + 1)"
        >
          下一页
        </button>
      </div>
    </footer>

    <div v-if="showCreate" class="modal-mask" @click.self="showCreate = false">
      <form class="modal-card" @submit.prevent="submitCreate">
        <h3>登记检测报告</h3>
        <label>
          <span>检测管段 *</span>
          <input v-model="createForm.segment" placeholder="如：WS-A12-光明路(振兴路—建设路段)" />
        </label>
        <label>
          <span>检测方式 *</span>
          <select v-model="createForm.method">
            <option value="">请选择</option>
            <option v-for="method in DETECT_METHODS" :key="method" :value="method">{{ method }}</option>
          </select>
        </label>
        <label>
          <span>检测设备 *</span>
          <input v-model="createForm.device" list="detect-device-options" />
        </label>
        <label>
          <span>检测人员 *</span>
          <input v-model="createForm.inspector" />
        </label>
        <label>
          <span>计划日期 *</span>
          <input v-model="createForm.scheduledDate" placeholder="YYYY-MM-DD" />
        </label>
        <label>
          <span>检测长度 *</span>
          <input v-model="createForm.length" placeholder="如：180.0m" />
        </label>
        <p v-if="createError" class="form-error">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="showCreate = false">取消</button>
          <button class="btn primary" type="submit">登记</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  createDetectReport,
  detectDeviceOptions,
  detectStats,
  downloadDetectCsv,
  queryDetectReports,
  resetDetectData,
} from '@/api/pipe-detect-controller'
import {
  DETECT_METHODS,
  PAGE_SIZE_OPTIONS,
  type DetectFilters,
  type DetectReport,
  type DetectQuery,
  type FieldErrors,
  type SortKey,
} from '@/data/pipe-detect/types'
import {
  DEFAULT_QUERY,
  clearSavedQuery,
  loadSavedQuery,
  saveQuery,
} from '@/data/pipe-detect/query-store'

const router = useRouter()
const route = useRoute()

const columns: { key: string; label: string; sortKey?: SortKey }[] = [
  { key: 'code', label: '检测编号', sortKey: 'code' },
  { key: 'segment', label: '检测管段', sortKey: 'segment' },
  { key: 'method', label: '检测方式', sortKey: 'method' },
  { key: 'device', label: '检测设备', sortKey: 'device' },
  { key: 'detectDate', label: '检测日期', sortKey: 'detectDate' },
  { key: 'length', label: '检测长度' },
  { key: 'conclusion', label: '检测结果' },
]

const saved = loadSavedQuery()
const query = reactive<DetectQuery>({
  filters: { ...saved.filters },
  sortKey: saved.sortKey,
  sortOrder: saved.sortOrder,
  page: saved.page,
  size: saved.size,
})

const rows = ref<DetectReport[]>([])
const total = ref(0)
const page = ref(1)
const fieldErrors = ref<FieldErrors>({})
const notice = ref('')
const pinnedId = ref<number | null>(null)
const deviceOptions = ref<string[]>([])
const statsVersion = ref(0)
const statsCards = computed(() => {
  // 依赖 statsVersion，数据被动作改写后刷新统计
  void statsVersion.value
  const stats = detectStats()
  return [
    { label: '报告总数', value: stats.total },
    { label: '待检测', value: stats.pending },
    { label: '检测中', value: stats.running },
    { label: '已完成', value: stats.completed },
    { label: '需复测', value: stats.needRetest },
  ]
})
const legend = computed(() => {
  void statsVersion.value
  const stats = detectStats()
  return [
    { status: '待检测', count: stats.pending },
    { status: '检测中', count: stats.running },
    { status: '已完成', count: stats.completed },
    { status: '需复测', count: stats.needRetest },
  ]
})

const showCreate = ref(false)
const createError = ref('')
const createForm = ref({
  segment: '',
  method: '',
  device: '',
  inspector: '',
  scheduledDate: '',
  length: '',
})

const hasFilterError = computed(() => Object.keys(fieldErrors.value).length > 0)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / query.size)))

const FILTER_LABELS: Record<keyof DetectFilters, string> = {
  segment: '检测管段',
  method: '检测方式',
  device: '检测设备',
  dateFrom: '开始日期',
  dateTo: '结束日期',
}

function filterLabel(field: string): string {
  return FILTER_LABELS[field as keyof DetectFilters] ?? field
}

function statusClass(status: string): string {
  return {
    待检测: 'status-pending',
    检测中: 'status-running',
    已完成: 'status-done',
    需复测: 'status-retest',
  }[status] ?? ''
}

function sortArrow(sortKey: SortKey): string {
  if (query.sortKey !== sortKey) {
    return '⇅'
  }
  return query.sortOrder === 'asc' ? '↑' : '↓'
}

function reload() {
  notice.value = ''
  const result = queryDetectReports(query)
  fieldErrors.value = result.errors
  statsVersion.value += 1
  if (!result.ok) {
    rows.value = []
    total.value = 0
    page.value = 1
    saveQuery(query)
    return
  }
  rows.value = result.items
  total.value = result.total
  page.value = result.page
  saveQuery(query)
}

function search() {
  query.page = 1
  reload()
}

function resetFilters() {
  const next = { ...DEFAULT_QUERY, filters: { ...DEFAULT_QUERY.filters } }
  query.filters = next.filters
  query.sortKey = next.sortKey
  query.sortOrder = next.sortOrder
  query.page = 1
  query.size = next.size
  fieldErrors.value = {}
  pinnedId.value = null
  clearSavedQuery()
  reload()
}

function toggleSort(sortKey: SortKey) {
  if (query.sortKey === sortKey) {
    query.sortOrder = query.sortOrder === 'asc' ? 'desc' : 'asc'
  } else {
    query.sortKey = sortKey
    query.sortOrder = 'asc'
  }
  query.page = 1
  reload()
}

function goPage(target: number) {
  query.page = target
  reload()
}

function changePageSize() {
  query.page = 1
  reload()
}

function openReport(id: number) {
  router.push({ name: 'pipe_detect_detail', params: { id: String(id) } })
}

// 定位：在当前条件下翻到目标记录所在页并高亮，结果仍收敛到单条记录的查看入口。
function locate(id: number) {
  notice.value = ''
  pinnedId.value = id
  const target = rows.value.find((row) => row.id === id)
  if (target) {
    return
  }
  const result = queryDetectReports({
    ...query,
    filters: { ...query.filters },
    page: 1,
    size: 9999,
  })
  if (!result.ok) {
    return
  }
  const index = result.items.findIndex((row) => row.id === id)
  if (index < 0) {
    notice.value = `编号为 ${id} 的报告不在当前过滤结果中，过滤条件已保留`
    return
  }
  query.page = Math.floor(index / query.size) + 1
  reload()
}

function exportRows() {
  if (hasFilterError.value) {
    notice.value = '过滤条件不合法，请先修正后再导出'
    return
  }
  downloadDetectCsv(query.filters)
}

function resetData() {
  resetDetectData()
  deviceOptions.value = detectDeviceOptions()
  reload()
}

function submitCreate() {
  createError.value = ''
  const result = createDetectReport(createForm.value)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  showCreate.value = false
  createForm.value = {
    segment: '',
    method: '',
    device: '',
    inspector: '',
    scheduledDate: '',
    length: '',
  }
  query.page = 1
  reload()
}

watch(
  () => route.query.focus,
  (focus) => {
    if (typeof focus === 'string' && /^\d+$/.test(focus)) {
      pinnedId.value = Number(focus)
    }
  },
  { immediate: true },
)

onMounted(() => {
  deviceOptions.value = detectDeviceOptions()
  reload()
  const focus = route.query.focus
  if (typeof focus === 'string' && /^\d+$/.test(focus)) {
    // 从详情页带回的定位参数：条件恢复后翻到该页并高亮。
    pinnedId.value = Number(focus)
    locate(Number(focus))
    router.replace({ name: 'pipe_detect' })
  }
})
</script>
