import { useState, useRef } from "react";
import { Camera, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  size?: "lg" | "xl";
  className?: string;
};

export default function AvatarUpload({ size = "xl", className }: Props) {
  const { profile, user, refreshProfile } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2MB");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);

      const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id);
      if (updateError) throw updateError;

      await refreshProfile();
      toast.success("Profile photo updated");
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user || !profile?.avatar_url) return;

    setRemoving(true);
    try {
      // Remove from storage (best-effort, ignore errors if file doesn't exist)
      const { data: files } = await supabase.storage.from("avatars").list(user.id);
      if (files?.length) {
        await supabase.storage.from("avatars").remove(files.map(f => `${user.id}/${f.name}`));
      }

      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("id", user.id);
      if (error) throw error;

      await refreshProfile();
      toast.success("Profile photo removed");
    } catch (err: any) {
      toast.error(err.message ?? "Remove failed");
    } finally {
      setRemoving(false);
    }
  };

  const busy = uploading || removing;

  return (
    <div className={cn("relative group", className)}>
      <div className="cursor-pointer" onClick={() => inputRef.current?.click()}>
        <UserAvatar
          name={profile?.full_name ?? ""}
          avatarUrl={profile?.avatar_url}
          size={size}
        />
        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-ink-primary/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <Camera className="h-5 w-5 text-white" />
        </div>
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-ink-primary/60">
            <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {profile?.avatar_url && !busy && (
        <button
          onClick={handleRemove}
          className="absolute -bottom-1 -right-1 h-6 w-6 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/90"
          title="Remove photo"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  );
}
