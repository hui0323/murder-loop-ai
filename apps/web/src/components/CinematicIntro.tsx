import { motion, AnimatePresence } from 'motion/react';
import { useEffect, useState } from 'react';

interface CinematicIntroProps {
  onComplete: () => void;
}

export function CinematicIntro({ onComplete }: CinematicIntroProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const sequence = async () => {
      // Step 0: Blank black screen pause
      await new Promise(r => setTimeout(r, 800));
      
      // Step 1
      setStep(1); 
      await new Promise(r => setTimeout(r, 3800));
      
      // Step 2
      setStep(2); 
      await new Promise(r => setTimeout(r, 4200));
      
      // Step 3
      setStep(3); 
      await new Promise(r => setTimeout(r, 2200));
      
      // Step 4
      setStep(4); 
      await new Promise(r => setTimeout(r, 3200));
      
      // Hide
      setStep(5);
      await new Promise(r => setTimeout(r, 500));
      onComplete();
    };
    
    sequence();
  }, [onComplete]);

  return (
    <motion.div 
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#030303]"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 4, ease: 'easeInOut' }}
    >
      <div className="max-w-2xl px-6 text-center relative pointer-events-none">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.p
              key="text1"
              initial={{ opacity: 0, y: 15, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -15, filter: 'blur(10px)' }}
              transition={{ duration: 2, ease: [0.25, 1, 0.5, 1] }}
              className="text-[#d6d6d6] font-serif text-2xl md:text-3xl tracking-[0.16em]"
            >
              23 点 47 分，你死了。
            </motion.p>
          )}
          {step === 2 && (
            <motion.p
              key="text2"
              initial={{ opacity: 0, y: 15, filter: 'blur(10px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -15, filter: 'blur(10px)' }}
              transition={{ duration: 2, ease: [0.25, 1, 0.5, 1] }}
              className="text-[#b2b2b2] font-serif text-xl md:text-2xl tracking-[0.12em] leading-[2]"
            >
              伴随着令人窒息的剧痛，<br />与潮湿纸箱发霉的味道。
            </motion.p>
          )}
          {step === 3 && (
            <motion.p
              key="text3"
              initial={{ opacity: 0, filter: 'blur(10px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, filter: 'blur(10px)' }}
              transition={{ duration: 2, ease: "easeOut" }}
              className="text-zinc-600 font-serif text-2xl tracking-[0.3em]"
            >
              ……
            </motion.p>
          )}
          {step === 4 && (
            <motion.div
              key="text4"
              initial={{ opacity: 0, scale: 0.9, filter: 'blur(15px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 1.1, filter: 'blur(15px)' }}
              transition={{ duration: 2.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="text-[#f4f4f4] font-serif text-[28px] md:text-[36px] tracking-[0.25em] drop-shadow-2xl">
                再一次，醒来。
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Subtle background noise/vignette overlay for atmosphere */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_0%,_#000000_100%)] opacity-80 pointer-events-none"></div>
    </motion.div>
  );
}
