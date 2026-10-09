export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          username: string
          name: string
          photo_url: string | null
          calorie_goal: number | null
          protein_goal: number | null
          privacy_default: 'public' | 'private'
          streak_count: number
          streak_last_log_date: string | null
          reminder_time: string | null
          created_at: string
          /** Migration 0013 — may be absent until it runs. */
          height_cm?: number | null
          target_weight_kg?: number | null
          water_goal_ml?: number | null
          water_glass_ml?: number | null
        }
        Insert: {
          id: string
          username: string
          name: string
          photo_url?: string | null
          calorie_goal?: number | null
          protein_goal?: number | null
          privacy_default?: 'public' | 'private'
        }
        Update: {
          id?: string
          username?: string
          name?: string
          photo_url?: string | null
          calorie_goal?: number | null
          protein_goal?: number | null
          privacy_default?: 'public' | 'private'
          streak_count?: number
          streak_last_log_date?: string | null
          reminder_time?: string | null
          height_cm?: number | null
          target_weight_kg?: number | null
          water_goal_ml?: number | null
          water_glass_ml?: number | null
        }
        Relationships: []
      }
      challenges: {
        Row: { id: string; creator_id: string; type: 'protein' | 'on_target' | 'log_daily' | 'hydration'; name: string; starts_on: string; ends_on: string; created_at: string }
        Insert: { creator_id: string; type: 'protein' | 'on_target' | 'log_daily' | 'hydration'; name: string; starts_on: string; ends_on: string }
        Update: never
        Relationships: []
      }
      challenge_members: {
        Row: { challenge_id: string; user_id: string; status: 'invited' | 'joined' | 'declined'; created_at: string }
        Insert: { challenge_id: string; user_id: string; status?: 'invited' | 'joined' | 'declined' }
        Update: { status?: 'invited' | 'joined' | 'declined' }
        Relationships: []
      }
      water_logs: {
        Row: { user_id: string; logged_on: string; ml: number; updated_at: string }
        Insert: { user_id: string; logged_on?: string; ml: number; updated_at?: string }
        Update: { ml?: number; updated_at?: string }
        Relationships: []
      }
      weight_logs: {
        Row: {
          id: string
          user_id: string
          weight_kg: number
          logged_on: string
          created_at: string
        }
        Insert: { user_id: string; weight_kg: number; logged_on?: string }
        Update: { weight_kg?: number }
        Relationships: []
      }
      friendships: {
        Row: {
          id: string
          requester_id: string
          recipient_id: string
          status: 'pending' | 'accepted'
          created_at: string
        }
        Insert: {
          requester_id: string
          recipient_id: string
        }
        Update: {
          status?: 'pending' | 'accepted'
        }
        Relationships: []
      }
      logs: {
        Row: {
          id: string
          user_id: string
          photo_url: string | null
          name: string | null
          description: string | null
          caption: string | null
          satiety: 'loved_it' | 'good' | 'okay' | 'not_great' | null
          meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
          visibility: 'public' | 'private'
          calories_estimate: number | null
          calories_final: number | null
          protein_estimate_g: number | null
          protein_final_g: number | null
          carbs_estimate_g: number | null
          carbs_final_g: number | null
          fat_estimate_g: number | null
          fat_final_g: number | null
          ai_confidence: 'low' | 'medium' | 'high' | null
          ai_raw_response: unknown
          created_at: string
          /** Set when the owner first shares a public link (migration 0012). */
          shared_at?: string | null
          /** The items as posted, after the user's edits (migration 0018). */
          items?: unknown
        }
        Insert: Partial<Database['public']['Tables']['logs']['Row']> & {
          user_id: string
          meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
          visibility: 'public' | 'private'
        }
        Update: Partial<Database['public']['Tables']['logs']['Row']>
        Relationships: []
      }
      comment_likes: {
        Row: {
          id: string
          comment_id: string
          user_id: string
          created_at: string
        }
        Insert: { comment_id: string; user_id: string; id?: string; created_at?: string }
        Update: Partial<Database['public']['Tables']['comment_likes']['Row']>
        Relationships: []
      }
      rewards: {
        Row: {
          id: string
          partner_name: string
          offer_description: string
          milestone_required: number
          expiry_date: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      redemptions: {
        Row: {
          id: string
          user_id: string
          reward_id: string
          code: string
          status: 'unredeemed' | 'redeemed' | 'expired'
          redeemed_at: string
        }
        Insert: {
          user_id: string
          reward_id: string
          code: string
        }
        Update: never
        Relationships: []
      }
      log_likes: {
        Row: {
          id: string
          log_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          log_id: string
          user_id: string
        }
        Update: never
        Relationships: []
      }
      log_comments: {
        Row: {
          id: string
          log_id: string
          user_id: string
          parent_comment_id: string | null
          body: string
          created_at: string
        }
        Insert: {
          log_id: string
          user_id: string
          parent_comment_id?: string | null
          body: string
        }
        Update: never
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          recipient_id: string
          actor_id: string
          log_id: string
          type: 'like' | 'comment' | 'reply'
          comment_id: string | null
          read_at: string | null
          created_at: string
        }
        Insert: {
          recipient_id: string
          actor_id: string
          log_id: string
          type: 'like' | 'comment' | 'reply'
          comment_id?: string | null
        }
        Update: {
          read_at?: string | null
        }
        Relationships: []
      }
      blocks: {
        Row: {
          blocker_id: string
          blocked_id: string
          created_at: string
        }
        Insert: {
          blocker_id: string
          blocked_id: string
        }
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}
