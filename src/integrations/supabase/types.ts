export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      holidays: {
        Row: {
          created_at: string | null
          created_by: string | null
          date: string
          description: string | null
          id: string
          is_recurring: boolean | null
          title: string
          type: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          date: string
          description?: string | null
          id?: string
          is_recurring?: boolean | null
          title: string
          type?: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          date?: string
          description?: string | null
          id?: string
          is_recurring?: boolean | null
          title?: string
          type?: string
        }
        Relationships: []
      }
      leave_policy: {
        Row: {
          allowed_days: number | null
          id: string
          is_enabled: boolean | null
          leave_type: string
          updated_at: string | null
        }
        Insert: {
          allowed_days?: number | null
          id?: string
          is_enabled?: boolean | null
          leave_type: string
          updated_at?: string | null
        }
        Update: {
          allowed_days?: number | null
          id?: string
          is_enabled?: boolean | null
          leave_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      leave_requests: {
        Row: {
          admin_note: string | null
          created_at: string | null
          employee_id: string
          end_date: string | null
          end_time: string | null
          id: string
          leave_category: string | null
          reason: string
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          start_time: string | null
          status: string | null
          type: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string | null
          employee_id: string
          end_date?: string | null
          end_time?: string | null
          id?: string
          leave_category?: string | null
          reason: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          start_time?: string | null
          status?: string | null
          type: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string | null
          employee_id?: string
          end_date?: string | null
          end_time?: string | null
          id?: string
          leave_category?: string | null
          reason?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          start_time?: string | null
          status?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          id: string
          is_enabled: boolean | null
          pref_key: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          id?: string
          is_enabled?: boolean | null
          pref_key: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          id?: string
          is_enabled?: boolean | null
          pref_key?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string | null
          email_sent: boolean | null
          id: string
          is_read: boolean | null
          reference_id: string | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string | null
          email_sent?: boolean | null
          id?: string
          is_read?: boolean | null
          reference_id?: string | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string | null
          email_sent?: boolean | null
          id?: string
          is_read?: boolean | null
          reference_id?: string | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          created_by: string | null
          department: string | null
          email: string
          full_name: string
          id: string
          is_active: boolean | null
          phone: string | null
          position: string | null
          role: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          email: string
          full_name: string
          id: string
          is_active?: boolean | null
          phone?: string | null
          position?: string | null
          role?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string | null
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean | null
          phone?: string | null
          position?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          assignee_role: string
          created_at: string | null
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          assignee_role?: string
          created_at?: string | null
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          assignee_role?: string
          created_at?: string | null
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_attachments: {
        Row: {
          created_at: string | null
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          task_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string | null
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          task_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string | null
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          task_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          body: string
          created_at: string | null
          id: string
          parent_id: string | null
          task_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string | null
          id?: string
          parent_id?: string | null
          task_id: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string | null
          id?: string
          parent_id?: string | null
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_by: string
          assigned_to: string
          category: string | null
          created_at: string | null
          deadline: string | null
          description: string | null
          id: string
          priority: string | null
          progress: number | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_by: string
          assigned_to: string
          category?: string | null
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          progress?: number | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_by?: string
          assigned_to?: string
          category?: string | null
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          priority?: string | null
          progress?: number | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_meeting_participants: {
        Row: {
          created_at: string | null
          id: string
          joined_at: string | null
          meeting_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          joined_at?: string | null
          meeting_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          joined_at?: string | null
          meeting_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "team_meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      team_meetings: {
        Row: {
          created_at: string | null
          created_by: string
          description: string | null
          duration_minutes: number | null
          id: string
          meeting_link: string | null
          scheduled_at: string
          status: string | null
          title: string
        }
        Insert: {
          created_at?: string | null
          created_by: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          meeting_link?: string | null
          scheduled_at: string
          status?: string | null
          title: string
        }
        Update: {
          created_at?: string | null
          created_by?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          meeting_link?: string | null
          scheduled_at?: string
          status?: string | null
          title?: string
        }
        Relationships: []
      }
      user_notes: {
        Row: {
          content: string
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: { Args: { uid: string }; Returns: string }
      is_admin: { Args: { uid: string }; Returns: boolean }
      is_strict_admin: { Args: { uid: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
