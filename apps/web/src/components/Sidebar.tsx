import { Smartphone, Brain, Gauge, BookOpen, X } from 'lucide-react';
import { useState } from 'react';
import { Clue, CoordinationState } from '../types';

interface SidebarProps {
  clues: Clue[];
  coordination?: CoordinationState;
  recap?: string;
  sidebar?: {
    phone: { battery: number; recording: boolean; muted: boolean; newMessages: string[] };
    threat: { level: number; trend: string; label: string };
    timeLabel: string;
    phaseLabel: string;
    moodSignal: string;
    roomStatus: Array<{ item: string; state: string; icon: string }>;
  };
}

function slotLabel(slot: 'action' | 'ambient') {
  return slot === 'action' ? '行动回应' : '环境播报';
}

function scoreColor(total: number) {
  if (total < 78) return 'text-rose-300';
  if (total < 88) return 'text-amber-300';
  return 'text-emerald-300';
}

// 故事背景
const STORY_BG = `你叫沈知夏，今天刚搬进青荷公寓503室。行李箱还堆在门边，桌上有一个被拆开了一半的纸箱——不是你买的。旧书、药板、一张写着"503"的数字纸条。你不认识寄件人，也不知道这个包裹为什么会在这里。在第一轮中，你于23:47被杀。死亡后你带着模糊的记忆碎片回到了23:00。你不知道是谁杀了你，也不知道为什么——只知道你必须活下来，找到答案。`;

export function Sidebar({ clues, coordination, recap, sidebar }: SidebarProps) {
  const directorScores = coordination?.directorScores ?? [];
  const [showMemories, setShowMemories] = useState(false);

  return (
    <aside className="w-full lg:w-80 border-l border-white/5 bg-[#0a0a0c] lg:h-[calc(100vh-65px)] overflow-y-auto flex flex-col">
      <div className="p-6 flex-1">
        {/* 回忆按钮 */}
        <button
          onClick={() => setShowMemories(!showMemories)}
          className="w-full flex items-center gap-2 mb-6 px-3 py-2 rounded-lg border border-white/5 bg-zinc-900/40 hover:bg-zinc-900/60 transition-colors text-left"
        >
          <BookOpen className="w-4 h-4 text-zinc-500" />
          <span className="font-mono text-xs tracking-widest text-zinc-400 uppercase">前情 & 回忆</span>
          <span className="ml-auto text-zinc-600 text-xs">{showMemories ? '收起' : '展开'}</span>
        </button>

        {/* 回忆面板 */}
        {showMemories && (
          <div className="mb-6 p-4 bg-zinc-900/40 border border-white/5 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono text-zinc-500 uppercase">故事背景</h3>
              <button onClick={() => setShowMemories(false)} className="text-zinc-600 hover:text-zinc-400"><X className="w-3 h-3" /></button>
            </div>
            <p className="text-xs text-zinc-400 font-sans leading-relaxed">{STORY_BG}</p>
            {recap && recap !== STORY_BG && (
              <>
                <div className="border-t border-white/5" />
                <h3 className="text-xs font-mono text-zinc-500 uppercase">前情提要</h3>
                {recap.split('\n').map((line, i) => (
                  <p key={i} className="text-xs text-zinc-400 font-sans leading-relaxed">{line}</p>
                ))}
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 mb-6">
          <Brain className="w-4 h-4 text-zinc-500" />
          <h2 className="font-mono text-sm tracking-widest text-zinc-400 uppercase">已知情报</h2>
        </div>

        <div className="space-y-6">
          {/* Status block — 动态数据 */}
          <div className="space-y-3">
            <h3 className="text-xs font-mono text-zinc-600 uppercase border-b border-white/5 pb-2">自身状态</h3>
            <ul className="text-sm font-sans space-y-2 text-zinc-400">
              <li className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${(sidebar?.threat?.level ?? 0) >= 60 ? 'bg-rose-500' : (sidebar?.threat?.level ?? 0) >= 40 ? 'bg-amber-500' : 'bg-zinc-500'}`} />
                {sidebar?.threat?.label ?? '相对平静'}
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                {sidebar?.phaseLabel ?? '循环开始'}
              </li>
              {sidebar?.moodSignal && (
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  <span className="text-xs text-zinc-500 italic">{sidebar.moodSignal}</span>
                </li>
              )}
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

              <div className="bg-zinc-900/30 border border-white/5 border-dashed rounded-lg p-3">
                <div className="flex items-center gap-2 text-zinc-400 font-sans text-sm mb-1">
                  <Smartphone className="w-3.5 h-3.5" />
                  手机
                  {sidebar?.phone.recording && <span className="text-[10px] font-mono bg-rose-500/20 text-rose-400 px-1 py-0.5 rounded">REC</span>}
                </div>
                <p className="text-xs text-zinc-500 font-sans">
                  电量 {(sidebar?.phone.battery ?? 60)}%
                  {sidebar?.phone.recording ? ' · 录音中' : ''}
                  {sidebar?.phone.muted ? ' · 已静音' : ''}
                  {(sidebar?.phone.newMessages?.length ?? 0) > 0 ? ` · ${sidebar!.phone.newMessages.length}条新消息` : ''}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-white/5 bg-black/20 text-center">
        <div className="font-mono text-[10px] text-zinc-700 tracking-widest break-all">
          ID: S-503 // ENV: HOSTILE // V_0.3.1
        </div>
      </div>
    </aside>
  );
}
