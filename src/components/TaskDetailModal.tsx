import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import StatusBadge from "@/components/StatusBadge";
import PriorityBadge from "@/components/PriorityBadge";
import UserAvatar from "@/components/UserAvatar";

export default function TaskDetailModal({ task, onClose }: { task: any; onClose: () => void }) {
  const { user } = useAuth();

  if (!task) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center">
        
        {/* BACKDROP */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* MODAL */}
        <motion.div
          onClick={(e) => e.stopPropagation()} // ✅ FIX: prevents closing when clicking inside
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-[600px] bg-white rounded-xl shadow-xl p-6 mx-4 z-[10000]"
        >
          
          {/* HEADER */}
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">{task.title}</h2>
            <button onClick={onClose}>
              <X />
            </button>
          </div>

          {/* BADGES */}
          <div className="flex gap-2 mb-4">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>

          {/* DESCRIPTION */}
          <p className="text-gray-600 mb-4">
            {task.description || "No description"}
          </p>

          {/* ASSIGNEES */}
          <div className="mb-4">
            <p className="text-sm font-semibold mb-2">Assigned to</p>
            <div className="flex gap-2">
              {task.task_assignees?.map((a: any) => (
                <div key={a.user_id} className="flex items-center gap-2">
                  <UserAvatar
                    name={a.user?.full_name}
                    avatarUrl={a.user?.avatar_url}
                    size="sm"
                  />
                  <span className="text-sm">{a.user?.full_name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* DEADLINE */}
          <div>
            <p className="text-sm font-semibold">Deadline</p>
            <p className="text-sm text-gray-500">
              {task.deadline
                ? format(new Date(task.deadline), "MMM d, yyyy")
                : "No deadline"}
            </p>
          </div>

        </motion.div>
      </div>
    </AnimatePresence>
  );
}
