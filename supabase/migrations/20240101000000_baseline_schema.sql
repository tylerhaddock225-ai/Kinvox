


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."internal_role" AS ENUM (
    'platform_owner',
    'platform_support',
    'platform_admin',
    'platform_sales',
    'platform_accounting'
);


ALTER TYPE "public"."internal_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_appointment_display_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.display_id is null then
    new.display_id := 'ap_' || nextval('public.appointments_display_seq');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_appointment_display_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_lead_display_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.display_id is null then
    new.display_id := 'ld_' || nextval('public.leads_display_seq');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_lead_display_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_organization_display_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.display_id is null then
    new.display_id := 'org_' || nextval('public.organizations_display_seq');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_organization_display_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_ticket_display_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  prefix text;
begin
  if new.display_id is null then
    select coalesce(value #>> '{}', 'tk_')
      into prefix
      from public.platform_settings
     where key = 'ticket_id_prefix';

    new.display_id := coalesce(prefix, 'tk_') || nextval('public.tickets_display_seq');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_ticket_display_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_user_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select organization_id from profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."auth_user_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."auth_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auth_user_view_leads"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select coalesce(
    (
      select (r.permissions->>'view_leads')::boolean
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.id = auth.uid()
    ),
    true
  )
$$;


ALTER FUNCTION "public"."auth_user_view_leads"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_invited_org"() RETURNS TABLE("org_id" "uuid", "org_name" "text", "org_slug" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select o.id, o.name, o.slug
    from auth.users u
    join public.organizations o
      on o.id = (u.raw_user_meta_data ->> 'invited_to_org')::uuid
     and o.deleted_at is null
   where u.id = auth.uid()
$$;


ALTER FUNCTION "public"."current_user_invited_org"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_profile_role_scope"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_role_org uuid;
begin
  if new.role_id is null then
    return new;
  end if;

  select organization_id into v_role_org
    from public.roles where id = new.role_id;

  -- HQ staff: role must be HQ-global (NULL org).
  if new.system_role is not null and v_role_org is not null then
    raise exception 'HQ staff (system_role=%) cannot be assigned a tenant-scoped role', new.system_role;
  end if;

  -- Tenant member: role must match their own org.
  if new.system_role is null and v_role_org is null then
    raise exception 'Tenant member cannot be assigned an HQ-global role';
  end if;

  if new.system_role is null
     and v_role_org is not null
     and v_role_org is distinct from new.organization_id then
    raise exception 'Role % belongs to a different organization than profile %', new.role_id, new.id;
  end if;

  return new;
end
$$;


ALTER FUNCTION "public"."enforce_profile_role_scope"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_invited_org_membership"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id    uuid := auth.uid();
  v_invited_to uuid;
  v_slug       text;
  v_current    uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select (raw_user_meta_data ->> 'invited_to_org')::uuid
    into v_invited_to
    from auth.users
   where id = v_user_id;

  if v_invited_to is null then
    raise exception 'No invitation found for this account';
  end if;

  select slug into v_slug
    from public.organizations
   where id = v_invited_to
     and deleted_at is null;

  if v_slug is null then
    raise exception 'Invited organization no longer exists';
  end if;

  select organization_id into v_current
    from public.profiles
   where id = v_user_id;

  -- Idempotent: re-accepting the same invite just returns the slug.
  if v_current = v_invited_to then
    return v_slug;
  end if;

  if v_current is not null then
    raise exception 'User already belongs to a different organization';
  end if;

  update public.profiles
     set organization_id = v_invited_to
   where id = v_user_id;

  return v_slug;
end
$$;


ALTER FUNCTION "public"."finalize_invited_org_membership"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_support_stats"("p_org_id" "uuid") RETURNS TABLE("open_count" bigint, "closed_week" bigint, "avg_hours" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select
    -- All non-closed, non-deleted tickets
    (
      select count(*)
      from   public.tickets
      where  organization_id = p_org_id
        and  status         != 'closed'
        and  deleted_at      is null
    ) as open_count,

    -- Tickets closed in the last 7 days
    (
      select count(*)
      from   public.tickets
      where  organization_id = p_org_id
        and  status          = 'closed'
        and  updated_at     >= now() - interval '7 days'
    ) as closed_week,

    -- Average resolution time (resolved_at - created_at) in hours, 1 decimal
    (
      select round(
        extract(epoch from avg(resolved_at - created_at)) / 3600.0,
        1
      )
      from   public.tickets
      where  organization_id = p_org_id
        and  resolved_at     is not null
        and  status          in ('resolved', 'closed')
    ) as avg_hours
$$;


ALTER FUNCTION "public"."get_support_stats"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"("user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.profiles where id = user_id;
$$;


ALTER FUNCTION "public"."get_user_role"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_hq"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and system_role is not null
  )
$$;


ALTER FUNCTION "public"."is_admin_hq"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "assigned_to" "uuid",
    "created_by" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "location" "text",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_id" "text",
    "customer_id" "uuid",
    CONSTRAINT "appointments_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."appointments_display_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."appointments_display_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_activities" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."customers_display_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."customers_display_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "display_id" "text" DEFAULT ('cu_'::"text" || ("nextval"('"public"."customers_display_seq"'::"regclass"))::"text") NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "first_name" "text" NOT NULL,
    "last_name" "text",
    "email" "text",
    "phone" "text",
    "company" "text",
    "notes" "text",
    "metadata" "jsonb",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "archived_at" timestamp with time zone
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "assigned_to" "uuid",
    "first_name" "text" NOT NULL,
    "last_name" "text",
    "email" "text",
    "phone" "text",
    "company" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "source" "text",
    "notes" "text",
    "tags" "text"[],
    "metadata" "jsonb",
    "converted_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_id" "text",
    CONSTRAINT "leads_source_check" CHECK (("source" = ANY (ARRAY['web'::"text", 'referral'::"text", 'import'::"text", 'manual'::"text", 'other'::"text"]))),
    CONSTRAINT "leads_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'contacted'::"text", 'qualified'::"text", 'lost'::"text", 'converted'::"text"])))
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."leads_display_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."leads_display_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "state" "text",
    "postal_code" "text",
    "country" "text" DEFAULT 'US'::"text" NOT NULL,
    "phone" "text",
    "website" "text",
    "logo_url" "text",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "inbound_email_address" "text",
    "verified_support_email" "text",
    "verified_support_email_confirmed_at" timestamp with time zone,
    "vertical" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "display_id" "text",
    CONSTRAINT "organizations_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'pro'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."organizations_display_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."organizations_display_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."password_reset_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."password_reset_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."platform_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "full_name" "text",
    "avatar_url" "text",
    "role" "text" DEFAULT 'agent'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "role_id" "uuid",
    "calendar_email" "text",
    "system_role" "public"."internal_role",
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'agent'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid",
    "name" "text" NOT NULL,
    "permissions" "jsonb" DEFAULT '{"edit_leads": true, "view_leads": true, "manage_team": false, "edit_tickets": true, "view_tickets": true, "view_appointments": true}'::"jsonb" NOT NULL,
    "is_system_role" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ticket_id" "uuid" NOT NULL,
    "sender_id" "uuid",
    "body" "text" NOT NULL,
    "type" "text" DEFAULT 'public'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "external_message_id" "text",
    CONSTRAINT "ticket_messages_type_check" CHECK (("type" = ANY (ARRAY['public'::"text", 'internal'::"text"])))
);


ALTER TABLE "public"."ticket_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "lead_id" "uuid",
    "assigned_to" "uuid",
    "created_by" "uuid" NOT NULL,
    "subject" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "channel" "text",
    "tags" "text"[],
    "due_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_id" "text",
    "customer_id" "uuid",
    "is_platform_support" boolean DEFAULT false NOT NULL,
    "hq_category" "text",
    "screenshot_url" "text",
    "affected_tab" "text",
    "record_id" "text",
    CONSTRAINT "tickets_affected_tab_check" CHECK ((("affected_tab" IS NULL) OR ("affected_tab" = ANY (ARRAY['dashboard'::"text", 'leads'::"text", 'customers'::"text", 'appointments'::"text", 'tickets'::"text", 'settings'::"text"])))),
    CONSTRAINT "tickets_channel_check" CHECK (("channel" = ANY (ARRAY['email'::"text", 'chat'::"text", 'phone'::"text", 'portal'::"text", 'manual'::"text"]))),
    CONSTRAINT "tickets_hq_category_check" CHECK ((("hq_category" IS NULL) OR ("hq_category" = ANY (ARRAY['bug'::"text", 'billing'::"text", 'feature_request'::"text", 'question'::"text"])))),
    CONSTRAINT "tickets_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "tickets_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'pending'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."tickets" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."tickets_display_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."tickets_display_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_dashboard_configs" (
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid",
    "hidden_widgets" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_dashboard_configs" OWNER TO "postgres";


ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_activities"
    ADD CONSTRAINT "customer_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_activities"
    ADD CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_dashboard_configs"
    ADD CONSTRAINT "user_dashboard_configs_pkey" PRIMARY KEY ("user_id");



CREATE INDEX "appointments_customer_idx" ON "public"."appointments" USING "btree" ("customer_id");



CREATE UNIQUE INDEX "appointments_display_id_unique" ON "public"."appointments" USING "btree" ("display_id");



CREATE INDEX "appointments_org_start_idx" ON "public"."appointments" USING "btree" ("organization_id", "start_at");



CREATE INDEX "customer_activities_created_idx" ON "public"."customer_activities" USING "btree" ("created_at" DESC);



CREATE INDEX "customer_activities_customer_idx" ON "public"."customer_activities" USING "btree" ("customer_id");



CREATE INDEX "customers_archived_at_idx" ON "public"."customers" USING "btree" ("organization_id") WHERE (("archived_at" IS NULL) AND ("deleted_at" IS NULL));



CREATE UNIQUE INDEX "customers_display_id_unique" ON "public"."customers" USING "btree" ("display_id");



CREATE UNIQUE INDEX "customers_lead_unique" ON "public"."customers" USING "btree" ("lead_id") WHERE ("lead_id" IS NOT NULL);



CREATE UNIQUE INDEX "customers_org_email_unique" ON "public"."customers" USING "btree" ("organization_id", "lower"("email")) WHERE (("deleted_at" IS NULL) AND ("email" IS NOT NULL));



CREATE INDEX "customers_org_idx" ON "public"."customers" USING "btree" ("organization_id");



CREATE INDEX "lead_activities_lead_created_idx" ON "public"."lead_activities" USING "btree" ("lead_id", "created_at" DESC);



CREATE UNIQUE INDEX "leads_display_id_unique" ON "public"."leads" USING "btree" ("display_id");



CREATE UNIQUE INDEX "leads_org_email_unique" ON "public"."leads" USING "btree" ("organization_id", "email") WHERE (("deleted_at" IS NULL) AND ("email" IS NOT NULL));



CREATE INDEX "leads_org_status_idx" ON "public"."leads" USING "btree" ("organization_id", "status");



CREATE UNIQUE INDEX "organizations_display_id_unique" ON "public"."organizations" USING "btree" ("display_id");



CREATE UNIQUE INDEX "organizations_inbound_email_unique" ON "public"."organizations" USING "btree" ("lower"("inbound_email_address")) WHERE ("inbound_email_address" IS NOT NULL);



CREATE UNIQUE INDEX "password_reset_tokens_hash_idx" ON "public"."password_reset_tokens" USING "btree" ("token_hash");



CREATE INDEX "password_reset_tokens_user_idx" ON "public"."password_reset_tokens" USING "btree" ("user_id", "expires_at" DESC);



CREATE INDEX "profiles_org_idx" ON "public"."profiles" USING "btree" ("organization_id");



CREATE INDEX "profiles_role_idx" ON "public"."profiles" USING "btree" ("role_id");



CREATE UNIQUE INDEX "roles_hq_name_unique" ON "public"."roles" USING "btree" ("name") WHERE ("organization_id" IS NULL);



CREATE INDEX "roles_org_idx" ON "public"."roles" USING "btree" ("organization_id");



CREATE UNIQUE INDEX "roles_tenant_name_unique" ON "public"."roles" USING "btree" ("organization_id", "name") WHERE ("organization_id" IS NOT NULL);



CREATE UNIQUE INDEX "ticket_messages_external_id_unique" ON "public"."ticket_messages" USING "btree" ("org_id", "external_message_id") WHERE ("external_message_id" IS NOT NULL);



CREATE INDEX "ticket_messages_org_idx" ON "public"."ticket_messages" USING "btree" ("org_id");



CREATE INDEX "ticket_messages_ticket_created_idx" ON "public"."ticket_messages" USING "btree" ("ticket_id", "created_at");



CREATE INDEX "tickets_customer_idx" ON "public"."tickets" USING "btree" ("customer_id");



CREATE UNIQUE INDEX "tickets_display_id_unique" ON "public"."tickets" USING "btree" ("display_id");



CREATE INDEX "tickets_org_status_priority_idx" ON "public"."tickets" USING "btree" ("organization_id", "status", "priority");



CREATE INDEX "tickets_platform_support_created_at_idx" ON "public"."tickets" USING "btree" ("created_at" DESC) WHERE ("is_platform_support" = true);



CREATE OR REPLACE TRIGGER "assign_appointment_display_id" BEFORE INSERT ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."assign_appointment_display_id"();



CREATE OR REPLACE TRIGGER "assign_lead_display_id" BEFORE INSERT ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."assign_lead_display_id"();



CREATE OR REPLACE TRIGGER "assign_organization_display_id" BEFORE INSERT ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."assign_organization_display_id"();



CREATE OR REPLACE TRIGGER "assign_ticket_display_id" BEFORE INSERT ON "public"."tickets" FOR EACH ROW EXECUTE FUNCTION "public"."assign_ticket_display_id"();



CREATE OR REPLACE TRIGGER "enforce_profile_role_scope" BEFORE INSERT OR UPDATE OF "role_id", "system_role", "organization_id" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_profile_role_scope"();



CREATE OR REPLACE TRIGGER "set_appointments_updated_at" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_customers_updated_at" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_leads_updated_at" BEFORE UPDATE ON "public"."leads" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_organizations_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_tickets_updated_at" BEFORE UPDATE ON "public"."tickets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_user_dashboard_configs_updated_at" BEFORE UPDATE ON "public"."user_dashboard_configs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_activities"
    ADD CONSTRAINT "customer_activities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_activities"
    ADD CONSTRAINT "customer_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_activities"
    ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_activities"
    ADD CONSTRAINT "lead_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."platform_settings"
    ADD CONSTRAINT "platform_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ticket_messages"
    ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_dashboard_configs"
    ADD CONSTRAINT "user_dashboard_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_dashboard_configs"
    ADD CONSTRAINT "user_dashboard_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can delete appointments" ON "public"."appointments" FOR DELETE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete customers" ON "public"."customers" FOR DELETE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can delete tickets" ON "public"."tickets" FOR DELETE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update organizations" ON "public"."organizations" FOR UPDATE TO "authenticated" USING (("public"."is_admin_hq"() OR (("id" = "public"."auth_user_org_id"()) AND ("public"."auth_user_role"() = 'admin'::"text")))) WITH CHECK (("public"."is_admin_hq"() OR (("id" = "public"."auth_user_org_id"()) AND ("public"."auth_user_role"() = 'admin'::"text"))));



CREATE POLICY "Admins can view all" ON "public"."appointments" FOR SELECT TO "authenticated" USING (("public"."is_admin_hq"() OR ("organization_id" = "public"."auth_user_org_id"())));



CREATE POLICY "Admins can view all" ON "public"."customers" FOR SELECT TO "authenticated" USING (("public"."is_admin_hq"() OR ("organization_id" = "public"."auth_user_org_id"())));



CREATE POLICY "Admins can view all" ON "public"."lead_activities" FOR SELECT TO "authenticated" USING (("public"."is_admin_hq"() OR ("lead_id" IN ( SELECT "l"."id"
   FROM "public"."leads" "l"
  WHERE ("l"."organization_id" = "public"."auth_user_org_id"())))));



CREATE POLICY "Admins can view all" ON "public"."leads" FOR SELECT TO "authenticated" USING (("public"."is_admin_hq"() OR ("organization_id" = "public"."auth_user_org_id"())));



CREATE POLICY "Admins can view all" ON "public"."organizations" FOR SELECT TO "authenticated" USING (("public"."is_admin_hq"() OR ("id" = "public"."auth_user_org_id"()) OR ("owner_id" = "auth"."uid"())));



CREATE POLICY "Admins can view all" ON "public"."ticket_messages" FOR SELECT TO "authenticated" USING (("public"."is_admin_hq"() OR ("org_id" = "public"."auth_user_org_id"())));



CREATE POLICY "Admins can view all" ON "public"."tickets" FOR SELECT TO "authenticated" USING (("public"."is_admin_hq"() OR ("organization_id" = "public"."auth_user_org_id"())));



CREATE POLICY "Authenticated can read platform_settings" ON "public"."platform_settings" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Authors can delete their own lead activities" ON "public"."lead_activities" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Authors can delete their own ticket messages" ON "public"."ticket_messages" FOR DELETE USING (("sender_id" = "auth"."uid"()));



CREATE POLICY "HQ admins can insert ticket messages" ON "public"."ticket_messages" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin_hq"() AND ("sender_id" = "auth"."uid"())));



CREATE POLICY "HQ admins can update tickets" ON "public"."tickets" FOR UPDATE TO "authenticated" USING ("public"."is_admin_hq"()) WITH CHECK ("public"."is_admin_hq"());



CREATE POLICY "HQ admins can write platform_settings" ON "public"."platform_settings" TO "authenticated" USING ("public"."is_admin_hq"()) WITH CHECK ("public"."is_admin_hq"());



CREATE POLICY "HQ staff can view all roles" ON "public"."roles" FOR SELECT USING ("public"."is_admin_hq"());



CREATE POLICY "HQ staff manage HQ roles" ON "public"."roles" USING ((("organization_id" IS NULL) AND "public"."is_admin_hq"())) WITH CHECK ((("organization_id" IS NULL) AND "public"."is_admin_hq"()));



CREATE POLICY "Org members can insert appointments" ON "public"."appointments" FOR INSERT WITH CHECK (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "Org members can insert customers" ON "public"."customers" FOR INSERT WITH CHECK (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "Org members can insert lead activities" ON "public"."lead_activities" FOR INSERT WITH CHECK ((("user_id" = "auth"."uid"()) AND ("lead_id" IN ( SELECT "l"."id"
   FROM "public"."leads" "l"
  WHERE ("l"."organization_id" IN ( SELECT "profiles"."organization_id"
           FROM "public"."profiles"
          WHERE ("profiles"."id" = "auth"."uid"())))))));



CREATE POLICY "Org members can insert ticket messages" ON "public"."ticket_messages" FOR INSERT WITH CHECK ((("sender_id" = "auth"."uid"()) AND ("org_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())))));



CREATE POLICY "Org members can insert tickets" ON "public"."tickets" FOR INSERT WITH CHECK (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "Org members can update appointments" ON "public"."appointments" FOR UPDATE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "Org members can update customers" ON "public"."customers" FOR UPDATE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "Org members can update tickets" ON "public"."tickets" FOR UPDATE USING (("organization_id" IN ( SELECT "profiles"."organization_id"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "Org members can view tenant roles" ON "public"."roles" FOR SELECT USING ((("organization_id" IS NOT NULL) AND ("organization_id" = "public"."auth_user_org_id"())));



CREATE POLICY "Tenant admins manage tenant roles" ON "public"."roles" USING ((("organization_id" IS NOT NULL) AND ("organization_id" = "public"."auth_user_org_id"()) AND ("public"."auth_user_role"() = 'admin'::"text"))) WITH CHECK ((("organization_id" IS NOT NULL) AND ("organization_id" = "public"."auth_user_org_id"()) AND ("public"."auth_user_role"() = 'admin'::"text")));



CREATE POLICY "Users manage own dashboard config" ON "public"."user_dashboard_configs" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_activities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customer_activities: insert" ON "public"."customer_activities" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("customer_id" IN ( SELECT "c"."id"
   FROM "public"."customers" "c"
  WHERE ("c"."organization_id" = "public"."auth_user_org_id"())))));



CREATE POLICY "customer_activities: read" ON "public"."customer_activities" FOR SELECT TO "authenticated" USING (("public"."is_admin_hq"() OR ("customer_id" IN ( SELECT "c"."id"
   FROM "public"."customers" "c"
  WHERE ("c"."organization_id" = "public"."auth_user_org_id"())))));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads: delete admin only" ON "public"."leads" FOR DELETE USING ((("organization_id" = "public"."auth_user_org_id"()) AND ("public"."auth_user_role"() = 'admin'::"text")));



CREATE POLICY "leads: insert own org" ON "public"."leads" FOR INSERT WITH CHECK (("organization_id" = "public"."auth_user_org_id"()));



CREATE POLICY "leads: select own org" ON "public"."leads" FOR SELECT USING (("organization_id" = "public"."auth_user_org_id"()));



CREATE POLICY "leads: update own org" ON "public"."leads" FOR UPDATE USING (("organization_id" = "public"."auth_user_org_id"()));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."password_reset_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles: select own" ON "public"."profiles" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "profiles: select same org" ON "public"."profiles" FOR SELECT USING (("organization_id" = "public"."auth_user_org_id"()));



CREATE POLICY "profiles: update own" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticket_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tickets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tickets: delete admin only" ON "public"."tickets" FOR DELETE USING ((("organization_id" = "public"."auth_user_org_id"()) AND ("public"."auth_user_role"() = 'admin'::"text")));



CREATE POLICY "tickets: insert own org" ON "public"."tickets" FOR INSERT WITH CHECK (("organization_id" = "public"."auth_user_org_id"()));



CREATE POLICY "tickets: update own org" ON "public"."tickets" FOR UPDATE USING (("organization_id" = "public"."auth_user_org_id"()));



ALTER TABLE "public"."user_dashboard_configs" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."assign_appointment_display_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_appointment_display_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_appointment_display_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_lead_display_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_lead_display_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_lead_display_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_organization_display_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_organization_display_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_organization_display_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_ticket_display_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_ticket_display_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_ticket_display_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_user_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_user_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_user_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."auth_user_view_leads"() TO "anon";
GRANT ALL ON FUNCTION "public"."auth_user_view_leads"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."auth_user_view_leads"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_invited_org"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_invited_org"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_invited_org"() TO "service_role";



GRANT ALL ON FUNCTION "public"."enforce_profile_role_scope"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_profile_role_scope"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_profile_role_scope"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_invited_org_membership"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_invited_org_membership"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_invited_org_membership"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_support_stats"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_support_stats"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_support_stats"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_role"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_role"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"("user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_hq"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_hq"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_hq"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."appointments_display_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."appointments_display_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."appointments_display_seq" TO "service_role";



GRANT ALL ON TABLE "public"."customer_activities" TO "anon";
GRANT ALL ON TABLE "public"."customer_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_activities" TO "service_role";



GRANT ALL ON SEQUENCE "public"."customers_display_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."customers_display_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."customers_display_seq" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."lead_activities" TO "anon";
GRANT ALL ON TABLE "public"."lead_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_activities" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON SEQUENCE "public"."leads_display_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."leads_display_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."leads_display_seq" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."organizations_display_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."organizations_display_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."organizations_display_seq" TO "service_role";



GRANT ALL ON TABLE "public"."password_reset_tokens" TO "anon";
GRANT ALL ON TABLE "public"."password_reset_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."password_reset_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."platform_settings" TO "anon";
GRANT ALL ON TABLE "public"."platform_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_settings" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_messages" TO "anon";
GRANT ALL ON TABLE "public"."ticket_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_messages" TO "service_role";



GRANT ALL ON TABLE "public"."tickets" TO "anon";
GRANT ALL ON TABLE "public"."tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."tickets" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tickets_display_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tickets_display_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tickets_display_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_dashboard_configs" TO "anon";
GRANT ALL ON TABLE "public"."user_dashboard_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_dashboard_configs" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


