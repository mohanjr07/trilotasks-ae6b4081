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
      className="rounded-card bg-card p-5 shadow-card transition-shadow hover:shadow-card-hover"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-ink-secondary">{title}</p>
          <p className="mt-1 font-heading text-[28px] font-semibold text-ink-primary">
            <CountUp value={value} />
          </p>
          {subtitle && <p className="mt-1 text-xs text-ink-muted">{subtitle}</p>}
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", iconBg)}>
          <Icon className={cn("h-5 w-5", iconColor)} />
        </div>
      </div>
    </motion.div>
  );
}
