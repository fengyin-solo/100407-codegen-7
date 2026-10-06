// 页面统一从这里读写管道检测报告；store 只负责持久化，不直接出现在组件里。
export {
  adoptDetectRound,
  createDetectReport,
  detectDeviceOptions,
  detectStats,
  downloadDetectCsv,
  exportDetectCsv,
  getDetectReport,
  queryDetectReports,
  requestRetest,
  startDetect,
  submitDetectResult,
  submitRetestResult,
  validateDetectFilters,
  DETECT_VERSION_CONFLICT_MESSAGE,
} from './pipe-detect-service'
export { resetDetectReports as resetDetectData } from '@/data/pipe-detect/store'
