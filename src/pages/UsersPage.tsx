import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Users as UsersIcon, Shield, UserCheck, UserPlus, MoreVertical, X, Copy, CheckSquare, Calendar, Eye, EyeOff } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage, { staggerContainer, staggerItem } from "@/components/AnimatedPage";
import StatCard from "@/components/StatCard";
import UserAvatar from "@/components/UserAvatar";
import StatusBadge from "@/components/StatusBadge";
import PriorityBadge from "@/components/PriorityBadge";
import EmptyState from "@/components/EmptyState";
import CreateTaskModal from "@/components/CreateTaskModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

async function getFunctionAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;

  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Your session expired. Please sign in again.");

  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

export default function UsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [createTaskForUser, setCreateTaskForUser] = useState<string | undefined>(undefined);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["users-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").order("full_name");
      return data ?? [];
    },
  });

  const { data: taskCounts = {} } = useQuery({
    queryKey: ["users-task-counts"],
    queryFn: async () => {
      const { data } = await supabase.from("task_assignees").select("user_id");
      const counts: Record<string, number> = {};
      (data ?? []).forEach((a: any) => { counts[a.user_id] = (counts[a.user_id] ?? 0) + 1; });
      return counts;
    },
  });

  const filtered = profiles.filter((p: any) => {
    if (search && !p.full_name.toLowerCase().includes(search.toLowerCase()) && !p.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (roleFilter !== "all" && p.role !== roleFilter) return false;
    if (statusFilter === "active" && !p.is_active) return false;
    if (statusFilter === "inactive" && p.is_active) return false;
    return true;
  });

  const totalUsers = profiles.length;
  const adminCount = profiles.filter((p: any) => p.role === "admin").length;
  const managerCount = profiles.filter((p: any) => p.role === "manager").length;
  const employeeCount = profiles.filter((p: any) => p.role === "employee").length;
  const internCount = profiles.filter((p: any) => p.role === "intern").length;
  const activeCount = profiles.filter((p: any) => p.is_active).length;

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      await supabase.from("profiles").update({ is_active: active }).eq("id", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-profiles"] });
      toast.success("User status updated");
    },
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const headers = await getFunctionAuthHeaders();
      const { data, error } = await supabase.functions.invoke("admin-delete-user", {
        body: { userId: id },
        headers,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: async (_, deletedUserId) => {
      queryClient.setQueryData<any[]>(["users-profiles"], (current = []) =>
        current.filter((profile) => profile.id !== deletedUserId),
      );
      await queryClient.invalidateQueries({ queryKey: ["users-profiles"] });
      toast.success("User deleted");
      setSelectedUser(null);
      setEditUser(null);
    },
  });

  const resetPassword = async (email: string) => {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    toast.success(`Password reset email sent to ${email}`);
  };

  return (
    <AnimatedPage>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-heading text-[28px] font-bold text-ink-primary">Users</h1>
          <p className="text-sm text-ink-muted">{totalUsers} total members</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" /> Add User
        </Button>
      </div>

      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total Users" value={totalUsers} icon={UsersIcon} />
        <StatCard title="Admins" value={adminCount} icon={Shield} iconBg="bg-accent-light" iconColor="text-primary" />
        <StatCard title="Employees" value={employeeCount} icon={UsersIcon} iconBg="bg-purple-light" iconColor="text-purple" />
        <StatCard title="Active" value={activeCount} icon={UserCheck} iconBg="bg-success-light" iconColor="text-success" />
      </motion.div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email..." className="pl-9 h-10" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[140px] h-10"><SelectValue placeholder="Role" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="employee">Employee</SelectItem>
            <SelectItem value="intern">Intern</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-10"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title={profiles.length === 0 ? "No team members yet" : "No users match your filters"}
          description={profiles.length === 0 ? "Add your first team member to get started." : "Try adjusting your search or filters."}
          actionLabel={profiles.length === 0 ? "Add User" : undefined}
          onAction={profiles.length === 0 ? () => setAddOpen(true) : undefined}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block rounded-card bg-card shadow-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-muted uppercase tracking-wider">User</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-muted uppercase tracking-wider">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-muted uppercase tracking-wider hidden lg:table-cell">Department</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-muted uppercase tracking-wider hidden lg:table-cell">Tasks</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-muted uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-ink-muted uppercase tracking-wider hidden xl:table-cell">Joined</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p: any) => (
                  <tr key={p.id} onClick={() => setSelectedUser(p)} className="border-b border-border last:border-0 hover:bg-surface-secondary cursor-pointer transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="md" />
                        <div>
                          <p className="font-medium text-ink-primary">{p.full_name}</p>
                          <p className="text-xs text-ink-muted">{p.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-pill capitalize ${
                        p.role === "admin" ? "bg-accent-light text-primary" : p.role === "manager" ? "bg-warning/10 text-warning" : p.role === "intern" ? "bg-purple-light text-purple" : "bg-muted text-ink-secondary"
                      }`}>{p.role}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-ink-secondary">{p.department ?? "—"}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-ink-secondary">{taskCounts[p.id] ?? 0}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${p.is_active ? "bg-success" : "bg-ink-muted"}`} />
                        <span className="text-xs">{p.is_active ? "Active" : "Inactive"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell text-xs text-ink-muted">
                      {p.created_at ? format(new Date(p.created_at), "MMM d, yyyy") : "—"}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="text-ink-muted hover:text-ink-primary p-1"><MoreVertical className="h-4 w-4" /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedUser(p)}>View Details</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditUser(p)}>Edit User</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => resetPassword(p.email)}>Reset Password</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleActive.mutate({ id: p.id, active: !p.is_active })}>
                            {p.is_active ? "Deactivate" : "Reactivate"}
                          </DropdownMenuItem>
                          {p.id !== user?.id && (
                            <DropdownMenuItem
                              className="text-destructive"
                              disabled={deleteUser.isPending}
                              onSelect={() => {
                                if (deleteUser.isPending) return;
                                if (confirm("This will permanently delete the user and their data. This cannot be undone.")) {
                                  deleteUser.mutate(p.id);
                                }
                              }}
                            >
                              {deleteUser.isPending ? "Deleting..." : "Delete User"}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="md:hidden space-y-3">
            {filtered.map((p: any) => (
              <motion.div key={p.id} variants={staggerItem} onClick={() => setSelectedUser(p)}
                className="rounded-card bg-card p-4 shadow-card cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} size="md" />
                    <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card ${p.is_active ? "bg-success" : "bg-ink-muted"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink-primary truncate">{p.full_name}</p>
                    <p className="text-xs text-ink-muted">{p.department ?? p.email}</p>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-pill capitalize ${
                    p.role === "admin" ? "bg-accent-light text-primary" : p.role === "manager" ? "bg-warning/10 text-warning" : p.role === "intern" ? "bg-purple-light text-purple" : "bg-muted text-ink-secondary"
                  }`}>{p.role}</span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </>
      )}

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} />
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} />}
      <UserDetailPanel user={selectedUser} onClose={() => setSelectedUser(null)} taskCounts={taskCounts}
        onEdit={(u: any) => { setSelectedUser(null); setEditUser(u); }}
        onCreateTask={(uid: string) => { setSelectedUser(null); setCreateTaskForUser(uid); }}
      />
      <CreateTaskModal open={!!createTaskForUser} onClose={() => setCreateTaskForUser(undefined)} preselectedAssignee={createTaskForUser} />
    </AnimatedPage>
  );
}

// Add User Modal
const addUserSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(100),
  email: z.string().email("Invalid email").max(255),
  role: z.enum(["admin", "manager", "employee", "intern"]),
  department: z.string().max(100).optional(),
  position: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  password: z.string().min(8, "Min 8 characters").optional(),
});

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [passwordMode, setPasswordMode] = useState<"email" | "password">("email");
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<z.infer<typeof addUserSchema>>({
    resolver: zodResolver(addUserSchema),
    defaultValues: { role: "employee" },
  });

  const createUser = useMutation({
    mutationFn: async (data: z.infer<typeof addUserSchema>) => {
      // Check email uniqueness
      const { data: existing } = await supabase.from("profiles").select("id").eq("email", data.email).maybeSingle();
      if (existing) throw new Error("Email already in use");

      if (passwordMode === "password" && !data.password) {
        throw new Error("Temporary password is required");
      }

      const { data: response, error } = await supabase.functions.invoke("admin-create-user", {
        headers: await getFunctionAuthHeaders(),
        body: {
          full_name: data.full_name,
          email: data.email,
          role: data.role,
          department: data.department || null,
          position: data.position || null,
          phone: data.phone || null,
          passwordMode,
          password: passwordMode === "password" ? data.password : undefined,
          redirectTo: `${window.location.origin}/reset-password`,
        },
      });

      if (error) throw error;
      if (response?.error) throw new Error(response.error);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users-profiles"] });
      toast.success("User created successfully");
      if (passwordMode === "email") toast.info("Setup email sent");
      reset();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const selectedRole = watch("role");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ display: open ? 'flex' : 'none' }}>
      <motion.div animate={{ opacity: open ? 1 : 0 }} className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-[520px] max-h-[90vh] overflow-y-auto rounded-modal bg-card p-6 shadow-modal mx-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading text-xl font-bold text-ink-primary">Add New User</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink-primary"><X className="h-5 w-5" /></button>
        </div>

        <form onSubmit={handleSubmit((d) => createUser.mutate(d))} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Full Name *</label>
            <Input {...register("full_name")} className="h-10" />
            {errors.full_name && <p className="mt-1 text-xs text-destructive">{errors.full_name.message}</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Email *</label>
            <Input {...register("email")} type="email" className="h-10" />
            {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Role *</label>
            <div className="grid grid-cols-2 gap-3">
              {(["admin", "manager", "employee", "intern"] as const).map((r) => (
                <button key={r} type="button" onClick={() => setValue("role", r)}
                  className={`rounded-lg border p-4 text-left transition-all ${selectedRole === r ? "border-primary bg-accent-light" : "border-border"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {r === "admin" ? <Shield className="h-4 w-4 text-primary" /> : r === "manager" ? <UserCheck className="h-4 w-4 text-primary" /> : r === "intern" ? <UsersIcon className="h-4 w-4 text-warning" /> : <UsersIcon className="h-4 w-4 text-ink-muted" />}
                    <span className="text-sm font-semibold capitalize text-ink-primary">{r}</span>
                  </div>
                  <p className="text-xs text-ink-muted">{r === "admin" ? "Full access & user management" : r === "manager" ? "All admin access except user management" : r === "intern" ? "Dashboard, tasks & notes only" : "View tasks & submit requests"}</p>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Job Title / Position</label>
            <Input {...register("position")} placeholder="e.g. Senior Designer" className="h-10" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-primary">Department</label>
              <Input {...register("department")} className="h-10" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-primary">Phone</label>
              <Input {...register("phone")} className="h-10" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Password</label>
            <div className="flex gap-3 mb-2">
              {(["email", "password"] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer">
                  <input type="radio" checked={passwordMode === m} onChange={() => setPasswordMode(m)} className="accent-primary" />
                  {m === "email" ? "Send setup email" : "Set temporary password"}
                </label>
              ))}
            </div>
            {passwordMode === "password" && (
              <>
                <div className="relative">
                  <Input
                    {...register("password")}
                    type={showPassword ? "text" : "password"}
                    placeholder="Min 8 characters"
                    className="h-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-muted hover:text-ink-primary transition-colors"
                    title={showPassword ? "Hide password" : "Show password"}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
              </>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={createUser.isPending} className="flex-1">
              {createUser.isPending ? "Creating..." : "Create User"}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// Edit User Modal
function EditUserModal({ user: editingUser, onClose }: { user: any; onClose: () => void }) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm({
    defaultValues: {
      full_name: editingUser.full_name,
      role: editingUser.role,
      department: editingUser.department ?? "",
      position: editingUser.position ?? "",
      phone: editingUser.phone ?? "",
    },
  });

  const updateUser = useMutation({
    mutationFn: async (data: any) => {
      const { data: response, error } = await supabase.functions.invoke("admin-update-user", {
        headers: await getFunctionAuthHeaders(),
        body: {
          userId: editingUser.id,
          full_name: data.full_name,
          role: data.role,
          department: data.department || null,
          position: data.position || null,
          phone: data.phone || null,
        },
      });

      if (error) throw error;
      if (response?.error) throw new Error(typeof response.error === "string" ? response.error : "Failed to update user");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users-profiles"] });
      toast.success("User updated");
      onClose();
    },
    onError: (error: any) => {
      toast.error(error?.message ?? "Failed to update user");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="relative w-full max-w-[480px] rounded-modal bg-card p-6 shadow-modal mx-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-heading text-xl font-bold text-ink-primary">Edit User</h2>
          <button onClick={onClose} className="text-ink-muted"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={handleSubmit((d) => updateUser.mutate(d))} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Full Name *</label>
            <Input {...register("full_name")} className="h-10" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Email</label>
            <Input value={editingUser.email} disabled className="h-10 bg-muted" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Role</label>
            <Select value={watch("role")} onValueChange={(v) => setValue("role", v)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="employee">Employee</SelectItem>
                <SelectItem value="intern">Intern</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-primary">Department</label>
              <Input {...register("department")} className="h-10" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-primary">Position</label>
              <Input {...register("position")} className="h-10" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-primary">Phone</label>
            <Input {...register("phone")} className="h-10" />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancel</Button>
            <Button type="submit" disabled={updateUser.isPending} className="flex-1">Save Changes</Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// User Detail Side Panel
function UserDetailPanel({ user: selectedUser, onClose, taskCounts, onEdit, onCreateTask }: {
  user: any; onClose: () => void; taskCounts: Record<string, number>;
  onEdit: (u: any) => void; onCreateTask: (uid: string) => void;
}) {
  const [tab, setTab] = useState<"tasks" | "leave">("tasks");

  const { data: userTasks = [] } = useQuery({
    queryKey: ["user-tasks", selectedUser?.id],
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("*").eq("assigned_to", selectedUser.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!selectedUser,
  });

  const { data: userLeave = [] } = useQuery({
    queryKey: ["user-leave", selectedUser?.id],
    queryFn: async () => {
      const { data } = await supabase.from("leave_requests").select("*").eq("employee_id", selectedUser.id).order("created_at", { ascending: false });
      return data ?? [];
    },
    enabled: !!selectedUser && tab === "leave",
  });

  if (!selectedUser) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-end">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 bg-ink-primary/30" onClick={onClose} />
        <motion.div
          initial={{ x: 400 }} animate={{ x: 0 }} exit={{ x: 400 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="relative w-full max-w-[400px] bg-card shadow-modal overflow-y-auto"
        >
          <div className="sticky top-0 bg-card z-10 flex items-center justify-between p-5 border-b border-border">
            <h2 className="font-heading text-lg font-bold text-ink-primary">User Details</h2>
            <button onClick={onClose} className="text-ink-muted"><X className="h-5 w-5" /></button>
          </div>

          <div className="p-5">
            <div className="flex items-center gap-4 mb-4">
              <UserAvatar name={selectedUser.full_name} avatarUrl={selectedUser.avatar_url} size="xl" />
              <div>
                <p className="font-heading text-xl font-bold text-ink-primary">{selectedUser.full_name}</p>
                <span className={`inline-flex text-[11px] font-medium px-2 py-0.5 rounded-pill capitalize ${
                  selectedUser.role === "admin" ? "bg-accent-light text-primary" : selectedUser.role === "manager" ? "bg-warning/10 text-warning" : selectedUser.role === "intern" ? "bg-purple-light text-purple" : "bg-muted text-ink-secondary"
                }`}>{selectedUser.role}</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`h-2 w-2 rounded-full ${selectedUser.is_active ? "bg-success" : "bg-ink-muted"}`} />
                  <span className="text-xs text-ink-muted">{selectedUser.is_active ? "Active" : "Inactive"}</span>
                </div>
              </div>
            </div>

            <div className="space-y-3 mb-5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">Email</span>
                <div className="flex items-center gap-1">
                  <span className="text-ink-primary">{selectedUser.email}</span>
                  <button onClick={() => { navigator.clipboard.writeText(selectedUser.email); toast.success("Copied"); }} className="text-ink-muted hover:text-primary">
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
              {selectedUser.phone && <div className="flex justify-between"><span className="text-ink-muted">Phone</span><span className="text-ink-primary">{selectedUser.phone}</span></div>}
              {selectedUser.department && <div className="flex justify-between"><span className="text-ink-muted">Department</span><span className="text-ink-primary">{selectedUser.department}</span></div>}
              {selectedUser.position && <div className="flex justify-between"><span className="text-ink-muted">Position</span><span className="text-ink-primary">{selectedUser.position}</span></div>}
              {selectedUser.created_at && <div className="flex justify-between"><span className="text-ink-muted">Member since</span><span className="text-ink-primary">{format(new Date(selectedUser.created_at), "MMM d, yyyy")}</span></div>}
            </div>

            <Button variant="outline" size="sm" onClick={() => onEdit(selectedUser)} className="w-full mb-4">Edit User</Button>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b border-border">
              {(["tasks", "leave"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`relative px-4 py-2 text-sm font-medium capitalize ${tab === t ? "text-primary" : "text-ink-muted"}`}>
                  {t === "tasks" ? "Tasks" : "Leave History"}
                  {tab === t && <motion.div layoutId="user-panel-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                </button>
              ))}
            </div>

            {tab === "tasks" ? (
              <>
                {userTasks.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-ink-muted mb-3">No tasks assigned</p>
                    <Button size="sm" onClick={() => onCreateTask(selectedUser.id)}>Assign Task</Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {userTasks.map((t: any) => (
                      <div key={t.id} className="rounded-lg bg-muted/50 p-3">
                        <p className="text-sm font-medium text-ink-primary truncate">{t.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <StatusBadge status={t.status ?? "todo"} />
                          <PriorityBadge priority={t.priority ?? "medium"} />
                          <div className="flex-1 flex items-center gap-1 text-xs text-ink-muted">
                            <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${t.progress ?? 0}%` }} />
                            </div>
                            {t.progress ?? 0}%
                          </div>
                        </div>
                      </div>
                    ))}
                    <Button size="sm" variant="outline" onClick={() => onCreateTask(selectedUser.id)} className="w-full mt-2">Assign Task</Button>
                  </div>
                )}
              </>
            ) : (
              <>
                {userLeave.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-muted">No leave requests</p>
                ) : (
                  <div className="space-y-2">
                    {userLeave.map((r: any) => (
                      <div key={r.id} className="rounded-lg bg-muted/50 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium bg-accent-light text-primary px-2 py-0.5 rounded-pill capitalize">{r.type}</span>
                          {r.leave_category && <span className="text-xs text-ink-muted capitalize">{r.leave_category}</span>}
                          <StatusBadge status={r.status ?? "pending"} />
                        </div>
                        <p className="text-xs text-ink-secondary">
                          {format(new Date(r.start_date), "MMM d")}
                          {r.end_date && r.end_date !== r.start_date && `–${format(new Date(r.end_date), "MMM d")}`}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
