import { useLayoutEffect, useMemo, useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus, Pencil, Trash2, Check, X as XIcon, Network, ZoomIn, ZoomOut, Maximize, Link2,
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
  extra_parent_ids?: string[] | null; // "also reports to" (drawn as extra lines)
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

// ── Chart layout ────────────────────────────────────────────────────────
const CARD_W = 170;   // every card has the same width
const H_GAP = 28;     // space between neighbouring cards
const V_GAP = 72;     // space between levels (room for elbows + arrowheads)

function layoutChart(tree: TreeNode[], nodes: OrgNode[], heights: Record<string, number>) {
  const h = (id: string) => heights[id] ?? 48;
  const pos = new Map<string, { x: number; y: number; level: number }>();

  // Row heights per level
  const levelH: number[] = [];
  const walk = (n: TreeNode, l: number) => {
    levelH[l] = Math.max(levelH[l] ?? 0, h(n.id));
    n.children.forEach((c) => walk(c, l + 1));
  };
  tree.forEach((r) => walk(r, 0));
  const levelY: number[] = [];
  let acc = 0;
  levelH.forEach((lh, l) => { levelY[l] = acc; acc += lh + V_GAP; });

  // Subtree widths, then place each parent centred over its children
  const widths = new Map<string, number>();
  const width = (n: TreeNode): number => {
    if (widths.has(n.id)) return widths.get(n.id)!;
    const kids = n.children.reduce((s, c) => s + width(c), 0) + H_GAP * Math.max(0, n.children.length - 1);
    const w = Math.max(CARD_W, kids);
    widths.set(n.id, w);
    return w;
  };
  const place = (n: TreeNode, left: number, l: number) => {
    const w = width(n);
    pos.set(n.id, { x: left + w / 2, y: levelY[l], level: l });
    const kids = n.children.reduce((s, c) => s + width(c), 0) + H_GAP * Math.max(0, n.children.length - 1);
    let cx = left + (w - kids) / 2;
    n.children.forEach((c) => { place(c, cx, l + 1); cx += width(c) + H_GAP; });
  };
  let left = 0;
  tree.forEach((r) => { place(r, left, 0); left += width(r) + H_GAP * 3; });

  // Boxes with more than one boss sit centred between all of them
  // (moved together with everything under them), unless that would
  // overlap another card on the same row.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kidsOf = new Map<string, string[]>();
  nodes.forEach((n) => { if (n.parent_id) kidsOf.set(n.parent_id, [...(kidsOf.get(n.parent_id) ?? []), n.id]); });
  const subtree = (id: string): string[] => [id, ...(kidsOf.get(id) ?? []).flatMap(subtree)];
  for (const n of nodes) {
    const extras = (n.extra_parent_ids ?? []).filter((id) => pos.has(id) && byId.has(id));
    if (!extras.length || !pos.has(n.id)) continue;
    const bosses = [n.parent_id, ...extras].filter((id): id is string => !!id && pos.has(id));
    const targetX = bosses.reduce((s, id) => s + pos.get(id)!.x, 0) / bosses.length;
    const dx = targetX - pos.get(n.id)!.x;
    if (Math.abs(dx) < 1) continue;
    const moving = new Set(subtree(n.id));
    const clash = [...moving].some((id) => {
      const p = pos.get(id);
      if (!p) return false;
      return [...pos.entries()].some(([oid, o]) =>
        !moving.has(oid) && o.level === p.level && Math.abs(o.x - (p.x + dx)) < CARD_W + H_GAP / 2);
    });
    if (clash) continue;
    moving.forEach((id) => { const p = pos.get(id); if (p) pos.set(id, { ...p, x: p.x + dx }); });
  }

  // Normalise so nothing sits left of 0
  let minX = Infinity, maxX = -Infinity;
  pos.forEach((p) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); });
  if (!isFinite(minX)) return { pos, edges: [] as string[], width: 0, height: 0 };
  const shift = CARD_W / 2 - minX;
  pos.forEach((p, id) => pos.set(id, { ...p, x: p.x + shift }));

  // Reporting lines: down from the boss, rounded elbow, across, down into the child
  const edges: string[] = [];
  const line = (fromId: string, toId: string) => {
    const a = pos.get(fromId), b = pos.get(toId);
    if (!a || !b) return;
    const px = a.x, py = a.y + h(fromId);
    const cx = b.x, cy = b.y - 2;
    const midY = Math.max(py + 12, b.y - V_GAP / 2);
    const dist = Math.abs(cx - px);
    if (dist < 1) { edges.push(`M${px},${py} V${cy}`); return; }
    const r = Math.min(12, dist / 2, (midY - py) / 2, (cy - midY) / 2);
    const dir = cx > px ? 1 : -1;
    edges.push(`M${px},${py} V${midY - r} Q${px},${midY} ${px + dir * r},${midY} H${cx - dir * r} Q${cx},${midY} ${cx},${midY + r} V${cy}`);
  };
  nodes.forEach((n) => {
    if (n.parent_id) line(n.parent_id, n.id);
    (n.extra_parent_ids ?? []).forEach((pid) => { if (byId.has(pid)) line(pid, n.id); });
  });

  const height = acc - V_GAP;
  return { pos, edges, width: maxX - minX + CARD_W, height: Math.max(height, 0) + 4 };
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
  // and scales it so the whole tree fits the container width. The +/- buttons
  // disable auto-fit for manual zooming; the canvas then scrolls (and can be
  // dragged) horizontally and vertically.
  const [zoom, setZoom] = useState(1);
  const [autoFit, setAutoFit] = useState(true);
  const [scaledSize, setScaledSize] = useState<{ w: number; h: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [linking, setLinking] = useState<OrgNode | null>(null);
  const [linkDraft, setLinkDraft] = useState<string[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);

  const { data: nodes = [], isLoading } = useQuery<OrgNode[]>({
    queryKey: ["organisation-flow"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organisation_flow_nodes")
        .select("*")
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

  const saveLinks = useMutation({
    mutationFn: async (args: { id: string; ids: string[] }) => {
      const { error } = await (supabase as any)
        .from("organisation_flow_nodes")
        .update({ extra_parent_ids: args.ids, updated_at: new Date().toISOString() })
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["organisation-flow"] });
      setLinking(null);
      toast.success("Links saved");
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save. Did you run the SQL migration?"),
  });

  // Nodes that can't be an extra parent of `n`: itself, its main parent, and
  // anything below it (that would make a loop).
  const blockedFor = (n: OrgNode) => {
    const byId = new Map(nodes.map((m) => [m.id, m]));
    const isUnder = (x: OrgNode) => {
      let cur: OrgNode | undefined = x;
      while (cur && cur.parent_id) {
        if (cur.parent_id === n.id) return true;
        cur = byId.get(cur.parent_id);
      }
      return false;
    };
    const blocked = new Set<string>([n.id]);
    if (n.parent_id) blocked.add(n.parent_id);
    for (const x of nodes) if (isUnder(x)) blocked.add(x.id);
    return blocked;
  };

  // ── FigJam-style layout ───────────────────────────────────────────────
  // Card heights are measured after render (offsetHeight ignores the zoom
  // transform), then every card gets an absolute x/y and every reporting
  // line is drawn as one SVG path with rounded elbows and an arrowhead.
  const [heights, setHeights] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const next: Record<string, number> = {};
    content.querySelectorAll<HTMLElement>("[data-org-card]").forEach((el) => {
      next[el.dataset.orgCard!] = el.offsetHeight;
    });
    const changed = Object.keys(next).length !== Object.keys(heights).length ||
      Object.entries(next).some(([k, v]) => heights[k] !== v);
    if (changed) setHeights(next);
  });
  const chart = useMemo(() => layoutChart(tree, nodes, heights), [tree, nodes, heights]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const startEdit = (n: OrgNode) => {
    setEditing(n.id);
    setEditTitle(n.title);
    setEditSubtitle(n.subtitle ?? "");
  };
  const commitEdit = (n: OrgNode) => {
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
      // On phones a whole-org chart fitted to ~340px is unreadably tiny,
      // so never shrink below 45% there — the chart scrolls/pans instead.
      const minFit = window.innerWidth < 768 ? 0.45 : 0;
      const nextZoom = autoFit
        ? Math.max(minFit, Math.min(1.5, availableWidth / naturalWidth))
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
          <h1 className="font-heading text-2xl sm:text-[28px] font-bold text-ink-primary">Organisation Flow</h1>
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
          className="rounded-xl border border-border bg-muted/20 overflow-auto max-h-[70dvh] md:max-h-[78dvh] p-4 touch-pan-x touch-pan-y cursor-grab active:cursor-grabbing"
          style={fullBleed}
          onPointerDown={(e) => {
            // Drag the empty canvas with the mouse to pan (nodes/buttons still click normally).
            if (e.pointerType !== "mouse" || e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button, input, textarea, a, [role=button]")) return;
            const el = scrollRef.current;
            if (!el) return;
            const start = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
            const move = (ev: PointerEvent) => {
              el.scrollLeft = start.l - (ev.clientX - start.x);
              el.scrollTop = start.t - (ev.clientY - start.y);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
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
              <div className="relative" style={{ width: chart.width, height: chart.height }}>
                <svg
                  className="absolute inset-0 pointer-events-none overflow-visible text-slate-400 dark:text-slate-500"
                  width={chart.width}
                  height={chart.height}
                  aria-hidden
                >
                  <defs>
                    <marker id="org-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
                    </marker>
                  </defs>
                  {chart.edges.map((d, i) => (
                    <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" markerEnd="url(#org-arrow)" />
                  ))}
                </svg>
                {nodes.map((n) => {
                  const p = chart.pos.get(n.id);
                  if (!p) return null;
                  return (
                    <div
                      key={n.id}
                      className="absolute"
                      style={{ left: p.x - CARD_W / 2, top: p.y, width: CARD_W, transition: "left 200ms ease, top 200ms ease" }}
                    >
                      <OrgCard
                        node={n}
                        canEdit={canEdit}
                        editing={editing}
                        editTitle={editTitle}
                        editSubtitle={editSubtitle}
                        onEditTitle={setEditTitle}
                        onEditSubtitle={setEditSubtitle}
                        onStartEdit={startEdit}
                        onCommitEdit={commitEdit}
                        onCancelEdit={() => setEditing(null)}
                        onDelete={(x) => {
                          if (confirm(`Delete "${x.title}"? All its children will also be removed.`)) {
                            deleteNode.mutate(x.id);
                          }
                        }}
                        onAddChild={(x) => setAddingUnder(x.id)}
                        onLink={(x) => { setLinking(x); setLinkDraft(x.extra_parent_ids ?? []); }}
                      />
                    </div>
                  );
                })}
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

      {/* "Also reports to" modal */}
      {linking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-primary/50 p-4" onClick={() => setLinking(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-card border border-border shadow-xl p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-heading text-lg font-semibold text-ink-primary">"{linking.title}" also reports to</h2>
              <button onClick={() => setLinking(null)} className="text-ink-muted hover:text-ink-primary"><XIcon className="h-5 w-5" /></button>
            </div>
            <p className="text-xs text-ink-muted mb-3">A line is drawn from each ticked box to this one. Its main position stays where it is.</p>
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {(() => {
                const blocked = blockedFor(linking);
                return nodes
                  .filter((x) => !blocked.has(x.id))
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((x) => (
                    <label key={x.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={linkDraft.includes(x.id)}
                        onChange={(e) => setLinkDraft((d) => e.target.checked ? [...d, x.id] : d.filter((v) => v !== x.id))}
                      />
                      <span className="text-ink-primary">{x.title}</span>
                      {x.subtitle && <span className="text-xs text-ink-muted">{x.subtitle}</span>}
                    </label>
                  ));
              })()}
            </div>
            <div className="flex gap-2 mt-5">
              <Button variant="outline" onClick={() => setLinking(null)} className="flex-1">Cancel</Button>
              <Button onClick={() => saveLinks.mutate({ id: linking.id, ids: linkDraft })} disabled={saveLinks.isPending} className="flex-1">
                {saveLinks.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AnimatedPage>
  );
}

// ── One card ─────────────────────────────────────────────────────────────
function OrgCard({
  node, canEdit, editing, editTitle, editSubtitle,
  onEditTitle, onEditSubtitle, onStartEdit, onCommitEdit, onCancelEdit,
  onDelete, onAddChild, onLink,
}: {
  node: OrgNode;
  canEdit: boolean;
  editing: string | null;
  editTitle: string;
  editSubtitle: string;
  onEditTitle: (v: string) => void;
  onEditSubtitle: (v: string) => void;
  onStartEdit: (n: OrgNode) => void;
  onCommitEdit: (n: OrgNode) => void;
  onCancelEdit: () => void;
  onDelete: (n: OrgNode) => void;
  onAddChild: (n: OrgNode) => void;
  onLink: (n: OrgNode) => void;
}) {
  const isEditing = editing === node.id;

  return (
      <div className="relative group" data-org-card={node.id}>
        <div
          className="rounded-xl bg-card border-2 border-primary/30 shadow-md px-3 py-2 w-full text-center hover:border-primary/60 transition-colors"
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
        </div>

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
              onClick={() => onLink(node)}
              className="h-6 w-6 rounded-full bg-card border border-border shadow-sm flex items-center justify-center text-ink-secondary hover:text-primary hover:border-primary"
              title="Also reports to…"
            >
              <Link2 className="h-3 w-3" />
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
  );
}
