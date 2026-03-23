import { cn } from "@/lib/utils";

const sizeMap = { sm: "h-6 w-6 text-[10px]", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm", xl: "h-16 w-16 text-lg" };

const colors = [
  "bg-primary/10 text-primary",
  "bg-success/10 text-success",
  "bg-warning/10 text-warning",
  "bg-purple/10 text-purple",
  "bg-destructive/10 text-destructive",
];

function hashName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % colors.length;
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

type Props = {
  name: string;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

export default function UserAvatar({ name, avatarUrl, size = "md", className }: Props) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} className={cn("rounded-full object-cover", sizeMap[size], className)} />;
  }
  return (
    <div className={cn("flex items-center justify-center rounded-full font-semibold", sizeMap[size], colors[hashName(name)], className)}>
      {getInitials(name)}
    </div>
  );
}
