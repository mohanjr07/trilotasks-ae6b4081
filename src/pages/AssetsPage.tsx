import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Monitor, Search, Plus, X, Pencil, Trash2,
  Laptop, Smartphone, Printer, Server, Headphones,
  Package, CheckCircle2, AlertCircle, Clock, Eye,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Asset = {
  id: string;
  asset_name: string;
  asset_type: string;
  serial_number: string | null;
  holder_name: string | null;
  holder_id: string | null;
  status: "available" | "assigned" | "maintenance" | "retired";
  notes: string | null;
  assigned_at: string | null;
  created_at: string;
};

type Profile = {
  id: string;
  full_name: string;
};

const ASSET_TYPES = ["Laptop", "Desktop", "Monitor", "Phone", "Tablet", "Printer", "Server", "Headset", "Other"];
const STATUS_OPTIONS = ["available", "assigned", "maintenance", "retired"] as const;

const assetTypeIcon = (type: string) => {
  switch (type.toLowerCase()) {
    case "laptop": return Laptop;
    case "desktop": return Monitor;
    case "phone": return Smartphone;
    case "printer": return Printer;
    case "server": return Server;
    case "headset": return Headphones;
    default: return Package;
  }
};

const statusConfig = {
  available:   { label: "Available",   color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",     icon: CheckCircle2 },
  assigned:    { label: "Assigned",    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",         icon: Clock },
  maintenance: { label: "Maintenance", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", icon: AlertCircle },
  retired:     { label: "Retired",     color: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",            icon: X },
};

const emptyForm = {
  asset_name: "",
  asset_type: "Laptop",
  serial_number: "",
  holder_name: "",
  status: "available" as Asset["status"],
  notes: "",
};

export default function AssetsPage() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  const isAdmin = profile?.role === "admin";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [viewAsset, setViewAsset] = useState<Asset | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Asset[];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-simple"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .order("full_name");
      return (data ?? []) as Profile[];
    },
    enabled: isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: async (values: typeof emptyForm) => {
      const { error } = await supabase.from("assets").insert({
        asset_name: values.asset_name,
        asset_type: values.asset_type,
        serial_number: values.serial_number || null,
        holder_name: values.holder_name || null,
        status: values.status,
        notes: values.notes || null,
        assigned_at: values.holder_name ? new Date().toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast.success("Asset added successfully");
      closeModal();
    },
    onError: (e: any) => toast.error("Failed to add asset: " + (e?.message ?? "Unknown error")),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: typeof emptyForm }) => {
      const { error } = await supabase.from("assets").update({
        asset_name: values.asset_name,
        asset_type: values.asset_type,
        serial_number: values.serial_number || null,
        holder_name: values.holder_name || null,
        status: values.status,
        notes: values.notes || null,
        assigned_at: values.holder_name ? new Date().toISOString() : null,
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast.success("Asset updated");
      closeModal();
    },
    onError: (e: any) => toast.error("Failed to update: " + (e?.message ?? "Unknown error")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("assets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      toast.success("Asset deleted");
      setDeleteId(null);
    },
    onError: (e: any) => toast.error("Failed to delete: " + (e?.message ?? "Unknown error")),
  });

  const openAdd = () => { setEditAsset(null); setForm(emptyForm); setModalOpen(true); };
  const openEdit = (a: Asset) => {
    setEditAsset(a);
    setForm({
      asset_name: a.asset_name,
      asset_type: a.asset_type,
      serial_number: a.serial_number ?? "",
      holder_name: a.holder_name ?? "",
      status: a.status,
      notes: a.notes ?? "",
    });
    setModalOpen(true);
  };
  const closeModal = () => { setModalOpen(false); setEditAsset(null); setForm(emptyForm); };

  const handleSubmit = () => {
    if (!form.asset_name.trim()) { toast.error("Asset name is required"); return; }
    if (editAsset) updateMutation.mutate({ id: editAsset.id, values: form });
    else createMutation.mutate(form);
  };

  const filtered = assets.filter((a) => {
    const q = search.toLowerCase();
    if (q && !a.asset_name.toLowerCase().includes(q) &&
        !(a.holder_name ?? "").toLowerCase().includes(q) &&
        !(a.serial_number ?? "").toLowerCase().includes(q)) return false;
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (typeFilter !== "all" && a.asset_type !== typeFilter) return false;
    return true;
  });

  const stats = {
    total: assets.length,
    available: assets.filter(a => a.status === "available").length,
    assigned: assets.filter(a => a.status === "assigned").length,
    maintenance: assets.filter(a => a.status === "maintenance").length,
  };

  return (
    <div className="p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-ink-primary">Assets</h2>
          <p className="text-sm text-ink-muted mt-0.5">Track company assets and their holders</p>
        </div>
        {isAdmin && (
          <Button onClick={openAdd} className="gap-2">
            <Plus className="h-4 w-4" /> Add Asset
          </Button>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Assets",  value: stats.total,       icon: Package,      color: "text-primary",    bg: "bg-primary/10" },
          { label: "Available",     value: stats.available,   icon: CheckCircle2, color: "text-green-600",  bg: "bg-green-100 dark:bg-green-900/30" },
          { label: "Assigned",      value: stats.assigned,    icon: Clock,        color: "text-blue-600",   bg: "bg-blue-100 dark:bg-blue-900/30" },
          { label: "Maintenance",   value: stats.maintenance, icon: AlertCircle,  color: "text-yellow-600", bg: "bg-yellow-100 dark:bg-yellow-900/30" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-ink-secondary">{label}</p>
                <p className="mt-1 text-3xl font-bold text-ink-primary">{value}</p>
              </div>
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", bg)}>
                <Icon className={cn("h-5 w-5", color)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
          <Input
            placeholder="Search assets or holders…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {ASSET_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-ink-muted text-sm">
            Loading assets…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
              <Package className="h-8 w-8 text-ink-muted" />
            </div>
            <h3 className="text-lg font-semibold text-ink-primary mb-1">No assets found</h3>
            <p className="text-sm text-ink-muted mb-4">
              {search || statusFilter !== "all" || typeFilter !== "all"
                ? "Try adjusting your filters"
                : isAdmin ? "Add your first asset to get started" : "No assets have been added yet"}
            </p>
            {isAdmin && assets.length === 0 && (
              <Button onClick={openAdd} className="gap-2">
                <Plus className="h-4 w-4" /> Add Asset
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-ink-muted text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-3 font-medium">Asset</th>
                  <th className="text-left px-5 py-3 font-medium">Type</th>
                  <th className="text-left px-5 py-3 font-medium">Serial No.</th>
                  <th className="text-left px-5 py-3 font-medium">Holder</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                  <th className="text-left px-5 py-3 font-medium">Notes</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((asset) => {
                  const Icon = assetTypeIcon(asset.asset_type);
                  const sc = statusConfig[asset.status] ?? statusConfig.available;
                  const StatusIcon = sc.icon;
                  return (
                    <tr
                      key={asset.id}
                      className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                            <Icon className="h-4 w-4" />
                          </div>
                          <span className="font-medium text-ink-primary">{asset.asset_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-ink-secondary">{asset.asset_type}</td>
                      <td className="px-5 py-3.5 text-ink-muted font-mono text-xs">
                        {asset.serial_number || "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        {asset.holder_name ? (
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                              {asset.holder_name.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-ink-primary">{asset.holder_name}</span>
                          </div>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", sc.color)}>
                          <StatusIcon className="h-3 w-3" />
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-ink-muted max-w-[180px] truncate">
                        {asset.notes || "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => setViewAsset(asset)}
                            className="p-1.5 rounded-lg hover:bg-muted text-ink-muted hover:text-ink-primary transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => openEdit(asset)}
                                className="p-1.5 rounded-lg hover:bg-muted text-ink-muted hover:text-ink-primary transition-colors"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => setDeleteId(asset.id)}
                                className="p-1.5 rounded-lg hover:bg-destructive/10 text-ink-muted hover:text-destructive transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      <AnimatePresence>
        {modalOpen && isAdmin && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={closeModal}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-ink-primary">
                    {editAsset ? "Edit Asset" : "Add Asset"}
                  </h3>
                  <button onClick={closeModal} className="text-ink-muted hover:text-ink-primary">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">Asset Name *</label>
                    <Input
                      placeholder="e.g. MacBook Pro 14"
                      value={form.asset_name}
                      onChange={(e) => setForm(f => ({ ...f, asset_name: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-ink-muted mb-1.5 block">Type</label>
                      <Select value={form.asset_type} onValueChange={(v) => setForm(f => ({ ...f, asset_type: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ASSET_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-ink-muted mb-1.5 block">Status</label>
                      <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v as Asset["status"] }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map(s => (
                            <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">Serial Number</label>
                    <Input
                      placeholder="e.g. SN-2024-00123"
                      value={form.serial_number}
                      onChange={(e) => setForm(f => ({ ...f, serial_number: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">Holder Name</label>
                    <Select
                      value={form.holder_name || "__none__"}
                      onValueChange={(v) => setForm(f => ({
                        ...f,
                        holder_name: v === "__none__" ? "" : v,
                        status: v === "__none__" ? "available" : "assigned",
                      }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Unassigned</SelectItem>
                        {profiles.map(p => (
                          <SelectItem key={p.id} value={p.full_name}>{p.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-muted mb-1.5 block">Notes</label>
                    <Input
                      placeholder="Any additional notes…"
                      value={form.notes}
                      onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1" onClick={closeModal}>Cancel</Button>
                  <Button
                    className="flex-1"
                    onClick={handleSubmit}
                    disabled={createMutation.isPending || updateMutation.isPending}
                  >
                    {editAsset ? "Save Changes" : "Add Asset"}
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* View Modal */}
      <AnimatePresence>
        {viewAsset && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setViewAsset(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {(() => {
                      const Icon = assetTypeIcon(viewAsset.asset_type);
                      return (
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                      );
                    })()}
                    <div>
                      <h3 className="text-lg font-semibold text-ink-primary">{viewAsset.asset_name}</h3>
                      <p className="text-xs text-ink-muted">{viewAsset.asset_type}</p>
                    </div>
                  </div>
                  <button onClick={() => setViewAsset(null)} className="text-ink-muted hover:text-ink-primary">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="divide-y divide-border text-sm">
                  <div className="flex items-center justify-between py-3">
                    <span className="text-ink-muted font-medium">Status</span>
                    {(() => {
                      const sc = statusConfig[viewAsset.status];
                      const SI = sc.icon;
                      return (
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", sc.color)}>
                          <SI className="h-3 w-3" />{sc.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <span className="text-ink-muted font-medium">Holder</span>
                    {viewAsset.holder_name ? (
                      <div className="flex items-center gap-2">
                        <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                          {viewAsset.holder_name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-ink-primary">{viewAsset.holder_name}</span>
                      </div>
                    ) : <span className="text-ink-muted">Unassigned</span>}
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <span className="text-ink-muted font-medium">Serial No.</span>
                    <span className="font-mono text-xs text-ink-secondary">{viewAsset.serial_number || "—"}</span>
                  </div>
                  <div className="flex items-center justify-between py-3">
                    <span className="text-ink-muted font-medium">Notes</span>
                    <span className="text-ink-secondary text-right max-w-[200px]">{viewAsset.notes || "—"}</span>
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <Button variant="outline" className="flex-1" onClick={() => setViewAsset(null)}>Close</Button>
                  {isAdmin && (
                    <Button className="flex-1" onClick={() => { setViewAsset(null); openEdit(viewAsset); }}>
                      <Pencil className="h-4 w-4 mr-1.5" /> Edit
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete Confirm */}
      <AnimatePresence>
        {deleteId && isAdmin && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-40"
              onClick={() => setDeleteId(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
                <h3 className="text-lg font-semibold text-ink-primary">Delete Asset?</h3>
                <p className="text-sm text-ink-muted">This action cannot be undone.</p>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={() => setDeleteId(null)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => deleteMutation.mutate(deleteId!)}
                    disabled={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
