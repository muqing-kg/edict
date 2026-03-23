import { useEffect, useState } from 'react';
import { useStore, isEdict } from '../store';

export default function BootSequence() {
  const liveStatus = useStore((s) => s.liveStatus);
  const [show, setShow] = useState(false);
  const [out, setOut] = useState(false);

  useEffect(() => {
    const lastOpen = localStorage.getItem('edict_boot_sequence_date');
    const today = new Date().toISOString().substring(0, 10);
    const pref = JSON.parse(localStorage.getItem('edict_boot_sequence_pref') || '{"enabled":true}');
    if (!pref.enabled || lastOpen === today) return;
    localStorage.setItem('edict_boot_sequence_date', today);
    setShow(true);
    const timer = setTimeout(() => skip(), 3500);
    return () => clearTimeout(timer);
  }, []);

  const skip = () => {
    setOut(true);
    setTimeout(() => setShow(false), 500);
  };

  if (!show) return null;

  const tasks = liveStatus?.tasks || [];
  const jjc = tasks.filter(isEdict);
  const pending = jjc.filter((t) => !['Done', 'Cancelled'].includes(t.state)).length;
  const done = jjc.filter((t) => t.state === 'Done').length;
  const overdue = jjc.filter(
    (t) => t.state !== 'Done' && t.state !== 'Cancelled' && t.eta && new Date(t.eta.replace(' ', 'T')) < new Date()
  ).length;

  const d = new Date();
  const days = ['日', '一', '二', '三', '四', '五', '六'];
  const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${days[d.getDay()]}曜日`;

  return (
    <div className={`boot-sequence-bg${out ? ' out' : ''}`} onClick={skip}>
      <div className="crm-glow" />
      <div className="crm-line1 in">🛰 舰桥主控已接入</div>
      <div className="crm-line2 in">任务航迹就绪，链路进入静默轨道</div>
      <div className="crm-line3 in">
        待推进 {pending} 条 · 已封存 {done} 条{overdue > 0 && ` · ⚠ 滞留 ${overdue} 条`}
      </div>
      <div className="crm-date in">{dateStr}</div>
      <div className="crm-skip">点击任意处跳过引导</div>
    </div>
  );
}
