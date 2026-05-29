/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Header } from './components/Header';
import { StoryPanel } from './components/StoryPanel';
import { InputArea } from './components/InputArea';
import { Sidebar } from './components/Sidebar';
import { CinematicIntro } from './components/CinematicIntro';
import { CinematicTransition } from './components/CinematicTransition';
import { INITIAL_STATE } from './constants';
import { GameState } from './types';
import { Menu, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface FrontendResolveResponse extends Partial<GameState> {
  coreState?: unknown;
  storyLog?: GameState['storyLog'];
}

interface EndingCinematicPayload {
  key: string;
  kind: 'death' | 'survived';
  title: string;
  summary: string;
  method?: string | null;
}

export default function App() {
  const [showCinematic, setShowCinematic] = useState(true);
  const [endingCinematic, setEndingCinematic] = useState<EndingCinematicPayload | null>(null);
  const [state, setState] = useState<GameState>(INITIAL_STATE);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleActionSubmit = async (actionText: string) => {
    const newLogId = Date.now().toString();
    const coreState = state.coreState;

    setState(prev => ({
      ...prev,
      isParsing: true,
      storyLog: [
        ...prev.storyLog,
        { id: `input-${newLogId}`, type: 'player_input', content: actionText }
      ]
    }));

    try {
      const response = await fetch('/api/frontend/resolve-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionText, coreState }),
      });
      if (!response.ok) throw new Error(`resolve-action failed: ${response.status}`);
      const result = (await response.json()) as FrontendResolveResponse;
      const resultLog = result.storyLog?.filter(node => node.type !== 'player_input') ?? [];

      setState(prev => ({
        ...prev,
        isParsing: false,
        actionConfirmation: null,
        time: result.time ?? prev.time,
        location: result.location ?? prev.location,
        phase: result.phase ?? prev.phase,
        clues: result.clues ?? prev.clues,
        coreState: result.coreState ?? prev.coreState,
        ending: result.ending ?? prev.ending,
        deathTitle: result.deathTitle ?? prev.deathTitle,
        deathSummary: result.deathSummary ?? prev.deathSummary,
        deathMethod: result.deathMethod ?? prev.deathMethod,
        coordination: result.coordination ?? prev.coordination,
        storyLog: [...prev.storyLog, ...resultLog],
      }));

      if (result.ending && result.ending !== state.ending) {
        setEndingCinematic({
          key: `${result.ending}-${Date.now()}`,
          kind: result.phase === 'survived' ? 'survived' : 'death',
          title: result.deathTitle || (result.phase === 'survived' ? '你活了下来' : '23:47'),
          summary: result.deathSummary || '这一轮结束了。房间里的每一个细节都会回到下一次醒来。',
          method: result.deathMethod,
        });
      }
    } catch {
      setState(prev => ({
        ...prev,
        isParsing: false,
        storyLog: [
          ...prev.storyLog,
          {
            id: `sys-${Date.now()}`,
            type: 'system',
            content: '后端暂时没有回应，行动未写入循环。',
          },
        ],
      }));
    }
  };

  // Mock Confirmation & Resolution (Phase 2: Execution & Response)
  const handleConfirmAction = () => {
    setState(prev => ({
      ...prev,
      actionConfirmation: null,
      storyLog: [
        ...prev.storyLog,
        { 
          id: `sys-${Date.now()}`, 
          type: 'action_result', 
          content: '执行成功... 时间流逝 3 分钟。' 
        }
      ]
    }));

    // Mock GM/Narrator Response delay
    setTimeout(() => {
      setState(prev => {
        let newTime = '23:03';
        if (prev.time === '23:03') newTime = '23:08';
        
        return {
          ...prev,
          time: newTime,
          storyLog: [
            ...prev.storyLog,
            {
              id: `sys-${Date.now()}-1`,
              type: 'system',
              content: '凶手感知到异常响动'
            },
            {
              id: `narrative-${Date.now()}`,
              type: 'narrative',
              timestamp: newTime,
              content: '你轻手轻脚地走到门边，透过猫眼往外看。楼道昏暗的感应灯并没有亮，外面一片死寂。\n\n忽然，你听到门外极近的地方，传来布料摩擦木门的细微沙沙声。似乎有人正贴在你的门上。'
            }
          ]
        };
      });
    }, 1200);
  };

  const handleCancelAction = () => {
    setState(prev => ({ ...prev, actionConfirmation: null }));
  };

  return (
    <>
      <AnimatePresence>
        {showCinematic && (
          <CinematicIntro key="cinematic" onComplete={() => setShowCinematic(false)} />
        )}
        {endingCinematic && (
          <CinematicTransition
            key={endingCinematic.key}
            kind={endingCinematic.kind}
            title={endingCinematic.title}
            summary={endingCinematic.summary}
            method={endingCinematic.method}
            onComplete={() => setEndingCinematic(null)}
          />
        )}
      </AnimatePresence>

      <div className="flex flex-col h-screen bg-[#08080a] overflow-hidden text-zinc-200">
      <Header 
        time={state.time} 
        location={state.location} 
      />
      
      {/* Mobile Sidebar Toggle */}
      <div className="lg:hidden absolute top-3 right-4 z-50">
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 bg-black/50 backdrop-blur rounded-lg border border-white/5 text-zinc-400 hover:text-white"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 border-r border-white/5 relative bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-zinc-900/10 via-[#08080a] to-[#08080a]">
          <StoryPanel log={state.storyLog} />
          
          <div className="relative">
            {/* Soft gradient fade for text going behind input */}
            <div className="absolute -top-12 left-0 right-0 h-12 bg-gradient-to-t from-[#0c0c0e] to-transparent pointer-events-none" />
            <InputArea 
              onActionSubmit={handleActionSubmit}
              onConfirmAction={handleConfirmAction}
              onCancelAction={handleCancelAction}
              isParsing={state.isParsing}
              confirmationText={state.actionConfirmation}
            />
          </div>
        </main>

        {/* Desktop Sidebar */}
        <div className="hidden lg:block shrink-0 relative z-30">
          <Sidebar clues={state.clues} coordination={state.coordination} />
        </div>

        {/* Mobile Sidebar Frame */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div 
              initial={{ x: '100%' }} 
              animate={{ x: 0 }} 
              exit={{ x: '100%' }}
              transition={{ type: "spring", bounce: 0, duration: 0.4 }}
              className="absolute inset-y-0 right-0 w-80 z-40 lg:hidden shadow-2xl bg-[#08080a]"
            >
               <Sidebar clues={state.clues} coordination={state.coordination} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
    </>
  );
}
