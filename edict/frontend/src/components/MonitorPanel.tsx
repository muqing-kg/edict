import { useEffect } from 'react';
import { useStore, DEPTS, isEdict, stateLabel, displayName, displayText } from '../store';
import { api, type NodeInfo } from '../api';

export default function MonitorPanel() {
  const liveStatus = useStore((s) => s.liveStatus);
  const agentsStatusData = useStore((s) => s.agentsStatusData);
  const nodesData = useStore((s) => s.nodesData);
  const loadAgentsStatus = useStore((s) => s.loadAgentsStatus);
  const setModalTaskId = useStore((s) => s.setModalTaskId);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    loadAgentsStatus();
  }, [loadAgentsStatus]);

  const tasks = liveStatus?.tasks || [];
  const activeTasks = tasks.filter((t) => isEdict(t) && t.state !== 'Done' && t.state !== 'Next');

  // Build node map
  const offMap: Record<string, NodeInfo> = {};
  if (nodesData?.nodes) {
    nodesData.nodes.forEach((o) => { offMap[o.id] = o; });
  }

  // Agent wake
  const handleWake = async (agentId: string) => {
    try {
      const r = await api.agentWake(agentId);
      toast(r.message || '唤醒脉冲已发出');
      setTimeout(() => loadAgentsStatus(), 30000);
    } catch { toast('唤醒失败', 'err'); }
  };

  const handleWakeAll = async () => {
    if (!agentsStatusData) return;
    const toWake = agentsStatusData.agents.filter(
      (a) => a.status !== 'running' && a.status !== 'unconfigured'
    );
    if (!toWake.length) { toast('所有节点均已在线'); return; }
    toast(`正在唤醒 ${toWake.length} 个节点...`);
    for (const a of toWake) {
      try { await api.agentWake(a.id); } catch { /* ignore */ }
    }
    toast(`${toWake.length} 个唤醒脉冲已发出，30秒后重扫状态`);
    setTimeout(() => loadAgentsStatus(), 30000);
  };

  // Agent Status Panel
  const asData = agentsStatusData;
  const filtered = asData?.agents || [];
  const running = filtered.filter((a) => a.status === 'running').length;
  const idle = filtered.filter((a) => a.status === 'idle').length;
  const offline = filtered.filter((a) => a.status === 'offline').length;
  const unconf = filtered.filter((a) => a.status === 'unconfigured').length;
  const gw = asData?.gateway;
  const gwCls = gw?.probe ? 'ok' : gw?.alive ? 'warn' : 'err';

  return (
    <div>
      {/* Agent Status Panel */}
      {asData && asData.ok && (
        <div className="as-panel">
          <div className="as-header">
            <span className="as-title">🔌 节点在线矩阵</span>
            <span className={`as-gw ${gwCls}`}>Gateway: {gw?.status || '未知'}</span>
            <button className="btn-refresh" onClick={() => loadAgentsStatus()} style={{ marginLeft: 8 }}>
              🔄 重扫
            </button>
            {(offline + unconf > 0) && (
              <button className="btn-refresh" onClick={handleWakeAll} style={{ marginLeft: 4, borderColor: 'var(--warn)', color: 'var(--warn)' }}>
                ⚡ 全节点唤醒
              </button>
            )}
          </div>
          <div className="as-grid">
            {filtered.map((a) => {
              const canWake = a.status !== 'running' && a.status !== 'unconfigured' && gw?.alive;
              return (
                <div key={a.id} className="as-card" title={`${a.role} · ${a.statusLabel}`}>
                  <div className={`as-dot ${a.status}`} />
                  <div style={{ fontSize: 22 }}>{a.emoji}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{displayName(a.label)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{displayName(a.role)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{a.statusLabel}</div>
                  {a.lastActive ? (
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>⏰ {a.lastActive}</div>
                  ) : (
                    <div style={{ fontSize: 10, color: 'var(--muted)' }}>无信号回传</div>
                  )}
                  {canWake && (
                    <button className="as-wake-btn" onClick={(e) => { e.stopPropagation(); handleWake(a.id); }}>
                      ⚡ 唤醒
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="as-summary">
            <span><span className="as-dot running" style={{ position: 'static', width: 8, height: 8 }} /> {running} 推进中</span>
            <span><span className="as-dot idle" style={{ position: 'static', width: 8, height: 8 }} /> {idle} 静默</span>
            {offline > 0 && <span><span className="as-dot offline" style={{ position: 'static', width: 8, height: 8 }} /> {offline} 失联</span>}
            {unconf > 0 && <span><span className="as-dot unconfigured" style={{ position: 'static', width: 8, height: 8 }} /> {unconf} 未挂载</span>}
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted)' }}>
              扫描于 {(asData.checkedAt || '').substring(11, 19)}
            </span>
          </div>
        </div>
      )}

      {/* Duty Grid */}
      <div className="duty-grid">
        {DEPTS.map((d) => {
          const myTasks = activeTasks.filter((t) => displayName(t.org || '') === displayName(d.label));
          const isActive = myTasks.some((t) => t.state === 'Doing');
          const isBlocked = myTasks.some((t) => t.state === 'Blocked');
          const off = offMap[d.id];
          const hb = off?.heartbeat || { status: 'idle', label: '⚪' };
          const dotCls = isBlocked ? 'blocked' : isActive ? 'busy' : hb.status === 'active' ? 'active' : 'idle';
          const statusText = isBlocked ? '⚠️ 航道阻塞' : isActive ? '⚙️ 推进中' : hb.status === 'active' ? '🟢 在线' : '⚪ 静默';
          const cardCls = isBlocked ? 'blocked-card' : isActive ? 'active-card' : '';

          return (
            <div key={d.id} className={`duty-card ${cardCls}`}>
              <div className="dc-hdr">
                <span className="dc-emoji">{d.emoji}</span>
                <div className="dc-info">
                  <div className="dc-name">{displayName(d.label)}</div>
                  <div className="dc-role">{d.role} · {d.rank}</div>
                </div>
                <div className="dc-status">
                  <span className={`dc-dot ${dotCls}`} />
                  <span>{statusText}</span>
                </div>
              </div>
              <div className="dc-body">
                {myTasks.length > 0 ? (
                  myTasks.map((t) => (
                    <div key={t.id} className="dc-task" onClick={() => setModalTaskId(t.id)}>
                      <div className="dc-task-id">{t.id}</div>
                      <div className="dc-task-title">{displayText(t.title || '(无标题)')}</div>
                      {t.now && t.now !== '-' && (
                        <div className="dc-task-now">{displayText(t.now).substring(0, 70)}</div>
                      )}
                      <div className="dc-task-meta">
                        <span className={`tag st-${t.state}`}>{stateLabel(t)}</span>
                        {t.block && t.block !== '无' && (
                          <span className="tag" style={{ borderColor: '#ff527044', color: 'var(--danger)' }}>🚫{displayText(t.block)}</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="dc-idle">
                    <span style={{ fontSize: 20 }}>🪭</span>
                    <span>静默待命</span>
                  </div>
                )}
              </div>
              <div className="dc-footer">
                <span className="dc-model">🤖 {off?.model_short || '待配置'}</span>
                {off?.last_active && <span className="dc-la">⏰ {off.last_active}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
