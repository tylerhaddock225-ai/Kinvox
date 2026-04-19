export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
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
          deleted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
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
          source: 'web' | 'referral' | 'import' | 'manual' | 'other' | null
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
          source?: 'web' | 'referral' | 'import' | 'manual' | 'other' | null
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
