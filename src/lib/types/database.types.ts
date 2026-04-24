export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          display_id: string | null
          name: string
          slug: string
          plan: 'free' | 'pro' | 'enterprise'
          owner_id: string
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          postal_code: string | null
          country: string
          phone: string | null
          website: string | null
          logo_url: string | null
          inbound_email_address: string | null
          verified_support_email: string | null
          verified_support_email_confirmed_at: string | null
          ai_listening_enabled: boolean
          cancel_at_period_end: boolean
          current_period_end: string | null
          custom_lead_questions: Json
          signal_engagement_mode: 'ai_draft' | 'manual'
          latitude: number | null
          longitude: number | null
          signal_radius: number | null
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          display_id?: string | null
          name: string
          slug: string
          plan?: 'free' | 'pro' | 'enterprise'
          owner_id: string
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          postal_code?: string | null
          country?: string
          phone?: string | null
          website?: string | null
          logo_url?: string | null
          inbound_email_address?: string | null
          verified_support_email?: string | null
          verified_support_email_confirmed_at?: string | null
          ai_listening_enabled?: boolean
          cancel_at_period_end?: boolean
          current_period_end?: string | null
          custom_lead_questions?: Json
          signal_engagement_mode?: 'ai_draft' | 'manual'
          latitude?: number | null
          longitude?: number | null
          signal_radius?: number | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['organizations']['Insert']>
      }
      profiles: {
        Row: {
          id: string
          organization_id: string | null
          full_name: string | null
          avatar_url: string | null
          role: 'admin' | 'agent' | 'viewer'
          role_id: string | null
          calendar_email: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          organization_id?: string | null
          full_name?: string | null
          avatar_url?: string | null
          role?: 'admin' | 'agent' | 'viewer'
          role_id?: string | null
          calendar_email?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      roles: {
        Row: {
          id: string
          organization_id: string
          name: string
          permissions: Json
          is_system_role: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          permissions?: Json
          is_system_role?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['roles']['Insert']>
      }
      leads: {
        Row: {
          id: string
          display_id: string | null
          organization_id: string
          assigned_to: string | null
          first_name: string
          last_name: string | null
          email: string | null
          phone: string | null
          company: string | null
          status: 'new' | 'contacted' | 'qualified' | 'lost' | 'converted'
          source: 'web' | 'referral' | 'import' | 'manual' | 'other' | 'social_listening' | null
          notes: string | null
          tags: string[] | null
          metadata: Json | null
          converted_at: string | null
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          display_id?: string | null
          organization_id: string
          assigned_to?: string | null
          first_name: string
          last_name?: string | null
          email?: string | null
          phone?: string | null
          company?: string | null
          status?: 'new' | 'contacted' | 'qualified' | 'lost' | 'converted'
          source?: 'web' | 'referral' | 'import' | 'manual' | 'other' | 'social_listening' | null
          notes?: string | null
          tags?: string[] | null
          metadata?: Json | null
          converted_at?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['leads']['Insert']>
      }
      customers: {
        Row: {
          id: string
          display_id: string | null
          organization_id: string
          lead_id: string | null
          first_name: string
          last_name: string | null
          email: string | null
          phone: string | null
          company: string | null
          notes: string | null
          metadata: Json | null
          deleted_at: string | null
          archived_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          display_id?: string | null
          organization_id: string
          lead_id?: string | null
          first_name: string
          last_name?: string | null
          email?: string | null
          phone?: string | null
          company?: string | null
          notes?: string | null
          metadata?: Json | null
          deleted_at?: string | null
          archived_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['customers']['Insert']>
      }
      lead_activities: {
        Row: {
          id: string
          lead_id: string
          user_id: string | null
          content: string
          created_at: string
        }
        Insert: {
          id?: string
          lead_id: string
          user_id?: string | null
          content: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['lead_activities']['Insert']>
      }
      user_dashboard_configs: {
        Row: {
          user_id:         string
          organization_id: string | null
          hidden_widgets:  string[]
          updated_at:      string
        }
        Insert: {
          user_id:          string
          organization_id?: string | null
          hidden_widgets?:  string[]
          updated_at?:      string
        }
        Update: Partial<Database['public']['Tables']['user_dashboard_configs']['Insert']>
      }
      appointments: {
        Row: {
          id: string
          display_id: string | null
          organization_id: string
          lead_id: string | null
          customer_id: string | null
          assigned_to: string | null
          created_by: string
          title: string
          description: string | null
          start_at: string
          end_at: string | null
          status: 'scheduled' | 'completed' | 'cancelled'
          location: string | null
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          display_id?: string | null
          organization_id: string
          lead_id?: string | null
          customer_id?: string | null
          assigned_to?: string | null
          created_by: string
          title: string
          description?: string | null
          start_at: string
          end_at?: string | null
          status?: 'scheduled' | 'completed' | 'cancelled'
          location?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['appointments']['Insert']>
      }
      tickets: {
        Row: {
          id: string
          display_id: string | null
          organization_id: string
          lead_id: string | null
          customer_id: string | null
          assigned_to: string | null
          created_by: string
          subject: string
          description: string | null
          status: 'open' | 'pending' | 'closed'
          priority: 'low' | 'medium' | 'high'
          channel: 'email' | 'chat' | 'phone' | 'portal' | 'manual' | null
          tags: string[] | null
          due_at: string | null
          resolved_at: string | null
          closed_at: string | null
          deleted_at: string | null
          created_at: string
          updated_at: string
          is_platform_support: boolean
          hq_category: 'bug' | 'billing' | 'feature_request' | 'question' | null
          screenshot_url: string | null
          affected_tab: 'dashboard' | 'leads' | 'customers' | 'appointments' | 'tickets' | 'settings' | null
          record_id: string | null
        }
        Insert: {
          id?: string
          display_id?: string | null
          organization_id: string
          lead_id?: string | null
          customer_id?: string | null
          assigned_to?: string | null
          created_by: string
          subject: string
          description?: string | null
          status?: 'open' | 'pending' | 'closed'
          priority?: 'low' | 'medium' | 'high'
          channel?: 'email' | 'chat' | 'phone' | 'portal' | 'manual' | null
          tags?: string[] | null
          due_at?: string | null
          resolved_at?: string | null
          closed_at?: string | null
          deleted_at?: string | null
          created_at?: string
          updated_at?: string
          is_platform_support?: boolean
          hq_category?: 'bug' | 'billing' | 'feature_request' | 'question' | null
          screenshot_url?: string | null
          affected_tab?: 'dashboard' | 'leads' | 'customers' | 'appointments' | 'tickets' | 'settings' | null
          record_id?: string | null
        }
        Update: Partial<Database['public']['Tables']['tickets']['Insert']>
      }
      ticket_messages: {
        Row: {
          id: string
          ticket_id: string
          org_id: string
          sender_id: string | null
          body: string
          type: 'public' | 'internal'
          external_message_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          org_id: string
          sender_id?: string | null
          body: string
          type?: 'public' | 'internal'
          external_message_id?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['ticket_messages']['Insert']>
      }
      platform_settings: {
        Row: {
          key: string
          value: unknown
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          value: unknown
          updated_at?: string
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['platform_settings']['Insert']>
      }
      organization_credits: {
        Row: {
          id: string
          organization_id: string
          balance: number
          auto_top_up_enabled: boolean
          top_up_threshold: number | null
          top_up_amount: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          balance?: number
          auto_top_up_enabled?: boolean
          top_up_threshold?: number | null
          top_up_amount?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['organization_credits']['Insert']>
      }
      pending_signals: {
        Row: {
          id: string
          organization_id: string
          raw_text: string | null
          ai_draft_reply: string | null
          reasoning_snippet: string | null
          intent_score: 1 | 3 | 6 | null
          platform: string | null
          status: 'pending' | 'approved' | 'dismissed'
          external_post_id: string | null
          signal_config_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          raw_text?: string | null
          ai_draft_reply?: string | null
          reasoning_snippet?: string | null
          intent_score?: 1 | 3 | 6 | null
          platform?: string | null
          status?: 'pending' | 'approved' | 'dismissed'
          external_post_id?: string | null
          signal_config_id?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['pending_signals']['Insert']>
      }
      signal_configs: {
        Row: {
          id: string
          organization_id: string
          vertical: string
          center_lat: number | null
          center_long: number | null
          radius_miles: number
          keywords: string[]
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          vertical: string
          center_lat?: number | null
          center_long?: number | null
          radius_miles?: number
          keywords?: string[]
          is_active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['signal_configs']['Insert']>
      }
      verticals: {
        Row: {
          id: string
          label: string
          is_active: boolean
        }
        Insert: {
          id: string
          label: string
          is_active?: boolean
        }
        Update: Partial<Database['public']['Tables']['verticals']['Insert']>
      }
      organization_api_keys: {
        Row: {
          id: string
          organization_id: string
          key_hash: string
          label: string | null
          created_by: string | null
          last_used_at: string | null
          revoked_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          key_hash: string
          label?: string | null
          created_by?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['organization_api_keys']['Insert']>
      }
      credit_ledger: {
        Row: {
          id: string
          organization_id: string
          amount: number
          type: 'signal_deduction' | 'purchase' | 'refund' | 'adjustment'
          reference_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          amount: number
          type: 'signal_deduction' | 'purchase' | 'refund' | 'adjustment'
          reference_id?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['credit_ledger']['Insert']>
      }
    }
    Functions: {
      deduct_credit: {
        Args: { org_id: string; amount: number; ref_id: string }
        Returns: number
      }
    }
  }
}

export type Appointment   = Database['public']['Tables']['appointments']['Row']
export type LeadActivity  = Database['public']['Tables']['lead_activities']['Row']
export type Profile      = Database['public']['Tables']['profiles']['Row']
export type Organization = Database['public']['Tables']['organizations']['Row']
export type Lead         = Database['public']['Tables']['leads']['Row']
export type Customer     = Database['public']['Tables']['customers']['Row']
export type Ticket        = Database['public']['Tables']['tickets']['Row']
export type TicketMessage = Database['public']['Tables']['ticket_messages']['Row']
export type Role          = Database['public']['Tables']['roles']['Row']
export type OrganizationCredits = Database['public']['Tables']['organization_credits']['Row']
export type CreditLedgerEntry   = Database['public']['Tables']['credit_ledger']['Row']
export type OrganizationApiKey  = Database['public']['Tables']['organization_api_keys']['Row']
export type PendingSignal       = Database['public']['Tables']['pending_signals']['Row']
export type SignalConfig        = Database['public']['Tables']['signal_configs']['Row']
export type Vertical            = Database['public']['Tables']['verticals']['Row']
