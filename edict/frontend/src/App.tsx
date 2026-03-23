import { useEffect } from 'react';
import { useStore, TAB_DEFS, startPolling, stopPolling, isEdict, isArchived } from './store';
import EdictBoard from './components/EdictBoard';
import MonitorPanel from './components/MonitorPanel';
import NodePanel from './components/NodePanel';
import ModelConfig from './components/ModelConfig';
import SkillsConfig from './components/SkillsConfig';
import SessionsPanel from './components/SessionsPanel';
import ArchivePanel from './components/ArchivePanel';
import TemplatePanel from './components/TemplatePanel';
import MorningPanel from './components/MorningPanel';
import TaskModal from './components/TaskModal';
// ConfirmDialog is used inside TaskModal as needed
import Toaster from './components/Toaster';
import BootSequence from './components/BootSequence';
import BridgeDiscussion from './components/BridgeDiscussion';

export default function App() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const liveStatus = useStore((s) => s.liveStatus);
  const countdown = useStore((s) => s.countdown);
  const loadAll = useStore((s) => s.loadAll);

  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, []);

  // Compute header chips
  const tasks = liveStatus?.tasks || [];
  const edicts = tasks.filter(isEdict);
  const activeEdicts = edicts.filter((t) => !isArchived(t));
  const sync = liveStatus?.syncStatus;
  const syncOk = sync?.ok;

  // Tab badge counts
  const tabBadge = (key: string): string => {
    if (key === 'edicts') return String(activeEdicts.length);
    if (key === 'sessions') return String(tasks.filter((t) => !isEdict(t)).length);
    if (key === 'archives') return String(edicts.filter((t) => ['Done', 'Cancelled'].includes(t.state)).length);
    if (key === 'monitor') {
      const activeDepts = tasks.filter((t) => isEdict(t) && t.state === 'Doing').length;
      return activeDepts + '在线';
    }
    return '';
  };

  return (
    <div className="wrap">
      {/* ── Header ── */}
      <div className="hdr">
        <div>
          <div className="logo">舰桥主控台</div>
          <div className="sub-text">OpenClaw 星舰控制界面</div>
        </div>
        <div className="hdr-r">
          <span className={`chip ${syncOk ? 'ok' : syncOk === false ? 'err' : ''}`}>
            {syncOk ? '✅ 链路正常' : syncOk === false ? '❌ 主链路离线' : '⏳ 星链握手中…'}
          </span>
          <span className="chip">{activeEdicts.length} 条任务航迹</span>
          <button className="btn-refresh" onClick={() => loadAll()}>
            ⟳ 同步星图
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>⟳ {countdown}s</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="tabs">
        {TAB_DEFS.map((t) => (
          <div
            key={t.key}
            className={`tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.icon} {t.label}
            {tabBadge(t.key) && <span className="tbadge">{tabBadge(t.key)}</span>}
          </div>
        ))}
      </div>

      {/* ── Panels ── */}
      {activeTab === 'edicts' && <EdictBoard />}
      {activeTab === 'bridge' && <BridgeDiscussion />}
      {activeTab === 'monitor' && <MonitorPanel />}
      {activeTab === 'nodes' && <NodePanel />}
      {activeTab === 'models' && <ModelConfig />}
      {activeTab === 'skills' && <SkillsConfig />}
      {activeTab === 'sessions' && <SessionsPanel />}
      {activeTab === 'archives' && <ArchivePanel />}
      {activeTab === 'templates' && <TemplatePanel />}
      {activeTab === 'morning' && <MorningPanel />}

      {/* ── Overlays ── */}
      <TaskModal />
      <Toaster />
      <BootSequence />
    </div>
  );
}
