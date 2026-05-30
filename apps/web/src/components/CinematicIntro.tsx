import { motion, AnimatePresence } from 'motion/react';
import { useCallback, useState } from 'react';

interface CinematicIntroProps {
  onComplete: () => void;
  recap?: string;
}

const TOTAL_STEPS = 5; // 1=背景, 2=死亡, 3=省略号, 4=醒来, 5=开始

export function CinematicIntro({ onComplete, recap }: CinematicIntroProps) {
  const [step, setStep] = useState(1);
  const hasRecap = Boolean(recap);

  const advance = useCallback(() => {
    setStep(prev => {
      const next = prev + 1;
      if (next > TOTAL_STEPS) {
        onComplete();
        return prev;
      }
      return next;
    });
  }, [onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#030303] cursor-pointer"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 2, ease: 'easeInOut' }}
      onClick={advance}
    >
      <div className="max-w-2xl px-6 text-center relative select-none">
        <AnimatePresence mode="wait">
          {/* Step 1: 故事背景或前情提要 */}
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -12, filter: 'blur(8px)' }}
              transition={{ duration: 1.5, ease: [0.25, 1, 0.5, 1] }}
            >
              {hasRecap ? (
                <div className="space-y-3">
                  <p className="text-zinc-500 font-serif text-xs tracking-[0.3em] uppercase mb-6">前情提要</p>
                  {recap!.split('\n').map((line, i) => (
                    <p key={i} className="text-[#c0c0c0] font-serif text-base md:text-lg tracking-[0.08em] leading-[1.8]">
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-zinc-500 font-serif text-xs tracking-[0.3em] uppercase mb-6">青荷公寓 · 503 室</p>
                  <p className="text-[#d6d6d6] font-serif text-lg md:text-xl tracking-[0.1em] leading-[2]">
                    你叫沈知夏。
                  </p>
                  <p className="text-[#b8b8b8] font-serif text-base md:text-lg tracking-[0.08em] leading-[1.9]">
                    今天刚搬进这间出租屋，行李箱还堆在门边。
                  </p>
                  <p className="text-[#b8b8b8] font-serif text-base md:text-lg tracking-[0.08em] leading-[1.9]">
                    桌上有一个被拆开了一半的纸箱——不是你买的。<br />
                    旧书、药板、一张写着"503"的数字纸条。
                  </p>
                  <p className="text-[#a0a0a0] font-serif text-sm md:text-base tracking-[0.06em] leading-[1.8] mt-6">
                    这个包裹原本属于你的房东陈怀民。<br />
                    他控制着一条地下转运链，而包裹里的东西足以让它崩塌。
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* Step 2: 死亡 */}
          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -12, filter: 'blur(8px)' }}
              transition={{ duration: 1.5, ease: [0.25, 1, 0.5, 1] }}
            >
              <p className="text-[#d6d6d6] font-serif text-2xl md:text-3xl tracking-[0.16em]">
                23 点 47 分，你死了。
              </p>
              <p className="text-[#b2b2b2] font-serif text-lg md:text-xl tracking-[0.08em] leading-[2] mt-4">
                伴随着令人窒息的剧痛，<br />与潮湿纸箱发霉的味道。
              </p>
            </motion.div>
          )}

          {/* Step 3: 省略号 */}
          {step === 3 && (
            <motion.p
              key="step3"
              initial={{ opacity: 0, filter: 'blur(8px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, filter: 'blur(8px)' }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              className="text-zinc-600 font-serif text-2xl tracking-[0.3em]"
            >
              ……
            </motion.p>
          )}

          {/* Step 4: 再一次醒来 */}
          {step === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, scale: 0.95, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 1.05, filter: 'blur(10px)' }}
              transition={{ duration: 2, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="text-[#f4f4f4] font-serif text-[28px] md:text-[36px] tracking-[0.25em] drop-shadow-2xl">
                再一次，醒来。
              </p>
              <p className="text-zinc-500 text-sm mt-8 tracking-[0.2em] animate-pulse">
                点击开始
              </p>
            </motion.div>
          )}

          {/* Step 5: 开始游戏 */}
          {step === 5 && (
            <motion.div
              key="step5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <p className="text-zinc-500 text-sm tracking-[0.2em]">
                雨声重新贴上窗户。电子钟回到 23:00。
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 点击提示 */}
      {step < TOTAL_STEPS && (
        <div className="absolute bottom-12 text-zinc-700 text-xs tracking-[0.2em] animate-pulse">
          点击继续
        </div>
      )}

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_#000000_100%)] opacity-80 pointer-events-none"></div>
    </motion.div>
  );
}
