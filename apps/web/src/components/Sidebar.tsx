import { Smartphone, Brain, Gauge } from 'lucide-react';
import { Clue, CoordinationState } from '../types';

interface SidebarProps {
  clues: Clue[];
  coordination?: CoordinationState;
}

function slotLabel(slot: 'action' | 'ambient') {
  return slot === 'action' ? '行动回应' : '环境播报';
}

function scoreColor(total: number) {
  if (total < 78) return 'text-rose-300';
  if (total < 88) return 'text-amber-300';
  return 'text-emerald-300';
}

export function Sidebar({ clues, coordination }: SidebarProps) {
  const directorScores = coordination?.directorScores ?? [];

  return (
    <aside className="w-full lg:w-80 border-l border-white/5 bg-[#0a0a0c] lg:h-[calc(100vh-65px)] overflow-y-auto flex flex-col">
      <div className="p-6 flex-1">
        <div className="flex items-center gap-2 mb-6">
          <Brain className="w-4 h-4 text-zinc-500" />
          <h2 className="font-mono text-sm tracking-widest text-zinc-400 uppercase">已知情报</h2>
        </div>

        <div className="space-y-6">
          {/* Status block */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono text-zinc-600 uppercase border-b border-white/5 pb-2">自身状态</h3>
            <ul className="text-sm font-sans space-y-2 text-zinc-400">
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                后脑钝痛，可能有轻微脑震荡
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                刚搬家，体力较差
              </li>
            </ul>
          </div>

          {directorScores.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b border-white/5 pb-2">
                <Gauge className="w-3.5 h-3.5 text-zinc-600" />
                <h3 className="text-xs font-mono text-zinc-600 uppercase">剧情导演</h3>
              </div>
              <div className="grid gap-3">
                {directorScores.slice(-3).map((score, index) => (
                  <div key={`${score.slot}-${score.source}-${index}`} className="bg-zinc-900/40 border border-white/5 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-mono text-zinc-400">{slotLabel(score.slot)}</span>
                      <span className={`text-sm font-mono ${scoreColor(score.total)}`}>{score.total}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] font-mono text-zinc-500">
                      <span>节奏 {score.pace}</span>
                      <span>泄露 {score.infoSafety}</span>
                      <span>规则 {score.ruleConsistency}</span>
                      <span>文笔 {score.prose}</span>
                    </div>
                    {score.issues.length > 0 && (
                      <p className="mt-2 text-xs text-zinc-500 leading-relaxed">{score.issues[0]}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clues block */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono text-zinc-600 uppercase border-b border-white/5 pb-2">线索 & 物品</h3>
            <div className="grid gap-3">
              {clues.map(clue => (
                <div key={clue.id} className="bg-zinc-900/50 border border-white/5 rounded-lg p-3">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-sans text-sm text-zinc-200">{clue.name}</span>
                    {clue.status === 'new' && (
                      <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded">NEW</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 font-sans leading-relaxed">{clue.description}</p>
                </div>
              ))}
              
              <div className="bg-zinc-900/30 border border-white/5 border-dashed rounded-lg p-3 opacity-60">
                <div className="flex items-center gap-2 text-zinc-400 font-sans text-sm mb-1">
                  <Smartphone className="w-3.5 h-3.5" /> 手机
                </div>
                <p className="text-xs text-zinc-600 font-sans">电量 42%，无未读消息。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Decorative footer */}
      <div className="p-4 border-t border-white/5 bg-black/20 text-center">
        <div className="font-mono text-[10px] text-zinc-700 tracking-widest break-all">
          ID: S-503 // ENV: HOSTILE // V_0.3.1
        </div>
      </div>
    </aside>
  );
}
