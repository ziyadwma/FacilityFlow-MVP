// FacilityFlow MVP - Phase 1 + Auth + Assign + Activity Log + Work Timing
// File: components/FacilityFlowMVP.tsx

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  AlertTriangle,
  Clock,
  User,
  MapPin,
  Filter,
  Plus,
  Bell,
  Settings,
  LogOut
} from 'lucide-react';

// ===== Types
interface Technician {
  id: number;
  name: string;
  dept: string; // must match a Department label below
}

interface ActivityEntry {
  at: string; // ISO timestamp
  actor: string; // user name
  action: 'created' | 'assigned' | 'status_changed' | 'work_started' | 'work_completed';
  details?: string;
}

interface Issue {
  id: number;
  title: string;
  description: string;
  area: string;
  department: string;
  priority: 'urgent' | 'normal' | 'low';
  status: 'open' | 'in_progress' | 'closed';
  createdAt: Date;
  targetAt: Date;
  createdBy: string;
  assignedTechnician: Technician | null;
  // Work timing
  startedAt?: Date; // set when moved to in_progress
  resolvedAt?: Date; // set when moved to closed
  activityLog?: ActivityEntry[];
}

interface NewIssueForm {
  title: string;
  description: string;
  area: string;
  department: string;
  priority: 'urgent' | 'normal' | 'low';
  // Optional pre-assignment while reporting
  assignedTechId?: number | '';
}

interface UserType {
  name: string;
  role: string; // one of roles[] below
  phone: string; // +974XXXXXXXX
  email: string;
}

// ===== Roles (12 as requested)
const roles: string[] = [
  'Operations Management',
  'Kitchen team',
  'Customer service team',
  'Marketing team',
  'Procurement team',
  'Facility team',
  'Finance team', // spelling normalized
  'IT team',
  'Cleaning team',
  'Technicians',
  'Packaging team',
  'Logistics team'
];

// ===== Mock Data
const departments = [
  'Operations', 'Facilities', 'Kitchen', 'Logistics', 'IT', 'Cleaning', 'Hygiene and Safety'
];

const areas = [
  'Reception', 'Cold Kitchen', 'Hot Kitchen', 'Packaging', 'Pastry Kitchen',
  'Consultation Rooms', 'Guest Washroom', 'Kitchen Staff Washroom',
  'Admin Staff Washroom Male', 'Admin Staff Washroom Female',
  'Receiving Area', 'Admin Offices', 'CEO Office', 'Studio',
  'Pathway Kitchen', 'Pathway Facility'
];

const technicians: Technician[] = [
  { id: 1, name: 'Mike Johnson', dept: 'Facilities' },
  { id: 2, name: 'Sarah Chen', dept: 'IT' },
  { id: 3, name: 'David Lopez', dept: 'Kitchen' },
  { id: 4, name: 'Anna Kim', dept: 'Operations' }
];

// Sample initial issues (with activity logs)
const initialIssues: Issue[] = [
  {
    id: 1,
    title: 'Broken coffee machine in break room',
    description: 'The main coffee machine is not turning on. Staff are unable to get coffee.',
    area: 'Reception',
    department: 'Facilities',
    priority: 'normal',
    status: 'open',
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    targetAt: new Date(Date.now() + 70 * 60 * 60 * 1000),
    createdBy: 'John Doe',
    assignedTechnician: null,
    activityLog: [
      { at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), actor: 'John Doe', action: 'created', details: 'Issue created' }
    ]
  },
  {
    id: 2,
    title: 'WiFi down in Admin Offices',
    description: 'Complete network outage in the admin wing. All computers offline.',
    area: 'Admin Offices',
    department: 'IT',
    priority: 'urgent',
    status: 'in_progress',
    createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    targetAt: new Date(Date.now() + 68 * 60 * 60 * 1000),
    createdBy: 'Jane Smith',
    assignedTechnician: technicians[1],
    startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    activityLog: [
      { at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), actor: 'Jane Smith', action: 'created', details: 'Issue created' },
      { at: new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString(), actor: 'Ops Bot', action: 'assigned', details: 'Assigned to Sarah Chen' },
      { at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), actor: 'Sarah Chen', action: 'work_started', details: 'Started work' }
    ]
  }
];

// ===== Local storage helpers (simple, no backend yet)
const USERS_KEY = 'ff_users_v1';
const CURRENT_USER_KEY = 'ff_current_user_v1';

function loadUsers(): UserType[] {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return []; }
}
function saveUsers(users: UserType[]) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}
function loadCurrentUser(): UserType | null {
  try { return JSON.parse(localStorage.getItem(CURRENT_USER_KEY) || 'null'); } catch { return null; }
}
function saveCurrentUser(user: UserType | null) {
  if (user) localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(CURRENT_USER_KEY);
}

// ===== Qatar phone helpers (pure, testable)
export const isQatarMobile = (raw: string) => {
  const s = raw.replace(/\s|-/g, '');
  // Accepts +974XXXXXXXX, 974XXXXXXXX, or 8 digits (which will be normalized)
  if (/^\+?974\d{8}$/.test(s)) return true;
  if (/^\d{8}$/.test(s)) return true;
  return false;
};
export const normalizeQatarMobile = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('974') && digits.length === 11) return `+${digits}`;
  if (digits.length === 8) return `+974${digits}`;
  return `+${digits}`;
};

// Pure helpers for permissions (for dev self-tests)
export const canStartWorkPure = (role: string, currentName?: string, assignedName?: string) =>
  role === 'Operations Management' || (role === 'Technicians' && currentName === assignedName);
export const canAssignPure = (role: string) => role === 'Operations Management' || role === 'Technicians';

// Duration helper (ms -> friendly)
const formatDuration = (ms: number) => {
  if (ms <= 0 || !isFinite(ms)) return '0m';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
};

export default function FacilityFlowMVP() {
  // ===== Views (now includes auth)
  const [currentView, setCurrentView] = useState<'auth-login' | 'auth-register' | 'dashboard' | 'issues' | 'new-issue'>('dashboard');

  // ===== Auth state
  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  const [users, setUsers] = useState<UserType[]>([]);
  const [authError, setAuthError] = useState<string>('');

  // Login form (email OR phone)
  const [loginId, setLoginId] = useState<string>('');

  // Registration form
  const [reg, setReg] = useState<{ name: string; phone: string; email: string; role: string }>({
    name: '',
    phone: '',
    email: '',
    role: roles[0]
  });

  // ===== Issues / filters
  const [issues, setIssues] = useState<Issue[]>(initialIssues);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');

  // New Issue Form State (with optional assignee)
  const [newIssue, setNewIssue] = useState<NewIssueForm>({
    title: '',
    description: '',
    area: '',
    department: '',
    priority: 'normal',
    assignedTechId: ''
  });

  // ===== Bootstrap from localStorage
  useEffect(() => {
    const u = loadUsers();
    setUsers(u);
    const cu = loadCurrentUser();
    if (cu) {
      setCurrentUser(cu);
      setCurrentView('dashboard');
    } else {
      setCurrentView('auth-login');
    }
  }, []);

  // ===== Auth actions
  const register = () => {
    setAuthError('');
    const phoneNorm = normalizeQatarMobile(reg.phone);
    if (!reg.name.trim()) { setAuthError('Name is required.'); return; }
    if (!isQatarMobile(reg.phone)) { setAuthError('Enter a valid Qatar mobile (+974XXXXXXXX).'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reg.email)) { setAuthError('Enter a valid email address.'); return; }
    if (!reg.role) { setAuthError('Select a role.'); return; }

    const exists = users.some(u => u.email.toLowerCase() === reg.email.trim().toLowerCase() || u.phone === phoneNorm);
    if (exists) { setAuthError('A user with this email or phone already exists. Try logging in.'); return; }

    const newUser: UserType = { name: reg.name.trim(), phone: phoneNorm, email: reg.email.trim(), role: reg.role };
    const updated = [newUser, ...users];
    setUsers(updated);
    saveUsers(updated);
    setCurrentUser(newUser);
    saveCurrentUser(newUser);
    setCurrentView('dashboard');
  };

  const login = () => {
    setAuthError('');
    const id = loginId.trim();
    const phoneNorm = normalizeQatarMobile(id);
    const found = users.find(u => u.email.toLowerCase() === id.toLowerCase() || u.phone === phoneNorm);
    if (!found) { setAuthError('No user found for that email or phone. Register instead.'); return; }
    setCurrentUser(found);
    saveCurrentUser(found);
    setCurrentView('dashboard');
  };

  const logout = () => {
    setCurrentUser(null);
    saveCurrentUser(null);
    setCurrentView('auth-login');
  };

  // ===== Business helpers
  const autoAssignTechnician = (department: string): Technician | null => {
    return technicians.find(tech => tech.dept === department) || null;
  };

  const getTimeRemaining = (targetAt: Date): string => {
    const now = new Date();
    const target = new Date(targetAt);
    const diff = target.getTime() - now.getTime();
    if (diff <= 0) return 'Overdue';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h remaining`;
    }
    return `${hours}h ${minutes}m remaining`;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'open': return 'bg-red-100 text-red-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'closed': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'urgent': return 'bg-red-500 text-white';
      case 'normal': return 'bg-blue-500 text-white';
      case 'low': return 'bg-gray-500 text-white';
      default: return 'bg-gray-500 text-white';
    }
  };

  // ===== Permissions & assignment
  const canAssign = useMemo(() => !!currentUser && canAssignPure(currentUser.role), [currentUser]);

  const assignIssue = (issueId: number, techId: string | number) => {
    const idNum = Number(techId);
    const tech = technicians.find(t => t.id === idNum) || null;
    const actor = currentUser?.name || 'System';

    setIssues(prev => prev.map(i => {
      if (i.id !== issueId) return i;
      const prevAssignee = i.assignedTechnician?.name || 'Unassigned';
      const nextAssignee = tech?.name || 'Unassigned';
      const log: ActivityEntry = {
        at: new Date().toISOString(),
        actor,
        action: 'assigned',
        details: `Assignee changed: ${prevAssignee} → ${nextAssignee}`
      };
      return {
        ...i,
        assignedTechnician: tech,
        activityLog: [...(i.activityLog || []), log]
      };
    }));
  };

  // ===== Issue actions
  const handleSubmitIssue = (): void => {
    if (!newIssue.title || !newIssue.description || !newIssue.area || !newIssue.department || !currentUser) return;

    const explicit = newIssue.assignedTechId ? (technicians.find(t => t.id === Number(newIssue.assignedTechId)) || null) : null;
    const fallback = autoAssignTechnician(newIssue.department);
    const assigned = explicit ?? fallback;

    const createdAt = new Date();
    const baseLog: ActivityEntry[] = [
      { at: createdAt.toISOString(), actor: currentUser.name, action: 'created', details: 'Issue created' }
    ];
    if (assigned) {
      baseLog.push({ at: createdAt.toISOString(), actor: currentUser.name, action: 'assigned', details: `Initial assignee: ${assigned.name}` });
    }

    const issue: Issue = {
      id: issues.length + 1,
      title: newIssue.title,
      description: newIssue.description,
      area: newIssue.area,
      department: newIssue.department,
      priority: newIssue.priority,
      status: 'open', // stays open even if assigned; tech must explicitly start work
      createdAt,
      targetAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72 hours from now
      createdBy: currentUser.name,
      assignedTechnician: assigned,
      activityLog: baseLog
    };

    setIssues([issue, ...issues]);
    setNewIssue({ title: '', description: '', area: '', department: '', priority: 'normal', assignedTechId: '' });
    setCurrentView('dashboard');
  };

  const updateIssueStatus = (issueId: number, newStatus: 'open' | 'in_progress' | 'closed'): void => {
    const actor = currentUser?.name || 'System';
    setIssues(issues.map(issue => {
      if (issue.id !== issueId) return issue;

      const logs: ActivityEntry[] = [...(issue.activityLog || [])];
      let startedAt = issue.startedAt;
      let resolvedAt = issue.resolvedAt;

      if (newStatus === 'in_progress') {
        if (!startedAt) {
          startedAt = new Date();
          logs.push({ at: startedAt.toISOString(), actor, action: 'work_started', details: 'Started work' });
        }
      }
      if (newStatus === 'closed') {
        if (!startedAt) {
          // If somehow closed without explicit start, set startedAt now for a minimal duration
          startedAt = new Date();
          logs.push({ at: startedAt.toISOString(), actor, action: 'work_started', details: 'Auto-start on close' });
        }
        resolvedAt = new Date();
        logs.push({ at: resolvedAt.toISOString(), actor, action: 'work_completed', details: 'Marked complete' });
      }

      logs.push({ at: new Date().toISOString(), actor, action: 'status_changed', details: `Status → ${newStatus}` });

      return {
        ...issue,
        status: newStatus,
        startedAt,
        resolvedAt,
        activityLog: logs
      };
    }));
  };

  // ===== Filters / stats
  const filteredIssues = issues.filter(issue => {
    if (filterStatus !== 'all' && issue.status !== filterStatus) return false;
    if (filterPriority !== 'all' && issue.priority !== filterPriority) return false;
    return true;
  });

  const stats = {
    total: issues.length,
    open: issues.filter(i => i.status === 'open').length,
    inProgress: issues.filter(i => i.status === 'in_progress').length,
    overdue: issues.filter(i => new Date(i.targetAt) < new Date() && i.status !== 'closed').length
  };

  // ===== Auth screens
  const renderAuthLogin = () => (
    <div className="min-h-screen bg-gray-50 grid place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome to FacilityFlow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Email or Qatar Mobile (+974XXXXXXXX)
            </label>
            <Input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              placeholder="alex@dieture.com or +9745xxxxxxx"
            />
          </div>
          {authError && <div className="text-sm text-red-600">{authError}</div>}
          <div className="flex gap-3">
            <Button className="flex-1" onClick={login}>Log in</Button>
            <Button variant="outline" className="flex-1" onClick={() => { setAuthError(''); setCurrentView('auth-register'); }}>
              Register
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderAuthRegister = () => (
    <div className="min-h-screen bg-gray-50 grid place-items-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Full Name *</label>
              <Input
                value={reg.name}
                onChange={(e) => setReg({ ...reg, name: e.target.value })}
                placeholder="e.g. Alex Thompson"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email *</label>
              <Input
                type="email"
                value={reg.email}
                onChange={(e) => setReg({ ...reg, email: e.target.value })}
                placeholder="name@company.com"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Qatar Mobile *</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l border border-r-0 bg-gray-50 text-gray-600">
                  +974
                </span>
                <Input
                  className="rounded-l-none"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="8 digits"
                  value={reg.phone}
                  onChange={(e) => setReg({ ...reg, phone: e.target.value })}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">Stored as +974XXXXXXXX</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Role *</label>
              <select
                className="w-full border rounded px-3 py-2"
                value={reg.role}
                onChange={(e) => setReg({ ...reg, role: e.target.value })}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
          {authError && <div className="text-sm text-red-600">{authError}</div>}
          <div className="flex gap-3 pt-2">
            <Button className="flex-1" onClick={register}>Create Account</Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => { setAuthError(''); setCurrentView('auth-login'); }}
            >
              Back to Login
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ===== Timing helpers for UI
  const renderWorkTiming = (issue: Issue) => {
    const started = issue.startedAt ? new Date(issue.startedAt) : null;
    const resolved = issue.resolvedAt ? new Date(issue.resolvedAt) : null;
    if (issue.status === 'in_progress' && started) {
      const elapsed = Date.now() - started.getTime();
      return <span className="text-xs text-gray-600">Started {started.toLocaleString()} · Elapsed {formatDuration(elapsed)}</span>;
    }
    if (issue.status === 'closed' && started && resolved) {
      const total = resolved.getTime() - started.getTime();
      return <span className="text-xs text-gray-600">Started {started.toLocaleString()} · Ended {resolved.toLocaleString()} · Time to fix {formatDuration(total)}</span>;
    }
    return null;
  };

  // ===== Existing App (only visible when logged in)
  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Issues</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Open</p>
                <p className="text-2xl font-bold text-red-600">{stats.open}</p>
              </div>
              <Clock className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">In Progress</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.inProgress}</p>
              </div>
              <User className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Overdue</p>
                <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Issues */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Issues</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredIssues.slice(0, 5).map(issue => (
              <div key={issue.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium">{issue.title}</h3>
                    <Badge className={getPriorityColor(issue.priority)}>{issue.priority}</Badge>
                    <Badge className={getStatusColor(issue.status)}>{issue.status}</Badge>
                  </div>
                  <div className="flex flex-col gap-1 text-sm text-gray-600">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {issue.area}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-4 w-4" />
                        {issue.assignedTechnician?.name || 'Unassigned'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {getTimeRemaining(issue.targetAt)}
                      </span>
                    </div>
                    {renderWorkTiming(issue)}
                  </div>
                </div>
                {issue.status !== 'closed' && (
                  <div className="flex gap-2 items-center">
                    {canAssign && (
                      <select
                        className="border rounded px-2 py-1 text-sm"
                        value={issue.assignedTechnician?.id ?? ''}
                        onChange={(e) => assignIssue(issue.id, e.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {[
                          ...technicians.filter(t => t.dept === issue.department),
                          ...technicians.filter(t => t.dept !== issue.department)
                        ].map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.dept})</option>
                        ))}
                      </select>
                    )}
                    {issue.status === 'open' && (canStartWork(issue) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateIssueStatus(issue.id, 'in_progress')}
                      >
                        Start Work
                      </Button>
                    ) : null)}

                    {issue.status === 'in_progress' && (
                      <Button
                        size="sm"
                        onClick={() => updateIssueStatus(issue.id, 'closed')}
                      >
                        Mark Complete
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderIssueList = () => (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-4 items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="closed">Closed</option>
            </select>
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            >
              <option value="all">All Priority</option>
              <option value="urgent">Urgent</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Issues List */}
      <div className="space-y-4">
        {filteredIssues.map(issue => (
          <Card key={issue.id}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold">{issue.title}</h3>
                    <Badge className={getPriorityColor(issue.priority)}>{issue.priority}</Badge>
                    <Badge className={getStatusColor(issue.status)}>{issue.status.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-gray-600 mb-3">{issue.description}</p>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="font-medium text-gray-500">Area:</span>
                      <p>{issue.area}</p>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">Department:</span>
                      <p>{issue.department}</p>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">Assigned to:</span>
                      <p>{issue.assignedTechnician?.name || 'Unassigned'}</p>
                    </div>
                    <div>
                      <span className="font-medium text-gray-500">SLA Status:</span>
                      <p className={new Date(issue.targetAt) < new Date() && issue.status !== 'closed' ? 'text-red-600 font-medium' : ''}>
                        {getTimeRemaining(issue.targetAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-2">{renderWorkTiming(issue)}</div>
                </div>

                {issue.status !== 'closed' && (
                  <div className="flex gap-2 ml-4 items-center">
                    {canAssign && (
                      <select
                        className="border rounded px-2 py-1 text-sm"
                        value={issue.assignedTechnician?.id ?? ''}
                        onChange={(e) => assignIssue(issue.id, e.target.value)}
                      >
                        <option value="">Unassigned</option>
                        {[
                          ...technicians.filter(t => t.dept === issue.department),
                          ...technicians.filter(t => t.dept !== issue.department)
                        ].map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.dept})</option>
                        ))}
                      </select>
                    )}
                    {issue.status === 'open' && (canStartWork(issue) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateIssueStatus(issue.id, 'in_progress')}
                      >
                        Start Work
                      </Button>
                    ) : null)}

                    {issue.status === 'in_progress' && (
                      <Button
                        size="sm"
                        onClick={() => updateIssueStatus(issue.id, 'closed')}
                      >
                        Mark Complete
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <div className="text-xs text-gray-500 border-t pt-3 space-y-2">
                <div>
                  Created by {issue.createdBy} on {issue.createdAt.toLocaleDateString()} at {issue.createdAt.toLocaleTimeString()}
                </div>
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
  );

  const renderNewIssue = () => (
    <Card>
      <CardHeader>
        <CardTitle>Report New Issue</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {!currentUser && (
            <div className="text-sm text-red-600">Please log in to file an issue.</div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1">Issue Title *</label>
            <Input
              value={newIssue.title}
              onChange={(e) => setNewIssue({ ...newIssue, title: e.target.value })}
              placeholder="Brief description of the problem"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description *</label>
            <Textarea
              value={newIssue.description}
              onChange={(e) => setNewIssue({ ...newIssue, description: e.target.value })}
              placeholder="Detailed description of the issue"
              rows={3}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Area *</label>
              <select
                value={newIssue.area}
                onChange={(e) => setNewIssue({ ...newIssue, area: e.target.value })}
                className="w-full border border-gray-300 rounded px-3 py-2"
                required
              >
                <option value="">Select area</option>
                {areas.map(area => (
                  <option key={area} value={area}>{area}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Department *</label>
              <select
                value={newIssue.department}
                onChange={(e) => setNewIssue({ ...newIssue, department: e.target.value, assignedTechId: '' })}
                className="w-full border border-gray-300 rounded px-3 py-2"
                required
              >
                <option value="">Select department</option>
                {departments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text sm font-medium mb-1">Priority</label>
            <select
              value={newIssue.priority}
              onChange={(e) => setNewIssue({ ...newIssue, priority: e.target.value as 'urgent' | 'normal' | 'low' })}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Assign to (optional)</label>
            <select
              value={newIssue.assignedTechId ?? ''}
              onChange={(e) => setNewIssue({ ...newIssue, assignedTechId: e.target.value ? Number(e.target.value) : '' })}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="">Unassigned</option>
              {(newIssue.department ? technicians.filter(t => t.dept === newIssue.department) : technicians).map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.dept})</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">If left unassigned, the department's default technician may be auto-assigned.</p>
          </div>

          <div className="flex gap-4 pt-4">
            <Button disabled={!currentUser} onClick={handleSubmitIssue} className="flex-1">
              Submit Issue
            </Button>
            <Button
              variant="outline"
              onClick={() => setCurrentView('dashboard')}
            >
              Cancel
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const canStartWork = (issue: Issue) => {
    if (!currentUser) return false;
    if (currentUser.role === 'Operations Management') return true;
    if (currentUser.role === 'Technicians') {
      return issue.assignedTechnician?.name === currentUser.name;
    }
    return false;
  };

  // ===== Root render (keep returns INSIDE the component scope)
  if (currentView === 'auth-login') return renderAuthLogin();
  if (currentView === 'auth-register') return renderAuthRegister();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Settings className="h-5 w-5 text-white" />
              </div>
              <h1 className="text-xl font-semibold">FacilityFlow MVP</h1>
            </div>

            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                {stats.overdue > 0 && (
                  <Badge className="bg-red-500 text-white text-xs">{stats.overdue}</Badge>
                )}
              </Button>

              {currentUser ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Avatar>
                      <AvatarFallback>{currentUser.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                    </Avatar>
                    <div className="text-sm">
                      <p className="font-medium">{currentUser.name}</p>
                      <p className="text-gray-500">{currentUser.role}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={logout} className="flex items-center gap-1">
                    <LogOut className="h-4 w-4" />
                    Logout
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => setCurrentView('auth-login')}>Log in</Button>
                  <Button size="sm" variant="outline" onClick={() => setCurrentView('auth-register')}>Register</Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex gap-6">
            <button
              onClick={() => setCurrentView('dashboard')}
              className={`py-3 px-1 border-b-2 font-medium text-sm ${
                currentView === 'dashboard'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setCurrentView('issues')}
              className={`py-3 px-1 border-b-2 font-medium text-sm ${
                currentView === 'issues'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              All Issues
            </button>
            <button
              onClick={() => setCurrentView('new-issue')}
              className={`py-3 px-1 border-b-2 font-medium text-sm flex items-center gap-1 ${
                currentView === 'new-issue'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Plus className="h-4 w-4" />
              Report Issue
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === 'dashboard' && renderDashboard()}
        {currentView === 'issues' && renderIssueList()}
        {currentView === 'new-issue' && renderNewIssue()}
      </main>
    </div>
  );
}

/*
=== IMPLEMENTATION NOTES & SELF-TESTS ===

Additions:
- `startedAt` and `resolvedAt` on Issue.
- Logs `work_started` and `work_completed` with actor + timestamps.
- UI shows start/end timestamps and a human-friendly duration (elapsed when in progress, total when closed).
- When closing without an explicit start, we auto-start at close time so duration is at least measurable.

Fixes:
- Typo `mx_auto` -> `mx-auto` in main container.

Lightweight runtime tests (non-breaking):
- In development builds, open the console to verify assertions below.
*/

if (typeof window !== 'undefined' && (window as any).document) {
  try {
    // Phone format tests
    console.assert(isQatarMobile('+97455555555') === true, 'Phone +974… should be valid');
    console.assert(isQatarMobile('97455555555') === true, 'Phone 974… should be valid');
    console.assert(isQatarMobile('55555555') === true, '8-digit local should be valid');
    console.assert(isQatarMobile('+97355555555') === false, 'Non-Qatar prefix should be invalid');
    console.assert(normalizeQatarMobile('55555555') === '+97455555555', 'Normalize 8-digit');
    console.assert(normalizeQatarMobile('97455555555') === '+97455555555', 'Normalize 974…');
    console.assert(normalizeQatarMobile('+974 1234-5678') === '+97412345678', 'Normalize with spaces and dashes');

    // Permission tests (pure helpers)
    console.assert(canStartWorkPure('Operations Management', 'Ops', 'Tech') === true, 'Ops can start');
    console.assert(canStartWorkPure('Technicians', 'Mike', 'Mike') === true, 'Assigned tech can start');
    console.assert(canStartWorkPure('Technicians', 'Mike', 'Sarah') === false, 'Unassigned tech cannot start');
    console.assert(canAssignPure('Technicians') === true && canAssignPure('Operations Management') === true, 'Assign roles');
    console.assert(canAssignPure('Kitchen team') === false, 'Non-assigning roles');

    // Duration helper tests
    console.assert(formatDuration(0) === '0m', '0ms -> 0m');
    console.assert(formatDuration(59_000) === '0m', '<1m floors to 0m');
    console.assert(formatDuration(60_000) === '1m', '1m');
    console.assert(formatDuration(61_000) === '1m', '1m + 1s -> 1m');
    console.assert(formatDuration(60 * 60_000) === '1h', '1h');
    console.assert(formatDuration(25 * 60 * 60_000).includes('1d'), '25h includes day');
  } catch (e) {
    console.warn('Self-tests failed:', e);
  }
}
