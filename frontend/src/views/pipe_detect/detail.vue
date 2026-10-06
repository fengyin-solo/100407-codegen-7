<template>
  <section v-if="report" class="page detail-page" data-module="pipe_detect_detail">
    <header class="page-head">
      <div>
        <button class="btn ghost back-btn" type="button" @click="backToList">← 返回检索台</button>
        <h2>{{ report.reportNo }} · {{ report.segment }}</h2>
        <p class="page-desc">
          {{ report.material }} · 管径 {{ report.diameterMm }}mm · 当前版本
          <strong>v{{ report.version }}</strong>
          <span class="status-badge" :class="`s-${status}`" style="margin-left: 8px">{{ status }}</span>
          <span v-if="conflict" class="conflict-tag" style="margin-left: 8px">存在结论冲突</span>
        </p>
      </div>
    </header>

    <div v-if="message" class="message-bar" :class="messageKind === 'ok' ? 'ok' : 'error'">
      {{ message }}
      <button v-if="messageKind === 'version'" class="link" type="button" @click="reloadWithNote">刷新到最新版本</button>
    </div>

    <article class="detail-card">
      <h3>当前采用依据</h3>
      <p class="basis-text">{{ report.adoptBasis }}</p>
      <p class="basis-round">
        当前采用：<strong>第 {{ report.adoptedSeq }} 轮</strong>
        （{{ adoptedRound?.kind ?? '—' }} ·
        {{ adoptedRound?.completedDate ?? '未完成' }} ·
        {{ adoptedRound?.resultCode ? RESULT_LABELS[adoptedRound.resultCode] : '暂无结论' }}）
      </p>
      <p v-if="conflict" class="conflict-note">
        各轮检测结论不一致，系统完整保留每一轮报告，不会用复测覆盖原始报告；如会商后认为应以历史某轮为准，可在下方切换当前采用依据。
      </p>

      <form v-if="conflict" class="adopt-form" @submit.prevent="submitAdopt">
        <label class="filter-item">
          <span>改采用历史轮次</span>
          <select v-model.number="adoptForm.seq">
            <option v-for="round in completedRoundList" :key="round.seq" :value="round.seq">
              第{{ round.seq }}轮（{{ round.kind }}，{{ round.completedDate }}，{{ round.resultCode ? RESULT_LABELS[round.resultCode] : '—' }}）
            </option>
          </select>
        </label>
        <label class="filter-item basis-input">
          <span>切换依据说明</span>
          <textarea v-model="adoptForm.basis" rows="2" placeholder="说明为什么改采用该轮结论，例如复测时淤积遮挡观测不充分"></textarea>
        </label>
        <button class="btn" type="submit" :disabled="busy">切换采用依据</button>
      </form>
    </article>

    <article class="detail-card">
      <h3>检测轮次（原始报告与历次复测均保留，共 {{ report.rounds.length }} 轮）</h3>
      <ol class="round-list">
        <li
          v-for="round in report.rounds"
          :id="`round-${round.seq}`"
          class="round-item"
          :class="{ pending: round.started && round.completedDate === null, scheduled: !round.started, adopted: round.seq === report.adoptedSeq }"
        >
          <div class="round-head">
            <strong>第{{ round.seq }}轮 · {{ round.kind }}</strong>
            <span v-if="round.seq === report.adoptedSeq" class="adopted-tag">当前采用</span>
            <span v-if="!round.started" class="scheduled-tag">已排期未进场（待检测）</span>
            <span v-else-if="round.completedDate === null" class="pending-tag">检测未完成（不得按已完成统计）</span>
          </div>
          <dl class="round-grid">
            <div><dt>检测方式</dt><dd>{{ round.method || '待录入' }}</dd></div>
            <div><dt>检测设备</dt><dd>{{ round.device || '待录入' }}</dd></div>
            <div><dt>检测人员</dt><dd>{{ round.inspector || '待录入' }}</dd></div>
            <div><dt>检测长度</dt><dd>{{ round.lengthM ? `${round.lengthM} m` : '待录入' }}</dd></div>
            <div><dt>检测日期</dt><dd>{{ round.detectDate || '待录入' }}</dd></div>
            <div>
              <dt>检测结论</dt>
              <dd v-if="round.completedDate">
                {{ round.resultCode ? RESULT_LABELS[round.resultCode] : '—' }}（{{ round.completedDate }} 完成）
              </dd>
              <dd v-else-if="round.started" class="muted">检测尚未完成</dd>
              <dd v-else class="muted">已排期，未进场检测</dd>
            </div>
          </dl>
          <p v-if="round.remark" class="round-remark">备注：{{ round.remark }}</p>
        </li>
        <li v-if="!report.rounds.length" class="round-item empty">尚未安排检测，无检测轮次</li>
      </ol>
    </article>

    <article class="detail-card">
      <h3>{{ pendingRound ? `录入第 ${pendingRound.seq} 轮复测信息` : '复测操作' }}</h3>

      <form v-if="pendingRound" class="retest-form" @submit.prevent="submitConclusion">
        <div class="form-grid">
          <label class="filter-item">
            <span>检测方式</span>
            <select v-model="retestForm.method">
              <option value="">请选择</option>
              <option v-for="method in DETECT_METHODS" :key="method" :value="method">{{ method }}</option>
            </select>
          </label>
          <label class="filter-item">
            <span>检测设备</span>
            <select v-model="retestForm.device">
              <option value="">请选择</option>
              <option v-for="device in DETECT_DEVICES" :key="device" :value="device">{{ device }}</option>
            </select>
          </label>
          <label class="filter-item">
            <span>检测人员</span>
            <input v-model="retestForm.inspector" placeholder="检测人员姓名" />
          </label>
          <label class="filter-item">
            <span>检测长度(m)</span>
            <input v-model.number="retestForm.lengthM" type="number" min="0" step="1" placeholder="如 320" />
          </label>
          <label class="filter-item">
            <span>检测日期</span>
            <input v-model="retestForm.detectDate" type="date" />
          </label>
          <label class="filter-item">
            <span>完成日期</span>
            <input v-model="retestForm.completedDate" type="date" />
          </label>
          <label class="filter-item">
            <span>复测结论</span>
            <select v-model="retestForm.resultCode">
              <option value="">请选择</option>
              <option v-for="code in RESULT_CODES" :key="code" :value="code">{{ code }} · {{ RESULT_LABELS[code] }}</option>
            </select>
          </label>
        </div>
        <label class="filter-item full">
          <span>情况说明</span>
          <textarea v-model="retestForm.remark" rows="2" placeholder="本论检测情况、与历史结论的差异说明"></textarea>
        </label>

        <fieldset class="adopt-pick">
          <legend>结论冲突时的当前采用依据</legend>
          <label>
            <input v-model="retestForm.adoptLatest" type="radio" :value="true" />
            采用本轮（第{{ pendingRound.seq }}轮复测）结论
          </label>
          <label v-if="completedRoundList.length">
            <input v-model="retestForm.adoptLatest" type="radio" :value="false" />
            采用历史轮次：
            <select v-model.number="retestForm.adoptedSeq" :disabled="retestForm.adoptLatest">
              <option v-for="round in completedRoundList" :key="round.seq" :value="round.seq">
                第{{ round.seq }}轮（{{ round.kind }}，{{ round.resultCode ? RESULT_LABELS[round.resultCode] : '—' }}）
              </option>
            </select>
          </label>
          <label class="filter-item full">
            <span>当前采用依据（会随报告保留并展示）</span>
            <textarea v-model="retestForm.adoptBasis" rows="2"></textarea>
          </label>
        </fieldset>

        <div class="form-actions">
          <button class="btn" type="button" :disabled="busy" @click="saveDraft">保存草稿（检测仍未完成）</button>
          <button class="btn primary" type="submit" :disabled="busy">
            {{ busy ? '提交中…' : '提交复测结论' }}
          </button>
        </div>
      </form>

      <div v-else-if="status !== '检测中'" class="retest-actions">
        <p class="muted">需要对该管段再次复测时，可追加新一轮检测；追加后原始报告与历次结论都不会被覆盖。</p>
        <button class="btn primary" type="button" :disabled="busy" @click="startRetestAction">发起复测</button>
      </div>
      <p v-else class="muted">当前存在未完成轮次，请先完成后再发起下一轮复测。</p>
    </article>
  </section>

  <section v-else class="page">
    <header class="page-head">
      <div>
        <button class="btn ghost back-btn" type="button" @click="backToList">← 返回检索台</button>
        <h2>未找到该检测报告</h2>
        <p class="page-desc">编号 {{ route.params.id }} 的报告不存在，可能已被重置。返回检索台可重新查找。</p>
      </div>
    </header>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  adoptHistoricalRound,
  completedRounds,
  deriveStatus,
  getReport,
  hasConflict,
  saveRetestDraft,
  startRetest,
  submitRetest,
} from '@/api/pipe-detect-service'
import { DETECT_DEVICES, DETECT_METHODS, RESULT_CODES, RESULT_LABELS } from '@/data/pipe-detect/types'
import type { DetectReport, DetectRound, ReportStatus, ResultCode } from '@/data/pipe-detect/types'

const route = useRoute()
const router = useRouter()

const report = ref<DetectReport | null>(null)
const busy = ref(false)
const message = ref('')
const messageKind = ref<'ok' | 'error' | 'version'>('ok')

const adoptForm = ref<{ seq: number; basis: string }>({ seq: 0, basis: '' })

const retestForm = ref({
  method: '',
  device: '',
  inspector: '',
  lengthM: 0,
  detectDate: '',
  completedDate: '',
  resultCode: '' as ResultCode | '',
  remark: '',
  adoptLatest: true,
  adoptedSeq: 0,
  adoptBasis: '',
})

const status = computed<ReportStatus | ''>(() => (report.value ? deriveStatus(report.value) : ''))
const conflict = computed(() => (report.value ? hasConflict(report.value) : false))
const completedRoundList = computed<DetectRound[]>(() => (report.value ? completedRounds(report.value) : []))
const pendingRound = computed<DetectRound | null>(
  () => report.value?.rounds.find((round) => round.started && round.completedDate === null) ?? null,
)
const adoptedRound = computed<DetectRound | null>(
  () => report.value?.rounds.find((round) => round.seq === report.value?.adoptedSeq) ?? null,
)

function defaultBasis(seq: number): string {
  if (!report.value) {
    return ''
  }
  const codes = new Set(completedRoundList.value.map((round) => round.resultCode).filter(Boolean))
  const newCode = retestForm.value.resultCode
  const conflicts = newCode !== '' && codes.size > 0 && !codes.has(newCode)
  if (conflicts) {
    return `本轮复测结论与历史结论不一致；各轮报告均保留，按规程以第${seq}轮复测结论为当前处置依据，历史结论存档备查`
  }
  return `按规范以最近一轮第${seq}轮复测结论为当前依据，原始初检报告留存备查`
}

function hydrateFormFromPending() {
  const pending = pendingRound.value
  if (!pending) {
    return
  }
  retestForm.value = {
    method: pending.method,
    device: pending.device,
    inspector: pending.inspector,
    lengthM: pending.lengthM,
    detectDate: pending.detectDate,
    completedDate: '',
    resultCode: '',
    remark: pending.remark,
    adoptLatest: true,
    adoptedSeq: report.value?.adoptedSeq ?? 0,
    adoptBasis: defaultBasis(pending.seq),
  }
}

function reload() {
  const id = Number(route.params.id)
  const found = Number.isFinite(id) ? getReport(id) : null
  report.value = found
  if (found) {
    if (!adoptForm.value.seq) {
      adoptForm.value = { seq: found.adoptedSeq, basis: '' }
    }
    if (found.rounds.some((round) => round.started && round.completedDate === null)) {
      hydrateFormFromPending()
    }
    if (showReloadNote) {
      message.value = '已加载最新报告版本'
      messageKind.value = 'ok'
      showReloadNote = false
    }
    const anchor = typeof route.query.round === 'string' ? route.query.round : ''
    if (anchor) {
      window.setTimeout(() => {
        document.getElementById(`round-${anchor}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 0)
    }
  }
}

let showReloadNote = false
function reloadWithNote() {
  showReloadNote = true
  reload()
}

function backToList() {
  router.push({ name: 'pipe_detect' })
}

function notify(ok: boolean, text: string, kind: 'ok' | 'error' | 'version' = ok ? 'ok' : 'error') {
  message.value = text
  messageKind.value = kind
}

async function startRetestAction() {
  if (!report.value) {
    return
  }
  busy.value = true
  const result = await startRetest(report.value.id, report.value.version)
  busy.value = false
  notify(result.ok, result.message, result.ok ? 'ok' : result.latestVersion !== undefined ? 'version' : 'error')
  if (result.ok) {
    reload()
  } else if (result.latestVersion !== undefined) {
    reload()
  }
}

async function saveDraft() {
  if (!report.value) {
    return
  }
  busy.value = true
  const result = await saveRetestDraft({
    id: report.value.id,
    method: retestForm.value.method,
    device: retestForm.value.device,
    inspector: retestForm.value.inspector,
    lengthM: Number(retestForm.value.lengthM),
    detectDate: retestForm.value.detectDate,
    remark: retestForm.value.remark,
    expectedVersion: report.value.version,
  })
  busy.value = false
  notify(result.ok, result.message, result.ok ? 'ok' : result.latestVersion !== undefined ? 'version' : 'error')
  if (result.ok) {
    reload()
  } else if (result.latestVersion !== undefined) {
    reload()
  }
}

async function submitConclusion() {
  if (!report.value || !pendingRound.value) {
    return
  }
  if (retestForm.value.resultCode === '') {
    notify(false, '请选择复测结论')
    return
  }
  busy.value = true
  const result = await submitRetest({
    id: report.value.id,
    method: retestForm.value.method,
    device: retestForm.value.device,
    inspector: retestForm.value.inspector,
    lengthM: Number(retestForm.value.lengthM),
    detectDate: retestForm.value.detectDate,
    completedDate: retestForm.value.completedDate,
    resultCode: retestForm.value.resultCode || ('OK' as ResultCode),
    remark: retestForm.value.remark,
    adoptLatest: retestForm.value.adoptLatest,
    adoptedSeq: retestForm.value.adoptedSeq,
    adoptBasis: retestForm.value.adoptBasis,
    expectedVersion: report.value.version,
  })
  busy.value = false
  notify(result.ok, result.message, result.ok ? 'ok' : result.latestVersion !== undefined ? 'version' : 'error')
  if (result.ok) {
    reload()
  } else if (result.latestVersion !== undefined) {
    reload()
  }
}

async function submitAdopt() {
  if (!report.value) {
    return
  }
  busy.value = true
  const result = await adoptHistoricalRound(
    report.value.id,
    adoptForm.value.seq,
    adoptForm.value.basis,
    report.value.version,
  )
  busy.value = false
  notify(result.ok, result.message, result.ok ? 'ok' : result.latestVersion !== undefined ? 'version' : 'error')
  if (result.ok) {
    adoptForm.value.basis = ''
    reload()
  } else if (result.latestVersion !== undefined) {
    reload()
  }
}

watch(
  () => route.params.id,
  () => reload(),
)

// 选择/改变复测结论时，按是否与历史结论冲突重填一次依据建议（用户仍可改写）。
watch(
  () => retestForm.value.resultCode,
  () => {
    if (pendingRound.value) {
      retestForm.value.adoptBasis = defaultBasis(pendingRound.value.seq)
    }
  },
)

onMounted(reload)
</script>
