/**
 * Zustand Store — 舰载系统看板状态管理
 * HTTP 5s 轮询，无 WebSocket
 */

import { create } from 'zustand';
import {
  api,
  type Task,
  type LiveStatus,
  type AgentConfig,
  type NodesData,
  type AgentsStatusData,
  type MorningBrief,
  type SubConfig,
  type ChangeLogEntry,
} from './api';

// ── Pipeline Definition (PIPE) ──

export const DISPLAY_NAME_MAP: Record<string, string> = {
  '主人': '主人',
  '云霄': '云霄',
  '星枢': '星枢',
  '棱镜': '棱镜',
  '中继': '中继',
  '文枢': '文枢',
  '源流': '源流',
  '维控': '维控',
  '探针': '探针',
  '机务': '机务',
  '序列': '序列',
  '天眼': '天眼',
  '执行群组': '执行群组',
};

export function displayName(name: string): string {
  return DISPLAY_NAME_MAP[name] || name;
}

const DISPLAY_TEXT_ENTRIES = Object.entries(DISPLAY_NAME_MAP).sort((a, b) => b[0].length - a[0].length);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function displayText(text: string): string {
  if (!text) return text;
  let next = text;
  for (const [from, to] of DISPLAY_TEXT_ENTRIES) {
    next = next.replace(new RegExp(escapeRegExp(from), 'g'), to);
  }
  return next;
}

export const PIPE = [
  { key: 'Inbox',    dept: '主人',     icon: '👤', action: '注入' },
  { key: 'Yunxiao',  dept: '云霄',     icon: '🧭', action: '接入' },
  { key: 'Xingshu',  dept: '星枢',     icon: '🧠', action: '建模' },
  { key: 'Lengjing', dept: '棱镜',     icon: '🔍', action: '校验' },
  { key: 'Assigned', dept: '中继',     icon: '📡', action: '派遣' },
  { key: 'Doing',    dept: '执行节点', icon: '⚙️', action: '推进' },
  { key: 'Review',   dept: '中继',     icon: '🔎', action: '汇流' },
  { key: 'Done',     dept: '回传',     icon: '✅', action: '闭环' },
] as const;

export const PIPE_STATE_IDX: Record<string, number> = {
  Inbox: 0, Pending: 0, Yunxiao: 1, Xingshu: 2, Lengjing: 3,
  Assigned: 4, Doing: 5, Review: 6, Done: 7, Blocked: 5, Cancelled: 5, Next: 4,
};

export const DEPT_COLOR: Record<string, string> = {
  '主人': '#ffd700',
  '云霄': '#e8a040',
  '星枢': '#a07aff',
  '棱镜': '#6a9eff',
  '中继': '#6aef9a',
  '文枢': '#f5c842',
  '源流': '#ff9a6a',
  '维控': '#ff5270',
  '探针': '#cc4444',
  '机务': '#44aaff',
  '序列': '#9b59b6',
  '天眼': '#38bdf8',
  '执行群组': '#06b6d4',
  '执行节点': '#06b6d4',
  '回传': '#2ecc8a',
};

export const STATE_LABEL: Record<string, string> = {
  Inbox: '源指令注入', Pending: '待接入', Yunxiao: '云霄接入', Xingshu: '星枢建模',
  Lengjing: '棱镜校验', Assigned: '已派遣', Doing: '链路推进中', Review: '待汇流',
  Done: '全链完成', Blocked: '航道阻塞', Cancelled: '已中止', Next: '待派遣',
};

export function deptColor(d: string): string {
  return DEPT_COLOR[d] || '#6a9eff';
}

export function stateLabel(t: Task): string {
  const r = t.review_round || 0;
  if (t.state === 'Lengjing' && r > 1) return `棱镜校验（第${r}轮）`;
  if (t.state === 'Xingshu' && r > 0) return `星枢重算（第${r}轮）`;
  return STATE_LABEL[t.state] || t.state;
}

export function isEdict(t: Task): boolean {
  return /^JJC-/i.test(t.id || '');
}

export function isSession(t: Task): boolean {
  return /^(OC-|MC-)/i.test(t.id || '');
}

export function isArchived(t: Task): boolean {
  return !!t.archived;
}

export type PipeStatus = { key: string; dept: string; icon: string; action: string; status: 'done' | 'active' | 'pending' };

export function getPipeStatus(t: Task): PipeStatus[] {
  const stateIdx = PIPE_STATE_IDX[t.state] ?? 4;
  return PIPE.map((stage, i) => ({
    ...stage,
    status: (i < stateIdx ? 'done' : i === stateIdx ? 'active' : 'pending') as 'done' | 'active' | 'pending',
  }));
}

// ── Tabs ──

export type TabKey =
  | 'edicts' | 'monitor' | 'nodes' | 'models'
  | 'skills' | 'sessions' | 'archives' | 'templates' | 'morning' | 'bridge';

export const TAB_DEFS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'edicts',    label: '任务星图', icon: '📜' },
  { key: 'bridge',    label: '战术沙盘', icon: '🏛️' },
  { key: 'monitor',   label: '节点航道', icon: '🔌' },
  { key: 'nodes',     label: '节点图谱', icon: '👔' },
  { key: 'models',    label: '模型矩阵', icon: '🤖' },
  { key: 'skills',    label: '能力挂载', icon: '🎯' },
  { key: 'sessions',  label: '侧链会话', icon: '💬' },
  { key: 'archives',  label: '任务黑匣', icon: '📜' },
  { key: 'templates', label: '任务模板库', icon: '📋' },
  { key: 'morning',   label: '天眼情报流', icon: '🌅' },
];

// ── DEPTS for monitor ──

export const DEPTS = [
  { id: 'main',    label: '云霄', emoji: '🧭', role: '入口分拣核心', rank: '核心层' },
  { id: 'xingshu', label: '星枢', emoji: '🧠', role: '规划与起草中枢', rank: '核心层' },
  { id: 'lengjing',   label: '棱镜', emoji: '🔍', role: '校核与拦截中枢', rank: '核心层' },
  { id: 'zhongji', label: '中继', emoji: '📡', role: '路由与调度中枢', rank: '核心层' },
  { id: 'wenshu',     label: '文枢', emoji: '📝', role: '文档与表达模块', rank: '执行层' },
  { id: 'yuanliu',     label: '源流', emoji: '💾', role: '资源与数据模块', rank: '执行层' },
  { id: 'weikong',   label: '维控', emoji: '🛡️', role: '执行与安全模块', rank: '执行层' },
  { id: 'tanzhen',   label: '探针', emoji: '⚖️', role: '审计与校验模块', rank: '执行层' },
  { id: 'jiwu',   label: '机务', emoji: '🔧', role: '工程与设施模块', rank: '执行层' },
  { id: 'xulie',  label: '序列', emoji: '🗂️', role: '编组与权限模块', rank: '执行层' },
  { id: 'tianyan',  label: '天眼', emoji: '🛰️', role: '态势与情报模块', rank: '感知层' },
];

// ── Templates ──

export interface TemplateParam {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  default?: string;
  required?: boolean;
  options?: string[];
}

export interface Template {
  id: string;
  cat: string;
  icon: string;
  name: string;
  desc: string;
  depts: string[];
  est: string;
  cost: string;
  params: TemplateParam[];
  command: string;
}

export const TEMPLATES: Template[] = [
  {
    id: 'tpl-weekly-report', cat: '舰桥事务', icon: '📝', name: '周报生成',
    desc: '基于本周看板数据和各节点产出，自动生成结构化周报',
    depts: ['源流', '文枢'], est: '~10分钟', cost: '¥0.5',
    params: [
      { key: 'date_range', label: '报告周期', type: 'text', default: '本周', required: true },
      { key: 'focus', label: '重点关注（逗号分隔）', type: 'text', default: '项目进展,下周计划' },
      { key: 'format', label: '输出格式', type: 'select', options: ['Markdown', '飞书文档'], default: 'Markdown' },
    ],
    command: '生成{date_range}的周报，重点覆盖{focus}，输出为{format}格式',
  },
  {
    id: 'tpl-code-review', cat: '工程坞', icon: '🔍', name: '代码审查',
    desc: '对指定代码仓库/文件进行质量审查，输出问题清单和改进建议',
    depts: ['维控', '探针'], est: '~20分钟', cost: '¥2',
    params: [
      { key: 'repo', label: '仓库/文件路径', type: 'text', required: true },
      { key: 'scope', label: '审查范围', type: 'select', options: ['全量', '增量(最近commit)', '指定文件'], default: '增量(最近commit)' },
      { key: 'focus', label: '重点关注（可选）', type: 'text', default: '安全漏洞,错误处理,性能' },
    ],
    command: '对 {repo} 进行代码审查，范围：{scope}，重点关注：{focus}',
  },
  {
    id: 'tpl-api-design', cat: '工程坞', icon: '⚡', name: 'API 设计与实现',
    desc: '从需求描述到 RESTful API 设计、实现、测试一条龙',
    depts: ['星枢', '维控'], est: '~45分钟', cost: '¥3',
    params: [
      { key: 'requirement', label: '需求描述', type: 'textarea', required: true },
      { key: 'tech', label: '技术栈', type: 'select', options: ['Python/FastAPI', 'Node/Express', 'Go/Gin'], default: 'Python/FastAPI' },
      { key: 'auth', label: '鉴权方式', type: 'select', options: ['JWT', 'API Key', '无'], default: 'JWT' },
    ],
    command: '设计并实现一个 {tech} 的 RESTful API：{requirement}。鉴权方式：{auth}',
  },
  {
    id: 'tpl-competitor', cat: '数据观测', icon: '📊', name: '竞品分析',
    desc: '爬取竞品网站数据，分析对比，生成结构化报告',
    depts: ['维控', '源流', '文枢'], est: '~60分钟', cost: '¥5',
    params: [
      { key: 'targets', label: '竞品名称/URL（每行一个）', type: 'textarea', required: true },
      { key: 'dimensions', label: '分析维度', type: 'text', default: '产品功能,定价策略,用户评价' },
      { key: 'format', label: '输出格式', type: 'select', options: ['Markdown报告', '表格对比'], default: 'Markdown报告' },
    ],
    command: '对以下竞品进行分析：\n{targets}\n\n分析维度：{dimensions}，输出格式：{format}',
  },
  {
    id: 'tpl-data-report', cat: '数据观测', icon: '📈', name: '数据报告',
    desc: '对给定数据集进行清洗、分析、可视化，输出分析报告',
    depts: ['源流', '文枢'], est: '~30分钟', cost: '¥2',
    params: [
      { key: 'data_source', label: '数据源描述/路径', type: 'text', required: true },
      { key: 'questions', label: '分析问题（每行一个）', type: 'textarea' },
      { key: 'viz', label: '是否需要可视化图表', type: 'select', options: ['是', '否'], default: '是' },
    ],
    command: '对数据 {data_source} 进行分析。{questions}\n需要可视化：{viz}',
  },
  {
    id: 'tpl-blog', cat: '内容编织', icon: '✍️', name: '博客文章',
    desc: '给定主题和要求，生成高质量博客文章',
    depts: ['文枢'], est: '~15分钟', cost: '¥1',
    params: [
      { key: 'topic', label: '文章主题', type: 'text', required: true },
      { key: 'audience', label: '目标读者', type: 'text', default: '技术人员' },
      { key: 'length', label: '期望字数', type: 'select', options: ['~1000字', '~2000字', '~3000字'], default: '~2000字' },
      { key: 'style', label: '风格', type: 'select', options: ['技术教程', '观点评论', '案例分析'], default: '技术教程' },
    ],
    command: '写一篇关于「{topic}」的博客文章，面向{audience}，{length}，风格：{style}',
  },
  {
    id: 'tpl-deploy', cat: '工程坞', icon: '🚀', name: '部署方案',
    desc: '生成完整的部署检查单、Docker配置、CI/CD流程',
    depts: ['维控', '机务'], est: '~25分钟', cost: '¥2',
    params: [
      { key: 'project', label: '项目名称/描述', type: 'text', required: true },
      { key: 'env', label: '部署环境', type: 'select', options: ['Docker', 'K8s', 'VPS', 'Serverless'], default: 'Docker' },
      { key: 'ci', label: 'CI/CD 工具', type: 'select', options: ['GitHub Actions', 'GitLab CI', '无'], default: 'GitHub Actions' },
    ],
    command: '为项目「{project}」生成{env}部署方案，CI/CD使用{ci}',
  },
  {
    id: 'tpl-email', cat: '内容编织', icon: '📧', name: '邮件/通知文案',
    desc: '根据场景和目的，生成专业邮件或通知文案',
    depts: ['文枢'], est: '~5分钟', cost: '¥0.3',
    params: [
      { key: 'scenario', label: '使用场景', type: 'select', options: ['商务邮件', '产品发布', '客户通知', '内部公告'], default: '商务邮件' },
      { key: 'purpose', label: '目的/内容', type: 'textarea', required: true },
      { key: 'tone', label: '语调', type: 'select', options: ['正式', '友好', '简洁'], default: '正式' },
    ],
    command: '撰写一封{scenario}，{tone}语调。内容：{purpose}',
  },
  {
    id: 'tpl-standup', cat: '舰桥事务', icon: '🗓️', name: '每日值班摘要',
    desc: '汇总各节点今日进展和下一阶段计划，生成值班摘要',
    depts: ['中继'], est: '~5分钟', cost: '¥0.3',
    params: [
      { key: 'range', label: '汇总范围', type: 'select', options: ['今天', '最近24小时', '昨天+今天'], default: '今天' },
    ],
    command: '汇总{range}各节点工作进展和待办，生成值班摘要',
  },
];

export const TPL_CATS = [
  { name: '全部', icon: '📋' },
  { name: '舰桥事务', icon: '💼' },
  { name: '数据观测', icon: '📊' },
  { name: '工程坞', icon: '⚙️' },
  { name: '内容编织', icon: '✍️' },
];

// ── Main Store ──

interface AppStore {
  // Data
  liveStatus: LiveStatus | null;
  agentConfig: AgentConfig | null;
  changeLog: ChangeLogEntry[];
  nodesData: NodesData | null;
  agentsStatusData: AgentsStatusData | null;
  morningBrief: MorningBrief | null;
  subConfig: SubConfig | null;

  // UI State
  activeTab: TabKey;
  edictFilter: 'active' | 'archived' | 'all';
  sessFilter: string;
  tplCatFilter: string;
  selectedNode: string | null;
  modalTaskId: string | null;
  countdown: number;

  // Toast
  toasts: { id: number; msg: string; type: 'ok' | 'err' }[];

  // Actions
  setActiveTab: (tab: TabKey) => void;
  setEdictFilter: (f: 'active' | 'archived' | 'all') => void;
  setSessFilter: (f: string) => void;
  setTplCatFilter: (f: string) => void;
  setSelectedNode: (id: string | null) => void;
  setModalTaskId: (id: string | null) => void;
  setCountdown: (n: number) => void;
  toast: (msg: string, type?: 'ok' | 'err') => void;

  // Data fetching
  loadLive: () => Promise<void>;
  loadAgentConfig: () => Promise<void>;
  loadNodes: () => Promise<void>;
  loadAgentsStatus: () => Promise<void>;
  loadMorning: () => Promise<void>;
  loadSubConfig: () => Promise<void>;
  loadAll: () => Promise<void>;
}

let _toastId = 0;

export const useStore = create<AppStore>((set, get) => ({
  liveStatus: null,
  agentConfig: null,
  changeLog: [],
  nodesData: null,
  agentsStatusData: null,
  morningBrief: null,
  subConfig: null,

  activeTab: 'edicts',
  edictFilter: 'active',
  sessFilter: 'all',
  tplCatFilter: '全部',
  selectedNode: null,
  modalTaskId: null,
  countdown: 5,

  toasts: [],

  setActiveTab: (tab) => {
    set({ activeTab: tab });
    const s = get();
    if (['models', 'skills', 'sessions'].includes(tab) && !s.agentConfig) s.loadAgentConfig();
    if (tab === 'nodes' && !s.nodesData) s.loadNodes();
    if (tab === 'monitor') s.loadAgentsStatus();
    if (tab === 'morning' && !s.morningBrief) s.loadMorning();
  },
  setEdictFilter: (f) => set({ edictFilter: f }),
  setSessFilter: (f) => set({ sessFilter: f }),
  setTplCatFilter: (f) => set({ tplCatFilter: f }),
  setSelectedNode: (id) => set({ selectedNode: id }),
  setModalTaskId: (id) => set({ modalTaskId: id }),
  setCountdown: (n) => set({ countdown: n }),

  toast: (msg, type = 'ok') => {
    const id = ++_toastId;
    set((s) => ({ toasts: [...s.toasts, { id, msg, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },

  loadLive: async () => {
    try {
      const data = await api.liveStatus();
      set({ liveStatus: data });
      // Also preload nodes for monitor tab
      const s = get();
      if (!s.nodesData) {
        api.nodesStats().then((d) => set({ nodesData: d })).catch(() => {});
      }
    } catch {
      // silently fail
    }
  },

  loadAgentConfig: async () => {
    try {
      const cfg = await api.agentConfig();
      const log = await api.modelChangeLog();
      set({ agentConfig: cfg, changeLog: log });
    } catch {
      // silently fail
    }
  },

  loadNodes: async () => {
    try {
      const data = await api.nodesStats();
      set({ nodesData: data });
    } catch {
      // silently fail
    }
  },

  loadAgentsStatus: async () => {
    try {
      const data = await api.agentsStatus();
      set({ agentsStatusData: data });
    } catch {
      set({ agentsStatusData: null });
    }
  },

  loadMorning: async () => {
    try {
      const [brief, config] = await Promise.all([api.morningBrief(), api.morningConfig()]);
      set({ morningBrief: brief, subConfig: config });
    } catch {
      // silently fail
    }
  },

  loadSubConfig: async () => {
    try {
      const config = await api.morningConfig();
      set({ subConfig: config });
    } catch {
      // silently fail
    }
  },

  loadAll: async () => {
    const s = get();
    await s.loadLive();
    const tab = s.activeTab;
    if (['models', 'skills'].includes(tab)) await s.loadAgentConfig();
  },
}));

// ── Countdown & Polling ──

let _cdTimer: ReturnType<typeof setInterval> | null = null;

export function startPolling() {
  if (_cdTimer) return;
  useStore.getState().loadAll();
  _cdTimer = setInterval(() => {
    const s = useStore.getState();
    const cd = s.countdown - 1;
    if (cd <= 0) {
      s.setCountdown(5);
      s.loadAll();
    } else {
      s.setCountdown(cd);
    }
  }, 1000);
}

export function stopPolling() {
  if (_cdTimer) {
    clearInterval(_cdTimer);
    _cdTimer = null;
  }
}

// ── Utility ──

export function esc(s: string | undefined | null): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isValidDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function fromNumericTimestamp(value: number): Date | null {
  if (!Number.isFinite(value)) return null;
  const ts = Math.abs(value) < 1e12 ? value * 1000 : value;
  const date = new Date(ts);
  return isValidDate(date) ? date : null;
}

export function parseDateInput(input: string | number | Date | undefined | null): Date | null {
  if (input == null || input === '') return null;
  if (input instanceof Date) return isValidDate(input) ? input : null;
  if (typeof input === 'number') return fromNumericTimestamp(input);

  const value = String(input).trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) return fromNumericTimestamp(Number(value));

  const localMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/
  );
  if (localMatch) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0', ms = '0'] = localMatch;
    const date = new Date(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss),
      Number(ms.padEnd(3, '0'))
    );
    return isValidDate(date) ? date : null;
  }

  const normalized =
    value.includes(' ') && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)
      ? value.replace(' ', 'T')
      : value;
  const date = new Date(normalized);
  return isValidDate(date) ? date : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLocalDateKey(input: string | number | Date | undefined | null = new Date()): string {
  const date = parseDateInput(input);
  if (!date) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatLocalTime(
  input: string | number | Date | undefined | null,
  withSeconds = true
): string {
  const date = parseDateInput(input);
  if (!date) return '';
  const base = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad2(date.getSeconds())}` : base;
}

export function formatLocalDateTime(
  input: string | number | Date | undefined | null,
  opts: { withSeconds?: boolean } = {}
): string {
  const date = parseDateInput(input);
  if (!date) return '';
  const datePart = formatLocalDateKey(date);
  const timePart = formatLocalTime(date, opts.withSeconds !== false);
  return timePart ? `${datePart} ${timePart}` : datePart;
}

export function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  try {
    const d = parseDateInput(iso);
    if (!d) return '';
    const diff = Date.now() - d.getTime();
    const absMins = Math.floor(Math.abs(diff) / 60000);
    if (absMins < 1) return '刚刚';
    if (diff < 0) {
      if (absMins < 60) return absMins + '分钟后';
      const hrs = Math.floor(absMins / 60);
      if (hrs < 24) return hrs + '小时后';
      return Math.floor(hrs / 24) + '天后';
    }
    if (absMins < 60) return absMins + '分钟前';
    const hrs = Math.floor(absMins / 60);
    if (hrs < 24) return hrs + '小时前';
    return Math.floor(hrs / 24) + '天前';
  } catch {
    return '';
  }
}
