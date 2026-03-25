import { useState } from 'react';
import { useStore, isEdict, STATE_LABEL, displayName, displayText, formatLocalDateTime } from '../store';
import type { Task, FlowEntry } from '../api';

export default function ArchivePanel() {
  const liveStatus = useStore((s) => s.liveStatus);
  const [filter, setFilter] = useState('all');
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const toast = useStore((s) => s.toast);

  const tasks = liveStatus?.tasks || [];
  let archives = tasks.filter((t) => isEdict(t) && ['Done', 'Cancelled'].includes(t.state));
  if (filter !== 'all') archives = archives.filter((t) => t.state === filter);

  const exportArchive = (t: Task) => {
    const fl = t.flow_log || [];
    let md = `# 📦 任务黑匣 · ${displayText(t.title)}\n\n`;
    md += `- **任务编号**: ${t.id}\n`;
    md += `- **链路状态**: ${t.state}\n`;
    md += `- **负责节点**: ${displayName(t.org || '')}\n`;
    if (fl.length) {
      const startAt = formatLocalDateTime(fl[0].at) || '未知';
      const endAt = formatLocalDateTime(fl[fl.length - 1].at) || '未知';
      md += `- **开始时间**: ${startAt}\n`;
      md += `- **完成时间**: ${endAt}\n`;
    }
    md += `\n## 链路记录\n\n`;
    for (const f of fl) {
      md += `- **${displayName(f.from || '')}** → **${displayName(f.to || '')}**  \n  ${displayText(f.remark || '')}  \n  _${formatLocalDateTime(f.at) || String(f.at || '')}_\n\n`;
    }
    if (t.output && t.output !== '-') md += `## 落地产物\n\n\`${t.output}\`\n`;
    navigator.clipboard.writeText(md).then(
      () => toast('✅ 黑匣记录已复制为 Markdown', 'ok'),
      () => toast('复制失败', 'err')
    );
  };

  return (
    <div>
      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>视图筛选：</span>
        {[
          { key: 'all', label: '全部' },
          { key: 'Done', label: '✅ 全链完成' },
          { key: 'Cancelled', label: '🚫 已中止' },
        ].map((f) => (
          <span
            key={f.key}
            className={`sess-filter${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </span>
        ))}
      </div>

      {/* List */}
      <div className="archive-list">
        {!archives.length ? (
          <div className="archive-empty">暂无黑匣记录 — 任务闭环后自动写入</div>
        ) : (
          archives.map((t) => {
            const fl = t.flow_log || [];
            const depts = [...new Set(fl.map((f) => f.from).concat(fl.map((f) => f.to)).filter((x) => x && displayName(x) !== '主人'))];
            const firstAt = fl.length ? formatLocalDateTime(fl[0].at, { withSeconds: false }) : '';
            const lastAt = fl.length ? formatLocalDateTime(fl[fl.length - 1].at, { withSeconds: false }) : '';
            const stIcon = t.state === 'Done' ? '✅' : '🚫';
            return (
              <div className="archive-card" key={t.id} onClick={() => setDetailTask(t)}>
                <div className="archive-icon">📦</div>
                <div className="archive-info">
                  <div className="archive-title">
                    {stIcon} {displayText(t.title || t.id)}
                  </div>
                  <div className="archive-sub">
                    {t.id} · {displayName(t.org || '')} · 链路 {fl.length} 段
                  </div>
                  <div className="archive-tags">
                    {depts.slice(0, 5).map((d) => (
                      <span className="archive-tag" key={d}>{displayName(d)}</span>
                    ))}
                  </div>
                </div>
                <div className="archive-right">
                  <span className="archive-date">{firstAt}</span>
                  {lastAt !== firstAt && <span className="archive-date">{lastAt}</span>}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Detail Modal */}
      {detailTask && (
        <ArchiveDetailModal task={detailTask} onClose={() => setDetailTask(null)} onExport={exportArchive} />
      )}
    </div>
  );
}

function ArchiveDetailModal({
  task: t,
  onClose,
  onExport,
}: {
  task: Task;
  onClose: () => void;
  onExport: (t: Task) => void;
}) {
  const fl = t.flow_log || [];
  const st = t.state || 'Unknown';
  const stIcon = st === 'Done' ? '✅' : st === 'Cancelled' ? '🚫' : '🔄';
  const depts = [...new Set(fl.map((f) => f.from).concat(fl.map((f) => f.to)).filter((x) => x && displayName(x) !== '主人'))];

  // Reconstruct phases
  const originLog: FlowEntry[] = [];
  const planLog: FlowEntry[] = [];
  const reviewLog: FlowEntry[] = [];
  const execLog: FlowEntry[] = [];
  const resultLog: FlowEntry[] = [];
  for (const f of fl) {
    if (displayName(f.from || '') === '主人') originLog.push(f);
    else if (displayName(f.to || '') === '星枢' || displayName(f.from || '') === '星枢') planLog.push(f);
    else if (displayName(f.to || '') === '棱镜' || displayName(f.from || '') === '棱镜') reviewLog.push(f);
    else if (f.remark && (f.remark.includes('完成') || f.remark.includes('回传'))) resultLog.push(f);
    else execLog.push(f);
  }

  const renderPhase = (title: string, icon: string, items: FlowEntry[]) => {
    if (!items.length) return null;
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
          {icon} {title}
        </div>
        <div className="md-timeline">
          {items.map((f, i) => {
            const dotCls = f.remark?.includes('✅') ? 'green' : f.remark?.includes('驳') ? 'red' : '';
            return (
              <div className="md-tl-item" key={i}>
                <div className={`md-tl-dot ${dotCls}`} />
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span className="md-tl-from">{displayName(f.from || '')}</span>
                  <span className="md-tl-to">→ {displayName(f.to || '')}</span>
                </div>
                <div className="md-tl-remark">{displayText(f.remark || '')}</div>
                <div className="md-tl-time">{formatLocalDateTime(f.at) || String(f.at || '')}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="modal-bg open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: 'var(--acc)', fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>{t.id}</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>{stIcon} {displayText(t.title || t.id)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
            <span className={`tag st-${st}`}>{STATE_LABEL[st] || st}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{displayName(t.org || '')}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>链路 {fl.length} 段</span>
            {depts.map((d) => (
              <span className="archive-tag" key={d}>{displayName(d)}</span>
            ))}
          </div>

          {t.now && (
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8, padding: '10px 14px', marginBottom: 18, fontSize: 12, color: 'var(--muted)' }}>
              {displayText(t.now)}
            </div>
          )}

          {renderPhase('源指令注入', '👤', originLog)}
          {renderPhase('航线建模', '📋', planLog)}
          {renderPhase('棱镜校验', '🔍', reviewLog)}
          {renderPhase('执行链路', '⚔️', execLog)}
          {renderPhase('信号回传', '📨', resultLog)}

          {t.output && t.output !== '-' && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>📦 落地产物</div>
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{t.output}</code>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button className="btn btn-g" onClick={() => onExport(t)} style={{ fontSize: 12, padding: '6px 16px' }}>
              📋 复制黑匣记录
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
