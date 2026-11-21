import { motion } from "framer-motion";
import { ReactNode } from "react";

// short and gentle, so pages appear quickly without jumping
const variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] } },
};

export default function AnimatedPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div initial="hidden" animate="visible" variants={variants} className={className}>
      {children}
    </motion.div>
  );
}

// Phones: lists appear at once (animating every row one by one makes cheaper phones stutter)
const isPhone = typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches;

export const staggerContainer = isPhone ? { hidden: { opacity: 1 }, visible: { opacity: 1 } } : {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.025 } },
};

export const staggerItem = isPhone ? { hidden: { opacity: 1 }, visible: { opacity: 1 } } : {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18 } },
};
