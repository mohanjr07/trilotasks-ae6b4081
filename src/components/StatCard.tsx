import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { staggerItem } from "./AnimatedPage";

type Props = {
  title: string;
  value: number;
  subtitle?: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  subtitleColor?: string;
};

function CountUp({ value }: { value: number }) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, (v) => Math.round(v));

  useEffect(() => {
    const controls = animate(count, value, { duration: 0.8, ease: "easeOut" });
    return controls.stop;
  }, [value, count]);

  return <motion.span>{rounded}</motion.span>;
}

export default function StatCard({ title, value, subtitle, icon: Icon, iconColor = "text-primary", iconBg = "bg-accent-light" }: Props) {
  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -2 }}
      className="rounded-card bg-card p-3.5 sm:p-5 shadow-card transition-shadow hover:shadow-card-hover min-w-0"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs sm:text-sm text-ink-secondary leading-snug">{title}</p>
          <p className="mt-1 font-heading text-2xl sm:text-[28px] font-semibold text-ink-primary leading-tight">
            <CountUp value={value} />
          </p>
          {subtitle && <p className="mt-1 text-[11px] sm:text-xs text-ink-muted leading-snug">{subtitle}</p>}
        </div>
        <div className={cn("flex h-8 w-8 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-lg", iconBg)}>
          <Icon className={cn("h-4 w-4 sm:h-5 sm:w-5", iconColor)} />
        </div>
      </div>
    </motion.div>
  );
}
