import { useLayoutEffect, useMemo, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Pencil, Trash2, Check, X as XIcon, Network, ZoomIn, ZoomOut, Maximize,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AnimatedPage from "@/components/AnimatedPage";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// ── Types ───────────────────────────────────────────────────────────────
type OrgNode = {
  id: string;
  parent_id: string | null;
  title: string;
  subtitle: string | null;
  position: number;
};

type TreeNode = OrgNode & { children: TreeNode[] };

// Build a tree from a flat list keyed by parent_id
function buildTree(nodes: OrgNode[]): TreeNode[] {
  const byParent = new Map<string | null, TreeNode[]>();
  for (const n of nodes) {
    const tn: TreeNode = { ...n, children: [] };
    const list = byParent.get(n.parent_id) ?? [];
    list.push(tn);
    byParent.set(n.parent_id, list);
  }
  // sort each level by position
  for (const list of byParent.values()) {
    list.sort((a, b) => a.position - b.position);
  }
  // attach children
  const attach = (parent: TreeNode) => {
    const kids = byParent.get(parent.id) ?? [];
    parent.children = kids;
    kids.forEach(attach);
  };
  const roots = byParent.get(null) ?? [];
  roots.forEach(attach);
  return roots;
}

export default function OrganisationFlowPage() {
  const { profile, user } = useAuth();
  const canEdit = profile?.role === "admin" || profile?.role === "super_admin";
  const qc = useQueryClient();

  // Edit state — which node is being edited, and the draft values
  const [editing, setEditing] = useState<string | null>(null); // node id
  const [editTitle, setEditTitle] = useState("");
  const [editSubtitle, setEditSubtitle] = useState("");

  // Add-child state — which node are we adding a child under
  const [addingUnder, setAddingUnder] = useState<string | null | "root">(null);
  const [newTitle, setNewTitle] = useState("");
  const [newSubtitle, setNewSubtitle] = useState("");

  // Zoom for the chart. Auto-fit mode measures the chart's natural width
  // and scales it so the whole tree fits the container width — no horizontal
  // scrollbar. The +/- buttons disable auto-fit for manual zooming.
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [scaledSize, setScaledSize] = useState<{ w: number; h: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const { data: nodes = [], isLoading } = useQuery<OrgNode[]>({
    queryKey: ["organisation-flow"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organisation_flow_nodes")
        .select("id, parent_id, title, subtitle, position")
        .order("position", { ascending: true });
      if (error) throw error;
      return (data as OrgNode[]) ?? [];
    },
  });

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const addNode = useMutation({
    mutationFn: async (args: { parent_id: string | null; title: string; subtitle: string | null }) => {
      const siblings = nodes.filter((n) => n.parent_id === args.parent_id);
      const nextPos = siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.position)) + 1;
      const { error } = await supabase.from("organisation_flow_nodes").insert({
        parent_id: args.parent_id,
        title: args.title.trim(),
        subtitle: args.subtitle?.trim() || null,
        position: nextPos,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organisation-flow"] });
      setAddingUnder(null);
      setNewTitle("");
      setNewSubtitle("");
      toast.success("Node added");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't add node. Did you run the SQL migration?"),
  });

  const updateNode = useMutation({
    mutationFn: async (args: { id: string; title: string; subtitle: string | null }) => {
      const { error } = await supabase
        .from("organisation_flow_nodes")
        .update({
          title: args.title.trim(),
          subtitle: args.subtitle?.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organisation-flow"] });
      setEditing(null);
      toast.success("Node updated");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't update node."),
  });

  const deleteNode = useMutation({
    mutationFn: async (id: string) => {
      // ON DELETE CASCADE in the DB handles children
      const { error } = await supabase.from("organisation_flow_nodes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organisation-flow"] });
      toast.success("Node deleted");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't delete node."),
  });

  // ── Handlers ──────────────────────────────────────────────────────────
  const startEdit = (n: TreeNode) => {
    setEditing(n.id);
    setEditTitle(n.title);
    setEditSubtitle(n.subtitle ?? "");
  };
  const commitEdit = (n: TreeNode) => {
    if (!editTitle.trim()) { setEditing(null); return; }
    if (editTitle === n.title && (editSubtitle || null) === (n.subtitle ?? null)) {
      setEditing(null);
      return;
    }
    updateNode.mutate({ id: n.id, title: editTitle, subtitle: editSubtitle || null });
  };

  const commitAdd = () => {
    if (!newTitle.trim()) return;
    const parent = addingUnder === "root" ? null : addingUnder;
    addNode.mutate({ parent_id: parent, title: newTitle, subtitle: newSubtitle || null });
  };

  // ── Fit-to-width autoscaler ───────────────────────────────────────────
  // Measures the unscaled chart (offsetWidth/Height are unaffected by CSS
  // transforms) against the available container width, then sets the zoom
  // so the tree just fits. Also sizes a wrapper to the *scaled* pixel
  // dimensions so the transform doesn't leave phantom scrollable space.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const measure = () => {
      const naturalWidth = content.offsetWidth;
      const naturalHeight = content.offsetHeight;
      if (naturalWidth === 0 || naturalHeight === 0) return;
      // Container padding is p-4 (16px each side) → subtract 32.
      const availableWidth = Math.max(0, container.clientWidth - 32);
      // Fit to WIDTH exactly — chart always spans the full container width,
      // no left/right gaps. Container height then follows the chart's
      // scaled height (set via scaledSize.h below), so no top/bottom gap
      // either. Capped at 1.5x so a tiny chart doesn't get silly-sized.
      const nextZoom = autoFit
        ? Math.min(1.5, availableWidth / naturalWidth)
        : zoom;
      if (autoFit && Math.abs(nextZoom - zoom) > 0.001) setZoom(nextZoom);
      setScaledSize({ w: naturalWidth * nextZoom, h: naturalHeight * nextZoom });
    };

    // First measurement after layout
    measure();
    // Re-measure whenever either the container or the content's natural
    // dimensions change (e.g. window resize, sidebar toggle, tree edits).
    const ro = new ResizeObserver(() => requestAnimationFrame(measure));
    ro.observe(container);
    ro.observe(content);
    return () => ro.disconnect();
  }, [autoFit, zoom, nodes]);

  // Escape key cancels any inline edit / add
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditing(null);
        setAddingUnder(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Shared full-bleed margins — applied to both the header row and the
  // chart canvas so the whole page uses the full flex-1 width beside the
  // sidebar (breaks out of <main>'s max-w-[1280px] cap on wide screens).
  const fullBleed = {
    marginLeft: "calc(-1 * max(0px, (100vw - 1520px) / 2))",
    marginRight: "calc(-1 * max(0px, (100vw - 1520px) / 2))",
  } as const;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AnimatedPage>
      {/* Header */}
      <div
        className="flex items-center justify-between mb-6 gap-3 flex-wrap"
        style={fullBleed}
      >
        <div>
          <h1 className="font-heading text-[28px] font-bold text-ink-primary">Organisation Flow</h1>
          <p className="text-sm text-ink-muted">
            {canEdit
              ? "Click a node to edit it, or the + button to add a child."
              : "Company organisation chart."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-card">
            <button
              onClick={() => { setAutoFit(false); setZoom((z) => Math.max(0.3, z - 0.1)); }}
              className="p-1.5 rounded-md text-ink-secondary hover:bg-muted"
              title="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span className="text-xs text-ink-muted w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => { setAutoFit(false); setZoom((z) => Math.min(2, z + 0.1)); }}
              className="p-1.5 rounded-md text-ink-secondary hover:bg-muted"
              title="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={() => setAutoFit(true)}
              className={`p-1.5 rounded-md hover:bg-muted ${autoFit ? "text-primary" : "text-ink-secondary"}`}
              title="Fit to width"
            >
              <Maximize className="h-4 w-4" />
            </button>
          </div>
          {canEdit && tree.length > 0 && (
            <Button onClick={() => setAddingUnder("root")} className="gap-2">
              <Plus className="h-4 w-4" /> Add root node
            </Button>
          )}
        </div>
      </div>

      {/* Chart canvas */}
      {isLoading ? (
        <div className="h-96 rounded-xl bg-muted animate-pulse" />
      ) : tree.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No organisation flow yet"
          description={canEdit ? "Start by adding the root node (e.g. your company name or CEO)." : "The admin hasn't set up the organisation chart yet."}
          actionLabel={canEdit ? "Add root node" : undefined}
          onAction={canEdit ? () => setAddingUnder("root") : undefined}
        />
      ) : (
        <div
          ref={scrollRef}
          className="rounded-xl border border-border bg-muted/20 overflow-hidden p-4"
          style={fullBleed}
        >
          {/* The wrapper is sized to the *scaled* pixel dimensions so the
              container exactly hugs the chart — no empty space on any side.
              Since auto-fit scales to full container width, the wrapper's
              width will always equal (container.clientWidth - 32). */}
          <div
            className="relative mx-auto"
            style={{
              width: scaledSize?.w,
              height: scaledSize?.h,
            }}
          >
            <div
              ref={contentRef}
              className="absolute top-0 left-0"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                transition: "transform 120ms ease-out",
              }}
            >
              <div className="flex flex-col items-center gap-16">
                {tree.map((root) => (
                <OrgNodeView
                  key={root.id}
                  node={root}
                  canEdit={canEdit}
                  editing={editing}
                  editTitle={editTitle}
                  editSubtitle={editSubtitle}
                  onEditTitle={setEditTitle}
                  onEditSubtitle={setEditSubtitle}
                  onStartEdit={startEdit}
                  onCommitEdit={commitEdit}
                  onCancelEdit={() => setEditing(null)}
                  onDelete={(n) => {
                    if (confirm(`Delete "${n.title}"? All its children will also be removed.`)) {
                      deleteNode.mutate(n.id);
                    }
                  }}
                  onAddChild={(n) => setAddingUnder(n.id)}
                />
              ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add-node modal (shared for root + child adds) */}
      <AnimatePresence>
        {addingUnder !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink-primary/50 p-4"
            onClick={() => setAddingUnder(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-heading text-lg font-semibold text-ink-primary">
                  {addingUnder === "root" ? "Add root node" : "Add child node"}
                </h2>
                <button onClick={() => setAddingUnder(null)} className="text-ink-muted hover:text-ink-primary">
                  <XIcon className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Title *</label>
                  <Input
                    autoFocus
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && newTitle.trim()) commitAdd(); }}
                    placeholder="e.g. Accounts"
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-primary">Subtitle (optional)</label>
                  <Input
                    value={newSubtitle}
                    onChange={(e) => setNewSubtitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && newTitle.trim()) commitAdd(); }}
                    placeholder="e.g. Person's name or role"
                    maxLength={80}
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <Button variant="outline" onClick={() => setAddingUnder(null)} className="flex-1">Cancel</Button>
                <Button onClick={commitAdd} disabled={!newTitle.trim() || addNode.isPending} className="flex-1">
                  {addNode.isPending ? "Adding..." : "Add"}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AnimatedPage>
  );
}

// ── Recursive node + subtree renderer ───────────────────────────────────
function OrgNodeView({
  node, canEdit, editing, editTitle, editSubtitle,
  onEditTitle, onEditSubtitle, onStartEdit, onCommitEdit, onCancelEdit,
  onDelete, onAddChild,
}: {
  node: TreeNode;
  canEdit: boolean;
  editing: string | null;
  editTitle: string;
  editSubtitle: string;
  onEditTitle: (v: string) => void;
  onEditSubtitle: (v: string) => void;
  onStartEdit: (n: TreeNode) => void;
  onCommitEdit: (n: TreeNode) => void;
  onCancelEdit: () => void;
  onDelete: (n: TreeNode) => void;
  onAddChild: (n: TreeNode) => void;
}) {
  const isEditing = editing === node.id;
  const hasChildren = node.children.length > 0;
  const childCount = node.children.length;

  // Tailwind class applied to every connector line — dark enough to be
  // clearly visible against the muted chart background in both themes.
  const LINE = "bg-slate-400 dark:bg-slate-500";

  return (
    <div className="flex flex-col items-center">
      {/* Node card */}
      <div className="relative group">
        <motion.div
          layout
          className="rounded-xl bg-card border-2 border-primary/30 shadow-md px-3 py-2 min-w-[140px] max-w-[200px] text-center hover:border-primary/60 transition-colors"
        >
          {isEditing ? (
            <div className="space-y-2">
              <Input
                autoFocus
                value={editTitle}
                onChange={(e) => onEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitEdit(node);
                  if (e.key === "Escape") onCancelEdit();
                }}
                className="h-8 text-sm font-semibold text-center"
                maxLength={80}
                placeholder="Title"
              />
              <Input
                value={editSubtitle}
                onChange={(e) => onEditSubtitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitEdit(node);
                  if (e.key === "Escape") onCancelEdit();
                }}
                className="h-7 text-xs text-center"
                maxLength={80}
                placeholder="Subtitle (optional)"
              />
              <div className="flex items-center justify-center gap-1">
                <button
                  onClick={() => onCommitEdit(node)}
                  className="text-primary hover:text-primary/80 p-1 rounded"
                  title="Save"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={onCancelEdit}
                  className="text-ink-muted hover:text-destructive p-1 rounded"
                  title="Cancel"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="font-semibold text-sm text-ink-primary leading-snug break-words">{node.title}</p>
              {node.subtitle && (
                <p className="text-xs text-ink-muted mt-0.5 break-words">{node.subtitle}</p>
              )}
            </>
          )}
        </motion.div>

        {/* Hover controls (admin only, not while editing) */}
        {canEdit && !isEditing && (
          <div className="absolute -top-2 -right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onStartEdit(node)}
              className="h-6 w-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-ink-secondary hover:text-primary hover:border-primary"
              title="Edit"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => onDelete(node)}
              className="h-6 w-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-ink-secondary hover:text-destructive hover:border-destructive"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Add-child button (admin only, bottom of card) */}
        {canEdit && !isEditing && (
          <button
            onClick={() => onAddChild(node)}
            className="absolute left-1/2 -bottom-3 -translate-x-1/2 h-6 w-6 rounded-full bg-primary text-white shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110"
            title="Add child"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Children block */}
      {hasChildren && (
        <>
          {/* Vertical connector from parent down to the horizontal bar.
              Generous height so the chart has real vertical presence. */}
          <div className={`w-0.5 h-10 ${LINE}`} />

          {/* Row of children. The horizontal bar is built from each child's
              own top half-border: first child gets right-half, last child
              gets left-half, middle children get full width. This guarantees
              the bar spans exactly from the first child's centre to the
              last child's centre, regardless of how wide each subtree is. */}
          <div className="flex gap-4 items-start">
            {node.children.map((child, i) => {
              const isFirst = i === 0;
              const isLast = i === childCount - 1;
              const onlyChild = childCount === 1;
              return (
                <div key={child.id} className="flex flex-col items-center relative">
                  {/* Top horizontal half-bars (skipped entirely for only children) */}
                  {!onlyChild && (
                    <div className="relative w-full h-10 flex items-start justify-center">
                      {/* left half */}
                      {!isFirst && (
                        <div className={`absolute top-0 left-0 right-1/2 h-0.5 ${LINE}`} />
                      )}
                      {/* right half */}
                      {!isLast && (
                        <div className={`absolute top-0 left-1/2 right-0 h-0.5 ${LINE}`} />
                      )}
                      {/* Upward stub from child's top into the horizontal bar */}
                      <div className={`w-0.5 h-10 ${LINE}`} />
                    </div>
                  )}
                  {/* For an only child we still need the vertical stub */}
                  {onlyChild && <div className={`w-0.5 h-10 ${LINE}`} />}

                  <OrgNodeView
                    node={child}
                    canEdit={canEdit}
                    editing={editing}
                    editTitle={editTitle}
                    editSubtitle={editSubtitle}
                    onEditTitle={onEditTitle}
                    onEditSubtitle={onEditSubtitle}
                    onStartEdit={onStartEdit}
                    onCommitEdit={onCommitEdit}
                    onCancelEdit={onCancelEdit}
                    onDelete={onDelete}
                    onAddChild={onAddChild}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
