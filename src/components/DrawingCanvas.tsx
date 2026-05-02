import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, Pencil, Trash2, Undo2, Download } from "lucide-react";
import { cn } from "@/lib/utils";

export type Stroke = {
  color: string;
  size: number;
  points: { x: number; y: number }[];
};

type Props = {
  value: Stroke[];
  onChange: (strokes: Stroke[]) => void;
};

const COLORS = ["#1f2937", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];
const SIZES = [2, 4, 6, 10, 16];

export default function DrawingCanvas({ value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const currentStroke = useRef<Stroke | null>(null);
  const [color, setColor] = useState("#1f2937");
  const [size, setSize] = useState(4);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [dims, setDims] = useState({ w: 800, h: 500 });

  // Resize observer to keep canvas responsive
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setDims({ w: Math.max(300, Math.floor(width)), h: Math.max(300, Math.floor(height)) });
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of value) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
  }, [value]);

  useEffect(() => {
    redraw();
  }, [redraw, dims]);

  const getPoint = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pt = getPoint(e);
    currentStroke.current = {
      color: tool === "eraser" ? "#ffffff" : color,
      size: tool === "eraser" ? size * 3 : size,
      points: [pt],
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current || !currentStroke.current) return;
    const pt = getPoint(e);
    currentStroke.current.points.push(pt);
    // Live draw the segment without re-rendering all strokes
    const ctx = canvasRef.current!.getContext("2d");
    if (!ctx) return;
    const pts = currentStroke.current.points;
    ctx.strokeStyle = currentStroke.current.color;
    ctx.lineWidth = currentStroke.current.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    if (!drawingRef.current || !currentStroke.current) return;
    drawingRef.current = false;
    if (currentStroke.current.points.length > 0) {
      onChange([...value, currentStroke.current]);
    }
    currentStroke.current = null;
  };

  const undo = () => onChange(value.slice(0, -1));
  const clear = () => onChange([]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Composite onto a white background for export
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const ctx = tmp.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(canvas, 0, 0);
    const a = document.createElement("a");
    a.href = tmp.toDataURL("image/png");
    a.download = `drawing-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setTool("pen")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
              tool === "pen" ? "bg-primary text-primary-foreground" : "text-ink-secondary hover:bg-muted"
            )}
          >
            <Pencil className="h-3.5 w-3.5" /> Pen
          </button>
          <button
            type="button"
            onClick={() => setTool("eraser")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
              tool === "eraser" ? "bg-primary text-primary-foreground" : "text-ink-secondary hover:bg-muted"
            )}
          >
            <Eraser className="h-3.5 w-3.5" /> Eraser
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setColor(c);
                setTool("pen");
              }}
              className={cn(
                "h-6 w-6 rounded-full border-2 transition-transform",
                color === c && tool === "pen" ? "border-ink-primary scale-110" : "border-border"
              )}
              style={{ backgroundColor: c }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              className={cn(
                "h-7 w-7 rounded-full border flex items-center justify-center transition-colors",
                size === s ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
              )}
              aria-label={`Size ${s}`}
            >
              <span
                className="rounded-full bg-ink-primary"
                style={{ width: Math.min(s, 14), height: Math.min(s, 14) }}
              />
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={undo} disabled={value.length === 0} className="gap-1 h-8">
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </Button>
          <Button variant="ghost" size="sm" onClick={download} disabled={value.length === 0} className="gap-1 h-8">
            <Download className="h-3.5 w-3.5" /> PNG
          </Button>
          <Button variant="ghost" size="sm" onClick={clear} disabled={value.length === 0} className="gap-1 h-8 text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} className="flex-1 min-h-0 bg-white relative overflow-hidden">
        <canvas
          ref={canvasRef}
          width={dims.w}
          height={dims.h}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="touch-none cursor-crosshair block"
          style={{ width: dims.w, height: dims.h }}
        />
      </div>
    </div>
  );
}
