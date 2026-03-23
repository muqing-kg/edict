import { useEffect } from 'react';
import { useStore, STATE_LABEL, displayName, displayText } from '../store';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function NodePanel() {
  const nodesData = useStore((s) => s.nodesData);
  const selectedNode = useStore((s) => s.selectedNode);
  const setSelectedNode = useStore((s) => s.setSelectedNode);
  const loadNodes = useStore((s) => s.loadNodes);
  const setModalTaskId = useStore((s) => s.setModalTaskId);

  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  if (!nodesData?.nodes) {
    return <div className="empty">⚠️ 请确保主链路已启动</div>;
  }

  const nodes = nodesData.nodes;
  const totals = nodesData.totals || { tasks_done: 0, cost_cny: 0 };
  const maxTk = Math.max(...nodes.map((o) => o.tokens_in + o.tokens_out + o.cache_read + o.cache_write), 1);

  // Active nodes
  const alive = nodes.filter((o) => o.heartbeat?.status === 'active');

  // Selected node detail
  const sel = nodes.find((o) => o.id === (selectedNode || nodes[0]?.id));
  const selId = sel?.id || nodes[0]?.id;

  return (
    <div>
      {/* Activity banner */}
      {alive.length > 0 && (
        <div className="node-activity">
          <span>🟢 当前在线节点：</span>
          {alive.map((o) => (
            <span key={o.id} style={{ fontSize: 12 }}>{o.emoji} {displayName(o.role)}</span>
          ))}
          <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 'auto' }}>其余节点处于静默轨道</span>
        </div>
      )}

      {/* KPI Row */}
      <div className="node-kpi">
        <div className="kpi">
          <div className="kpi-v" style={{ color: 'var(--acc)' }}>{nodes.length}</div>
          <div className="kpi-l">接入节点</div>
        </div>
        <div className="kpi">
          <div className="kpi-v" style={{ color: '#f5c842' }}>{totals.tasks_done || 0}</div>
          <div className="kpi-l">累计完成任务</div>
        </div>
        <div className="kpi">
          <div className="kpi-v" style={{ color: (totals.cost_cny || 0) > 20 ? 'var(--warn)' : 'var(--ok)' }}>
            ¥{totals.cost_cny || 0}
          </div>
          <div className="kpi-l">累计耗能（含缓存）</div>
        </div>
        <div className="kpi">
          <div className="kpi-v" style={{ fontSize: 16, paddingTop: 4 }}>{displayName(nodesData.top_node || '—')}</div>
          <div className="kpi-l">信号峰值</div>
        </div>
      </div>

      {/* Layout: Ranklist + Detail */}
      <div className="node-layout">
        {/* Left: Ranklist */}
        <div className="node-ranklist">
          <div className="orl-hdr">节点功率排行</div>
          {nodes.map((o) => {
            const hb = o.heartbeat || { status: 'idle' };
            return (
              <div
                key={o.id}
                className={`orl-item${selId === o.id ? ' selected' : ''}`}
                onClick={() => setSelectedNode(o.id)}
              >
                <span style={{ minWidth: 24, textAlign: 'center' }}>
                  {o.merit_rank <= 3 ? MEDALS[o.merit_rank - 1] : '#' + o.merit_rank}
                </span>
                <span>{o.emoji}</span>
                <span style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{displayName(o.role)}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{displayName(o.label)}</div>
                </span>
                <span style={{ fontSize: 11 }}>{o.merit_score}点</span>
                <span className={`dc-dot ${hb.status}`} style={{ width: 8, height: 8 }} />
              </div>
            );
          })}
        </div>

        {/* Right: Detail */}
        <div className="node-detail">
          {sel ? (
            <NodeDetail node={sel} maxTk={maxTk} onOpenTask={setModalTaskId} />
          ) : (
            <div className="empty">选择左侧节点查看图谱</div>
          )}
        </div>
      </div>
    </div>
  );
}

function NodeDetail({
  node: o,
  maxTk,
  onOpenTask,
}: {
  node: NonNullable<ReturnType<typeof useStore.getState>['nodesData']>['nodes'][0];
  maxTk: number;
  onOpenTask: (id: string) => void;
}) {
  const hb = o.heartbeat || { status: 'idle', label: '⚪ 静默' };
  const totTk = o.tokens_in + o.tokens_out + o.cache_read + o.cache_write;
  const edicts = o.participated_edicts || [];

  const tkBars = [
    { l: '输入', v: o.tokens_in, color: '#6a9eff' },
    { l: '输出', v: o.tokens_out, color: '#a07aff' },
    { l: '缓存读', v: o.cache_read, color: '#2ecc8a' },
    { l: '缓存写', v: o.cache_write, color: '#f5c842' },
  ];

  return (
    <div>
      {/* Hero */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 40 }}>{o.emoji}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{displayName(o.role)}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {displayName(o.label)} · <span style={{ color: 'var(--acc)' }}>{o.model_short || o.model}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            🏅 {displayName(o.rank)} · 信号分 {o.merit_score}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`hb ${hb.status}`} style={{ marginBottom: 4 }}>{hb.label}</div>
          {o.last_active && <div style={{ fontSize: 10, color: 'var(--muted)' }}>最近信号 {o.last_active}</div>}
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
            {o.sessions} 条链路 · {o.messages} 条消息
          </div>
        </div>
      </div>

      {/* Merit Stats */}
      <div style={{ marginBottom: 18 }}>
        <div className="sec-title">节点指标</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ok)' }}>{o.tasks_done}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>完成任务</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--warn)' }}>{o.tasks_active}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>推进中</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--acc)' }}>{o.flow_participations}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>链路参与</div>
          </div>
        </div>
      </div>

      {/* Token Bars */}
      <div style={{ marginBottom: 18 }}>
        <div className="sec-title">Token 通量</div>
        {tkBars.map((b) => (
          <div key={b.l} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ color: 'var(--muted)' }}>{b.l}</span>
              <span>{b.v.toLocaleString()}</span>
            </div>
            <div style={{ height: 6, background: '#0e1320', borderRadius: 3 }}>
              <div style={{ height: '100%', width: `${maxTk > 0 ? Math.round((b.v / maxTk) * 100) : 0}%`, background: b.color, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Cost */}
      <div style={{ marginBottom: 18 }}>
        <div className="sec-title">累计耗能</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <span style={{ fontSize: 12, color: o.cost_cny > 10 ? 'var(--danger)' : o.cost_cny > 3 ? 'var(--warn)' : 'var(--ok)' }}>
            <b>¥{o.cost_cny}</b> 人民币
          </span>
          <span style={{ fontSize: 12 }}><b>${o.cost_usd}</b> 美元</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>总通量 {totTk.toLocaleString()} tokens</span>
        </div>
      </div>

      {/* Participated Edicts */}
      <div>
        <div className="sec-title">参与任务（{edicts.length} 条）</div>
        {edicts.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>暂无任务记录</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {edicts.map((e) => (
              <div
                key={e.id}
                style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--line)' }}
                onClick={() => onOpenTask(e.id)}
              >
                <span style={{ fontSize: 10, color: 'var(--acc)', fontWeight: 700 }}>{e.id}</span>
                <span style={{ flex: 1, fontSize: 12 }}>{displayText(e.title).substring(0, 35)}</span>
                <span className={`tag st-${e.state}`} style={{ fontSize: 10 }}>{STATE_LABEL[e.state] || e.state}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
