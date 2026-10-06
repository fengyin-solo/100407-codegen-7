<template>
  <section class="page detail-page" v-if="report">
    <header class="page-head">
      <div>
        <h2>检测报告 {{ report.code }}</h2>
        <p class="page-desc">
          <button class="link" type="button" @click="backToList">← 返回检索台（保留已选条件）</button>
        </p>
      </div>
      <div class="page-actions">
        <span class="status-tag big" :class="statusClass(report.status)">{{ report.status }}</span>
        <span class="version-tag">当前版本 v{{ report.version }}</span>
      </div>
    </header>

    <div v-if="report.conflict" class="conflict-banner" role="alert">
      该报告各轮结论存在冲突：系统已保留全部轮次结论，并以「当前采用依据」标注本轮报告采信哪一轮，历史结论不覆盖、不删除。
    </div>

    <p v-if="actionMessage" :class="actionOk ? 'form-ok' : 'form-error'" role="status">
      {{ actionMessage }}
    </p>

    <article class="detail-grid">
      <div><span class="detail-label">检测管段</span>{{ report.segment }}</div>
      <div><span class="detail-label">检测方式</span>{{ report.method }}</div>
      <div><span class="detail-label">检测设备</span>{{ report.device }}</div>
      <div><span class="detail-label">检测人员</span>{{ report.inspector }}</div>
      <div><span class="detail-label">计划日期</span>{{ report.scheduledDate }}</div>
      <div>
        <span class="detail-label">实际检测日期</span>
        <template v-if="report.detectDate">{{ report.detectDate }}</template>
        <em v-else class="not-done">未完成检测，尚无实际检测日期</em>
      </div>
      <div><span class="detail-label">检测长度</span>{{ report.length || '—' }}</div>
      <div>
        <span class="detail-label">当前采用结论</span>
        <strong v-if="report.conclusion">{{ report.conclusion }}</strong>
        <em v-else class="not-done">检测未完成，暂无结论</em>
      </div>
      <div class="detail-grid-wide">
        <span class="detail-label">当前采用依据</span>
        <template v-if="report.adoptedBasis">{{ report.adoptedBasis }}</template>
        <em v-else class="not-done">尚无轮次被采用</em>
      </div>
    </article>

    <section class="rounds-block">
      <h3>检测轮次（{{ report.rounds.length }} 轮，历史结论全部留档）</h3>
      <table v-if="report.rounds.length" class="data-table">
        <thead>
          <tr>
            <th>轮次</th>
            <th>类型</th>
            <th>检测日期</th>
            <th>方式 / 设备</th>
            <th>检测人员</th>
            <th>长度</th>
            <th>本轮结论</th>
            <th>缺陷描述</th>
            <th>采用状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="round in report.rounds" :key="round.round" :class="{ 'round-adopted': round.round === report.adoptedRound }">
            <td>第 {{ round.round }} 轮</td>
            <td>{{ round.kind }}</td>
            <td>{{ round.detectedDate }}</td>
            <td>{{ round.method }}<br /><span class="muted">{{ round.device }}</span></td>
            <td>{{ round.inspector }}</td>
            <td>{{ round.length }}</td>
            <td>
              <span :class="conclusionClass(round.conclusion)">{{ round.conclusion }}</span>
              <span v-if="isConflictRound(round)" class="conflict-flag">与采用结论冲突</span>
            </td>
            <td>{{ round.defects || '—' }}<br /><span class="muted">{{ round.remark }}</span></td>
            <td>
              <strong v-if="round.round === report.adoptedRound" class="adopted-mark">★ 当前采用</strong>
              <button
                v-else-if="canAdopt"
                class="link"
                type="button"
                @click="beginAdopt(round.round)"
              >
                采用这一轮
              </button>
              <span v-else class="muted">历史留档</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-box">报告尚未执行检测，没有任何检测轮次；未完成检测不会显示为已完成。</p>
    </section>

    <section class="actions-block">
      <h3>状态流转</h3>
      <div class="action-row">
        <button
          v-if="report.status === '待检测'"
          class="btn primary"
          type="button"
          @click="mode = report.rounds.length ? 'retest-result' : 'result'; beginRound(false)"
        >
          {{ report.rounds.length ? '开始复测' : '开始检测' }}
        </button>
        <template v-if="report.status === '检测中'">
          <button class="btn primary" type="button" @click="beginRound(false)">
            录入{{ report.rounds.length ? '复测' : '初检' }}结果
          </button>
          <button class="btn ghost" type="button" @click="beginRound(true)">
            模拟并发提交（同版本提交两次）
          </button>
        </template>
        <button
          v-if="report.status === '已完成' || report.status === '需复测'"
          class="btn"
          type="button"
          @click="openRetestPlan"
        >
          发起复测排期
        </button>
        <p class="muted action-hint">
          复测只追加新轮次，原始报告与历史结论始终保留；每次提交都会校验版本，并发提交只落一个当前版本。
        </p>
      </div>
    </section>

    <div v-if="showForm" class="modal-mask" @click.self="cancelForm">
      <form class="modal-card wide" @submit.prevent="submitForm">
        <h3>{{ formTitle }}</h3>
        <template v-if="mode === 'retest-plan'">
          <label>
            <span>复测方式 *</span>
            <select v-model="retestForm.method">
              <option value="">请选择</option>
              <option v-for="method in DETECT_METHODS" :key="method" :value="method">{{ method }}</option>
            </select>
          </label>
          <label>
            <span>复测设备 *</span>
            <input v-model="retestForm.device" list="detail-device-options" />
            <datalist id="detail-device-options">
              <option v-for="device in deviceOptions" :key="device" :value="device" />
            </datalist>
          </label>
          <label>
            <span>复测人员 *</span>
            <input v-model="retestForm.inspector" />
          </label>
          <label>
            <span>复测计划日期 *</span>
            <input v-model="retestForm.scheduledDate" placeholder="YYYY-MM-DD" />
          </label>
          <label class="modal-full">
            <span>排期说明</span>
            <input v-model="retestForm.remark" />
          </label>
        </template>

        <template v-else>
          <label>
            <span>检测方式 *</span>
            <select v-model="roundForm.method">
              <option v-for="method in DETECT_METHODS" :key="method" :value="method">{{ method }}</option>
            </select>
          </label>
          <label>
            <span>检测设备 *</span>
            <input v-model="roundForm.device" list="detail-device-options" />
          </label>
          <label>
            <span>检测人员 *</span>
            <input v-model="roundForm.inspector" />
          </label>
          <label>
            <span>检测日期 *</span>
            <input v-model="roundForm.detectedDate" placeholder="YYYY-MM-DD" />
          </label>
          <label>
            <span>检测长度 *</span>
            <input v-model="roundForm.length" />
          </label>
          <label>
            <span>检测结论 *</span>
            <select v-model="roundForm.conclusion">
              <option value="">请选择</option>
              <option value="合格">合格</option>
              <option value="合格：缺陷已修复">合格：缺陷已修复</option>
              <option value="不合格：缺陷仍存在">不合格：缺陷仍存在</option>
              <option value="不合格：新发现缺陷">不合格：新发现缺陷</option>
            </select>
          </label>
          <label class="modal-full">
            <span>缺陷描述</span>
            <textarea v-model="roundForm.defects" rows="2" />
          </label>
          <label class="modal-full">
            <span>备注</span>
            <textarea v-model="roundForm.remark" rows="2" />
          </label>
          <p class="muted">
            本次提交基于版本 v{{ baseVersion }}；若期间已有他人提交，服务端会拒绝并要求刷新。
          </p>
        </template>

        <p v-if="formError" class="form-error">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="cancelForm">取消</button>
          <button class="btn primary" type="submit">提交</button>
        </div>
      </form>
    </div>

    <div v-if="adoptTarget !== null" class="modal-mask" @click.self="adoptTarget = null">
      <form class="modal-card" @submit.prevent="confirmAdopt">
        <h3>采用第 {{ adoptTarget }} 轮结论</h3>
        <p class="muted">切换采用依据不会删除任何轮次；请说明为什么采用这一轮。</p>
        <label class="modal-full">
          <span>采用依据说明 *</span>
          <textarea v-model="adoptBasis" rows="3" />
        </label>
        <p v-if="formError" class="form-error">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="adoptTarget = null">取消</button>
          <button class="btn primary" type="submit">确认采用</button>
        </div>
      </form>
    </div>
  </section>

  <section v-else class="page">
    <header class="page-head">
      <div>
        <h2>报告不存在</h2>
        <p class="page-desc">
          <button class="link" type="button" @click="backToList">← 返回检索台</button>
        </p>
      </div>
    </header>
    <p class="form-error">没有找到这条检测报告，它可能已被重置；检索条件仍保留在检索台。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  adoptDetectRound,
  detectDeviceOptions,
  getDetectReport,
  requestRetest,
  startDetect,
  submitDetectResult,
  submitRetestResult,
} from '@/api/pipe-detect-controller'
import {
  DETECT_METHODS,
  type DetectReport,
  type RetestInput,
  type RoundInput,
} from '@/data/pipe-detect/types'

const route = useRoute()
const router = useRouter()

const reportId = Number(route.params.id)
const report = ref<DetectReport | null>(getDetectReport(reportId))
const deviceOptions = ref<string[]>([])
const actionMessage = ref('')
const actionOk = ref(true)

const showForm = ref(false)
// result：初检录入；retest-result：复测录入；retest-plan：复测排期
const mode = ref<'result' | 'retest-result' | 'retest-plan'>('result')
const formError = ref('')
const baseVersion = ref(0)

const roundForm = ref({
  method: '',
  device: '',
  inspector: '',
  detectedDate: '',
  length: '',
  conclusion: '',
  defects: '',
  remark: '',
})
const retestForm = ref<RetestInput>({
  version: 0,
  method: '',
  device: '',
  inspector: '',
  scheduledDate: '',
  remark: '',
})
const adoptTarget = ref<number | null>(null)
const adoptBasis = ref('')

const canAdopt = computed(
  () => report.value !== null && report.value.rounds.length > 1 && report.value.status !== '检测中',
)

const formTitle = computed(() => {
  if (mode.value === 'retest-plan') {
    return '发起复测排期'
  }
  const isRetest = (report.value?.rounds.length ?? 0) > 0
  return isRetest ? `录入第 ${(report.value?.rounds.length ?? 0) + 1} 轮复测结果` : '录入初检结果'
})

function refresh() {
  report.value = getDetectReport(reportId)
}

function statusClass(status: string): string {
  return {
    待检测: 'status-pending',
    检测中: 'status-running',
    已完成: 'status-done',
    需复测: 'status-retest',
  }[status] ?? ''
}

function conclusionClass(conclusion: string): string {
  return conclusion.includes('合格') && !conclusion.includes('不')
    ? 'conclusion-pass'
    : 'conclusion-fail'
}

function isConflictRound(round: { conclusion: string }): boolean {
  if (!report.value || report.value.adoptedRound === null) {
    return false
  }
  const adopted = report.value.rounds.find((item) => item.round === report.value?.adoptedRound)
  if (!adopted) {
    return false
  }
  const pass = (text: string) => text.includes('合格') && !text.includes('不')
  return pass(adopted.conclusion) !== pass(round.conclusion)
}

function backToList() {
  router.push({ name: 'pipe_detect', query: { focus: String(reportId) } })
}

function notify(ok: boolean, message: string) {
  actionOk.value = ok
  actionMessage.value = message
}

function openRetestPlan() {
  const current = getDetectReport(reportId)
  if (!current) {
    return
  }
  mode.value = 'retest-plan'
  formError.value = ''
  retestForm.value = {
    version: current.version,
    method: current.method,
    device: current.device,
    inspector: current.inspector,
    scheduledDate: '',
    remark: '',
  }
  showForm.value = true
}

function beginRound(simulateConcurrent: boolean) {
  if (!report.value) {
    return
  }
  const isRetest = report.value.rounds.length > 0
  mode.value = isRetest ? 'retest-result' : 'result'
  formError.value = ''
  if (report.value.status === '待检测') {
    const result = startDetect(report.value.id, report.value.version)
    if (!result.ok) {
      notify(false, result.message)
      return
    }
    refresh()
    notify(true, result.message)
  }
  if (simulateConcurrent) {
    runConcurrentSubmit()
    return
  }
  const current = getDetectReport(reportId)
  if (!current) {
    return
  }
  baseVersion.value = current.version
  roundForm.value = {
    method: current.method,
    device: current.device,
    inspector: current.inspector,
    detectedDate: '',
    length: current.length,
    conclusion: '',
    defects: '',
    remark: '',
  }
  showForm.value = true
}

function runConcurrentSubmit() {
  // 并发提交演示：同一个基版本连提两次，只有第一次落库，第二次拿到版本冲突。
  const current = getDetectReport(reportId)
  if (!current) {
    return
  }
  const base = current.version
  const payloadA: RoundInput = {
    version: base,
    method: current.method,
    device: current.device,
    inspector: current.inspector,
    detectedDate: '2026-10-06',
    length: current.length,
    conclusion: '合格',
    defects: '并发演示：第一份提交',
    remark: '并发提交演示',
  }
  const payloadB: RoundInput = { ...payloadA, defects: '并发演示：第二份提交（应被拒绝）' }
  const isRetest = current.rounds.length > 0
  const submit = isRetest ? submitRetestResult : submitDetectResult
  const first = submit(current.id, payloadA)
  const second = submit(current.id, payloadB)
  refresh()
  notify(
    second.ok,
    `第 1 次提交：${first.message} ｜ 第 2 次提交：${second.message}`,
  )
}

function submitForm() {
  if (!report.value) {
    return
  }
  if (mode.value === 'retest-plan') {
    const result = requestRetest(report.value.id, {
      ...retestForm.value,
      version: report.value.version,
    })
    if (!result.ok) {
      formError.value = result.message
      return
    }
    showForm.value = false
    refresh()
    notify(true, result.message)
    return
  }

  const payload: RoundInput = { ...roundForm.value, version: baseVersion.value }
  const isRetest = (report.value.rounds.length ?? 0) > 0
  const result = isRetest
    ? submitRetestResult(report.value.id, payload)
    : submitDetectResult(report.value.id, payload)
  if (!result.ok) {
    formError.value = result.message
    notify(false, result.message)
    return
  }
  showForm.value = false
  refresh()
  notify(true, result.message)
}

function cancelForm() {
  showForm.value = false
  formError.value = ''
}

function beginAdopt(round: number) {
  adoptTarget.value = round
  adoptBasis.value = ''
  formError.value = ''
}

function confirmAdopt() {
  if (!report.value || adoptTarget.value === null) {
    return
  }
  const result = adoptDetectRound(report.value.id, {
    version: report.value.version,
    round: adoptTarget.value,
    basis: adoptBasis.value,
  })
  if (!result.ok) {
    formError.value = result.message
    return
  }
  adoptTarget.value = null
  refresh()
  notify(true, result.message)
}

onMounted(() => {
  deviceOptions.value = detectDeviceOptions()
  refresh()
})
</script>
