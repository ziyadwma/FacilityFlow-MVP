// lib/supabaseAdapter.ts
// Supabase adapter for FacilityFlow MVP (v1)
// Assumes you've created tables/policies from the provided SQL.
// Env vars (set in Vercel/Next):
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY

import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!SUPABASE_URL || !SUPABASE_ANON) {
  // Fail fast in dev; in prod this helps pinpoint missing envs
  console.warn('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ---------- Types (mirror the SQL) ----------

export type Role =
  | 'Operations Management'
  | 'Kitchen team'
  | 'Customer service team'
  | 'Marketing team'
  | 'Procurement team'
  | 'Facility team'
  | 'Finance team'
  | 'IT team'
  | 'Cleaning team'
  | 'Technicians'
  | 'Packaging team'
  | 'Logistics team';

export type Priority = 'urgent' | 'normal' | 'low';
export type IssueStatus = 'open' | 'in_progress' | 'closed';

export interface ProfileRow {
  id: string; // uuid (auth.users.id)
  name: string;
  email: string;
  phone: string; // +974XXXXXXXX
  role: Role;
  created_at: string;
}

export interface IssueRow {
  id: number;
  title: string;
  description: string;
  area: string;
  department: string;
  priority: Priority;
  status: IssueStatus;
  created_at: string;
  target_at: string;
  created_by: string;       // uuid (profiles.id)
  assigned_tech_id: string | null; // uuid (profiles.id) or null
  started_at: string | null;
  resolved_at: string | null;
}

export type ActivityAction = 'created' | 'assigned' | 'status_changed' | 'work_started' | 'work_completed';

export interface ActivityRow {
  id: number;
  issue_id: number;
  at: string;
  actor_id: string; // uuid
  action: ActivityAction;
  details: string | null;
}

// ---------- Helpers ----------

function getUserIdOrThrow(): string {
  const user = supabase.auth.getUser
    ? undefined
    : undefined;
  // Using the session (v2)
  // We'll rely on getSession() in calls below to avoid race conditions.
  throw new Error('getUserIdOrThrow() should not be called directly');
}

async function getSessionUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const uid = data.session?.user?.id;
  if (!uid) throw new Error('Not authenticated.');
  return uid;
}

// Small safe select utility
async function must<T>(p: Promise<{ data: T | null; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  if (data === null) throw new Error('Not found');
  return data;
}

// ---------- Auth ----------

const auth = {
  // Magic link sign-in/up (email)
  async loginWithMagicLink(email: string) {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined } });
    if (error) throw error;
    return true;
  },

  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return true;
  },

  // Subscribe to auth state and provide profile (if exists)
  onAuthStateChange(cb: (profile: (ProfileRow & { session: Session }) | null) => void) {
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        cb(null);
        return;
      }
      // Try to load profile; it's okay if it doesn't exist yet
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profile) {
        cb({ ...profile, session } as ProfileRow & { session: Session });
      } else {
        // Return a minimal structure; UI can show "Complete profile"
        const minimal: ProfileRow = {
          id: session.user.id,
          name: session.user.user_metadata?.name ?? session.user.email ?? 'New User',
          email: session.user.email ?? '',
          phone: '',
          role: 'Technicians',
          created_at: new Date().toISOString(),
        };
        cb({ ...minimal, session } as ProfileRow & { session: Session });
      }
    });
    return sub;
  },
};

// ---------- Users / Profiles ----------

const users = {
  async getCurrent(): Promise<ProfileRow | null> {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) return null;
    const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (error) throw error;
    return profile ?? null;
  },

  // Upsert self profile (first-login or edits)
  async upsertSelf(input: { name: string; email: string; phone: string; role: Role }): Promise<ProfileRow> {
    const uid = await getSessionUserId();
    const payload = {
      id: uid,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      role: input.role,
    };
    const { data, error } = await supabase.from('profiles').upsert(payload).select('*').eq('id', uid).single();
    if (error) throw error;
    return data as ProfileRow;
  },
};

// ---------- Issues ----------

const issues = {
  // Optional filters (pass undefined to ignore)
  async list(filters?: { status?: IssueStatus | 'all'; priority?: Priority | 'all' }): Promise<IssueRow[]> {
    let q = supabase.from('issues').select('*').order('created_at', { ascending: false });
    if (filters?.status && filters.status !== 'all') q = q.eq('status', filters.status);
    if (filters?.priority && filters.priority !== 'all') q = q.eq('priority', filters.priority);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as IssueRow[];
  },

  async create(input: {
    title: string;
    description: string;
    area: string;
    department: string;
    priority: Priority;
    target_at: string; // ISO
    assigned_tech_id: string | null;
  }): Promise<IssueRow> {
    const uid = await getSessionUserId();

    const insert = {
      title: input.title,
      description: input.description,
      area: input.area,
      department: input.department,
      priority: input.priority,
      status: 'open' as IssueStatus,
      target_at: input.target_at,
      created_by: uid,
      assigned_tech_id: input.assigned_tech_id ?? null,
    };

    const { data, error } = await supabase.from('issues').insert(insert).select('*').single();
    if (error) throw error;

    // Activity: created (+ assigned if any)
    await activity.append({
      issue_id: (data as IssueRow).id,
      action: 'created',
      details: 'Issue created',
    });
    if (insert.assigned_tech_id) {
      // Get assignee profile for better details (best-effort)
      const { data: prof } = await supabase.from('profiles').select('name').eq('id', insert.assigned_tech_id).maybeSingle();
      await activity.append({
        issue_id: (data as IssueRow).id,
        action: 'assigned',
        details: `Initial assignee: ${prof?.name ?? insert.assigned_tech_id}`,
      });
    }

    return data as IssueRow;
  },

  async assign(issue_id: number, assigned_tech_id: string | null): Promise<IssueRow> {
    const uid = await getSessionUserId();

    // Update assignee
    const { data: updated, error } = await supabase
      .from('issues')
      .update({ assigned_tech_id })
      .eq('id', issue_id)
      .select('*')
      .single();
    if (error) throw error;

    // Log activity
    let details = 'Unassigned';
    if (assigned_tech_id) {
      const { data: prof } = await supabase.from('profiles').select('name').eq('id', assigned_tech_id).maybeSingle();
      details = `Assigned to ${prof?.name ?? assigned_tech_id}`;
    }
    await activity.append({ issue_id, action: 'assigned', details });

    return updated as IssueRow;
  },

  // Handles status semantics:
  // - moving to 'in_progress' sets started_at if not set + logs work_started
  // - moving to 'closed' sets resolved_at (and auto-sets started_at if missing) + logs work_completed
  async updateStatus(issue_id: number, newStatus: IssueStatus): Promise<IssueRow> {
    const uid = await getSessionUserId();

    // Read current
    const cur = await must<IssueRow>(supabase.from('issues').select('*').eq('id', issue_id).single());

    const updates: Partial<IssueRow> = { status: newStatus };
    const nowIso = new Date().toISOString();

    if (newStatus === 'in_progress' && !cur.started_at) {
      updates.started_at = nowIso;
    }
    if (newStatus === 'closed') {
      updates.resolved_at = nowIso;
      if (!cur.started_at) {
        // auto-start to compute duration fairly
        updates.started_at = nowIso;
      }
    }

    const { data, error } = await supabase.from('issues').update(updates).eq('id', issue_id).select('*').single();
    if (error) throw error;

    // Activity log
    if (newStatus === 'in_progress' && !cur.started_at) {
      await activity.append({ issue_id, action: 'work_started', details: 'Started work' });
    }
    if (newStatus === 'closed') {
      if (!cur.started_at) {
        await activity.append({ issue_id, action: 'work_started', details: 'Auto-start on close' });
      }
      await activity.append({ issue_id, action: 'work_completed', details: 'Marked complete' });
    }
    await activity.append({ issue_id, action: 'status_changed', details: `Status → ${newStatus}` });

    return data as IssueRow;
  },
};

// ---------- Activity ----------

const activity = {
  async list(issue_id: number): Promise<ActivityRow[]> {
    const { data, error } = await supabase
      .from('issue_activity')
      .select('*')
      .eq('issue_id', issue_id)
      .order('at', { ascending: false });

    if (error) throw error;
    return (data ?? []) as ActivityRow[];
  },

  async append(input: { issue_id: number; action: ActivityAction; details?: string }) {
    const uid = await getSessionUserId();
    const { error } = await supabase.from('issue_activity').insert({
      issue_id: input.issue_id,
      actor_id: uid,
      action: input.action,
      details: input.details ?? null,
    });
    if (error) throw error;
    return true;
  },
};

// ---------- Public API ----------

export const backend = {
  supabase, // for advanced/custom queries if ever needed
  auth,
  users,
  issues,
  activity,
};
