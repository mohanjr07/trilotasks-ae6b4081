import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Users as UsersIcon, UserCheck, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import StatCard from "@/components/StatCard";
import UserAvatar from "@/components/UserAvatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function TeamPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const { data: profiles = [] } = useQuery({
    queryKey: ["team-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").order("full_name");
      return data ?? [];
    },
  });

  const filtered = profiles.filter((p: any) => {
    if (search && !p.full_name.toLowerCase().includes(search.toLowerCase()) && !p.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (roleFilter !== "all" && p.role !== roleFilter) return false;
    return true;
  });

  const active = profiles.filter((p: any) => p.is_active).length;
  const admins = profiles.filter((p: any) => p.role === "admin" || p.role === "super_admin").length;

  return (
    <AnimatedPage>
      <h1 className="font-heading text-[28px] font-bold text-ink-primary mb-6">Team</h1>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard title="Total Members" value={profiles.length} icon={UsersIcon} />
        <StatCard title="Active" value={active} icon={UserCheck} iconBg="bg-success-light" iconColor="text-success" />
        <StatCard title="Admins" value={admins} icon={Shield} iconBg="bg-purple-light" iconColor="text-purple" />
      </motion.div>

      <div className="flex gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email..." className="pl-9 h-10" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[140px] h-10"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="super_admin">Super Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible"
        className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((p: any) => (
          <motion.div key={p.id} variants={staggerItem} whileHover={{ y: -2 }}
            className="rounded-card bg-card p-5 shadow-card hover:shadow-card-hover transition-all">
            <div className="flex items-start gap-3 mb-3">
              <div className="relative">
                <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="lg" />
                <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-card ${p.is_active ? "bg-success" : "bg-ink-muted"}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-ink-primary truncate">{p.full_name}</p>
                <p className="text-xs text-ink-muted truncate">{p.position ?? p.department ?? p.email}</p>
                <span className={`mt-1 inline-flex text-[10px] font-medium px-2 py-0.5 rounded-pill capitalize ${
                  p.role === "admin" || p.role === "super_admin" ? "bg-accent-light text-primary" : "bg-muted text-ink-secondary"
                }`}>{p.role?.replace("_", " ")}</span>
              </div>
            </div>
            {p.department && <p className="text-xs text-ink-muted">{p.department}</p>}
          </motion.div>
        ))}
      </motion.div>
    </AnimatedPage>
  );
}
