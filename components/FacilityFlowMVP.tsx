"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Clock, User, MapPin, Filter, Plus, Bell, Settings, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabaseClient"; // ensure this file exists (createClient with NEXT_PUBLIC_* keys)

/*****
FacilityFlowMVP — Supabase‑ready drop‑in
- Uses Supabase if env + session are available; otherwise falls back to local in‑memory state so the UI keeps working.
- Maps 1:1 to your described domain: issues, activity logs, roles permitting assignment/start/close.
- Realtime refresh on issues + issue_activity via Postgres Changes if Supabase is active.

HOW IT DECIDES MODE
- If NEXT_PUBLIC_SUPABASE_URL/KEY are set AND supabase.auth.getSession() returns a session, the component runs in "cloud" mode.
- Else it runs in "local" mode with mock auth (localStorage).

RLS NOTE
- Assumes your RLS/policies from the provided SQL are in place and profiles exist for the logged‑in user id in auth.users.
- The UI restricts actions by role; RLS must still enforce server‑side.
*****/

/***** Minimal UI atoms (to avoid external deps in the component) *****/
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");
const Button = ({ className = "", variant = "default", size = "md", ...props }: any) => {
  const base = "inline-flex items-center justify-center rounded-2xl font-medium transition-colors focus:outline-none focus:ring disabled:opacity-50 disabled:cursor-not-allowed shadow-sm";
  const variants: Record<string, string> = {
    default: "bg-blue-600 text-white hover:bg-blue-700",
    outline: "border border-gray-300 bg-white hover:bg-gray-50 text-gray-900",
  };
  const sizes: Record<string, string> = { sm: "h-9 px-3 text-sm", md: "h-10 px-4", lg: "h-11 px-6 text-base" };
  return <button className={cx(base, variants[variant] || variants.default, sizes[size] || sizes.md, className)} {...props} />;
};
const Card = ({ className = "", ...props }: any) => <div className={cx("rounded-2xl border bg-white shadow-sm", className)} {...props} />;
const CardHeader = ({ className = "", ...props }: any) => <div className={cx("p-6 border-b", className)} {...props} />;
const CardContent = ({ className = "", ...props }: any) => <div className={cx("p-6", className)} {...props} />;
const CardTitle = ({ className = "", ...props }: any) => <h3 className={cx("text-lg font-semibold", className)} {...props} />;
const Input = ({ className = "", ...props }: any) => <input className={cx("w-full rounded-xl border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500", className)} {...props} />;
const Textarea = ({ className = "", ...props }: any) => <textarea className={cx("w-full rounded-xl border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500", className)} {...props} />;
const Badge = ({ className = "", ...props }: any) => <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", className)} {...props} />;
const Avatar = ({ className = "", children }: any) => <div className={cx("inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold", className)}>{children}</div>;
const AvatarFallback = ({ children }: any) => <>{children}</>;

/***** Types *****/
type Role =
  | "Operations Management" | "Kitchen team" | "Customer service team" | "Marketing team" | "Procurement team" | "Facility team" | "Finance team" | "IT team" | "Cleaning team" | "Technicians" | "Packaging team" | "Logistics team";
interface Technician { id: string; name: string; dept: string; } // id: profiles.id (uuid) in cloud mode
interface ActivityEntry { at: string; actor: string; action: 'created' | 'assigned' | 'status_changed' | 'work_started' | 'work_completed'; details?: string; }
interface IssueUI {
  id: number; title: string; description: string; area: string; department: string;
  priority: 'urgent'|'normal'|'low'; status: 'open'|'in_progress'|'closed'; createdAt: Date; targetAt: Date;
  createdBy: string; assignedTechnician: Technician | null; startedAt?: Date; resolvedAt?: Date; activityLog?: ActivityEntry[];
}
interface NewIssueForm { title: string; description: string; area: string; department: string; priority: 'urgent'|'normal'|'low'; assignedTechId?: string | '' }
interface LocalUser { name: string; role: Role; phone: string; email: string; }

/***** Constants *****/
const roles: Role[] = [
  'Operations Management','Kitchen team','Customer service team','Marketing team','Procurement team','Facility team','Finance team','IT team','Cleaning team','Technicians','Packaging team','Logistics team'
];
const departments = ['Operations','Facilities','Kitchen','Logistics','IT','Cleaning','Hygiene and Safety'];
const areas = ['Reception','Cold Kitchen','Hot Kitchen','Packaging','Pastry Kitchen','Consultation Rooms','Guest Washroom','Kitchen Staff Washroom','Admin Staff Washroom Male','Admin Staff Washroom Female','Receiving Area','Admin Offices','CEO Office','Studio','Pathway Kitchen','Pathway Facility'];

/***** LocalStorage auth (fallback) *****/
const USERS_KEY = 'ff_users_v1';
const CURRENT_USER_KEY = 'ff_current_user_v1';
const loadUsers = (): LocalUser[] => { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return []; } };
const saveUsers = (u: LocalUser[]) => localStorage.setItem(USERS_KEY, JSON.stringify(u));
const loadCurrentUser = (): LocalUser | null => { try { return JSON.parse(localStorage.getItem(CURRENT_USER_KEY) || 'null'); } catch { return null; } };
const saveCurrentUser = (u: LocalUser | null) => u ? localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(u)) : localStorage.removeItem(CURRENT_USER_KEY);

/***** Utils *****/
const isQatarMobile = (raw: string) => { const s = raw.replace(/\s|-/g, ""); return /^\+?974\d{8}$/.test(s) || /^\d{8}$/.test(s); };
const normalizeQatarMobile = (raw: string) => { const d = raw.replace(/\D/g, ""); if (d.startsWith("974") && d.length === 11) return `+${d}`; if (d.length === 8) return `+974${d}`; return `+${d}`; };
const canStartWorkPure = (role: Role, currentName?: string, assignedName?: string) => role === 'Operations Management' || (role === 'Technicians' && currentName === assignedName);
const canAssignPure = (role: Role) => role === 'Operations Management' || role === 'Technicians';
const formatDuration = (ms: number) => { if (ms <= 0 || !isFinite(ms)) return '0m'; const m = Math.floor(ms/60000), d = Math.floor(m/(60*24)), h = Math.floor((m%(60*24))/60), mm = m%60; const parts=[] as string[]; if(d)parts.push(`${d}d`); if(h)parts.push(`${h}h`); if(mm||!parts.length)parts.push(`${mm}m`); return parts.join(' '); };

/***** Supabase data layer *****/
async function getSession() { const { data } = await supabase.auth.getSession(); return data.session ?? null; }
const supaActive = async () => {
  try { const url = (process as any).env.NEXT_PUBLIC_SUPABASE_URL || (typeof window !== 'undefined' ? (window as any).ENV_SUPA_URL : null); if (!url) return false; return !!(await getSession()); } catch { return false; }
};

async function supaFetchIssues(): Promise<IssueUI[]> {
  // Fetch issues with creator/assignee names + derive UI fields
  const { data: issues, error } = await supabase
    .from('issues')
    .select('id, title, description, area, department, priority, status, target_at, created_by, assigned_tech_id, started_at, resolved_at, created_at')
    .order('id', { ascending: false });
  if (error) throw error;

  // Fetch related profile names in one go
  const ids = Array.from(new Set((issues || []).flatMap((i: any) => [i.created_by, i.assigned_tech_id]).filter(Boolean)));
  let profilesById: Record<string, { name: string; role?: Role; dept?: string }> = {};
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, name, role').in('id', ids as string[]);
    for (const p of (profs || [])) profilesById[p.id] = { name: p.name, role: p.role as Role };
  }

  // Fetch last 3 activities from view if available
  const issueIds = (issues || []).map((i: any) => i.id);
  let actsByIssue: Record<number, ActivityEntry[]> = {};
  if (issueIds.length) {
    const { data: acts } = await supabase
      .from('issue_activity')
      .select('issue_id, at, action, details, actor_id')
      .in('issue_id', issueIds)
      .order('at', { ascending: false });
    for (const a of (acts || [])) {
      const list = actsByIssue[a.issue_id] || (actsByIssue[a.issue_id] = []);
      list.push({ at: a.at, actor: profilesById[a.actor_id]?.name || a.actor_id, action: a.action, details: a.details || undefined });
    }
    for (const k of Object.keys(actsByIssue)) actsByIssue[+k] = actsByIssue[+k].slice(0, 3).reverse();
  }

  return (issues || []).map((i: any) => ({
    id: i.id,
    title: i.title,
    description: i.description,
    area: i.area,
    department: i.department,
    priority: i.priority,
    status: i.status,
    createdAt: new Date(i.created_at ?? Date.now()),
    targetAt: new Date(i.target_at),
    createdBy: profilesById[i.created_by]?.name || i.created_by,
    assignedTechnician: i.assigned_tech_id ? { id: i.assigned_tech_id, name: profilesById[i.assigned_tech_id]?.name || i.assigned_tech_id, dept: i.department } : null,
    startedAt: i.started_at ? new Date(i.started_at) : undefined,
    resolvedAt: i.resolved_at ? new Date(i.resolved_at) : undefined,
    activityLog: actsByIssue[i.id] || [],
  }));
}

async function supaCreateIssue(payload: { title: string; description: string; area: string; department: string; priority: 'urgent'|'normal'|'low'; assignedTechUuid?: string | null; }) {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await supabase.from('issues').insert([{
    title: payload.title,
    description: payload.description,
    area: payload.area,
    department: payload.department,
    priority: payload.priority,
    status: 'open',
    target_at: new Date(Date.now() + 72*60*60*1000).toISOString(),
    created_by: user.id,
    assigned_tech_id: payload.assignedTechUuid ?? null,
  }]).select('*').single();
  if (error) throw error; return data;
}
async function supaAssignIssue(issueId: number, techUuidOrNull: string | null) {
  const { error } = await supabase.from('issues').update({ assigned_tech_id: techUuidOrNull }).eq('id', issueId); if (error) throw error;
}
async function supaStartWork(issueId: number) {
  const { error } = await supabase.from('issues').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', issueId); if (error) throw error;
}
async function supaCloseIssue(issueId: number) {
  const { error } = await supabase.from('issues').update({ status: 'closed', resolved_at: new Date().toISOString() }).eq('id', issueId); if (error) throw error;
}

/***** Component *****/
export default function FacilityFlowMVP() {
  const [currentView, setCurrentView] = useState<'auth-login' | 'auth-register' | 'dashboard' | 'issues' | 'new-issue'>('dashboard');
  const [currentUser, setCurrentUser] = useState<LocalUser | null>(null);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [authError, setAuthError] = useState<string>('');
  const [loginId, setLoginId] = useState<string>('');
  const [reg, setReg] = useState<{ name: string; phone: string; email: string; role: Role }>({ name: '', phone: '', email: '', role: roles[0] });

  const [issues, setIssues] = useState<IssueUI[] | null>(null); // null = loading
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [newIssue, setNewIssue] = useState<NewIssueForm>({ title: '', description: '', area: '', department: '', priority: 'normal', assignedTechId: '' });

  const [cloudMode, setCloudMode] = useState<boolean>(false);
  const supaSubRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // bootstrap auth + mode
  useEffect(() => {
    (async () => {
      const u = loadUsers(); setUsers(u);
      const cu = loadCurrentUser();
      const hasSession = await supaActive();
      setCloudMode(hasSession);
      if (cu) { setCurrentUser(cu); setCurrentView('dashboard'); }
      else { setCurrentView(hasSession ? 'dashboard' : 'auth-login'); }
    })();
  }, []);

  // initial data load
  useEffect(() => {
    (async () => {
      if (cloudMode) {
        try { setIssues(null); const rows = await supaFetchIssues(); setIssues(rows); } catch (e) { console.error(e); setIssues([]); }
        // realtime subscription
        if (!supaSubRef.current) {
          const ch = supabase.channel('issues-live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'issues' }, () => refreshIssues())
            .on('postgres_changes', { event: '*', schema: 'public', table: 'issue_activity' }, () => refreshIssues())
            .subscribe();
          supaSubRef.current = ch;
        }
      } else {
        // local seed
        setIssues([{
          id: 1, title: 'Broken coffee machine in break room', description: 'The main coffee machine is not turning on. Staff are unable to get coffee.',
          area: 'Reception', department: 'Facilities', priority: 'normal', status: 'open', createdAt: new Date(Date.now() - 2*60*60*1000), targetAt: new Date(Date.now() + 70*60*60*1000), createdBy: 'John Doe', assignedTechnician: null, activityLog: [ { at: new Date(Date.now()-2*60*60*1000).toISOString(), actor: 'John Doe', action: 'created', details: 'Issue created' } ]
        }, {
          id: 2, title: 'WiFi down in Admin Offices', description: 'Complete network outage in the admin wing. All computers offline.',
          area: 'Admin Offices', department: 'IT', priority: 'urgent', status: 'in_progress', createdAt: new Date(Date.now() - 4*60*60*1000), targetAt: new Date(Date.now() + 68*60*60*1000), createdBy: 'Jane Smith', assignedTechnician: { id: 'tech-sarah', name: 'Sarah Chen', dept: 'IT' }, startedAt: new Date(Date.now()-3*60*60*1000), activityLog: [
            { at: new Date(Date.now()-4*60*60*1000).toISOString(), actor: 'Jane Smith', action: 'created', details: 'Issue created' },
            { at: new Date(Date.now()-3.5*60*60*1000).toISOString(), actor: 'Ops Bot', action: 'assigned', details: 'Assigned to Sarah Chen' },
            { at: new Date(Date.now()-3*60*60*1000).toISOString(), actor: 'Sarah Chen', action: 'work_started', details: 'Started work' }
          ]
        }]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudMode]);

  async function refreshIssues() { if (!cloudMode) return; try { const rows = await supaFetchIssues(); setIssues(rows); } catch (e) { console.error(e); } }

  // auth actions (local fallback)
  const register = () => {
    setAuthError(''); const phoneNorm = normalizeQatarMobile(reg.phone);
    if (!reg.name.trim()) { setAuthError('Name is required.'); return; }
    if (!isQatarMobile(reg.phone)) { setAuthError('Enter a valid Qatar mobile (+974XXXXXXXX).'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reg.email)) { setAuthError('Enter a valid email address.'); return; }
    if (!reg.role) { setAuthError('Select a role.'); return; }
    const exists = users.some(u => u.email.toLowerCase() === reg.email.trim().toLowerCase() || u.phone === phoneNorm);
    if (exists) { setAuthError('A user with this email or phone already exists. Try logging in.'); return; }
    const newUser: LocalUser = { name: reg.name.trim(), phone: phoneNorm, email: reg.email.trim(), role: reg.role };
    const updated = [newUser, ...users]; setUsers(updated); saveUsers(updated); setCurrentUser(newUser); saveCurrentUser(newUser); setCurrentView('dashboard');
  };
  const login = () => {
    setAuthError(''); const id = loginId.trim(); const phoneNorm = normalizeQatarMobile(id);
    const found = users.find(u => u.email.toLowerCase() === id.toLowerCase() || u.phone === phoneNorm);
    if (!found) { setAuthError('No user found for that email or phone. Register instead.'); return; }
    setCurrentUser(found); saveCurrentUser(found); setCurrentView('dashboard');
  };
  const logout = () => { setCurrentUser(null); saveCurrentUser(null); setCurrentView('auth-login'); };

  // derived
  const canAssign = useMemo(() => !!currentUser && canAssignPure(currentUser.role), [currentUser]);
  const filteredIssues = (issues || []).filter(i => (filterStatus === 'all' || i.status === filterStatus) && (filterPriority === 'all' || i.priority === filterPriority));
  const stats = { total: (issues || []).length, open: (issues || []).filter(i => i.status === 'open').length, inProgress: (issues || []).filter(i => i.status === 'in_progress').length, overdue: (issues || []).filter(i => new Date(i.targetAt) < new Date() && i.status !== 'closed').length };

  // local-only helpers for demo assignees
  const localTechs: Technician[] = [
    { id: 'tech-mike', name: 'Mike Johnson', dept: 'Facilities' },
    { id: 'tech-sarah', name: 'Sarah Chen', dept: 'IT' },
    { id: 'tech-david', name: 'David Lopez', dept: 'Kitchen' },
    { id: 'tech-anna', name: 'Anna Kim', dept: 'Operations' },
  ];
  const autoAssignTechnicianLocal = (department: string): Technician | null => localTechs.find(t => t.dept === department) || null;

  // ACTIONS — dispatch to cloud or local
  async function createIssueAction() {
    if (!newIssue.title || !newIssue.description || !newIssue.area || !newIssue.department || !currentUser) return;
    if (cloudMode) {
      await supaCreateIssue({ title: newIssue.title, description: newIssue.description, area: newIssue.area, department: newIssue.department, priority: newIssue.priority, assignedTechUuid: newIssue.assignedTechId || null });
      await refreshIssues();
    } else {
      const assigned = newIssue.assignedTechId ? localTechs.find(t => t.id === String(newIssue.assignedTechId)) || null : autoAssignTechnicianLocal(newIssue.department);
      const createdAt = new Date();
      const baseLog: ActivityEntry[] = [{ at: createdAt.toISOString(), actor: currentUser.name, action: 'created', details: 'Issue created' }];
      if (assigned) baseLog.push({ at: createdAt.toISOString(), actor: currentUser.name, action: 'assigned', details: `Initial assignee: ${assigned.name}` });
      const next: IssueUI = { id: (issues || []).length + 1, title: newIssue.title, description: newIssue.description, area: newIssue.area, department: newIssue.department, priority: newIssue.priority, status: 'open', createdAt, targetAt: new Date(Date.now() + 72*60*60*1000), createdBy: currentUser.name, assignedTechnician: assigned, activityLog: baseLog };
      setIssues([next, ...(issues || [])]);
    }
    setNewIssue({ title: '', description: '', area: '', department: '', priority: 'normal', assignedTechId: '' }); setCurrentView('dashboard');
  }

  async function assignIssueAction(issueId: number, techIdOrUuid: string | number) {
    const techId = String(techIdOrUuid) || null;
    if (cloudMode) { await supaAssignIssue(issueId, techId || null); await refreshIssues(); return; }
    const tech = localTechs.find(t => t.id === techId) || null; const actor = currentUser?.name || 'System';
    setIssues(prev => (prev || []).map(i => {
      if (i.id !== issueId) return i;
      const prevAssignee = i.assignedTechnician?.name || 'Unassigned'; const nextAssignee = tech?.name || 'Unassigned';
      const log: ActivityEntry = { at: new Date().toISOString(), actor, action: 'assigned', details: `Assignee changed: ${prevAssignee} → ${nextAssignee}` };
      return { ...i, assignedTechnician: tech, activityLog: [...(i.activityLog || []), log] };
    }));
  }

  async function startWorkAction(issueId: number) { if (cloudMode) { await supaStartWork(issueId); await refreshIssues(); return; } setIssues(prev => (prev || []).map(issue => { if (issue.id !== issueId) return issue; const logs=[...(issue.activityLog||[])]; const startedAt=new Date(); logs.push({at:startedAt.toISOString(),actor:currentUser?.name||'System',action:'work_started',details:'Started work'}); logs.push({at:new Date().toISOString(),actor:currentUser?.name||'System',action:'status_changed',details:'Status → in_progress'}); return { ...issue, status:'in_progress', startedAt, activityLog: logs }; })); }
  async function closeIssueAction(issueId: number) { if (cloudMode) { await supaCloseIssue(issueId); await refreshIssues(); return; } setIssues(prev => (prev || []).map(issue => { if (issue.id !== issueId) return issue; const logs=[...(issue.activityLog||[])]; let startedAt=issue.startedAt; if(!startedAt){ startedAt=new Date(); logs.push({at:startedAt.toISOString(),actor:currentUser?.name||'System',action:'work_started',details:'Auto-start on close'});} const resolvedAt=new Date(); logs.push({at:resolvedAt.toISOString(),actor:currentUser?.name||'System',action:'work_completed',details:'Marked complete'}); logs.push({at:new Date().toISOString(),actor:currentUser?.name||'System',action:'status_changed',details:'Status → closed'}); return { ...issue, status:'closed', startedAt, resolvedAt, activityLog: logs }; })); }

  // UI helpers
  const getTimeRemaining = (targetAt: Date) => { const now = new Date(); const diff = targetAt.getTime() - now.getTime(); if (diff <= 0) return 'Overdue'; const hours = Math.floor(diff/3_600_000); const minutes = Math.floor((diff%3_600_000)/60_000); if (hours > 24){ const days = Math.floor(hours/24); return `${days}d ${hours%24}h remaining`; } return `${hours}h ${minutes}m remaining`; };
  const getStatusColor = (status: string) => status === 'open' ? 'bg-red-100 text-red-800' : status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800';
  const getPriorityColor = (priority: string) => priority === 'urgent' ? 'bg-red-500 text-white' : priority === 'normal' ? 'bg-blue-500 text-white' : 'bg-gray-500 text-white';
  const renderWorkTiming = (issue: IssueUI) => { const started = issue.startedAt ? new Date(issue.startedAt) : null; const resolved = issue.resolvedAt ? new Date(issue.resolvedAt) : null; if (issue.status === 'in_progress' && started) { const elapsed = Date.now() - started.getTime(); return <span className="text-xs text-gray-600">Started {started.toLocaleString()} · Elapsed {formatDuration(elapsed)}</span>; } if (issue.status === 'closed' && started && resolved) { const total = resolved.getTime() - started.getTime(); return <span className="text-xs text-gray-600">Started {started.toLocaleString()} · Ended {resolved.toLocaleString()} · Time to fix {formatDuration(total)}</span>; } return null; };

  const canStartWork = (issue: IssueUI) => { if (!currentUser) return false; if (currentUser.role === 'Operations Management') return true; if (currentUser.role === 'Technicians') { return issue.assignedTechnician?.name === currentUser.name; } return false; };

  // RENDER AUTH
  if (!cloudMode && currentView === 'auth-login') return (
    <div className="min-h-screen bg-gray-50 grid place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Welcome to FacilityFlow</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email or Qatar Mobile (+974XXXXXXXX)</label>
            <Input value={loginId} onChange={(e: any) => setLoginId(e.target.value)} placeholder="alex@dieture.com or +9745xxxxxxx" />
          </div>
          {authError && <div className="text-sm text-red-600">{authError}</div>}
          <div className="flex gap-3">
            <Button className="flex-1" onClick={login}>Log in</Button>
            <Button variant="outline" className="flex-1" onClick={() => { setAuthError(''); setCurrentView('auth-register'); }}>Register</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  if (!cloudMode && currentView === 'auth-register') return (
    <div className="min-h-screen bg-gray-50 grid place-items-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader><CardTitle>Create your account</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Full Name *</label>
              <Input value={reg.name} onChange={(e: any) => setReg({ ...reg, name: e.target.value })} placeholder="e.g. Alex Thompson" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email *</label>
              <Input type="email" value={reg.email} onChange={(e: any) => setReg({ ...reg, email: e.target.value })} placeholder="name@company.com" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Qatar Mobile *</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l border border-r-0 bg-gray-50 text-gray-600">+974</span>
                <Input className="rounded-l-none" inputMode="numeric" maxLength={8} placeholder="8 digits" value={reg.phone} onChange={(e: any) => setReg({ ...reg, phone: e.target.value })} />
              </div>
              <p className="text-xs text-gray-500 mt-1">Stored as +974XXXXXXXX</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Role *</label>
              <select className="w-full border rounded px-3 py-2" value={reg.role} onChange={(e) => setReg({ ...reg, role: e.target.value as Role })}>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          {authError && <div className="text-sm text-red-600">{authError}</div>}
          <div className="flex gap-3 pt-2">
            <Button className="flex-1" onClick={register}>Create Account</Button>
            <Button variant="outline" className="flex-1" onClick={() => { setAuthError(''); setCurrentView('auth-login'); }}>Back to Login</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // MAIN LAYOUT
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"><Settings className="h-5 w-5 text-white"/></div>
              <h1 className="text-xl font-semibold">FacilityFlow MVP</h1>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <Bell className="h-4 w-4"/>
                {stats.overdue > 0 && (<Badge className="bg-red-500 text-white text-xs">{stats.overdue}</Badge>)}
              </Button>
              {currentUser ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Avatar><AvatarFallback>{currentUser.name.split(' ').map(n => n[0]).join('')}</AvatarFallback></Avatar>
                    <div className="text-sm"><p className="font-medium">{currentUser.name}</p><p className="text-gray-500">{currentUser.role}</p></div>
                  </div>
                  <Button variant="outline" size="sm" onClick={logout} className="flex items-center gap-1"><LogOut className="h-4 w-4"/>Logout</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {/* In cloud mode, you'd render your Supabase Auth UI here (magic link / OAuth) */}
                  <Button size="sm" onClick={() => setCurrentView('auth-login')}>Log in</Button>
                  <Button size="sm" variant="outline" onClick={() => setCurrentView('auth-register')}>Register</Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-6">
            <button onClick={() => setCurrentView('dashboard')} className={`py-3 px-1 border-b-2 font-medium text-sm ${currentView === 'dashboard' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Dashboard</button>
            <button onClick={() => setCurrentView('issues')} className={`py-3 px-1 border-b-2 font-medium text-sm ${currentView === 'issues' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>All Issues</button>
            <button onClick={() => setCurrentView('new-issue')} className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-1 ${currentView === 'new-issue' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}><Plus className="h-4 w-4"/>Report Issue</button>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Total Issues</p><p className="text-2xl font-bold">{stats.total}</p></div><AlertTriangle className="h-8 w-8 text-gray-400"/></div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Open</p><p className="text-2xl font-bold text-red-600">{stats.open}</p></div><Clock className="h-8 w-8 text-red-400"/></div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">In Progress</p><p className="text-2xl font-bold text-yellow-600">{stats.inProgress}</p></div><User className="h-8 w-8 text-yellow-400"/></div></CardContent></Card>
              <Card><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm text-gray-600">Overdue</p><p className="text-2xl font-bold text-red-600">{stats.overdue}</p></div><AlertTriangle className="h-8 w-8 text-red-400"/></div></CardContent></Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Recent Issues</CardTitle></CardHeader>
              <CardContent>
                {!issues && <div className="text-sm text-gray-500">Loading…</div>}
                {issues && (
                  <div className="space-y-4">
                    {filteredIssues.slice(0,5).map(issue => (
                      <div key={issue.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium">{issue.title}</h3>
                            <Badge className={getPriorityColor(issue.priority)}>{issue.priority}</Badge>
                            <Badge className={getStatusColor(issue.status)}>{issue.status}</Badge>
                          </div>
                          <div className="flex flex-col gap-1 text-sm text-gray-600">
                            <div className="flex items-center gap-4">
                              <span className="flex items-center gap-1"><MapPin className="h-4 w-4"/>{issue.area}</span>
                              <span className="flex items-center gap-1"><User className="h-4 w-4"/>{issue.assignedTechnician?.name || 'Unassigned'}</span>
                              <span className="flex items-center gap-1"><Clock className="h-4 w-4"/>{getTimeRemaining(issue.targetAt)}</span>
                            </div>
                            {renderWorkTiming(issue)}
                          </div>
                        </div>
                        {issue.status !== 'closed' && (
                          <div className="flex gap-2 items-center">
                            {canAssign && (
                              <select className="border rounded px-2 py-1 text-sm" value={issue.assignedTechnician?.id ?? ''} onChange={(e) => assignIssueAction(issue.id, e.target.value)}>
                                <option value="">Unassigned</option>
                                {/* In cloud mode, consider querying technicians by department and listing here by UUID. */}
                                {!cloudMode && [...localTechs.filter(t => t.dept === issue.department), ...localTechs.filter(t => t.dept !== issue.department)].map(t => (
                                  <option key={t.id} value={t.id}>{t.name} ({t.dept})</option>
                                ))}
                              </select>
                            )}
                            {issue.status === 'open' && (canStartWork(issue) ? (
                              <Button size="sm" variant="outline" onClick={() => startWorkAction(issue.id)}>Start Work</Button>
                            ) : null)}
                            {issue.status === 'in_progress' && (
                              <Button size="sm" onClick={() => closeIssueAction(issue.id)}>Mark Complete</Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {currentView === 'issues' && issues && (
          <div className="space-y-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex gap-4 items-center">
                  <div className="flex items-center gap-2"><Filter className="h-4 w-4"/><span className="text-sm font-medium">Filters:</span></div>
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="border rounded px-2 py-1 text-sm">
                    <option value="all">All Status</option><option value="open">Open</option><option value="in_progress">In Progress</option><option value="closed">Closed</option>
                  </select>
                  <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="border rounded px-2 py-1 text-sm">
                    <option value="all">All Priority</option><option value="urgent">Urgent</option><option value="normal">Normal</option><option value="low">Low</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {filteredIssues.map(issue => (
                <Card key={issue.id}>
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold">{issue.title}</h3>
                          <Badge className={getPriorityColor(issue.priority)}>{issue.priority}</Badge>
                          <Badge className={getStatusColor(issue.status)}>{issue.status.replace('_',' ')}</Badge>
                        </div>
                        <p className="text-gray-600 mb-3">{issue.description}</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div><span className="font-medium text-gray-500">Area:</span><p>{issue.area}</p></div>
                          <div><span className="font-medium text-gray-500">Department:</span><p>{issue.department}</p></div>
                          <div><span className="font-medium text-gray-500">Assigned to:</span><p>{issue.assignedTechnician?.name || 'Unassigned'}</p></div>
                          <div><span className="font-medium text-gray-500">SLA Status:</span><p className={(new Date(issue.targetAt) < new Date() && issue.status !== 'closed') ? 'text-red-600 font-medium' : ''}>{getTimeRemaining(issue.targetAt)}</p></div>
                        </div>
                        <div className="mt-2">{renderWorkTiming(issue)}</div>
                      </div>
                      {issue.status !== 'closed' && (
                        <div className="flex gap-2 ml-4 items-center">
                          {canAssign && (
                            <select className="border rounded px-2 py-1 text-sm" value={issue.assignedTechnician?.id ?? ''} onChange={(e) => assignIssueAction(issue.id, e.target.value)}>
                              <option value="">Unassigned</option>
                              {!cloudMode && [...localTechs.filter(t => t.dept === issue.department), ...localTechs.filter(t => t.dept !== issue.department)].map(t => (
                                <option key={t.id} value={t.id}>{t.name} ({t.dept})</option>
                              ))}
                            </select>
                          )}
                          {issue.status === 'open' && (canStartWork(issue) ? (
                            <Button size="sm" variant="outline" onClick={() => startWorkAction(issue.id)}>Start Work</Button>
                          ) : null)}
                          {issue.status === 'in_progress' && (
                            <Button size="sm" onClick={() => closeIssueAction(issue.id)}>Mark Complete</Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 border-top pt-3 space-y-2">
                      <div>Created by {issue.createdBy} on {issue.createdAt.toLocaleDateString()} at {issue.createdAt.toLocaleTimeString()}</div>
                      {issue.activityLog && issue.activityLog.length > 0 && (
                        <div>
                          <div className="font-medium text-gray-600">Activity</div>
                          <ul className="list-disc pl-5 space-y-1">
                            {issue.activityLog.slice(-3).map((ev, idx) => (
                              <li key={idx}>{new Date(ev.at).toLocaleString()} — {ev.actor}: {ev.action}{ev.details ? ` (${ev.details})` : ''}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {currentView === 'new-issue' && (
          <Card>
            <CardHeader><CardTitle>Report New Issue</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {!currentUser && (<div className="text-sm text-red-600">Please log in to file an issue.</div>)}
                <div>
                  <label className="block text-sm font-medium mb-1">Issue Title *</label>
                  <Input value={newIssue.title} onChange={(e: any) => setNewIssue({ ...newIssue, title: e.target.value })} placeholder="Brief description of the problem" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description *</label>
                  <Textarea value={newIssue.description} onChange={(e: any) => setNewIssue({ ...newIssue, description: e.target.value })} placeholder="Detailed description of the issue" rows={3} required />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Area *</label>
                    <select value={newIssue.area} onChange={(e) => setNewIssue({ ...newIssue, area: e.target.value })} className="w-full border border-gray-300 rounded px-3 py-2" required>
                      <option value="">Select area</option>
                      {areas.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Department *</label>
                    <select value={newIssue.department} onChange={(e) => setNewIssue({ ...newIssue, department: e.target.value, assignedTechId: '' })} className="w-full border border-gray-300 rounded px-3 py-2" required>
                      <option value="">Select department</option>
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Priority</label>
                  <select value={newIssue.priority} onChange={(e) => setNewIssue({ ...newIssue, priority: e.target.value as any })} className="w-full border border-gray-300 rounded px-3 py-2">
                    <option value="low">Low</option><option value="normal">Normal</option><option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Assign to (optional)</label>
                  <select value={newIssue.assignedTechId ?? ''} onChange={(e) => setNewIssue({ ...newIssue, assignedTechId: e.target.value ? String(e.target.value) : '' })} className="w-full border border-gray-300 rounded px-3 py-2">
                    <option value="">Unassigned</option>
                    {/* In cloud mode, populate with technicians from profiles filtered by department/role. */}
                    {!cloudMode && (newIssue.department ? localTechs.filter(t => t.dept === newIssue.department) : localTechs).map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.dept})</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">If left unassigned, the department's default technician may be auto-assigned.</p>
                </div>
                <div className="flex gap-4 pt-4">
                  <Button disabled={!currentUser} onClick={createIssueAction} className="flex-1">Submit Issue</Button>
                  <Button variant="outline" onClick={() => setCurrentView('dashboard')}>Cancel</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
