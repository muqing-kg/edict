/**
 * 舰桥议程 — 多节点实时讨论可视化组件
 *
 * 灵感来自 nvwa 项目的故事剧场 + 协作工坊 + 虚拟生活
 * 功能：
 *   - 可视化舰桥布局，节点站位
 *   - 实时群聊讨论，节点各抒己见
 *   - 用户随时发言参与
 *   - 系统事件（上帝视角）改变讨论走向
 *   - 命运骰子：随机事件增加趣味性
 *   - 自动推进 / 手动推进
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore, DEPTS, displayName, displayText } from '../store';
import { api } from '../api';

// ── 常量 ──

const NODE_COLORS: Record<string, string> = {
  main: '#e8a040', xingshu: '#a07aff', lengjing: '#6a9eff', zhongji: '#2ecc8a',
  wenshu: '#f5c842', yuanliu: '#ff9a6a', weikong: '#ff5270', tanzhen: '#cc4444',
  jiwu: '#44aaff', xulie: '#9b59b6',
};

const EMOTION_EMOJI: Record<string, string> = {
  neutral: '', confident: '😏', worried: '😟', angry: '😤',
  thinking: '🤔', amused: '😄', happy: '😊',
};

const BRIDGE_POSITIONS: Record<string, { x: number; y: number }> = {
  // 左列
  xingshu: { x: 15, y: 25 }, lengjing: { x: 15, y: 45 }, zhongji: { x: 15, y: 65 },
  // 右列
  wenshu: { x: 85, y: 20 }, yuanliu: { x: 85, y: 35 }, weikong: { x: 85, y: 50 },
  tanzhen: { x: 85, y: 65 }, jiwu: { x: 85, y: 80 },
  // 中间
  main: { x: 50, y: 20 }, xulie: { x: 50, y: 80 },
};

interface BridgeMessage {
  type: string;
  content: string;
  node_id?: string;
  node_name?: string;
  emotion?: string;
  action?: string;
  timestamp?: number;
}

interface BridgeSession {
  session_id: string;
  topic: string;
  nodes: Array<{
    id: string;
    name: string;
    emoji: string;
    role: string;
    personality: string;
    speaking_style: string;
  }>;
  messages: BridgeMessage[];
  round: number;
  phase: string;
}

export default function BridgeDiscussion() {
  // Phase: setup | session
  const [phase, setPhase] = useState<'setup' | 'session'>('setup');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [topic, setTopic] = useState('');
  const [session, setSession] = useState<BridgeSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef(false);

  // 主人发言
  const [userInput, setUserInput] = useState('');
  // 系统事件
  const [showSystemEvent, setShowSystemEvent] = useState(false);
  const [systemEventInput, setSystemEventInput] = useState('');
  const [systemEventFlash, setSystemEventFlash] = useState(false);
  // 命运骰子
  const [diceRolling, setDiceRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<string | null>(null);
  // 活跃说话节点
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // 节点情绪
  const [emotions, setEmotions] = useState<Record<string, string>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const toast = useStore((s) => s.toast);
  const liveStatus = useStore((s) => s.liveStatus);

  // 自动滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session?.messages?.length]);

  // 自动推进
  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  useEffect(() => {
    if (!autoPlay || !session || loading) return;
    const timer = setInterval(() => {
      if (autoPlayRef.current && !loading) {
        handleAdvance();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [autoPlay, session, loading]);

  // ── 切换节点选中 ──
  const toggleNode = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 8) next.add(id);
      return next;
    });
  };

  // ── 开始会商 ──
  const handleStart = async () => {
    if (!topic.trim() || selectedIds.size < 2 || loading) return;
    setLoading(true);
    try {
      const res = await api.bridgeDiscussStart(topic, Array.from(selectedIds));
      if (!res.ok) throw new Error(res.error || '启动推演失败');
      setSession(res as unknown as BridgeSession);
      setPhase('session');
    } catch (e: unknown) {
      toast((e as Error).message || '启动推演失败', 'err');
    } finally {
      setLoading(false);
    }
  };

  // ── 推进讨论 ──
  const handleAdvance = useCallback(async (userMsg?: string, systemEvent?: string) => {
    if (!session || loading) return;
    setLoading(true);

    try {
      const res = await api.bridgeDiscussAdvance(session.session_id, userMsg, systemEvent);
      if (!res.ok) throw new Error(res.error || '推进失败');

      // 更新 session messages（追加新消息）
      setSession((prev) => {
        if (!prev) return prev;
        const newMsgs: BridgeMessage[] = [];

        if (userMsg) {
          newMsgs.push({ type: 'owner', content: userMsg, timestamp: Date.now() / 1000 });
        }
        if (systemEvent) {
          newMsgs.push({ type: 'system_event', content: systemEvent, timestamp: Date.now() / 1000 });
        }

        const aiMsgs = (res.new_messages || []).map((m: Record<string, string>) => ({
          type: 'node',
          node_id: m.node_id,
          node_name: m.name,
          content: m.content,
          emotion: m.emotion,
          action: m.action,
          timestamp: Date.now() / 1000,
        }));

        if (res.scene_note) {
          newMsgs.push({ type: 'scene_note', content: res.scene_note, timestamp: Date.now() / 1000 });
        }

        return {
          ...prev,
          round: res.round ?? prev.round + 1,
          messages: [...prev.messages, ...newMsgs, ...aiMsgs],
        };
      });

      // 动画：依次高亮说话的节点
      const aiMsgs = res.new_messages || [];
      if (aiMsgs.length > 0) {
        const emotionMap: Record<string, string> = {};
        let idx = 0;
        const cycle = () => {
          if (idx < aiMsgs.length) {
            setSpeakingId(aiMsgs[idx].node_id);
            emotionMap[aiMsgs[idx].node_id] = aiMsgs[idx].emotion || 'neutral';
            idx++;
            setTimeout(cycle, 1200);
          } else {
            setSpeakingId(null);
          }
        };
        cycle();
        setEmotions((prev) => ({ ...prev, ...emotionMap }));
      }
    } catch {
      // silently
    } finally {
      setLoading(false);
    }
  }, [session, loading]);

  // ── 主人发言 ──
  const handleOwner = () => {
    const msg = userInput.trim();
    if (!msg) return;
    setUserInput('');
    handleAdvance(msg);
  };

  // ── 系统事件 ──
  const handleSystemEvent = () => {
    const msg = systemEventInput.trim();
    if (!msg) return;
    setSystemEventInput('');
    setShowSystemEvent(false);
    setSystemEventFlash(true);
    setTimeout(() => setSystemEventFlash(false), 800);
    handleAdvance(undefined, msg);
  };

  // ── 命运骰子 ──
  const handleDice = async () => {
    if (loading || diceRolling) return;
    setDiceRolling(true);
    setDiceResult(null);

    // 滚动动画
    let count = 0;
    const timer = setInterval(async () => {
      count++;
      setDiceResult('🎲 随机变量演算中...');
      if (count >= 6) {
        clearInterval(timer);
        try {
          const res = await api.bridgeDiscussFate();
          const event = res.event || '未知扰动自深空逼近';
          setDiceResult(event);
          setDiceRolling(false);
          handleAdvance(undefined, `【随机变量】${event}`);
        } catch {
          setDiceResult('随机变量未响应');
          setDiceRolling(false);
        }
      }
    }, 200);
  };

  // ── 结束会商 ──
  const handleConclude = async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await api.bridgeDiscussConclude(session.session_id);
      if (res.summary) {
        setSession((prev) =>
          prev
            ? {
              ...prev,
              phase: 'concluded',
              messages: [
                ...prev.messages,
                { type: 'system', content: `📋 推演结束 — ${res.summary}`, timestamp: Date.now() / 1000 },
              ],
            }
            : prev,
        );
      }
      setAutoPlay(false);
    } catch {
      toast('结束推演失败', 'err');
    } finally {
      setLoading(false);
    }
  };

  // ── 重置 ──
  const handleReset = () => {
    if (session) {
      api.bridgeDiscussDestroy(session.session_id).catch(() => {});
    }
    setPhase('setup');
    setSession(null);
    setAutoPlay(false);
    setEmotions({});
    setSpeakingId(null);
    setDiceResult(null);
  };

  // ── 预设议题（从当前指令中提取）──
  const activeEdicts = (liveStatus?.tasks || []).filter(
    (t) => /^JJC-/i.test(t.id) && !['Done', 'Cancelled'].includes(t.state),
  );

  const presetTopics = [
    ...activeEdicts.slice(0, 3).map((t) => ({
      text: `推演任务 ${t.id}：${displayText(t.title)}`,
      taskId: t.id,
      icon: '📜',
    })),
    { text: '推演系统架构升级方案', taskId: '', icon: '🏗️' },
    { text: '评估当前项目态势与风险', taskId: '', icon: '📊' },
    { text: '制定下周航线计划', taskId: '', icon: '📋' },
    { text: '紧急信号：线上 Bug 围堵方案', taskId: '', icon: '🚨' },
  ];

  // ═══════════════════
  //     渲染：设置页
  // ═══════════════════

  if (phase === 'setup') {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center py-4">
          <h2 className="text-xl font-bold bg-gradient-to-r from-amber-400 to-purple-400 bg-clip-text text-transparent">
            🛰 战术沙盘
          </h2>
          <p className="text-xs text-[var(--muted)] mt-1">
            接入推演节点，围绕主题展开沙盘推演 · 主人可随时插入指令或注入系统扰动
          </p>
        </div>

        {/* 选择节点 */}
        <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--line)]">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold">🧭 接入推演节点</span>
            <span className="text-xs text-[var(--muted)]">（{selectedIds.size}/8，至少2个）</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {DEPTS.map((d) => {
              const active = selectedIds.has(d.id);
              const color = NODE_COLORS[d.id] || '#6a9eff';
              return (
                <button
                  key={d.id}
                  onClick={() => toggleNode(d.id)}
                  className="p-2.5 rounded-lg border transition-all text-left"
                  style={{
                    borderColor: active ? color + '80' : 'var(--line)',
                    background: active ? color + '15' : 'var(--panel2)',
                    boxShadow: active ? `0 0 12px ${color}20` : 'none',
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-lg">{d.emoji}</span>
                    <div>
                      <div className="text-xs font-semibold" style={{ color: active ? color : 'var(--text)' }}>
                        {displayName(d.label)}
                      </div>
                      <div className="text-[10px] text-[var(--muted)]">{displayName(d.role)}</div>
                    </div>
                    {active && (
                      <span
                        className="ml-auto w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white"
                        style={{ background: color }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 议题 */}
        <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--line)]">
          <div className="text-sm font-semibold mb-2">📡 设定推演主题</div>
          {presetTopics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {presetTopics.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setTopic(p.text)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-[var(--line)] hover:border-[var(--acc)] hover:text-[var(--acc)] transition-colors"
                  style={{
                    background: topic === p.text ? 'var(--acc)' + '18' : 'transparent',
                    borderColor: topic === p.text ? 'var(--acc)' : undefined,
                    color: topic === p.text ? 'var(--acc)' : undefined,
                  }}
                >
                  {p.icon} {p.text}
                </button>
              ))}
            </div>
          )}
          <textarea
            className="w-full bg-[var(--panel2)] rounded-lg p-3 text-sm border border-[var(--line)] focus:border-[var(--acc)] outline-none resize-none"
            rows={2}
            placeholder="或自定义推演主题..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>

        {/* 功能特性标签 */}
        <div className="flex flex-wrap gap-1.5">
          {[
            '👤 主人接入', '⚡ 系统扰动', '🎲 随机变量',
            '🔄 自动推演', '📜 推演记录',
          ].map((tag) => (
            <span key={tag} className="text-[10px] px-2 py-1 rounded-full border border-[var(--line)] text-[var(--muted)]">
              {tag}
            </span>
          ))}
        </div>

        {/* 开始按钮 */}
        <button
          onClick={handleStart}
          disabled={selectedIds.size < 2 || !topic.trim() || loading}
          className="w-full py-3 rounded-xl font-semibold text-sm transition-all border-0"
          style={{
            background:
              selectedIds.size >= 2 && topic.trim()
                ? 'linear-gradient(135deg, #6a9eff, #a07aff)'
                : 'var(--panel2)',
            color: selectedIds.size >= 2 && topic.trim() ? '#fff' : 'var(--muted)',
            opacity: loading ? 0.6 : 1,
            cursor: selectedIds.size >= 2 && topic.trim() && !loading ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? '节点握手中...' : `🛰 启动推演（${selectedIds.size}个节点）`}
        </button>
      </div>
    );
  }

  // ═══════════════════
  //   渲染：会商进行中
  // ═══════════════════

  const nodes = session?.nodes || [];
  const messages = session?.messages || [];

  return (
    <div className="space-y-3">
      {/* 顶部控制栏 */}
      <div className="flex items-center justify-between flex-wrap gap-2 bg-[var(--panel)] rounded-xl px-4 py-2 border border-[var(--line)]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">🛰 战术沙盘</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--acc)]20 text-[var(--acc)] border border-[var(--acc)]30">
            第{session?.round || 0}轮推演
          </span>
          {session?.phase === 'concluded' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800">
              已结束
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSystemEvent(!showSystemEvent)}
            className="text-xs px-2.5 py-1 rounded-lg border border-amber-600/40 text-amber-400 hover:bg-amber-900/20 transition"
            title="注入系统扰动 — 全局视角干预"
          >
            ⚡ 扰动
          </button>
          <button
            onClick={handleDice}
            disabled={diceRolling || loading}
            className="text-xs px-2.5 py-1 rounded-lg border border-purple-600/40 text-purple-400 hover:bg-purple-900/20 transition"
            title="随机变量 — 扰动注入"
          >
            🎲 {diceRolling ? '...' : '变量'}
          </button>
          <button
            onClick={() => setAutoPlay(!autoPlay)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition ${autoPlay
              ? 'border-green-600/40 text-green-400 bg-green-900/20'
              : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
              }`}
          >
            {autoPlay ? '⏸ 暂停' : '▶ 自动'}
          </button>
          {session?.phase !== 'concluded' && (
            <button
              onClick={handleConclude}
              className="text-xs px-2.5 py-1 rounded-lg border border-[var(--line)] text-[var(--muted)] hover:text-[var(--warn)] hover:border-[var(--warn)]40 transition"
            >
              📋 结束推演
            </button>
          )}
          <button
            onClick={handleReset}
            className="text-xs px-2 py-1 rounded-lg border border-red-900/40 text-red-400/70 hover:text-red-400 transition"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 系统事件面板 */}
      {showSystemEvent && (
        <div
          className="bg-gradient-to-br from-amber-950/40 to-purple-950/30 rounded-xl p-4 border border-amber-700/30"
          style={{ animation: 'fadeIn .3s' }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold text-amber-400">⚡ 系统扰动 — 全局视角</span>
            <button onClick={() => setShowSystemEvent(false)} className="text-xs text-[var(--muted)]">
              ✕
            </button>
          </div>
          <p className="text-[10px] text-amber-300/60 mb-2">
            注入系统扰动改变推演走向，所有节点将据此重新演算
          </p>
          <div className="flex gap-2">
            <input
              value={systemEventInput}
              onChange={(e) => setSystemEventInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSystemEvent()}
              placeholder="例如：预算陡增、窗口缩短、上游接口失联..."
              className="flex-1 bg-black/30 rounded-lg px-3 py-1.5 text-sm border border-amber-800/40 outline-none focus:border-amber-600"
            />
            <button
              onClick={handleSystemEvent}
              disabled={!systemEventInput.trim()}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-purple-600 text-white text-xs font-semibold disabled:opacity-40"
            >
              注入扰动
            </button>
          </div>
        </div>
      )}

      {/* 命运骰子结果 */}
      {diceResult && (
        <div
          className="bg-purple-950/40 rounded-lg px-3 py-2 border border-purple-700/30 text-xs text-purple-300 flex items-center gap-2"
          style={{ animation: 'fadeIn .3s' }}
        >
          <span className="text-lg">🎲</span>
          {diceResult}
        </div>
      )}

      {/* 系统事件闪光效果 */}
      {systemEventFlash && (
        <div
          className="fixed inset-0 pointer-events-none z-50"
          style={{
            background: 'radial-gradient(circle, rgba(255,200,50,0.3), transparent 70%)',
            animation: 'fadeOut .8s forwards',
          }}
        />
      )}

      {/* 议题 */}
      <div className="text-xs text-center text-[var(--muted)] py-1">
        📡 {displayText(session?.topic || '')}
      </div>

      {/* 主内容：舰桥布局 + 聊天记录 */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3">
        {/* 左侧：舰桥可视化 */}
        <div className="bg-[var(--panel)] rounded-xl p-3 border border-[var(--line)] relative overflow-hidden min-h-[320px]">
          {/* 战术核心 */}
          <div className="text-center mb-2">
            <div className="inline-block px-3 py-1 rounded-lg bg-gradient-to-b from-amber-800/40 to-amber-950/40 border border-amber-700/30">
              <span className="text-lg">👑</span>
              <div className="text-[10px] text-amber-400/80">战术核心</div>
            </div>
          </div>

          {/* 节点站位 */}
          <div className="relative" style={{ minHeight: 250 }}>
            {/* 左列标签 */}
            <div className="absolute left-0 top-0 text-[9px] text-[var(--muted)] opacity-50">核心层</div>
            <div className="absolute right-0 top-0 text-[9px] text-[var(--muted)] opacity-50">执行链路</div>

            {nodes.map((o) => {
              const pos = BRIDGE_POSITIONS[o.id] || { x: 50, y: 50 };
              const color = NODE_COLORS[o.id] || '#6a9eff';
              const isSpeaking = speakingId === o.id;
              const emotion = emotions[o.id] || 'neutral';

              return (
                <div
                  key={o.id}
                  className="absolute transition-all duration-500"
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                >
                  {/* 说话光圈 */}
                  {isSpeaking && (
                    <div
                      className="absolute -inset-2 rounded-full"
                      style={{
                        background: `radial-gradient(circle, ${color}40, transparent)`,
                        animation: 'pulse 1s infinite',
                      }}
                    />
                  )}
                  {/* 头像 */}
                  <div
                    className="relative w-10 h-10 rounded-full flex items-center justify-center text-lg border-2 transition-all"
                    style={{
                      borderColor: isSpeaking ? color : color + '40',
                      background: isSpeaking ? color + '30' : color + '10',
                      transform: isSpeaking ? 'scale(1.2)' : 'scale(1)',
                      boxShadow: isSpeaking ? `0 0 16px ${color}50` : 'none',
                    }}
                  >
                    {o.emoji}
                    {/* 情绪气泡 */}
                    {EMOTION_EMOJI[emotion] && (
                      <span
                        className="absolute -top-1 -right-1 text-xs"
                        style={{ animation: 'bounceIn .3s' }}
                      >
                        {EMOTION_EMOJI[emotion]}
                      </span>
                    )}
                  </div>
                  {/* 名字 */}
                  <div
                    className="text-[9px] text-center mt-0.5 whitespace-nowrap"
                    style={{ color: isSpeaking ? color : 'var(--muted)' }}
                  >
                    {displayName(o.name)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧：聊天记录 */}
        <div className="bg-[var(--panel)] rounded-xl border border-[var(--line)] flex flex-col" style={{ maxHeight: 500 }}>
          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ minHeight: 200 }}>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} nodes={nodes} />
            ))}
            {loading && (
              <div className="text-xs text-[var(--muted)] text-center py-2" style={{ animation: 'pulse 1.5s infinite' }}>
                🛰 节点正在演算...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 主人输入栏 */}
          {session?.phase !== 'concluded' && (
            <div className="border-t border-[var(--line)] p-2 flex gap-2">
              <input
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleOwner()}
                placeholder="向推演链路插入指令..."
                className="flex-1 bg-[var(--panel2)] rounded-lg px-3 py-1.5 text-sm border border-[var(--line)] outline-none focus:border-amber-600"
              />
              <button
                onClick={handleOwner}
                disabled={!userInput.trim() || loading}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold border-0 disabled:opacity-40"
                style={{
                  background: userInput.trim() ? 'linear-gradient(135deg, #e8a040, #f5c842)' : 'var(--panel2)',
                  color: userInput.trim() ? '#000' : 'var(--muted)',
                }}
              >
                👤 注入
              </button>
              <button
                onClick={() => handleAdvance()}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg text-xs border border-[var(--acc)]40 text-[var(--acc)] hover:bg-[var(--acc)]10 disabled:opacity-40 transition"
              >
                ▶ 推进一轮
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 消息气泡 ──

function MessageBubble({
  msg,
  nodes,
}: {
  msg: BridgeMessage;
  nodes: Array<{ id: string; name: string; emoji: string }>;
}) {
  const color = NODE_COLORS[msg.node_id || ''] || '#6a9eff';
  const node = nodes.find((o) => o.id === msg.node_id);

  if (msg.type === 'system') {
    return (
      <div className="text-center text-[10px] text-[var(--muted)] py-1 border-b border-[var(--line)] border-dashed">
        {displayText(msg.content)}
      </div>
    );
  }

  if (msg.type === 'scene_note') {
    return (
      <div className="text-center text-[10px] text-purple-400/80 py-1 italic">
        ✦ {displayText(msg.content)} ✦
      </div>
    );
  }

  if (msg.type === 'owner') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-gradient-to-br from-amber-900/40 to-amber-800/20 rounded-xl px-3 py-2 border border-amber-700/30">
          <div className="text-[10px] text-amber-400 mb-0.5">👤 主人接入</div>
          <div className="text-sm">{displayText(msg.content)}</div>
        </div>
      </div>
    );
  }

  if (msg.type === 'system_event') {
    return (
      <div className="text-center py-2">
        <div className="inline-block bg-gradient-to-r from-amber-900/30 via-purple-900/30 to-amber-900/30 rounded-lg px-4 py-2 border border-amber-600/30">
          <div className="text-xs text-amber-400 font-bold">⚡ 系统扰动</div>
          <div className="text-sm mt-0.5">{displayText(msg.content)}</div>
        </div>
      </div>
    );
  }

  // 节点消息
  return (
    <div className="flex gap-2 items-start" style={{ animation: 'fadeIn .4s' }}>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 border"
        style={{ borderColor: color + '60', background: color + '15' }}
      >
        {node?.emoji || '💬'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[11px] font-semibold" style={{ color }}>
            {displayName(msg.node_name || '节点')}
          </span>
          {msg.emotion && EMOTION_EMOJI[msg.emotion] && (
            <span className="text-xs">{EMOTION_EMOJI[msg.emotion]}</span>
          )}
        </div>
        <div className="text-sm leading-relaxed">
          {displayText(msg.content || '').split(/(\*[^*]+\*)/).map((part, i) => {
            if (part.startsWith('*') && part.endsWith('*')) {
              return (
                <span key={i} className="text-[var(--muted)] italic text-xs">
                  {part.slice(1, -1)}
                </span>
              );
            }
            return <span key={i}>{part}</span>;
          })}
        </div>
      </div>
    </div>
  );
}
