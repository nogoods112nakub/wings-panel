'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Server as ServerIcon, Cpu, HardDrive, Terminal as TerminalIcon, Folder,
  Layers, PlusCircle, RotateCw, Power, Trash2, FileText, ChevronRight,
  Plus, RefreshCw, Play, Square, Skull, LogOut, User, Shield,
  Network, Settings, Save, X, CheckCircle, AlertTriangle, Info,
  Activity,   Key, Copy,
  RotateCcw, PauseCircle, ArrowRight, Bug, Coffee, Users, Sun, Moon,
  Download, Upload, Pencil, Settings2, Share2, LayoutDashboard, Send, Box
} from 'lucide-react'
import type { Terminal as XTermTerminal } from 'xterm'
import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit'


const API_BASE = process.env.NEXT_PUBLIC_PANEL_URL || 'http://localhost:8000'

interface Server {
  id: number; uuid: string; name: string; description?: string; owner_id: number;
  node_id: number; primary_allocation_id: number; cpu_limit: number; memory_limit: number;
  disk_limit: number; docker_image: string; docker_network?: string; startup_command: string; status: string;
  installed: boolean; allocations?: any[]; group_id?: number | null
}

interface Node {
  id: number; name: string; fqdn: string; ip_address: string;
  daemon_port: number; is_active: boolean
}

interface Allocation {
  id: number; node_id: number; ip_address: string; port: number; server_id: number | null
}

interface FileEntry { name: string; is_directory: boolean; size: number; modified_at: number }

interface User { id: number; username: string; email: string; root_admin: boolean }

interface SystemStatus {
  panel_version: string; daemon_reachable: boolean; daemon_version?: string;
  total_nodes: number; active_nodes: number; total_servers: number; running_servers: number;
  total_allocations: number; used_allocations: number; total_users: number;
}

interface NodeSummary {
  node_id: number; node_name: string; total_allocations: number; used_allocations: number; total_servers: number;
}

interface ActivityLogEntry {
  id: number; created_at: string; user_id: number; username?: string;
  server_id?: number; server_name?: string; action: string;
  detail?: string; ip_address?: string
}

interface ApiKey {
  id: number; name: string; key?: string; permissions: string;
  last_used?: string; created_at: string; expires_at?: string
}

export default function Dashboard() {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)

  const [authPage, setAuthPage] = useState<'login' | 'register'>('login')
  const [authUsername, setAuthUsername] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')

  const [activeTab, setActiveTab] = useState<'dashboard' | 'servers' | 'nodes' | 'allocations' | 'create-server' | 'system' | 'activity' | 'api-keys' | 'users' | 'templates' | 'webhooks' | 'settings'>('dashboard')
  const [nodes, setNodes] = useState<Node[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [selectedServer, setSelectedServer] = useState<Server | null>(null)

  const [stats, setStats] = useState({ cpu: 0, memory: 0, disk: 0, status: 'offline' })

  const [consoleUrl, setConsoleUrl] = useState('')
  const [consoleLoading, setConsoleLoading] = useState(false)
  const [consoleError, setConsoleError] = useState('')
  const [consoleConnected, setConsoleConnected] = useState(false)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitAddonRef = useRef<XTermFitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const terminalContainerRef = useRef<HTMLDivElement | null>(null)

  const [currentPath, setCurrentPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [fileError, setFileError] = useState('')
  const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null)
  const [newPathName, setNewPathName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formNodeId, setFormNodeId] = useState(0)
  const [formAllocId, setFormAllocId] = useState(0)
  const [formCpu, setFormCpu] = useState(100)
  const [formMemory, setFormMemory] = useState(2048)
  const [formDisk, setFormDisk] = useState(10240)
  const [formImage, setFormImage] = useState('itzg/minecraft-server')
  const [formNetwork, setFormNetwork] = useState('pterodactyl-net')
  const [formStartup, setFormStartup] = useState('java -Xmx1024M -jar server.jar nogui')
  const [formStartupAuto, setFormStartupAuto] = useState(true)
  const [formPreset, setFormPreset] = useState('')
  const [formGameVersion, setFormGameVersion] = useState('')
  const [formEnv, setFormEnv] = useState<Record<string, string>>({})
  const [formEnvText, setFormEnvText] = useState('')
  const [dockerNetworks, setDockerNetworks] = useState<{ name: string; id: string; driver: string; scope: string }[]>([])
  const [formUseDockerfile, setFormUseDockerfile] = useState(false)
  const [formDockerfile, setFormDockerfile] = useState('')
  const [formImageName, setFormImageName] = useState('')
  const [isBuildingImage, setIsBuildingImage] = useState(false)

  const GAME_PRESETS: { id: string; label: string; image: string; startup: string; memory: number; disk: number; icon: string; allocPort: number; env?: Record<string, string>; versionOptions?: string[]; defaultVersion?: string }[] = [
    { id: 'mc-java', label: 'Minecraft: Java Edition', image: 'itzg/minecraft-server', startup: 'java -Xmx$MEMORY -jar server.jar nogui', memory: 2048, disk: 10240, icon: '⛏', allocPort: 25565, env: { EULA: 'TRUE', TYPE: 'PAPER' }, versionOptions: ['LATEST', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4', '1.12.2', '1.8.9'], defaultVersion: 'LATEST' },
    { id: 'mc-bedrock', label: 'Minecraft: Bedrock Edition', image: 'itzg/minecraft-bedrock-server', startup: '', memory: 2048, disk: 10240, icon: '⛏', allocPort: 25535, env: { EULA: 'TRUE' }, versionOptions: ['LATEST', '1.21.62', '1.21.51', '1.21.50', '1.21.30', '1.20.81', '1.20.73'], defaultVersion: 'LATEST' },
    { id: 'terraria', label: 'Terraria', image: 'ryshe/terraria', startup: '', memory: 1024, disk: 5120, icon: '🌙', allocPort: 7777 },
    { id: 'cs2', label: 'Counter-Strike 2', image: 'ich777/steamcmd:cs2', startup: '', memory: 4096, disk: 20480, icon: '🔫', allocPort: 27015 },
    { id: 'valheim', label: 'Valheim', image: 'lloesche/valheim-server', startup: '', memory: 2048, disk: 10240, icon: '⚔', allocPort: 2456 },
    { id: 'gmod', label: "Garry's Mod", image: 'ich777/steamcmd:garrysmod', startup: '', memory: 2048, disk: 10240, icon: '🔧', allocPort: 27020 },
    { id: 'rust', label: 'Rust', image: 'ich777/steamcmd:rust', startup: '', memory: 8192, disk: 30720, icon: '🪓', allocPort: 28015 },
    { id: 'palworld', label: 'Palworld', image: 'thijsvanloef/palworld-server-docker', startup: '', memory: 8192, disk: 30720, icon: '🦊', allocPort: 8211 },
    { id: 'velocity', label: 'Velocity Proxy', image: 'wings-panel-velocity', startup: '', memory: 512, disk: 1024, icon: '⚡', allocPort: 25577 },
    { id: 'custom', label: 'Custom Docker Image', image: '', startup: '', memory: 2048, disk: 10240, icon: '🐳', allocPort: 0 },
  ]

  const [isRegisteringNode, setIsRegisteringNode] = useState(false)
  const [nodeName, setNodeName] = useState('')
  const [nodeFQDN, setNodeFQDN] = useState('')
  const [nodeIP, setNodeIP] = useState('')
  const [nodeToken, setNodeToken] = useState('')

  const [isCreatingAlloc, setIsCreatingAlloc] = useState(false)
  const [allocNodeId, setAllocNodeId] = useState(0)
  const [allocIP, setAllocIP] = useState('0.0.0.0')
  const [allocPortStart, setAllocPortStart] = useState(25565)
  const [allocCount, setAllocCount] = useState(10)

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [nodeSummaries, setNodeSummaries] = useState<NodeSummary[]>([])

  const [popup, setPopup] = useState<{ open: boolean; type: 'info' | 'success' | 'error' | 'confirm'; title: string; message: string; onConfirm?: () => void }>({ open: false, type: 'info', title: '', message: '' })
  const showPopup = (type: 'info' | 'success' | 'error' | 'confirm', title: string, message: string, onConfirm?: () => void) => setPopup({ open: true, type, title, message, onConfirm })

  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([])
  const [activityOffset, setActivityOffset] = useState(0)
  const [activityFilterServer, setActivityFilterServer] = useState('')
  const [activityHasMore, setActivityHasMore] = useState(false)

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [isCreatingKey, setIsCreatingKey] = useState(false)
  const [keyFormName, setKeyFormName] = useState('')
  const [keyFormPerms, setKeyFormPerms] = useState<string[]>(['servers.read'])
  const [keyFormExpiry, setKeyFormExpiry] = useState('')
  const [newApiKeyRaw, setNewApiKeyRaw] = useState<string | null>(null)

  const [panelUsers, setPanelUsers] = useState<{ id: number; username: string; email: string; root_admin: boolean; created_at: string }[]>([])
  const [isCreatingUser, setIsCreatingUser] = useState(false)
  const [userFormName, setUserFormName] = useState('')
  const [userFormEmail, setUserFormEmail] = useState('')
  const [userFormPass, setUserFormPass] = useState('')
  const [userFormAdmin, setUserFormAdmin] = useState(false)
  const [editingUser, setEditingUser] = useState<number | null>(null)
  const [userEditEmail, setUserEditEmail] = useState('')
  const [userEditPass, setUserEditPass] = useState('')
  const [userEditAdmin, setUserEditAdmin] = useState(false)

  const [settingsTab, setSettingsTab] = useState<'profile' | 'security' | 'panel'>('profile')
  const [settingsEmail, setSettingsEmail] = useState('')
  const [settingsNewPass, setSettingsNewPass] = useState('')
  const [settingsConfirmPass, setSettingsConfirmPass] = useState('')
  const [selectedServerIds, setSelectedServerIds] = useState<number[]>([])
  const [bulkAction, setBulkAction] = useState('')

  const [detailTab, setDetailTab] = useState<'console' | 'files' | 'logs' | 'schedules' | 'backups' | 'members' | 'stats' | 'activity'>('console')

  const [logsContent, setLogsContent] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsTail, setLogsTail] = useState(100)

  const [showCloneDialog, setShowCloneDialog] = useState(false)
  const [cloneName, setCloneName] = useState('')
  const [cloning, setCloning] = useState(false)

  const [showScheduleDialog, setShowScheduleDialog] = useState(false)
  const [scheduleAction, setScheduleAction] = useState('start')
  const [scheduleTime, setScheduleTime] = useState('')
  const [scheduleRecurring, setScheduleRecurring] = useState(false)
  const [scheduleCron, setScheduleCron] = useState('0 0 * * *')
  const [schedules, setSchedules] = useState<any[]>([])

  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [settingsName, setSettingsName] = useState('')
  const [settingsDesc, setSettingsDesc] = useState('')
  const [settingsCpu, setSettingsCpu] = useState(100)
  const [settingsMemory, setSettingsMemory] = useState(1024)
  const [settingsDisk, setSettingsDisk] = useState(5120)
  const [settingsImage, setSettingsImage] = useState('')
  const [settingsStartup, setSettingsStartup] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)

  const [showShareDialog, setShowShareDialog] = useState(false)
  const [members, setMembers] = useState<any[]>([])
  const [shareUsername, setShareUsername] = useState('')
  const [sharePerms, setSharePerms] = useState<string[]>(['console', 'power', 'files', 'schedules', 'logs'])

  const [theme, setTheme] = useState<'dark' | 'light'>(() => (typeof window !== 'undefined' && localStorage.getItem('wings_theme') === 'light') ? 'light' : 'dark')

  const [showNetworkDialog, setShowNetworkDialog] = useState(false)
  const [networkName, setNetworkName] = useState('')
  const [networkDriver, setNetworkDriver] = useState('bridge')

  const [serverGroups, setServerGroups] = useState<any[]>([])
  const [showGroupDialog, setShowGroupDialog] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupColor, setGroupColor] = useState('#38bdf8')
  const [groupDescription, setGroupDescription] = useState('')
  const [editingGroup, setEditingGroup] = useState<number | null>(null)

  // Cloudflare DNS
  const [cloudflareRecords, setCloudflareRecords] = useState<any[]>([])
  const [showCloudflareDialog, setShowCloudflareDialog] = useState(false)
  const [cfRecordType, setCfRecordType] = useState('A')
  const [cfRecordName, setCfRecordName] = useState('')
  const [cfRecordContent, setCfRecordContent] = useState('')
  const [cfRecordTTL, setCfRecordTTL] = useState(300)
  const [cfRecordProxied, setCfRecordProxied] = useState(false)
  const [cfLoading, setCfLoading] = useState(false)

  // Playit.gg Tunnels
  const [playitTunnels, setPlayitTunnels] = useState<any[]>([])
  const [showPlayitDialog, setShowPlayitDialog] = useState(false)
  const [playitTunnelName, setPlayitTunnelName] = useState('')
  const [playitTunnelPort, setPlayitTunnelPort] = useState(25565)
  const [playitTunnelProtocol, setPlayitTunnelProtocol] = useState('tcp')
  const [playitLoading, setPlayitLoading] = useState(false)

  // Bug Report
  const [showBugReport, setShowBugReport] = useState(false)
  const [bugReportTitle, setBugReportTitle] = useState('')
  const [bugReportDesc, setBugReportDesc] = useState('')
  const [bugReportSeverity, setBugReportSeverity] = useState('medium')
  const [bugReportLoading, setBugReportLoading] = useState(false)

  // Backups
  const [backups, setBackups] = useState<any[]>([])
  const [backupsLoading, setBackupsLoading] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)

  // Live stats
  const [liveStats, setLiveStats] = useState<any>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const statsTimerRef = useRef<any>(null)

  // Per-server activity
  const [serverActivity, setServerActivity] = useState<ActivityLogEntry[]>([])

  // Templates
  const [templates, setTemplates] = useState<any[]>([])
  const [showTemplateDialog, setShowTemplateDialog] = useState(false)
  const [templateForm, setTemplateForm] = useState<any>({ name: '', description: '', docker_image: 'itzg/minecraft-server', docker_network: 'pterodactyl-net', startup_command: '', cpu_limit: 100, memory_limit: 2048, disk_limit: 10240, alloc_port: 25565, featured: false })
  const [templateSaving, setTemplateSaving] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<number | null>(null)

  // Webhooks
  const [webhooks, setWebhooks] = useState<any[]>([])
  const [showWebhookDialog, setShowWebhookDialog] = useState(false)
  const [webhookForm, setWebhookForm] = useState<any>({ name: '', url: '', events: ['server.created'], is_active: true })
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [editingWebhook, setEditingWebhook] = useState<number | null>(null)

  // Announcements
  const [announcements, setAnnouncements] = useState<any[]>([])
  const [showAnnouncementDialog, setShowAnnouncementDialog] = useState(false)
  const [announcementForm, setAnnouncementForm] = useState<any>({ title: '', content: '', color: '#38bdf8', is_active: true })
  const [announcementSaving, setAnnouncementSaving] = useState(false)
  const [editingAnnouncement, setEditingAnnouncement] = useState<number | null>(null)

  // Panel settings
  const [panelSettings, setPanelSettings] = useState<any>({ site_name: 'Wings Panel', maintenance_mode: false, registration_enabled: true, default_theme: 'dark' })

  // Docker images
  const [dockerImages, setDockerImages] = useState<any[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [dockerImagesError, setDockerImagesError] = useState<string | null>(null)

  // Node ping results
  const [nodePings, setNodePings] = useState<{ [nodeId: number]: { ok: boolean; detail: string; ms: number } }>({})
  const [bugReports, setBugReports] = useState<any[]>([])
  const [showBugList, setShowBugList] = useState(false)

  const authHeaders = useCallback((): Record<string, string> => token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : {}, [token])

  const apiFetch = useCallback(async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { ...authHeaders(), ...opts.headers } })
    if (res.status === 401) {
      setToken(null); setUser(null); localStorage.removeItem('panel_token')
    }
    return res
  }, [authHeaders])

  const asArray = (d: any): any[] => Array.isArray(d) ? d : []

  useEffect(() => {
    const saved = localStorage.getItem('panel_token')
    if (saved) { setToken(saved); verifyToken(saved) }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('wings_theme', theme)
  }, [theme])

  useEffect(() => {
    if (!user) return
    const id = setInterval(() => { fetchAll() }, 10000)
    return () => clearInterval(id)
  }, [user])

  const verifyToken = async (t: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { 'Authorization': `Bearer ${t}` } })
      if (res.ok) { const u = await res.json(); setUser(u) }
      else { setToken(null); localStorage.removeItem('panel_token') }
    } catch { setToken(null); localStorage.removeItem('panel_token') }
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    const endpoint = authPage === 'login' ? '/api/auth/login' : '/api/auth/register'
    const body = authPage === 'login'
      ? { username: authUsername, password: authPassword }
      : { username: authUsername, email: authEmail, password: authPassword }
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (res.ok) {
        const data = await res.json()
        setToken(data.token)
        setUser(data.user)
        localStorage.setItem('panel_token', data.token)
      } else {
        const err = await res.json()
        setAuthError(err.detail || 'Auth failed')
      }
    } catch { setAuthError('Cannot reach panel API') }
  }

  const logout = () => { setToken(null); setUser(null); localStorage.removeItem('panel_token') }

  useEffect(() => { if (user) fetchAll() }, [user])

  const fetchAll = async () => {
    try {
      const nRes = await apiFetch('/api/nodes')
      if (nRes.ok) setNodes(asArray(await nRes.json()))
      const sRes = await apiFetch('/api/servers')
      if (sRes.ok) setServers(asArray(await sRes.json()))
      const aRes = await apiFetch('/api/allocations')
      if (aRes.ok) setAllocations(asArray(await aRes.json()))
      try { const sysRes = await apiFetch('/api/system/status'); if (sysRes.ok) setSystemStatus(await sysRes.json()) } catch {}
      try { const sumRes = await apiFetch('/api/system/nodes-summary'); if (sumRes.ok) setNodeSummaries(asArray(await sumRes.json())) } catch {}
      try { const netRes = await apiFetch('/api/system/docker-networks'); if (netRes.ok) setDockerNetworks(asArray(await netRes.json())) } catch {}
      try { const grpRes = await apiFetch('/api/server-groups'); if (grpRes.ok) setServerGroups(asArray(await grpRes.json())) } catch {}
      if (activeTab === 'system') {
        try { const cfRes = await apiFetch('/api/cloudflare/dns/list'); if (cfRes.ok) { const d = await cfRes.json(); setCloudflareRecords(asArray(d.records)) } } catch {}
        try { const ptRes = await apiFetch('/api/playit/tunnel/list'); if (ptRes.ok) { const d = await ptRes.json(); setPlayitTunnels(asArray(d.tunnels)) } } catch {}
        try { const imgRes = await apiFetch('/api/system/images'); if (imgRes.ok) setDockerImages(asArray(await imgRes.json())) } catch {}
      }
      if (activeTab === 'dashboard') {
        try { const actRes = await apiFetch('/api/activity?limit=8'); if (actRes.ok) setActivityLogs(asArray(await actRes.json())) } catch {}
        try { const annRes = await apiFetch('/api/announcements'); if (annRes.ok) setAnnouncements(asArray(await annRes.json())) } catch {}
      }
      if (activeTab === 'templates') { try { await fetchTemplates() } catch {} }
      if (activeTab === 'webhooks') { try { await fetchWebhooks() } catch {} }
      if (activeTab === 'settings') { try { await fetchPanelSettings() } catch {} }
    } catch (e) { console.error(e) }
  }

  useEffect(() => { if (activeTab === 'dashboard' || activeTab === 'templates' || activeTab === 'webhooks' || activeTab === 'settings') fetchAll() }, [activeTab])

  useEffect(() => {
    if (!selectedServer) return
    if (detailTab === 'backups') fetchBackups(selectedServer.id)
    if (detailTab === 'members') fetchMembers(selectedServer.id)
    if (detailTab === 'stats') { startStatsPolling(selectedServer.id); return () => stopStatsPolling() }
    if (detailTab === 'activity') fetchServerActivity(selectedServer.id)
  }, [selectedServer, detailTab])

  useEffect(() => {
    if (!selectedServer) { cleanupConsole(); return }
    setEditingFile(null); setCurrentPath('')
    fetchFiles(selectedServer.id, ''); fetchStats(selectedServer.id)
    cleanupConsole()
    return () => { cleanupConsole() }
  }, [selectedServer])

  const cleanupConsole = () => {
    if (wsRef.current) { try { wsRef.current.close() } catch {} wsRef.current = null }
    if (terminalRef.current) { try { terminalRef.current.dispose() } catch {} terminalRef.current = null }
    fitAddonRef.current = null
    setConsoleUrl('')
    setConsoleError('')
    setConsoleConnected(false)
  }

  const initTerminal = async () => {
    if (terminalRef.current || !terminalContainerRef.current) return
    if (typeof window === 'undefined') return
    const { Terminal } = await import('xterm')
    const { FitAddon } = await import('@xterm/addon-fit')
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'var(--font-mono), monospace',
      theme: { background: '#0d1117', foreground: '#e6edf3' },
      convertEol: true,
      scrollback: 2000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(terminalContainerRef.current)
    fit.fit()
    terminalRef.current = term
    fitAddonRef.current = fit
    term.onData((data) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(data)
      }
    })
  }

  const startConsole = async (serverId: number) => {
    setConsoleLoading(true)
    setConsoleError('')
    await initTerminal()
    const term = terminalRef.current
    if (!term) { setConsoleError('Terminal failed to initialize'); setConsoleLoading(false); return }
    try {
      const base = API_BASE.replace(/^https/, 'wss').replace(/^http/, 'ws')
      const ws = new WebSocket(`${base}/ws/servers/${serverId}/console?token=${encodeURIComponent(token || '')}`)
      wsRef.current = ws
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        setConsoleConnected(true)
        setConsoleLoading(false)
        term.writeln('Connected to container shell. Type commands below.')
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          term.write(ev.data)
        } else {
          term.write(new Uint8Array(ev.data as ArrayBuffer))
        }
      }
      ws.onclose = () => {
        setConsoleConnected(false)
        setConsoleLoading(false)
        if (wsRef.current === ws) wsRef.current = null
      }
      ws.onerror = () => {
        setConsoleError('WebSocket connection failed. Is the server running?')
        setConsoleConnected(false)
        setConsoleLoading(false)
      }
    } catch {
      setConsoleError('Cannot reach panel websocket')
      setConsoleLoading(false)
    }
  }

  const stopConsole = async () => {
    if (wsRef.current) { try { wsRef.current.close() } catch {} wsRef.current = null }
    if (terminalRef.current) { try { terminalRef.current.dispose() } catch {} terminalRef.current = null }
    terminalRef.current = null
    fitAddonRef.current = null
    setConsoleUrl('')
    setConsoleConnected(false)
  }

  const disconnectConsole = () => { cleanupConsole() }

  useEffect(() => {
    if (!selectedServer) return
    const id = setInterval(() => { fetchStats(selectedServer.id) }, 3000)
    return () => clearInterval(id)
  }, [selectedServer])

  const fetchStats = async (serverId: number) => {
    try { const res = await apiFetch(`/api/servers/${serverId}/stats`); if (res.ok) { const d = await res.json(); setStats({ cpu: d.cpu_percentage || 0, memory: d.memory_mb || 0, disk: d.disk_mb || 0, status: d.status || 'offline' }) } } catch {}
  }

  const fetchLogs = async (serverId: number) => {
    setLogsLoading(true)
    try { const res = await apiFetch(`/api/servers/${serverId}/logs?tail=${logsTail}`); if (res.ok) { const d = await res.json(); setLogsContent(d.logs || '') } } catch {}
    setLogsLoading(false)
  }

  const cloneServer = async (srv: Server) => {
    if (!cloneName.trim()) { showPopup('error', 'Missing Name', 'Enter a name for the cloned server'); return }
    setCloning(true)
    try {
      const res = await apiFetch(`/api/servers/${srv.id}/clone`, { method: 'POST', body: JSON.stringify({ name: cloneName }) })
      if (res.ok) { showPopup('success', 'Cloned', `Server cloned as "${cloneName}".`); setShowCloneDialog(false); setCloneName(''); fetchAll() }
      else { const e = await res.json(); showPopup('error', 'Clone Failed', e.detail || 'Failed to clone server') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setCloning(false)
  }

  const fetchSchedules = async (serverId: number) => {
    try { const res = await apiFetch(`/api/servers/${serverId}/schedules`); if (res.ok) setSchedules(asArray(await res.json())) } catch {}
  }

  const createSchedule = async () => {
    if (!selectedServer) return
    if (!scheduleTime && !scheduleCron) { showPopup('error', 'Missing Info', 'Select a time (or a cron pattern for recurring schedules)'); return }
    try {
      const res = await apiFetch(`/api/servers/${selectedServer.id}/schedules`, { method: 'POST', body: JSON.stringify({ action: scheduleAction, scheduled_time: scheduleTime ? new Date(scheduleTime).toISOString() : null, recurring: scheduleRecurring, recurring_pattern: scheduleRecurring ? scheduleCron : null }) })
      if (res.ok) { showPopup('success', 'Scheduled', `Power action scheduled.`); setShowScheduleDialog(false); setScheduleTime(''); setScheduleRecurring(false); setScheduleCron('0 0 * * *'); fetchSchedules(selectedServer.id); fetchAll() }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed to create schedule') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const deleteSchedule = async (scheduleId: number) => {
    showPopup('confirm', 'Delete Schedule', 'Delete this schedule?', async () => {
      try { const res = await apiFetch(`/api/servers/${selectedServer?.id}/schedules/${scheduleId}`, { method: 'DELETE' }); if (res.ok) { showPopup('success', 'Deleted', 'Schedule removed.'); fetchSchedules(selectedServer!.id); fetchAll() } } catch {}
    })
  }

  const toggleSchedule = async (scheduleId: number, isActive: boolean) => {
    try {
      const res = await apiFetch(`/api/servers/${selectedServer?.id}/schedules/${scheduleId}/toggle`, { method: 'POST' })
      if (res.ok) { showPopup('success', 'Updated', isActive ? 'Schedule paused.' : 'Schedule activated.'); fetchSchedules(selectedServer!.id) }
    } catch {}
  }

  const createNetwork = async () => {
    if (!networkName.trim()) { showPopup('error', 'Missing Name', 'Enter a network name'); return }
    try {
      const res = await apiFetch('/api/system/networks', { method: 'POST', body: JSON.stringify({ name: networkName, driver: networkDriver }) })
      if (res.ok) { showPopup('success', 'Created', `Network "${networkName}" created.`); setShowNetworkDialog(false); setNetworkName(''); fetchAll() }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed to create network') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const deleteNetwork = async (name: string) => {
    showPopup('confirm', 'Delete Network', `Delete network "${name}"?`, async () => {
      try { const res = await apiFetch(`/api/system/networks/${encodeURIComponent(name)}`, { method: 'DELETE' }); if (res.ok) { showPopup('success', 'Deleted', `Network "${name}" removed.`); fetchAll() } } catch {}
    })
  }

  const fetchServerGroups = async () => {
    try { const res = await apiFetch('/api/server-groups'); if (res.ok) setServerGroups(await res.json()) } catch {}
  }

  const createServerGroup = async () => {
    if (!groupName.trim()) { showPopup('error', 'Missing Name', 'Enter a group name'); return }
    try {
      const res = await apiFetch('/api/server-groups', { method: 'POST', body: JSON.stringify({ name: groupName, description: groupDescription, color: groupColor }) })
      if (res.ok) { showPopup('success', 'Created', `Group "${groupName}" created.`); setShowGroupDialog(false); setGroupName(''); setGroupDescription(''); fetchServerGroups(); fetchAll() }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed to create group') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const deleteServerGroup = async (groupId: number, name: string) => {
    showPopup('confirm', 'Delete Group', `Delete group "${name}"?`, async () => {
      try { const res = await apiFetch(`/api/server-groups/${groupId}`, { method: 'DELETE' }); if (res.ok) { showPopup('success', 'Deleted', `Group "${name}" removed.`); fetchServerGroups(); fetchAll() } } catch {}
    })
  }

  const assignServerToGroup = async (serverId: number, groupId: number | null) => {
    try {
      const res = await apiFetch(`/api/servers/${serverId}`, { method: 'PATCH', body: JSON.stringify({ group_id: groupId }) })
      if (res.ok) { showPopup('success', 'Updated', 'Server group updated.'); fetchAll() }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed to update group') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const openSettingsDialog = (srv: Server) => {
    setSettingsName(srv.name)
    setSettingsDesc(srv.description || '')
    setSettingsCpu(srv.cpu_limit)
    setSettingsMemory(srv.memory_limit)
    setSettingsDisk(srv.disk_limit)
    setSettingsImage(srv.docker_image)
    setSettingsStartup(srv.startup_command || '')
    setShowSettingsDialog(true)
  }

  const saveServerSettings = async () => {
    if (!selectedServer) return
    setSettingsSaving(true)
    try {
      const body: any = {
        name: settingsName,
        description: settingsDesc,
        cpu_limit: settingsCpu,
        memory_limit: settingsMemory,
        disk_limit: settingsDisk,
        docker_image: settingsImage,
        startup_command: settingsStartup,
      }
      const res = await apiFetch(`/api/servers/${selectedServer.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (res.ok) {
        showPopup('success', 'Saved', 'Server settings updated.')
        setShowSettingsDialog(false)
        fetchAll()
        setSelectedServer({ ...selectedServer, ...body })
      } else { const e = await res.json(); showPopup('error', 'Update Failed', e.detail || 'Failed to update settings') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setSettingsSaving(false)
  }

  const openShareDialog = async (srv: Server) => {
    setShareUsername('')
    setSharePerms(['console', 'power', 'files', 'schedules', 'logs'])
    setShowShareDialog(true)
    await fetchMembers(srv.id)
  }

  const fetchMembers = async (serverId: number) => {
    try { const res = await apiFetch(`/api/servers/${serverId}/members`); if (res.ok) setMembers(asArray(await res.json())) } catch {}
  }

  const addMember = async () => {
    if (!selectedServer || !shareUsername.trim()) { showPopup('error', 'Missing Info', 'Enter a username or email'); return }
    try {
      const res = await apiFetch(`/api/servers/${selectedServer.id}/members`, { method: 'POST', body: JSON.stringify({ username: shareUsername.trim(), permissions: sharePerms.join(',') }) })
      if (res.ok) { showPopup('success', 'Shared', `Server shared with ${shareUsername.trim()}.`); setShareUsername(''); fetchMembers(selectedServer.id) }
      else { const e = await res.json(); showPopup('error', 'Share Failed', e.detail || 'Failed to share server') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const removeMember = async (member: any) => {
    if (!selectedServer) return
    showPopup('confirm', 'Remove Access', `Remove "${member.username}" from this server?`, async () => {
      try { const res = await apiFetch(`/api/servers/${selectedServer!.id}/members/${member.id}`, { method: 'DELETE' }); if (res.ok) { showPopup('success', 'Removed', 'Access removed.'); fetchMembers(selectedServer!.id) } } catch {}
    })
  }

  const updateMemberPerms = async (member: any, perms: string[]) => {
    if (!selectedServer) return
    try {
      const res = await apiFetch(`/api/servers/${selectedServer.id}/members/${member.id}/permissions`, { method: 'POST', body: JSON.stringify({ permissions: perms.join(',') }) })
      if (res.ok) { showPopup('success', 'Updated', 'Permissions updated.'); fetchMembers(selectedServer.id) }
    } catch {}
  }

  // --- Backups ---
  const fetchBackups = async (serverId: number) => {
    setBackupsLoading(true)
    try { const res = await apiFetch(`/api/servers/${serverId}/backups`); if (res.ok) setBackups(asArray(await res.json())) } catch {}
    setBackupsLoading(false)
  }

  const createBackup = async () => {
    if (!selectedServer) return
    setCreatingBackup(true)
    try {
      const res = await apiFetch(`/api/servers/${selectedServer.id}/backups`, { method: 'POST', body: JSON.stringify({}) })
      if (res.ok) { showPopup('success', 'Backup Started', 'Backup created. It may take a moment to complete.'); fetchBackups(selectedServer.id) }
      else { const e = await res.json(); showPopup('error', 'Backup Failed', e.detail || 'Failed to create backup') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setCreatingBackup(false)
  }

  const restoreBackup = async (backupId: string) => {
    if (!selectedServer) return
    showPopup('confirm', 'Restore Backup', 'Restore this backup? This overwrites current server files.', async () => {
      try {
        const res = await apiFetch(`/api/servers/${selectedServer!.id}/backups/${backupId}/restore`, { method: 'POST' })
        if (res.ok) { showPopup('success', 'Restored', 'Backup restored.'); fetchBackups(selectedServer!.id) }
        else { const e = await res.json(); showPopup('error', 'Restore Failed', e.detail || 'Failed to restore backup') }
      } catch { showPopup('error', 'Error', 'Connection failed') }
    })
  }

  const deleteBackup = async (backupId: string) => {
    if (!selectedServer) return
    showPopup('confirm', 'Delete Backup', 'Delete this backup file? This cannot be undone.', async () => {
      try {
        const res = await apiFetch(`/api/servers/${selectedServer!.id}/backups/${backupId}`, { method: 'DELETE' })
        if (res.ok) { showPopup('success', 'Deleted', 'Backup removed.'); fetchBackups(selectedServer!.id) }
        else { const e = await res.json(); showPopup('error', 'Delete Failed', e.detail || 'Failed to delete backup') }
      } catch { showPopup('error', 'Error', 'Connection failed') }
    })
  }

  // --- Live stats ---
  const fetchLiveStats = async (serverId: number) => {
    try { const res = await apiFetch(`/api/servers/${serverId}/stats`); if (res.ok) { const d = await res.json(); setLiveStats(d); setStats({ cpu: d.cpu_percentage || 0, memory: d.memory_mb || 0, disk: d.disk_mb || 0, status: d.status || 'offline' }) } } catch {}
  }

  const startStatsPolling = (serverId: number) => {
    if (statsTimerRef.current) clearInterval(statsTimerRef.current)
    fetchLiveStats(serverId)
    statsTimerRef.current = setInterval(() => fetchLiveStats(serverId), 3000)
  }

  const stopStatsPolling = () => {
    if (statsTimerRef.current) { clearInterval(statsTimerRef.current); statsTimerRef.current = null }
  }

  // --- Per-server activity ---
  const fetchServerActivity = async (serverId: number) => {
    try { const res = await apiFetch(`/api/servers/${serverId}/activity?limit=20`); if (res.ok) setServerActivity(asArray(await res.json())) } catch {}
  }

  // --- Templates ---
  const fetchTemplates = async () => {
    try { const res = await apiFetch('/api/templates'); if (res.ok) setTemplates(asArray(await res.json())) } catch {}
  }

  const applyTemplate = (t: any) => {
    setFormImage(t.docker_image || 'itzg/minecraft-server')
    setFormNetwork(t.docker_network || 'pterodactyl-net')
    setFormStartup(t.startup_command || '')
    setFormStartupAuto(false)
    setFormCpu(t.cpu_limit || 100)
    setFormMemory(t.memory_limit || 2048)
    setFormDisk(t.disk_limit || 10240)
    setActiveTab('create-server')
    showPopup('success', 'Template Applied', `"${t.name}" applied to the deploy form.`)
  }

  const saveTemplateFromCurrent = async () => {
    if (!selectedServer) return
    const t = templateForm
    try {
      const res = await apiFetch('/api/templates', { method: 'POST', body: JSON.stringify({ name: t.name, description: t.description, docker_image: t.docker_image, docker_network: t.docker_network, startup_command: t.startup_command, cpu_limit: Number(t.cpu_limit), memory_limit: Number(t.memory_limit), disk_limit: Number(t.disk_limit), alloc_port: t.alloc_port ? Number(t.alloc_port) : undefined, featured: !!t.featured }) })
      if (res.ok) { showPopup('success', 'Saved', `Template "${t.name}" created.`); setShowTemplateDialog(false); setTemplateForm({ name: '', description: '', docker_image: selectedServer.docker_image, docker_network: selectedServer.docker_network, startup_command: selectedServer.startup_command || '', cpu_limit: selectedServer.cpu_limit, memory_limit: selectedServer.memory_limit, disk_limit: selectedServer.disk_limit, alloc_port: selectedServer.allocations?.[0]?.port, featured: false }); fetchTemplates() }
      else { const e = await res.json(); showPopup('error', 'Save Failed', e.detail || 'Failed to create template') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const saveTemplate = async () => {
    setTemplateSaving(true)
    try {
      const body = { name: templateForm.name, description: templateForm.description, docker_image: templateForm.docker_image, docker_network: templateForm.docker_network, startup_command: templateForm.startup_command, cpu_limit: Number(templateForm.cpu_limit), memory_limit: Number(templateForm.memory_limit), disk_limit: Number(templateForm.disk_limit), alloc_port: templateForm.alloc_port ? Number(templateForm.alloc_port) : undefined, featured: !!templateForm.featured }
      const res = editingTemplate
        ? await apiFetch(`/api/templates/${editingTemplate}`, { method: 'PUT', body: JSON.stringify(body) })
        : await apiFetch('/api/templates', { method: 'POST', body: JSON.stringify(body) })
      if (res.ok) { showPopup('success', 'Saved', 'Template saved.'); setShowTemplateDialog(false); setEditingTemplate(null); setTemplateForm({ name: '', description: '', docker_image: 'itzg/minecraft-server', docker_network: 'pterodactyl-net', startup_command: '', cpu_limit: 100, memory_limit: 2048, disk_limit: 10240, alloc_port: 25565, featured: false }); fetchTemplates() }
      else { const e = await res.json(); showPopup('error', 'Save Failed', e.detail || 'Failed to save template') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setTemplateSaving(false)
  }

  const deleteTemplate = async (id: number, name: string) => {
    showPopup('confirm', 'Delete Template', `Delete template "${name}"?`, async () => {
      try { const res = await apiFetch(`/api/templates/${id}`, { method: 'DELETE' }); if (res.ok) { showPopup('success', 'Deleted', 'Template removed.'); fetchTemplates() } } catch {}
    })
  }

  // --- Webhooks ---
  const fetchWebhooks = async () => {
    try { const res = await apiFetch('/api/webhooks'); if (res.ok) setWebhooks(asArray(await res.json())) } catch {}
  }

  const toggleWebhookEvent = (event: string) => {
    setWebhookForm((prev: any) => ({ ...prev, events: prev.events.includes(event) ? prev.events.filter((e: string) => e !== event) : [...prev.events, event] }))
  }

  const saveWebhook = async () => {
    if (!webhookForm.name.trim() || !webhookForm.url.trim()) { showPopup('error', 'Missing Info', 'Name and URL are required'); return }
    if (!webhookForm.url.startsWith('http')) { showPopup('error', 'Invalid URL', 'Webhook URL must start with http:// or https://'); return }
    setWebhookSaving(true)
    try {
      const body = { name: webhookForm.name, url: webhookForm.url, events: webhookForm.events.join(','), is_active: webhookForm.is_active }
      const res = editingWebhook
        ? await apiFetch(`/api/webhooks/${editingWebhook}`, { method: 'PUT', body: JSON.stringify(body) })
        : await apiFetch('/api/webhooks', { method: 'POST', body: JSON.stringify(body) })
      if (res.ok) { showPopup('success', 'Saved', 'Webhook saved.'); setShowWebhookDialog(false); setEditingWebhook(null); setWebhookForm({ name: '', url: '', events: ['server.created'], is_active: true }); fetchWebhooks() }
      else { const e = await res.json(); showPopup('error', 'Save Failed', e.detail || 'Failed to save webhook') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setWebhookSaving(false)
  }

  const deleteWebhook = async (id: number, name: string) => {
    showPopup('confirm', 'Delete Webhook', `Delete webhook "${name}"?`, async () => {
      try { const res = await apiFetch(`/api/webhooks/${id}`, { method: 'DELETE' }); if (res.ok) { showPopup('success', 'Deleted', 'Webhook removed.'); fetchWebhooks() } } catch {}
    })
  }

  const testWebhook = async (id: number) => {
    try {
      const res = await apiFetch(`/api/webhooks/${id}/test`, { method: 'POST' })
      if (res.ok) { const d = await res.json(); showPopup(d.ok ? 'success' : 'error', d.ok ? 'Delivered' : 'Failed', d.ok ? `Webhook delivered (HTTP ${d.status}).` : `Webhook responded with HTTP ${d.status}.`) }
      else { const e = await res.json(); showPopup('error', 'Test Failed', e.detail || 'Failed to send test') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  // --- Announcements ---
  const fetchAnnouncements = async () => {
    try { const res = await apiFetch('/api/announcements'); if (res.ok) setAnnouncements(asArray(await res.json())) } catch {}
  }

  const saveAnnouncement = async () => {
    if (!announcementForm.title.trim()) { showPopup('error', 'Missing Title', 'Enter an announcement title'); return }
    setAnnouncementSaving(true)
    try {
      const res = editingAnnouncement
        ? await apiFetch(`/api/announcements/${editingAnnouncement}`, { method: 'PUT', body: JSON.stringify(announcementForm) })
        : await apiFetch('/api/announcements', { method: 'POST', body: JSON.stringify(announcementForm) })
      if (res.ok) { showPopup('success', 'Saved', 'Announcement saved.'); setShowAnnouncementDialog(false); setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', color: '#38bdf8', is_active: true }); fetchAnnouncements() }
      else { const e = await res.json(); showPopup('error', 'Save Failed', e.detail || 'Failed to save announcement') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setAnnouncementSaving(false)
  }

  const deleteAnnouncement = async (id: number, title: string) => {
    showPopup('confirm', 'Delete Announcement', `Delete announcement "${title}"?`, async () => {
      try { const res = await apiFetch(`/api/announcements/${id}`, { method: 'DELETE' }); if (res.ok) { showPopup('success', 'Deleted', 'Announcement removed.'); fetchAnnouncements() } } catch {}
    })
  }

  // --- Panel settings ---
  const fetchPanelSettings = async () => {
    try { const res = await apiFetch('/api/settings'); if (res.ok) setPanelSettings(await res.json()) } catch {}
  }

  const savePanelSettings = async () => {
    try {
      const res = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ site_name: panelSettings.site_name, maintenance_mode: panelSettings.maintenance_mode, registration_enabled: panelSettings.registration_enabled, default_theme: panelSettings.default_theme }) })
      if (res.ok) { showPopup('success', 'Saved', 'Panel settings updated.'); fetchPanelSettings() }
      else { const e = await res.json(); showPopup('error', 'Save Failed', e.detail || 'Failed to update settings') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  // --- Docker images ---
  const fetchDockerImages = async () => {
    setImagesLoading(true)
    try { const res = await apiFetch('/api/system/images'); if (res.ok) { setDockerImages(asArray(await res.json())); setDockerImagesError(null) } else { const e = await res.json().catch(() => null); setDockerImagesError(e?.detail || 'Failed to load images') } } catch { setDockerImagesError('Daemon unreachable') }
    setImagesLoading(false)
  }

  const removeDockerImage = async (name: string) => {
    showPopup('confirm', 'Remove Image', `Remove Docker image "${name}"? This frees disk space but the image may be needed by running servers.`, async () => {
      try {
        const res = await apiFetch(`/api/system/images/${encodeURIComponent(name)}`, { method: 'DELETE' })
        if (res.ok) { showPopup('success', 'Removed', `Image "${name}" removed.`); fetchDockerImages() }
        else { const e = await res.json(); showPopup('error', 'Remove Failed', e.detail || 'Failed to remove image') }
      } catch { showPopup('error', 'Error', 'Connection failed') }
    })
  }

  // --- Node ping ---
  const pingNode = async (nodeId: number) => {
    setNodePings(prev => ({ ...prev, [nodeId]: { ok: false, detail: 'Pinging...', ms: 0 } }))
    try {
      const start = Date.now()
      const res = await apiFetch(`/api/nodes/${nodeId}/ping`)
      const ms = Date.now() - start
      if (res.ok) { const d = await res.json(); setNodePings(prev => ({ ...prev, [nodeId]: { ok: true, detail: d.detail || 'Online', ms } })) }
      else { const e = await res.json(); setNodePings(prev => ({ ...prev, [nodeId]: { ok: false, detail: e.detail || 'Unreachable', ms } })) }
    } catch { setNodePings(prev => ({ ...prev, [nodeId]: { ok: false, detail: 'Unreachable', ms: 0 } })) }
  }

  // Cloudflare DNS functions
  const fetchCloudflareRecords = async () => {
    setCfLoading(true)
    try { const res = await apiFetch('/api/cloudflare/dns/list'); if (res.ok) { const data = await res.json(); setCloudflareRecords(data.records || []) } } catch {}
    setCfLoading(false)
  }

  const createCloudflareRecord = async () => {
    if (!cfRecordName.trim() || !cfRecordContent.trim()) { showPopup('error', 'Missing Info', 'Name and Content are required'); return }
    setCfLoading(true)
    try {
      const res = await apiFetch('/api/cloudflare/dns/create', { method: 'POST', body: JSON.stringify({ type: cfRecordType, name: cfRecordName, content: cfRecordContent, ttl: cfRecordTTL, proxied: cfRecordProxied }) })
      if (res.ok) { showPopup('success', 'Created', 'DNS record created.'); setShowCloudflareDialog(false); setCfRecordName(''); setCfRecordContent(''); fetchCloudflareRecords(); fetchAll() }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed to create record') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setCfLoading(false)
  }

  const deleteCloudflareRecord = async (recordId: string) => {
    showPopup('confirm', 'Delete Record', `Delete DNS record "${recordId}"?`, async () => {
      try { const res = await apiFetch(`/api/cloudflare/dns/delete/${recordId}`, { method: 'DELETE' }); if (res.ok) { showPopup('success', 'Deleted', 'DNS record removed.'); fetchCloudflareRecords() } } catch {}
    })
  }

  // Playit.gg functions
  const fetchPlayitTunnels = async () => {
    try { const res = await apiFetch('/api/playit/tunnel/list'); if (res.ok) { const data = await res.json(); setPlayitTunnels(data.tunnels || []) } } catch {}
  }

  const createPlayitTunnel = async () => {
    if (!playitTunnelName.trim()) { showPopup('error', 'Missing Name', 'Enter a tunnel name'); return }
    setPlayitLoading(true)
    try {
      const res = await apiFetch('/api/playit/tunnel/create', { method: 'POST', body: JSON.stringify({ name: playitTunnelName, port: playitTunnelPort, protocol: playitTunnelProtocol }) })
      if (res.ok) { showPopup('success', 'Created', 'Playit.gg tunnel created.'); setShowPlayitDialog(false); setPlayitTunnelName(''); fetchPlayitTunnels(); fetchAll() }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed to create tunnel') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setPlayitLoading(false)
  }

  const deletePlayitTunnel = async (tunnelId: string) => {
    showPopup('confirm', 'Delete Tunnel', `Delete Playit.gg tunnel "${tunnelId}"?`, async () => {
      try { const res = await apiFetch(`/api/playit/tunnel/delete/${tunnelId}`, { method: 'DELETE' }); if (res.ok) { showPopup('success', 'Deleted', 'Tunnel removed.'); fetchPlayitTunnels() } } catch {}
    })
  }

  const submitBugReport = async () => {
    if (!bugReportTitle.trim()) { showPopup('error', 'Missing Title', 'Enter a title for the report'); return }
    setBugReportLoading(true)
    try {
      const res = await apiFetch('/api/bug-reports', { method: 'POST', body: JSON.stringify({ title: bugReportTitle.trim(), description: bugReportDesc.trim(), severity: bugReportSeverity, browser_info: navigator.userAgent }) })
      if (res.ok) { showPopup('success', 'Submitted', 'Bug report submitted. Thank you!'); setShowBugReport(false); setBugReportTitle(''); setBugReportDesc(''); setBugReportSeverity('medium') }
      else { const e = await res.json(); showPopup('error', 'Submit Failed', typeof e.detail === 'string' ? e.detail : 'Failed to submit report') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setBugReportLoading(false)
  }

  const fetchFiles = async (serverId: number, path: string) => {
    try { const res = await apiFetch(`/api/servers/${serverId}/files/list?path=${encodeURIComponent(path)}`); if (res.ok) { setFiles(await res.json()); setFileError('') } else { const e = await res.json(); setFileError(e.detail || 'Failed to load files') } } catch { setFileError('Connection failed') }
  }

  const refreshFiles = () => { if (selectedServer) fetchFiles(selectedServer.id, currentPath) }

  const sendPowerAction = async (action: string) => {
    if (!selectedServer) return
    try {
      const res = await apiFetch(`/api/servers/${selectedServer.id}/power?action=${action}`, { method: 'POST' })
      if (res.ok) { fetchStats(selectedServer.id); setTimeout(() => fetchStats(selectedServer.id), 2000); setTimeout(() => fetchStats(selectedServer.id), 5000); fetchAll() }
      else { const e = await res.json(); setConsoleError(e.detail) }
    } catch (e: any) { setConsoleError(e.message) }
  }

  const handleFileClick = async (file: FileEntry) => {
    if (!selectedServer) return
    const fp = currentPath ? `${currentPath}/${file.name}` : file.name
    if (file.is_directory) { setCurrentPath(fp); fetchFiles(selectedServer.id, fp) }
    else { try { const res = await apiFetch(`/api/servers/${selectedServer.id}/files/read?path=${encodeURIComponent(fp)}`); if (res.ok) { const d = await res.json(); setEditingFile({ path: fp, content: d.content }) } else { const e = await res.json(); showPopup('error', 'Cannot Open', e.detail || 'Failed to read file') } } catch { showPopup('error', 'Error', 'Connection failed') } }
  }

  const saveFileContent = async () => {
    if (!selectedServer || !editingFile) return
    try { const res = await apiFetch(`/api/servers/${selectedServer.id}/files/write`, { method: 'POST', body: JSON.stringify({ path: editingFile.path, content: editingFile.content }) }); if (res.ok) { setEditingFile(null); showPopup('success', 'Saved', 'File saved successfully.'); refreshFiles() } else { const e = await res.json(); showPopup('error', 'Save Failed', e.detail || 'Failed to save file') } } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const createFolder = async () => {
    if (!selectedServer || !newPathName) return
    const fp = currentPath ? `${currentPath}/${newPathName}` : newPathName
    try { const res = await apiFetch(`/api/servers/${selectedServer.id}/files/folder`, { method: 'POST', body: JSON.stringify({ path: fp }) }); if (res.ok) { setNewPathName(''); setIsCreatingFolder(false); refreshFiles() } else { const e = await res.json(); showPopup('error', 'Create Failed', e.detail || 'Failed to create folder') } } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const deleteFile = async (file: FileEntry) => {
    if (!selectedServer) return
    const fp = currentPath ? `${currentPath}/${file.name}` : file.name
    showPopup('confirm', 'Delete File', `Delete "${file.name}"?`, async () => {
      try {
        const res = await apiFetch(`/api/servers/${selectedServer.id}/files/delete?path=${encodeURIComponent(fp)}`, { method: 'DELETE' })
        if (res.ok) { refreshFiles() } else { const e = await res.json(); showPopup('error', 'Delete Failed', e.detail || 'Failed to delete') }
      } catch { showPopup('error', 'Error', 'Connection failed') }
    })
  }

  const renameFile = async () => {
    if (!selectedServer || !renameTarget || !renameValue.trim()) return
    const oldPath = currentPath ? `${currentPath}/${renameTarget.name}` : renameTarget.name
    const newPath = currentPath ? `${currentPath}/${renameValue.trim()}` : renameValue.trim()
    if (oldPath === newPath) { setRenameTarget(null); setRenameValue(''); return }
    try {
      const res = await apiFetch(`/api/servers/${selectedServer.id}/files/rename`, { method: 'POST', body: JSON.stringify({ old_path: oldPath, new_path: newPath }) })
      if (res.ok) { setRenameTarget(null); setRenameValue(''); showPopup('success', 'Renamed', 'File renamed successfully.'); refreshFiles() }
      else { const e = await res.json(); showPopup('error', 'Rename Failed', e.detail || 'Failed to rename') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const downloadFile = async (file: FileEntry) => {
    if (!selectedServer || file.is_directory) return
    const fp = currentPath ? `${currentPath}/${file.name}` : file.name
    try {
      const res = await apiFetch(`/api/servers/${selectedServer.id}/files/read?path=${encodeURIComponent(fp)}`)
      if (res.ok) {
        const d = await res.json()
        const blob = new Blob([d.content || ''], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = file.name
        document.body.appendChild(a); a.click(); a.remove()
        URL.revokeObjectURL(url)
      } else { const e = await res.json(); showPopup('error', 'Download Failed', e.detail || 'Failed to read file') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedServer || !e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]
    const fp = currentPath ? `${currentPath}/${file.name}` : file.name
    setUploading(true)
    try {
      const content = await file.text()
      const res = await apiFetch(`/api/servers/${selectedServer.id}/files/write`, { method: 'POST', body: JSON.stringify({ path: fp, content }) })
      if (res.ok) { showPopup('success', 'Uploaded', `"${file.name}" uploaded successfully.`); refreshFiles() }
      else { const err = await res.json(); showPopup('error', 'Upload Failed', err.detail || 'Failed to upload file') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const navigateUp = () => {
    if (!currentPath) return
    const parts = currentPath.split('/'); parts.pop()
    const pp = parts.join('/'); setCurrentPath(pp)
    if (selectedServer) fetchFiles(selectedServer.id, pp)
  }

  const parseEnvText = (text: string): Record<string, string> => {
    const out: Record<string, string> = {}
    text.split('\n').forEach(line => {
      const i = line.indexOf('=')
      if (i > 0) { const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim(); if (k) out[k] = v }
    })
    return out
  }

  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formNodeId) { showPopup('error', 'Missing Info', 'Select a node'); return }
    if (!formImage || !formImage.trim()) { showPopup('error', 'Missing Info', 'Docker image is required'); return }
    try {
      const envVars: Record<string, string> = { ...formEnv, ...parseEnvText(formEnvText) }
      if (formGameVersion && formGameVersion !== 'LATEST') envVars.VERSION = formGameVersion
      const body: any = { name: formName, description: formDesc, node_id: formNodeId, primary_allocation_id: formAllocId || 0, cpu_limit: formCpu, memory_limit: formMemory, disk_limit: formDisk, docker_image: formImage, docker_network: formNetwork, startup_command: formUseDockerfile ? '' : formStartup, env_vars: envVars }
      const res = await apiFetch('/api/servers', { method: 'POST', body: JSON.stringify(body) })
      if (res.ok) { fetchAll(); setActiveTab('servers') }
      else { const e = await res.json(); showPopup('error', 'Deploy Failed', e.detail || 'Failed to create server') }
    } catch { showPopup('error', 'Connection Error', 'Cannot reach panel API') }
  }

  const buildDockerImage = async () => {
    if (!formDockerfile || !formImageName) { showPopup('error', 'Missing Info', 'Provide a Dockerfile and image name.'); return }
    setIsBuildingImage(true)
    try {
      const res = await apiFetch('/api/system/docker-build', { method: 'POST', body: JSON.stringify({ image_name: formImageName, dockerfile: formDockerfile }) })
      if (res.ok) { setFormImage(formImageName); setFormUseDockerfile(false); showPopup('success', 'Build Started', `Image "${formImageName}" is building in the background.`) }
      else { const e = await res.json(); showPopup('error', 'Build Failed', e.detail || 'Failed to start build') }
    } catch { showPopup('error', 'Connection Error', 'Cannot reach panel API') }
    setIsBuildingImage(false)
  }

  const registerNode = async () => {
    try {
      const res = await apiFetch('/api/nodes', { method: 'POST', body: JSON.stringify({ name: nodeName, fqdn: nodeFQDN, ip_address: nodeIP, daemon_port: 8080, daemon_token: nodeToken }) })
      if (res.ok) { setIsRegisteringNode(false); fetchAll() }
      else { const e = await res.json(); showPopup('error', 'Registration Failed', e.detail || 'Failed to register node') }
    } catch {}
  }

  const createAllocations = async () => {
    try {
      const res = await apiFetch('/api/allocations', { method: 'POST', body: JSON.stringify({ node_id: allocNodeId, ip_address: allocIP, port_start: allocPortStart, count: allocCount }) })
      if (res.ok) { setIsCreatingAlloc(false); fetchAll() }
      else { const e = await res.json(); showPopup('error', 'Allocation Failed', e.detail || 'Failed to create allocations') }
    } catch {}
  }

  const deleteServer = async (srv: Server) => {
    showPopup('confirm', 'Delete Server', `Delete "${srv.name}"? This cannot be undone.`, async () => {
      try { const res = await apiFetch(`/api/servers/${srv.id}`, { method: 'DELETE' }); if (res.ok) { setSelectedServer(null); fetchAll() } } catch {}
    })
  }

  const fetchActivity = async (offset = 0) => {
    try {
      let url = `/api/activity?limit=50&offset=${offset}`
      if (activityFilterServer) url += `&server_id=${activityFilterServer}`
      const res = await apiFetch(url)
      if (res.ok) { const data = await res.json(); setActivityLogs(Array.isArray(data) ? data : data.data || []); setActivityHasMore(Array.isArray(data) ? data.length === 50 : (data.data?.length === 50)) }
    } catch {}
  }

  useEffect(() => { if (activeTab === 'activity') fetchActivity(activityOffset) }, [activeTab, activityOffset, activityFilterServer])

  const fetchApiKeys = async () => {
    try { const res = await apiFetch('/api/keys'); if (res.ok) setApiKeys(asArray(await res.json())) } catch {}
  }

  useEffect(() => { if (activeTab === 'api-keys') fetchApiKeys() }, [activeTab])

  const createApiKey = async () => {
    try {
      const res = await apiFetch('/api/keys', { method: 'POST', body: JSON.stringify({ name: keyFormName, permissions: keyFormPerms.join(','), expires_at: keyFormExpiry || undefined }) })
      if (res.ok) { const data = await res.json(); setNewApiKeyRaw(data.key || data.raw_key || data.token || ''); setIsCreatingKey(false); setKeyFormName(''); setKeyFormPerms(['servers.read']); setKeyFormExpiry(''); fetchApiKeys() }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed to create key') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const deleteApiKey = async (key: ApiKey) => {
    showPopup('confirm', 'Delete API Key', `Delete key "${key.name}"?`, async () => {
      try { const res = await apiFetch(`/api/keys/${key.id}`, { method: 'DELETE' }); if (res.ok) fetchApiKeys() } catch {}
    })
  }

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text).then(() => showPopup('success', 'Copied', 'API key copied to clipboard.')).catch(() => showPopup('info', 'Copy', `Please copy manually: ${text}`)) }

  // --- Panel Users (Admin) ---
  const fetchPanelUsers = async () => {
    try { const res = await apiFetch('/api/users'); if (res.ok) setPanelUsers(asArray(await res.json())) } catch {}
  }

  useEffect(() => { if (activeTab === 'users') fetchPanelUsers() }, [activeTab])

  const createPanelUser = async () => {
    if (!userFormName || !userFormEmail || !userFormPass) { showPopup('error', 'Missing', 'Fill all fields'); return }
    try {
      const res = await apiFetch('/api/users', { method: 'POST', body: JSON.stringify({ username: userFormName, email: userFormEmail, password: userFormPass, root_admin: userFormAdmin }) })
      if (res.ok) { setIsCreatingUser(false); setUserFormName(''); setUserFormEmail(''); setUserFormPass(''); setUserFormAdmin(false); fetchPanelUsers() }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const updatePanelUser = async (userId: number) => {
    try {
      const body: any = { email: userEditEmail }
      if (userEditPass) body.password = userEditPass
      body.root_admin = userEditAdmin
      const res = await apiFetch(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify(body) })
      if (res.ok) { setEditingUser(null); fetchPanelUsers() }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const deletePanelUser = async (userId: number, username: string) => {
    showPopup('confirm', 'Delete User', `Delete user "${username}"?`, async () => {
      try { const res = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' }); if (res.ok) fetchPanelUsers() } catch {}
    })
  }

  const toggleKeyPerm = (perm: string) => { setKeyFormPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]) }

  const saveSettings = async () => {
    const body: any = {}
    if (settingsEmail) body.email = settingsEmail
    if (settingsNewPass) {
      if (settingsNewPass !== settingsConfirmPass) { showPopup('error', 'Error', 'Passwords do not match'); return }
      if (settingsNewPass.length < 8) { showPopup('error', 'Error', 'Password must be at least 8 characters'); return }
      body.password = settingsNewPass
    }
    if (!body.email && !body.password) { showPopup('info', 'Nothing to change', 'No changes were made.'); return }
    try {
      const res = await apiFetch('/api/auth/settings', { method: 'PUT', body: JSON.stringify(body) })
      if (res.ok) { showPopup('success', 'Saved', 'Settings updated successfully.'); setSettingsNewPass(''); setSettingsConfirmPass('') }
      else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed to update settings') }
    } catch { showPopup('error', 'Error', 'Connection failed') }
  }

  const reinstallServer = async (srv: Server) => {
    showPopup('confirm', 'Reinstall Server', `Reinstall "${srv.name}"? This will delete the container and redeploy it.`, async () => {
      try { const res = await apiFetch(`/api/servers/${srv.id}/reinstall`, { method: 'POST' }); if (res.ok) { showPopup('success', 'Reinstall Started', 'Server is being reinstalled.'); fetchAll() } else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed') } } catch {}
    })
  }

  const transferServer = async (srv: Server) => {
    const nodeId = prompt('Enter target Node ID:')
    if (!nodeId || isNaN(Number(nodeId))) return
    showPopup('confirm', 'Transfer Server', `Transfer "${srv.name}" to node #${nodeId}?`, async () => {
      try { const res = await apiFetch(`/api/servers/${srv.id}/transfer`, { method: 'POST', body: JSON.stringify({ node_id: Number(nodeId) }) }); if (res.ok) { showPopup('success', 'Transfer Started', 'Server is being transferred.'); fetchAll() } else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed') } } catch {}
    })
  }

  const suspendServer = async (srv: Server, suspend: boolean) => {
    const endpoint = suspend ? 'suspend' : 'unsuspend'
    showPopup('confirm', suspend ? 'Suspend Server' : 'Unsuspend Server', `${suspend ? 'Suspend' : 'Unsuspend'} "${srv.name}"?`, async () => {
      try { const res = await apiFetch(`/api/servers/${srv.id}/${endpoint}`, { method: 'POST' }); if (res.ok) { showPopup('success', suspend ? 'Suspended' : 'Unsuspended', `Server ${suspend ? 'suspended' : 'unsuspended'}.`); fetchAll() } else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed') } } catch {}
    })
  }

  const toggleServerSelect = (id: number) => {
    setSelectedServerIds(prev => prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id])
  }

  const executeBulkAction = async () => {
    if (!bulkAction || selectedServerIds.length === 0) return
    showPopup('confirm', 'Bulk Action', `${bulkAction} ${selectedServerIds.length} server(s)?`, async () => {
      try {
        const res = await apiFetch('/api/servers/bulk/power', { method: 'POST', body: JSON.stringify({ action: bulkAction, server_ids: selectedServerIds }) })
        if (res.ok) { showPopup('success', 'Done', `Bulk ${bulkAction} completed.`); setSelectedServerIds([]); fetchAll() }
        else { const e = await res.json(); showPopup('error', 'Error', e.detail || 'Failed') }
      } catch { showPopup('error', 'Error', 'Connection failed') }
    })
  }

  useEffect(() => {
    if (!selectedServer) return
    if (detailTab === 'console') { /* console handled by websocket */ }
  }, [detailTab, selectedServer])

  if (!token || !user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-main)' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ width: '420px', padding: '40px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div className="logo" style={{ justifyContent: 'center', marginBottom: '8px' }}><Layers size={32} /><span>WINGS PANEL</span></div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Game Server Management Platform</p>
          </div>
          {authError && <div style={{ padding: '10px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', color: 'var(--color-danger)', fontSize: '0.85rem', marginBottom: '16px' }}>{authError}</div>}
          <form onSubmit={handleAuth}>
            <div className="form-group"><label className="form-label">Username</label><input className="form-control" type="text" value={authUsername} onChange={e => setAuthUsername(e.target.value)} required /></div>
            {authPage === 'register' && <div className="form-group"><label className="form-label">Email</label><input className="form-control" type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} required /></div>}
            <div className="form-group"><label className="form-label">Password</label><input className="form-control" type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} required minLength={8} /></div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>{authPage === 'login' ? 'Sign In' : 'Create Account'}</button>
          </form>
          <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {authPage === 'login' ? <>No account? <span onClick={() => setAuthPage('register')} style={{ color: 'var(--color-primary)', cursor: 'pointer' }}>Register</span></> : <>Have an account? <span onClick={() => setAuthPage('login')} style={{ color: 'var(--color-primary)', cursor: 'pointer' }}>Sign in</span></>}
          </p>
          {authPage === 'register' && <p style={{ textAlign: 'center', marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Your email is used only for account recovery.</p>}
        </div>
        </div>
        <p style={{ textAlign: 'center', padding: '16px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>Wings Panel × Pterodactyl Panel &copy; 2026</p>
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="logo"><Layers size={24} /><span>WINGS PANEL</span></div>
        <nav className="nav-links">
          <button onClick={() => { setActiveTab('dashboard'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}><LayoutDashboard size={18} /><span>Dashboard</span></button>
          <button onClick={() => { setActiveTab('servers'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'servers' && !selectedServer ? 'active' : ''}`}><ServerIcon size={18} /><span>Servers</span></button>
          {user.root_admin && <button onClick={() => { setActiveTab('nodes'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'nodes' ? 'active' : ''}`}><Network size={18} /><span>Nodes</span></button>}
          {user.root_admin && <button onClick={() => { setActiveTab('allocations'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'allocations' ? 'active' : ''}`}><Settings size={18} /><span>Allocations</span></button>}
          {user.root_admin && <button onClick={() => { setActiveTab('system'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'system' ? 'active' : ''}`}><Cpu size={18} /><span>System</span></button>}
          <button onClick={() => { setActiveTab('activity'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'activity' ? 'active' : ''}`}><Activity size={18} /><span>Activity</span></button>
          <button onClick={() => { setActiveTab('api-keys'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'api-keys' ? 'active' : ''}`}><Key size={18} /><span>API Keys</span></button>
          {user.root_admin && <button onClick={() => { setActiveTab('users'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'users' ? 'active' : ''}`}><Users size={18} /><span>Users</span></button>}
          {user.root_admin && <button onClick={() => { setActiveTab('templates'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'templates' ? 'active' : ''}`}><FileText size={18} /><span>Templates</span></button>}
          {user.root_admin && <button onClick={() => { setActiveTab('webhooks'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'webhooks' ? 'active' : ''}`}><Share2 size={18} /><span>Webhooks</span></button>}
          <button onClick={() => { setActiveTab('create-server'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'create-server' ? 'active' : ''}`}><PlusCircle size={18} /><span>Deploy</span></button>
          <button onClick={() => { setActiveTab('settings'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}><User size={18} /><span>Settings</span></button>
        </nav>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <Layers size={16} style={{ color: 'var(--color-primary)' }} />
            <span className="topbar-brand">WINGS PANEL</span>
            <span className="topbar-tag">× Pterodactyl Panel &copy; 2026</span>
          </div>
          <div className="topbar-right">
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="topbar-btn" title="Toggle Theme">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}<span>{theme === 'dark' ? 'Light' : 'Dark'}</span></button>
            <div className="user-chip">
              <Shield size={14} style={{ color: 'var(--color-primary)' }} />
              <span>{user.username}</span>
              {user.root_admin && <span className="admin-badge">ADMIN</span>}
            </div>
            <button onClick={logout} className="topbar-btn" title="Sign Out"><LogOut size={14} /><span>Sign Out</span></button>
            <button onClick={() => { setBugReportTitle(''); setBugReportDesc(''); setBugReportSeverity('medium'); setShowBugReport(true) }} className="topbar-btn" title="Report Bug"><Bug size={14} /><span>Report</span></button>
            <button onClick={() => window.open('https://ko-fi.com/wingspanel', '_blank')} className="topbar-btn" title="Support on Ko-Fi"><Coffee size={14} /><span>Donate</span></button>
          </div>
        </header>
        <div className="page-content">
        {!selectedServer ? (<>
{activeTab === 'dashboard' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Dashboard</h1><p className="header-desc">Welcome back, {user.username} — panel overview</p></div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={fetchAll} className="btn btn-outline"><RefreshCw size={16} /><span>Refresh</span></button>
                  </div>
                </div>

                {announcements.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                    {announcements.slice(0, 3).map(a => (
                      <div key={a.id} style={{ border: `1px solid ${a.color || '#38bdf8'}55`, background: `${a.color || '#38bdf8'}11`, borderRadius: '10px', padding: '14px 18px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: a.color || '#38bdf8', marginTop: '5px', flexShrink: 0 }}></div>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>{a.title}</p>
                          {a.content && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>{a.content}</p>}
                          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '6px' }}>{new Date(a.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="card-grid">
                  <div className="card" style={{ textAlign: 'center' }}>
                    <ServerIcon size={22} style={{ color: 'var(--color-primary)', margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-primary)' }}>{systemStatus?.total_servers ?? servers.length}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Servers</p>
                  </div>
                  <div className="card" style={{ textAlign: 'center' }}>
                    <Play size={22} style={{ color: 'var(--color-success)', margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-success)' }}>{systemStatus?.running_servers ?? servers.filter(s => s.status === 'running').length}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Running</p>
                  </div>
                  <div className="card" style={{ textAlign: 'center' }}>
                    <Network size={22} style={{ color: 'var(--color-secondary)', margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-secondary)' }}>{systemStatus?.active_nodes ?? 0}<span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>/{systemStatus?.total_nodes ?? 0}</span></p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nodes</p>
                  </div>
                  <div className="card" style={{ textAlign: 'center' }}>
                    <Layers size={22} style={{ color: '#fbbf24', margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: '2rem', fontWeight: 700, color: '#fbbf24' }}>{systemStatus?.used_allocations ?? 0}<span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>/{systemStatus?.total_allocations ?? 0}</span></p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Allocations</p>
                  </div>
                  <div className="card" style={{ textAlign: 'center' }}>
                    <Users size={22} style={{ color: 'var(--text-main)', margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-main)' }}>{systemStatus?.total_users ?? 0}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Users</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '24px', marginTop: '24px' }}>
                  <div>
                    <div className="card" style={{ marginBottom: '24px' }}>
                      <div className="header-wrapper">
                        <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Recent Activity</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Latest actions across the panel</p></div>
                        <button onClick={() => setActiveTab('activity')} className="btn btn-outline">View All</button>
                      </div>
                      {activityLogs.length === 0 ? (
                        <p style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>No activity recorded yet.</p>
                      ) : (
                        activityLogs.slice(0, 8).map(entry => (
                          <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--border-color)' }}>
                            <Activity size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ fontSize: '0.85rem' }}><strong>{entry.username || `User #${entry.user_id}`}</strong> <span style={{ color: 'var(--text-muted)' }}>{entry.action}{entry.server_name ? ` · ${entry.server_name}` : ''}</span></p>
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}</p>
                            </div>
                            {entry.detail && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>{entry.detail}</p>}
                          </div>
                        ))
                      )}
                    </div>
                    {nodeSummaries.length > 0 && (
                      <div className="card">
                        <div className="header-wrapper">
                          <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Node Health</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Live status across nodes</p></div>
                          {user.root_admin && <button onClick={() => setActiveTab('nodes')} className="btn btn-outline">Manage</button>}
                        </div>
                        {nodeSummaries.map(ns => (
                          <div key={ns.node_id} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 0', borderBottom: '1px solid var(--border-color)' }}>
                            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: systemStatus?.daemon_reachable ? 'var(--color-success)' : 'var(--color-danger)', flexShrink: 0 }}></div>
                            <div style={{ flex: 1, minWidth: 0 }}><p style={{ fontWeight: 600 }}>{ns.node_name}</p><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{ns.total_servers} servers · {ns.used_allocations}/{ns.total_allocations} allocations</p></div>
                            <span className={`status-pill ${systemStatus?.daemon_reachable ? 'running' : 'stopped'}`}>{systemStatus?.daemon_reachable ? 'Online' : 'Offline'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="card" style={{ marginBottom: '24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: systemStatus?.daemon_reachable ? 'var(--color-success)' : 'var(--color-danger)' }}></div>
                        <div><p style={{ fontWeight: 600 }}>{systemStatus?.daemon_reachable ? 'Daemon Connected' : 'Daemon Unreachable'}</p><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{systemStatus?.daemon_version ? `v${systemStatus.daemon_version}` : 'version unknown'}</p></div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '8px 0', borderTop: '1px solid var(--border-color)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Panel Version</span><span style={{ fontWeight: 600 }}>v{systemStatus?.panel_version || '1.0.0'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '8px 0', borderTop: '1px solid var(--border-color)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Active Nodes</span><span style={{ fontWeight: 600 }}>{systemStatus?.active_nodes ?? 0} / {systemStatus?.total_nodes ?? 0}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', padding: '8px 0', borderTop: '1px solid var(--border-color)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Allocations Used</span><span style={{ fontWeight: 600 }}>{systemStatus?.used_allocations ?? 0} / {systemStatus?.total_allocations ?? 0}</span>
                      </div>
                    </div>
                    <div className="card">
                      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '4px' }}>Quick Actions</h3>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>Common tasks</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <button onClick={() => setActiveTab('create-server')} className="btn btn-primary" style={{ justifyContent: 'flex-start' }}><PlusCircle size={16} /><span>Deploy a Server</span></button>
                        <button onClick={() => setActiveTab('servers')} className="btn btn-outline" style={{ justifyContent: 'flex-start' }}><ServerIcon size={16} /><span>Manage Servers</span></button>
                        <button onClick={() => setActiveTab('system')} className="btn btn-outline" style={{ justifyContent: 'flex-start' }}><Cpu size={16} /><span>System Status</span></button>
                        {user.root_admin && <button onClick={() => setActiveTab('allocations')} className="btn btn-outline" style={{ justifyContent: 'flex-start' }}><Settings size={16} /><span>Allocations</span></button>}
                        {user.root_admin && <button onClick={() => setActiveTab('users')} className="btn btn-outline" style={{ justifyContent: 'flex-start' }}><Users size={16} /><span>Manage Users</span></button>}
                        <button onClick={() => setActiveTab('settings')} className="btn btn-outline" style={{ justifyContent: 'flex-start' }}><User size={16} /><span>Settings</span></button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'servers' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Servers</h1><p className="header-desc">{servers.length} server{servers.length !== 1 ? 's' : ''} deployed</p></div>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={fetchAll} className="btn btn-outline"><RefreshCw size={16} /><span>Refresh</span></button>
                  </div>
                </div>
                {selectedServerIds.length > 0 && (
                  <div className="card" style={{ marginBottom: '20px', border: '1px solid var(--color-primary)', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{selectedServerIds.length} selected</span>
                    <select className="form-control" value={bulkAction} onChange={e => setBulkAction(e.target.value)} style={{ width: '150px', padding: '6px 10px' }}>
                      <option value="">Bulk action...</option>
                      <option value="start">Start All</option>
                      <option value="stop">Stop All</option>
                      <option value="restart">Restart All</option>
                      <option value="kill">Kill All</option>
                    </select>
                    <button onClick={executeBulkAction} className="btn btn-primary" disabled={!bulkAction} style={{ padding: '6px 14px' }}><Power size={14} /> Execute</button>
                    <button onClick={() => setSelectedServerIds([])} className="btn btn-outline" style={{ padding: '6px 14px' }}><X size={14} /> Clear</button>
                  </div>
                )}
                <div className="card-grid">
                  {servers.map(s => (
                    <div key={s.id} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <input type="checkbox" checked={selectedServerIds.includes(s.id)} onChange={() => toggleServerSelect(s.id)} style={{ accentColor: 'var(--color-primary)', width: '18px', height: '18px', cursor: 'pointer' }} />
                          <div style={{ padding: '8px', background: 'rgba(56,189,248,0.1)', color: 'var(--color-primary)', borderRadius: '8px' }}><ServerIcon size={20} /></div>
                          <div><h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{s.name} {s.owner_id !== user.id && !user.root_admin && <span style={{ fontSize: '0.65rem', color: 'var(--color-secondary)', border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.1)', padding: '1px 6px', borderRadius: '4px', verticalAlign: 'middle' }}>SHARED</span>}</h3><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.uuid.substring(0, 8)}...</p></div>
                        </div>
                        <span className={`status-pill ${s.status}`}><span className="status-glow"></span>{s.status}</span>
                      </div>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '20px', minHeight: '40px' }}>{s.description || 'No description'}</p>
<div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginBottom: '20px' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Cpu size={14} /><span>{s.cpu_limit}%</span></div>
                         <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><HardDrive size={14} /><span>{s.memory_limit} MB</span></div>
                         {s.group_id && (
                           <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                             <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: serverGroups.find(g => g.id === s.group_id)?.color || '#38bdf8' }}></div>
                             <span>{serverGroups.find(g => g.id === s.group_id)?.name || 'Group'}</span>
                           </div>
                         )}
                       </div>
                       <div style={{ display: 'flex', gap: '8px' }}>
                         <button onClick={() => setSelectedServer(s)} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Manage</button>
                         {user.root_admin && (
                           <select className="form-control" value={s.group_id || ''} onChange={e => assignServerToGroup(s.id, e.target.value ? Number(e.target.value) : null)} style={{ width: 'auto', padding: '6px 8px', fontSize: '0.8rem' }}>
                             <option value="">No Group</option>
                             {serverGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                           </select>
                         )}
                         {user.root_admin && <button onClick={() => deleteServer(s)} className="btn btn-danger" style={{ padding: '8px 12px' }}><Trash2 size={14} /></button>}
                       </div>
                    </div>
                  ))}
                  {servers.length === 0 && (
                    <div className="card" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <Layers size={48} style={{ color: 'var(--color-primary)', margin: '0 auto 16px', display: 'block', opacity: 0.7 }} />
                      <p style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '8px' }}>No servers yet</p>
                      <p style={{ fontSize: '0.875rem', marginBottom: '24px' }}>Deploy your first game server from the Deploy tab.</p>
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button onClick={() => setActiveTab('create-server')} className="btn btn-primary"><PlusCircle size={16} /><span>Deploy Server</span></button>
                      </div>
                    </div>
                  )}</div>
                  <div className="card" style={{ marginTop: '24px', marginBottom: '24px' }}>
                    <div className="header-wrapper">
                      <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Cloudflare DNS</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Manage DNS records for game server domains</p></div>
                      <button onClick={() => { setCfRecordName(''); setCfRecordContent(''); setCfRecordType('A'); setCfRecordTTL(300); setCfRecordProxied(false); setShowCloudflareDialog(true) }} className="btn btn-primary"><Plus size={14} /><span>Add Record</span></button>
                    </div>
                    {cfLoading ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading records...</p>
                    ) : cloudflareRecords.length > 0 ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {cloudflareRecords.map(rec => (
                          <div key={rec.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <span style={{ fontWeight: 600, fontSize: '0.85rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(56,189,248,0.1)', color: 'var(--color-primary)' }}>{rec.type}</span>
                              <div><p style={{ fontWeight: 600, fontSize: '0.85rem' }}>{rec.name}</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{rec.content} {rec.proxied ? '(proxied)' : ''}</p></div>
                            </div>
                            <button onClick={() => deleteCloudflareRecord(rec.id)} className="btn btn-danger" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>Delete</button>
                          </div>
                        ))}
                      </div>
                    ) : (<p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No DNS records found. Configure Cloudflare API token and zone ID in the daemon env vars.</p>)}
                  </div>
                  <div className="card" style={{ marginTop: '24px', marginBottom: '24px' }}>
                    <div className="header-wrapper">
                      <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Playit.gg Tunnels</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Manage Playit.gg tunnels for public server access</p></div>
                      <button onClick={() => { setPlayitTunnelName(''); setPlayitTunnelPort(25565); setPlayitTunnelProtocol('tcp'); setShowPlayitDialog(true) }} className="btn btn-primary"><Plus size={14} /><span>Create Tunnel</span></button>
                    </div>
                    {playitTunnels.length > 0 ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {playitTunnels.map(t => (
                          <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <div><p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.name}</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{t.url} — {t.protocol} :{t.port}</p></div>
                            <button onClick={() => deletePlayitTunnel(t.id)} className="btn btn-danger" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>Delete</button>
                          </div>
                        ))}
                      </div>
                    ) : (<p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No tunnels configured. Set PLAYIT_CLAIM_TOKEN in the daemon env vars.</p>)}
                  </div>
                </div>
              )}

            {activeTab === 'nodes' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Nodes</h1><p className="header-desc">Daemon hosts running Wings</p></div>
                  <button onClick={() => setIsRegisteringNode(true)} className="btn btn-primary"><Plus size={16} /><span>Register Node</span></button>
                </div>
                {isRegisteringNode && (
                  <div className="card" style={{ marginBottom: '24px', border: '1px solid var(--color-primary)' }}>
                    <h3 style={{ marginBottom: '16px' }}>Register Node</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div className="form-group"><label className="form-label">Name</label><input className="form-control" value={nodeName} onChange={e => setNodeName(e.target.value)} /></div>
                      <div className="form-group"><label className="form-label">FQDN</label><input className="form-control" value={nodeFQDN} onChange={e => setNodeFQDN(e.target.value)} placeholder="node.example.com" /></div>
                      <div className="form-group"><label className="form-label">IP Address</label><input className="form-control" value={nodeIP} onChange={e => setNodeIP(e.target.value)} placeholder="192.168.1.100" /></div>
                      <div className="form-group"><label className="form-label">Daemon Token</label><input className="form-control" type="password" value={nodeToken} onChange={e => setNodeToken(e.target.value)} /></div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <button onClick={() => setIsRegisteringNode(false)} className="btn btn-outline">Cancel</button>
                      <button onClick={registerNode} className="btn btn-primary">Register</button>
                    </div>
                  </div>
                )}
                <div className="card" style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}><th style={{ padding: '16px' }}>Name</th><th style={{ padding: '16px' }}>Address</th><th style={{ padding: '16px' }}>Port</th><th style={{ padding: '16px' }}>Status</th><th style={{ padding: '16px' }}>Latency</th><th style={{ padding: '16px', textAlign: 'right' }}></th></tr></thead>
                    <tbody>
                      {nodes.map(n => (
                        <tr key={n.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '16px', fontWeight: 600 }}>{n.name}</td>
                          <td style={{ padding: '16px' }}>{n.fqdn} ({n.ip_address})</td>
                          <td style={{ padding: '16px' }}>{n.daemon_port}</td>
                          <td style={{ padding: '16px' }}><span className="status-pill running"><span className="status-glow"></span>{n.is_active ? 'Active' : 'Inactive'}</span></td>
                          <td style={{ padding: '16px' }}>
                            {nodePings[n.id] ? <span style={{ color: nodePings[n.id].ok ? 'var(--color-success)' : 'var(--color-danger)', fontSize: '0.8rem' }}>{nodePings[n.id].ok ? `${nodePings[n.id].ms}ms` : nodePings[n.id].detail || 'Unreachable'}</span> : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>}
                          </td>
                          <td style={{ padding: '16px', textAlign: 'right' }}>
                            <button onClick={() => pingNode(n.id)} className="btn btn-outline" style={{ padding: '4px 10px', fontSize: '0.8rem' }}><Activity size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Ping</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'allocations' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Allocations</h1><p className="header-desc">{allocations.length} port allocation{allocations.length !== 1 ? 's' : ''}</p></div>
                  <button onClick={() => setIsCreatingAlloc(true)} className="btn btn-primary"><Plus size={16} /><span>Create Allocations</span></button>
                </div>
                {isCreatingAlloc && (
                  <div className="card" style={{ marginBottom: '24px', border: '1px solid var(--color-primary)' }}>
                    <h3 style={{ marginBottom: '16px' }}>Allocate Ports</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '16px' }}>
                      <div className="form-group"><label className="form-label">Node</label><select className="form-control" value={allocNodeId} onChange={e => setAllocNodeId(Number(e.target.value))}>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></div>
                      <div className="form-group"><label className="form-label">IP</label><input className="form-control" value={allocIP} onChange={e => setAllocIP(e.target.value)} /></div>
                      <div className="form-group"><label className="form-label">Start Port</label><input className="form-control" type="number" value={allocPortStart} onChange={e => setAllocPortStart(Number(e.target.value))} /></div>
                      <div className="form-group"><label className="form-label">Count</label><input className="form-control" type="number" value={allocCount} onChange={e => setAllocCount(Number(e.target.value))} max={256} /></div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <button onClick={() => setIsCreatingAlloc(false)} className="btn btn-outline">Cancel</button>
                      <button onClick={createAllocations} className="btn btn-primary">Create</button>
                    </div>
                  </div>
                )}
                <div className="card" style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}><th style={{ padding: '16px' }}>Node ID</th><th style={{ padding: '16px' }}>IP:Port</th><th style={{ padding: '16px' }}>Assigned</th></tr></thead>
                    <tbody>
                      {allocations.map(a => (
                        <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '16px' }}>{a.node_id}</td>
                          <td style={{ padding: '16px', fontFamily: 'var(--font-mono)' }}>{a.ip_address}:{a.port}</td>
                          <td style={{ padding: '16px' }}>{a.server_id ? <span style={{ color: 'var(--color-danger)' }}>In Use</span> : <span style={{ color: 'var(--color-success)' }}>Available</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'system' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">System Overview</h1><p className="header-desc">Panel & daemon health status</p></div>
                  <button onClick={fetchAll} className="btn btn-outline"><RefreshCw size={16} /><span>Refresh</span></button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                  <div className="card" style={{ textAlign: 'center' }}><p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-primary)' }}>{systemStatus?.total_servers || 0}</p><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Servers</p></div>
                  <div className="card" style={{ textAlign: 'center' }}><p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-success)' }}>{systemStatus?.running_servers || 0}</p><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Running</p></div>
                  <div className="card" style={{ textAlign: 'center' }}><p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-secondary)' }}>{systemStatus?.total_allocations || 0}</p><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Allocations</p></div>
                  <div className="card" style={{ textAlign: 'center' }}><p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-muted)' }}>{systemStatus?.total_users || 0}</p><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Users</p></div>
                </div>
                <div className="card" style={{ marginBottom: '24px' }}>
                  <h3 style={{ marginBottom: '16px' }}>Daemon Status</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: systemStatus?.daemon_reachable ? 'var(--color-success)' : 'var(--color-danger)' }}></div>
                      <div><p style={{ fontWeight: 600 }}>{systemStatus?.daemon_reachable ? 'Daemon Connected' : 'Daemon Unreachable'}</p><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{systemStatus?.daemon_version ? `v${systemStatus.daemon_version}` : 'version unknown'}</p></div>
                    </div>
                    <div><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Panel Version</p><p style={{ fontWeight: 600 }}>v{systemStatus?.panel_version || '1.0.0'}</p></div>
                  </div>
                </div>
                <div className="card" style={{ marginBottom: '24px' }}>
                  <h3 style={{ marginBottom: '16px' }}>Nodes</h3>
                  {nodeSummaries.length > 0 ? (
                    <div style={{ display: 'grid', gap: '12px' }}>
                      {nodeSummaries.map(ns => (
                        <div key={ns.node_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <Network size={18} style={{ color: 'var(--color-primary)' }} />
                            <div><p style={{ fontWeight: 600 }}>{ns.node_name}</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ns.total_servers} server{ns.total_servers !== 1 ? 's' : ''}</p></div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <p style={{ fontSize: '0.85rem' }}>{ns.used_allocations}/{ns.total_allocations} allocations</p>
                            <div style={{ width: '120px', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', marginTop: '4px' }}><div style={{ width: `${ns.total_allocations > 0 ? (ns.used_allocations / ns.total_allocations) * 100 : 0}%`, height: '100%', background: 'var(--color-primary)', borderRadius: '2px' }}></div></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (<p style={{ color: 'var(--text-muted)' }}>No nodes registered</p>)}
                </div>
<div className="card">
                   <h3 style={{ marginBottom: '12px' }}>Quick Info</h3>
                   <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                     <div>Active Nodes: <span style={{ color: 'var(--text-primary)' }}>{systemStatus?.active_nodes || 0}</span></div>
                     <div>Allocations Used: <span style={{ color: 'var(--text-primary)' }}>{systemStatus?.used_allocations || 0}</span></div>
                   </div>
                 </div>
                 <div className="card" style={{ marginTop: '24px', marginBottom: '24px' }}>
                   <div className="header-wrapper">
                     <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Docker Networks</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Manage Docker networks for server containers</p></div>
                     <button onClick={() => { setNetworkName(''); setNetworkDriver('bridge'); setShowNetworkDialog(true) }} className="btn btn-primary"><Plus size={14} /><span>Create Network</span></button>
                   </div>
                   {dockerNetworks.length > 0 ? (
                     <div style={{ display: 'grid', gap: '8px' }}>
                       {dockerNetworks.map(n => (
                         <div key={n.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                           <div><p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{n.name}</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{n.driver} — {n.id}</p></div>
                           <button onClick={() => deleteNetwork(n.name)} className="btn btn-danger" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>Delete</button>
                         </div>
                       ))}
                     </div>
                   ) : (<p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No networks found</p>)}
                 </div>
                 <div className="card">
                   <div className="header-wrapper">
                     <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Server Groups</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Organize servers into groups for easier management</p></div>
                     <button onClick={() => { setGroupName(''); setGroupDescription(''); setGroupColor('#38bdf8'); setEditingGroup(null); setShowGroupDialog(true) }} className="btn btn-primary"><Plus size={14} /><span>Create Group</span></button>
                   </div>
                   {serverGroups.length > 0 ? (
                     <div style={{ display: 'grid', gap: '8px' }}>
                       {serverGroups.map(g => (
                         <div key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                           <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                             <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: g.color || '#38bdf8' }}></div>
                             <div><p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{g.name}</p><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{g.description || 'No description'}</p></div>
                           </div>
                           <button onClick={() => deleteServerGroup(g.id, g.name)} className="btn btn-danger" style={{ padding: '4px 10px', fontSize: '0.8rem' }}>Delete</button>
                         </div>
                       ))}
                     </div>
                    ) : (<p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No groups created yet</p>)}
                  </div>
                  <div className="card" style={{ marginTop: '24px' }}>
                    <div className="header-wrapper">
                      <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Docker Images</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Images available on the daemon host</p></div>
                      <button onClick={fetchDockerImages} className="btn btn-outline"><RefreshCw size={14} /><span>Refresh</span></button>
                    </div>
                    {dockerImages.length > 0 ? (
                      <div style={{ display: 'grid', gap: '8px' }}>
                        {dockerImages.map(img => (
                          <div key={img.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                              <Box size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                              <div style={{ minWidth: 0 }}>
                                <p style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.tags && img.tags.length > 0 ? img.tags.join(', ') : img.id}</p>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{img.id.slice(0, 12)} — {img.size > 0 ? `${(img.size / 1024 / 1024 / 1024).toFixed(2)} GB` : 'unknown size'}</p>
                              </div>
                            </div>
                            <button onClick={() => removeDockerImage(img.id)} className="btn btn-danger" style={{ padding: '4px 10px', fontSize: '0.8rem', flexShrink: 0 }}>Remove</button>
                          </div>
                        ))}
                      </div>
                    ) : dockerImagesError ? (
                      <p style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>{dockerImagesError}</p>
                    ) : (<p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No images found</p>)}
                  </div>
                </div>
              )}

            {activeTab === 'activity' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Activity Log</h1><p className="header-desc">Recent actions across the panel</p></div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <select className="form-control" value={activityFilterServer} onChange={e => { setActivityFilterServer(e.target.value); setActivityOffset(0) }} style={{ width: '200px' }}>
                      <option value="">All Servers</option>
                      {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button onClick={() => fetchActivity(activityOffset)} className="btn btn-outline"><RefreshCw size={16} /><span>Refresh</span></button>
                  </div>
                </div>
                <div className="card" style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '14px' }}>Time</th><th style={{ padding: '14px' }}>User</th><th style={{ padding: '14px' }}>Server</th><th style={{ padding: '14px' }}>Action</th><th style={{ padding: '14px' }}>Detail</th><th style={{ padding: '14px' }}>IP</th>
                    </tr></thead>
                    <tbody>
                      {activityLogs.map(entry => (
                        <tr key={entry.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}</td>
                          <td style={{ padding: '12px 14px' }}>{entry.username || entry.user_id}</td>
                          <td style={{ padding: '12px 14px' }}>{entry.server_name || (entry.server_id ? `#${entry.server_id}` : '—')}</td>
                          <td style={{ padding: '12px 14px' }}><span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(56,189,248,0.1)', color: 'var(--color-primary)', fontSize: '0.8rem' }}>{entry.action}</span></td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-muted)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.detail || '—'}</td>
                          <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{entry.ip_address || '—'}</td>
                        </tr>
                      ))}
                      {activityLogs.length === 0 && <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No activity recorded yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '16px' }}>
                  <button onClick={() => { const prev = Math.max(0, activityOffset - 50); setActivityOffset(prev); fetchActivity(prev) }} className="btn btn-outline" disabled={activityOffset === 0}>Previous</button>
                  <span style={{ display: 'flex', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Offset: {activityOffset}</span>
                  <button onClick={() => { const next = activityOffset + 50; setActivityOffset(next); fetchActivity(next) }} className="btn btn-outline" disabled={!activityHasMore}>Next</button>
                </div>
              </div>
            )}

            {activeTab === 'api-keys' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">API Keys</h1><p className="header-desc">Manage API access keys</p></div>
                  <button onClick={() => { setIsCreatingKey(true); setKeyFormName(''); setKeyFormPerms(['servers.read']); setKeyFormExpiry('') }} className="btn btn-primary"><Plus size={16} /><span>Create API Key</span></button>
                </div>
                {isCreatingKey && (
                  <div className="card" style={{ marginBottom: '24px', border: '1px solid var(--color-primary)' }}>
                    <h3 style={{ marginBottom: '16px' }}>Create API Key</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div className="form-group"><label className="form-label">Name</label><input className="form-control" value={keyFormName} onChange={e => setKeyFormName(e.target.value)} placeholder="My Integration" /></div>
                      <div className="form-group"><label className="form-label">Expires (optional)</label><input className="form-control" type="date" value={keyFormExpiry} onChange={e => setKeyFormExpiry(e.target.value)} /></div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Permissions</label>
                      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        {['servers.read', 'servers.manage', 'admin'].map(perm => (
                          <label key={perm} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                            <input type="checkbox" checked={keyFormPerms.includes(perm)} onChange={() => toggleKeyPerm(perm)} style={{ accentColor: 'var(--color-primary)' }} />{perm}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <button onClick={() => setIsCreatingKey(false)} className="btn btn-outline">Cancel</button>
                      <button onClick={createApiKey} className="btn btn-primary">Create</button>
                    </div>
                  </div>
                )}
                {newApiKeyRaw && (
                  <div className="card" style={{ marginBottom: '24px', border: '1px solid var(--color-success)', background: 'rgba(16,185,129,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                      <CheckCircle size={20} style={{ color: 'var(--color-success)' }} />
                      <h3 style={{ color: 'var(--color-success)' }}>API Key Created</h3>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>Copy this key now. It will not be shown again.</p>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div style={{ flex: 1, padding: '12px 16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', wordBreak: 'break-all', border: '1px solid var(--border-color)' }}>{newApiKeyRaw}</div>
                      <button onClick={() => copyToClipboard(newApiKeyRaw)} className="btn btn-outline" style={{ padding: '12px' }} title="Copy to clipboard"><Copy size={18} /></button>
                    </div>
                    <button onClick={() => setNewApiKeyRaw(null)} className="btn btn-outline" style={{ marginTop: '12px' }}>Dismiss</button>
                  </div>
                )}
                <div className="card" style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '14px' }}>Name</th><th style={{ padding: '14px' }}>Permissions</th><th style={{ padding: '14px' }}>Last Used</th><th style={{ padding: '14px' }}>Created</th><th style={{ padding: '14px' }}>Expires</th><th style={{ padding: '14px' }}></th>
                    </tr></thead>
                    <tbody>
                      {apiKeys.map(key => (
                        <tr key={key.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '14px', fontWeight: 600 }}>{key.name}</td>
                          <td style={{ padding: '14px' }}><div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>{(key.permissions || '').split(',').filter(Boolean).map(p => <span key={p} style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(168,85,247,0.1)', color: 'var(--color-secondary)', fontSize: '0.75rem' }}>{p}</span>)}</div></td>
                          <td style={{ padding: '14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{key.last_used ? new Date(key.last_used).toLocaleString() : 'Never'}</td>
                          <td style={{ padding: '14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{key.created_at ? new Date(key.created_at).toLocaleDateString() : '—'}</td>
                          <td style={{ padding: '14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{key.expires_at ? new Date(key.expires_at).toLocaleDateString() : 'Never'}</td>
                          <td style={{ padding: '14px' }}><button onClick={() => deleteApiKey(key)} className="btn btn-danger" style={{ padding: '6px 10px' }}><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                      {apiKeys.length === 0 && <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No API keys yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'users' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Users</h1><p className="header-desc">{panelUsers.length} registered user{panelUsers.length !== 1 ? 's' : ''}</p></div>
                  <button onClick={() => setIsCreatingUser(true)} className="btn btn-primary"><Plus size={16} /><span>Add User</span></button>
                </div>

                {isCreatingUser && (
                  <div className="card" style={{ marginBottom: '20px' }}>
                    <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>Create User</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                      <div className="form-group"><label className="form-label">Username</label><input className="form-control" value={userFormName} onChange={e => setUserFormName(e.target.value)} placeholder="username" autoFocus /></div>
                      <div className="form-group"><label className="form-label">Email</label><input className="form-control" type="email" value={userFormEmail} onChange={e => setUserFormEmail(e.target.value)} placeholder="user@example.com" /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                      <div className="form-group"><label className="form-label">Password</label><input className="form-control" type="password" value={userFormPass} onChange={e => setUserFormPass(e.target.value)} placeholder="min 8 characters" /></div>
                      <div className="form-group"><label className="form-label">Admin?</label>
                        <select className="form-control" value={userFormAdmin ? '1' : '0'} onChange={e => setUserFormAdmin(e.target.value === '1')}>
                          <option value="0">Regular User</option>
                          <option value="1">Root Admin</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={createPanelUser} className="btn btn-primary"><Plus size={14} /> Create</button>
                      <button onClick={() => setIsCreatingUser(false)} className="btn btn-outline"><X size={14} /> Cancel</button>
                    </div>
                  </div>
                )}

                <div className="card">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <th style={{ padding: '12px 14px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.8rem' }}>ID</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Username</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Email</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Role</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Created</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Actions</th>
                    </tr></thead>
                    <tbody>
                      {panelUsers.map(u => (
                        <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px 14px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{u.id}</td>
                          <td style={{ padding: '12px 14px', fontSize: '0.85rem', fontWeight: 600 }}>{u.username}</td>
                          {editingUser === u.id ? (
                            <td colSpan={3} style={{ padding: '8px 14px' }}>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <input className="form-control" value={userEditEmail} onChange={e => setUserEditEmail(e.target.value)} style={{ flex: 1, minWidth: '150px', padding: '6px 10px', fontSize: '0.8rem' }} placeholder="Email" />
                                <input className="form-control" type="password" value={userEditPass} onChange={e => setUserEditPass(e.target.value)} style={{ flex: 1, minWidth: '120px', padding: '6px 10px', fontSize: '0.8rem' }} placeholder="New password (blank = keep)" />
                                <select className="form-control" value={userEditAdmin ? '1' : '0'} onChange={e => setUserEditAdmin(e.target.value === '1')} style={{ padding: '6px 10px', fontSize: '0.8rem', width: '120px' }}>
                                  <option value="0">User</option>
                                  <option value="1">Admin</option>
                                </select>
                                <button onClick={() => updatePanelUser(u.id)} className="btn btn-primary" style={{ padding: '6px 10px' }}><CheckCircle size={14} /></button>
                                <button onClick={() => setEditingUser(null)} className="btn btn-outline" style={{ padding: '6px 10px' }}><X size={14} /></button>
                              </div>
                            </td>
                          ) : (
                            <>
                              <td style={{ padding: '12px 14px', fontSize: '0.85rem' }}>{u.email}</td>
                              <td style={{ padding: '12px 14px' }}><span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: u.root_admin ? 'rgba(139,92,246,0.15)' : 'rgba(34,197,94,0.15)', color: u.root_admin ? '#a78bfa' : '#4ade80' }}>{u.root_admin ? 'Admin' : 'User'}</span></td>
                              <td style={{ padding: '12px 14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                              <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                  <button onClick={() => { setEditingUser(u.id); setUserEditEmail(u.email); setUserEditPass(''); setUserEditAdmin(u.root_admin) }} className="btn btn-outline" style={{ padding: '6px 10px' }}><Settings size={14} /></button>
                                  <button onClick={() => deletePanelUser(u.id, u.username)} className="btn btn-danger" style={{ padding: '6px 10px' }}><Trash2 size={14} /></button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                      {panelUsers.length === 0 && <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No users.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'create-server' && (
              <div style={{ maxWidth: '900px' }}>
                <div className="header-wrapper"><div><h1 className="header-title">Deploy Server</h1><p className="header-desc">Spin up a Docker container in seconds</p></div></div>
                <form onSubmit={handleCreateServer}>
                  <div className="card" style={{ marginBottom: '20px' }}>
                    <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>1. Choose Image</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                      {GAME_PRESETS.map(p => (
                        <div key={p.id} onClick={() => { setFormPreset(p.id); if (p.id !== 'custom') { setFormImage(p.image); const memStr = `${Math.floor(p.memory / 1024)}G`; setFormStartup(p.startup.replace('$MEMORY', memStr)); setFormMemory(p.memory); setFormDisk(p.disk); setFormStartupAuto(true); setFormEnv(p.env ? { ...p.env } : {}); setFormEnvText(Object.entries(p.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')); setFormGameVersion(p.defaultVersion || '') } else { setFormImage(''); setFormStartup(''); setFormStartupAuto(false); setFormEnv({}); setFormEnvText(''); setFormGameVersion('') } if (!formName || GAME_PRESETS.some(gp => gp.label === formName)) { setFormName(p.id === 'custom' ? '' : p.label) } }} style={{ padding: '16px', borderRadius: '10px', cursor: 'pointer', border: formPreset === p.id ? '2px solid var(--color-primary)' : '1px solid var(--border-color)', background: formPreset === p.id ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.02)', transition: 'all 0.15s ease', textAlign: 'center' }}>
                          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>{p.icon}</div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>{p.label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                      <button type="button" onClick={() => setFormUseDockerfile(false)} className={`btn ${!formUseDockerfile ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1, justifyContent: 'center' }}>Pull Image</button>
                      <button type="button" onClick={() => { setFormUseDockerfile(true); if (!formDockerfile) setFormDockerfile('FROM ubuntu:22.04\n\nRUN apt-get update && apt-get install -y curl wget\n\nWORKDIR /home/container\nCOPY . /home/container\n\nEXPOSE 25565\nCMD ["/bin/bash"]') }} className={`btn ${formUseDockerfile ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1, justifyContent: 'center' }}>Build from Dockerfile</button>
                    </div>
                    {!formUseDockerfile ? (<>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Docker Image</label>
                        <input className="form-control" value={formImage} onChange={e => { setFormImage(e.target.value); setFormPreset('') }} placeholder="e.g. itzg/minecraft-server" required />
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>Enter any public Docker Hub or registry image</p>
                      </div>
                      {(() => { const preset = GAME_PRESETS.find(p => p.id === formPreset); return preset?.versionOptions ? (
                        <div className="form-group" style={{ marginBottom: 0, marginTop: '12px' }}>
                          <label className="form-label">Game Version</label>
                          <select className="form-control" value={formGameVersion} onChange={e => setFormGameVersion(e.target.value)}>
                            {preset.versionOptions!.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>LATEST follows the newest release. Pinning a version lets this image run exactly that game version.</p>
                        </div>
                      ) : null })()}
                      <div className="form-group" style={{ marginBottom: 0, marginTop: '12px' }}>
                        <label className="form-label">Environment Variables <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(KEY=VALUE, one per line)</span></label>
                        <textarea className="form-control" rows={4} value={formEnvText} onChange={e => setFormEnvText(e.target.value)} placeholder={'EULA=TRUE\nVERSION=1.20.4'} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }} />
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>Passed to the container; used by images to pick versions/modes (VERSION, TYPE, DIFFICULTY, ...).</p>
                      </div>
                    </>) : (<>
                      <div className="form-group"><label className="form-label">Image Name</label><input className="form-control" value={formImageName} onChange={e => setFormImageName(e.target.value)} placeholder="e.g. my-server:latest" required /></div>
                      <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Dockerfile</label><textarea className="form-control" rows={14} value={formDockerfile} onChange={e => setFormDockerfile(e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', whiteSpace: 'pre' }} /></div>
                      <button type="button" onClick={buildDockerImage} disabled={isBuildingImage || !formDockerfile || !formImageName} className="btn btn-primary" style={{ marginTop: '12px' }}>{isBuildingImage ? 'Building...' : 'Build Image'}</button>
                    </>)}
                    <div className="form-group" style={{ marginTop: '16px', marginBottom: 0 }}>
                      <label className="form-label">Docker Network</label>
                      <select className="form-control" value={formNetwork} onChange={e => setFormNetwork(e.target.value)}>
                        {dockerNetworks.length > 0 ? dockerNetworks.map(n => <option key={n.name} value={n.name}>{n.name} ({n.driver}){n.name === 'pterodactyl-net' ? ' — default' : ''}</option>) : (<>
                          <option value="pterodactyl-net">pterodactyl-net (bridge) — default</option><option value="host">host</option><option value="bridge">bridge</option><option value="none">none</option>
                        </>)}
                      </select>
                    </div>
                  </div>
                  <div className="card" style={{ marginBottom: '20px' }}>
                    <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>2. Server Details</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                      <div className="form-group"><label className="form-label">Server Name</label><input className="form-control" value={formName} onChange={e => setFormName(e.target.value)} required placeholder="My Server" /></div>
                      <div className="form-group"><label className="form-label">Node</label><select className="form-control" value={formNodeId} onChange={e => { const nid = Number(e.target.value); setFormNodeId(nid); setFormAllocId(0) }} required><option value={0}>Select node...</option>{nodes.map(n => <option key={n.id} value={n.id}>{n.name} ({n.fqdn})</option>)}</select></div>
                      <div className="form-group" style={{ gridColumn: 'span 2' }}><label className="form-label">Description</label><input className="form-control" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Optional" /></div>
                    </div>
                  </div>
                  <div className="card" style={{ marginBottom: '20px' }}>
                    <h3 style={{ marginBottom: '16px', fontSize: '1rem' }}>3. Allocation & Resources</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                      <div className="form-group"><label className="form-label">Primary Port</label><select className="form-control" value={formAllocId} onChange={e => setFormAllocId(Number(e.target.value))} disabled={formNodeId === 0}><option value={0}>No allocation (all ports)</option>{allocations.filter(a => !a.server_id && a.node_id === formNodeId).map(a => <option key={a.id} value={a.id}>{a.ip_address}:{a.port}</option>)}</select></div>
                      <div className="form-group"><label className="form-label">Memory (MB)</label><input className="form-control" type="number" value={formMemory} onChange={e => setFormMemory(Number(e.target.value))} required min={256} /></div>
                      <div className="form-group"><label className="form-label">Disk (MB)</label><input className="form-control" type="number" value={formDisk} onChange={e => setFormDisk(Number(e.target.value))} required min={512} /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                      <div className="form-group"><label className="form-label">CPU Limit (%)</label><input className="form-control" type="number" value={formCpu} onChange={e => setFormCpu(Number(e.target.value))} required min={1} max={1000} /></div>
                      {!formUseDockerfile && <div className="form-group" style={{ gridColumn: 'span 2' }}><label className="form-label">Startup Command</label><div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}><label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}><input type="checkbox" checked={formStartupAuto} onChange={e => setFormStartupAuto(e.target.checked)} style={{ accentColor: 'var(--color-primary)' }} />Auto (use command from preset/image)</label>{formStartupAuto && <span style={{ fontSize: '0.75rem', color: 'var(--color-success)' }}>locked to preset command</span>}</div><input className="form-control" value={formStartup} onChange={e => setFormStartup(e.target.value)} disabled={formStartupAuto} required style={formStartupAuto ? { opacity: 0.6, cursor: 'not-allowed' } : undefined} /></div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                    <button type="button" onClick={() => setActiveTab('servers')} className="btn btn-outline">Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={formNodeId === 0}><ServerIcon size={16} /> Deploy Server</button>
                  </div>
                </form>
              </div>
            )}
{/*_PART2_MARKER_*/}
            {activeTab === 'templates' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Server Templates</h1><p className="header-desc">Reusable configurations for quick deployments</p></div>
                  <button onClick={() => { setEditingTemplate(null); setTemplateForm({ name: '', description: '', docker_image: 'itzg/minecraft-server', docker_network: 'pterodactyl-net', startup_command: '', cpu_limit: 100, memory_limit: 2048, disk_limit: 10240, alloc_port: 25565, featured: false }); setShowTemplateDialog(true) }} className="btn btn-primary"><Plus size={16} /><span>New Template</span></button>
                </div>
                {templates.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>No templates yet. Create one or use "Save as Template" on a server.</div>
                ) : (
                  <div className="card-grid">
                    {templates.map(t => (
                      <div key={t.id} className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{t.name} {t.featured && <span style={{ fontSize: '0.65rem', color: 'var(--color-secondary)', border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.1)', padding: '1px 6px', borderRadius: '4px', verticalAlign: 'middle' }}>FEATURED</span>}</h3>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', minHeight: '38px', marginBottom: '16px' }}>{t.description || 'No description'}</p>
                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px', flexWrap: 'wrap' }}>
                          <span><Layers size={14} style={{ verticalAlign: 'middle' }} /> {t.docker_image}</span>
                          <span><Cpu size={14} style={{ verticalAlign: 'middle' }} /> {t.cpu_limit}%</span>
                          <span><HardDrive size={14} style={{ verticalAlign: 'middle' }} /> {t.memory_limit} MB</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => applyTemplate(t)} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Use Template</button>
                          <button onClick={() => { setEditingTemplate(t.id); setTemplateForm({ name: t.name, description: t.description || '', docker_image: t.docker_image, docker_network: t.docker_network, startup_command: t.startup_command || '', cpu_limit: t.cpu_limit, memory_limit: t.memory_limit, disk_limit: t.disk_limit, alloc_port: t.alloc_port, featured: t.featured }); setShowTemplateDialog(true) }} className="btn btn-outline" style={{ padding: '8px 12px' }}><Pencil size={14} /></button>
                          <button onClick={() => deleteTemplate(t.id, t.name)} className="btn btn-danger" style={{ padding: '8px 12px' }}><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {showTemplateDialog && (
                  <div className="popup-overlay" onClick={() => setShowTemplateDialog(false)}>
                    <div className="popup-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
                      <h3 className="popup-title">{editingTemplate ? 'Edit Template' : 'New Template'}</h3>
                      <div className="form-group"><label className="form-label">Name</label><input className="form-control" value={templateForm.name} onChange={e => setTemplateForm({ ...templateForm, name: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">Description</label><textarea className="form-control" rows={2} value={templateForm.description} onChange={e => setTemplateForm({ ...templateForm, description: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">Docker Image</label><input className="form-control" value={templateForm.docker_image} onChange={e => setTemplateForm({ ...templateForm, docker_image: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">Network</label><input className="form-control" value={templateForm.docker_network} onChange={e => setTemplateForm({ ...templateForm, docker_network: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">Startup Command</label><input className="form-control" value={templateForm.startup_command} onChange={e => setTemplateForm({ ...templateForm, startup_command: e.target.value })} /></div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
                        <div className="form-group"><label className="form-label">CPU %</label><input className="form-control" type="number" value={templateForm.cpu_limit} onChange={e => setTemplateForm({ ...templateForm, cpu_limit: Number(e.target.value) })} /></div>
                        <div className="form-group"><label className="form-label">Memory MB</label><input className="form-control" type="number" value={templateForm.memory_limit} onChange={e => setTemplateForm({ ...templateForm, memory_limit: Number(e.target.value) })} /></div>
                        <div className="form-group"><label className="form-label">Disk MB</label><input className="form-control" type="number" value={templateForm.disk_limit} onChange={e => setTemplateForm({ ...templateForm, disk_limit: Number(e.target.value) })} /></div>
                        <div className="form-group"><label className="form-label">Port</label><input className="form-control" type="number" value={templateForm.alloc_port || ''} onChange={e => setTemplateForm({ ...templateForm, alloc_port: e.target.value ? Number(e.target.value) : null })} /></div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={templateForm.featured} onChange={e => setTemplateForm({ ...templateForm, featured: e.target.checked })} style={{ accentColor: 'var(--color-primary)' }} /> Featured (shown first)
                      </label>
                      <div className="popup-actions">
                        <button className="btn btn-outline" onClick={() => setShowTemplateDialog(false)}>Cancel</button>
                        <button className="btn btn-primary" onClick={saveTemplate} disabled={templateSaving}>{templateSaving ? 'Saving...' : 'Save Template'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'webhooks' && (
              <div>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Webhooks</h1><p className="header-desc">Send event notifications to external endpoints</p></div>
                  <button onClick={() => { setEditingWebhook(null); setWebhookForm({ name: '', url: '', events: ['server.created'], is_active: true }); setShowWebhookDialog(true) }} className="btn btn-primary"><Plus size={16} /><span>New Webhook</span></button>
                </div>
                {webhooks.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>No webhooks configured. Webhooks fire on server create, power, and delete events.</div>
                ) : (
                  <div className="card" style={{ padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Name</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>URL</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Events</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Active</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}></th>
                      </tr></thead>
                      <tbody>
                        {webhooks.map(h => (
                          <tr key={h.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '12px 14px', fontWeight: 600 }}>{h.name}</td>
                            <td style={{ padding: '12px 14px', fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.url}</td>
                            <td style={{ padding: '12px 14px' }}>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {h.events.split(',').map((ev: string) => <span key={ev} style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: '4px', background: 'rgba(56,189,248,0.1)', color: 'var(--color-primary)' }}>{ev.trim()}</span>)}
                              </div>
                            </td>
                            <td style={{ padding: '12px 14px' }}><span style={{ color: h.is_active ? 'var(--color-success)' : 'var(--text-muted)' }}>{h.is_active ? 'Active' : 'Paused'}</span></td>
                            <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button onClick={() => testWebhook(h.id)} className="btn btn-outline" style={{ padding: '4px 8px', marginRight: '8px' }} title="Send test ping"><Send size={14} /></button>
                              <button onClick={() => { setEditingWebhook(h.id); setWebhookForm({ name: h.name, url: h.url, events: h.events.split(','), is_active: h.is_active }); setShowWebhookDialog(true) }} className="btn btn-outline" style={{ padding: '4px 8px', marginRight: '8px' }}><Pencil size={14} /></button>
                              <button onClick={() => deleteWebhook(h.id, h.name)} className="btn btn-danger" style={{ padding: '4px 8px' }}><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {showWebhookDialog && (
                  <div className="popup-overlay" onClick={() => setShowWebhookDialog(false)}>
                    <div className="popup-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
                      <h3 className="popup-title">{editingWebhook ? 'Edit Webhook' : 'New Webhook'}</h3>
                      <div className="form-group"><label className="form-label">Name</label><input className="form-control" value={webhookForm.name} onChange={e => setWebhookForm({ ...webhookForm, name: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">URL</label><input className="form-control" value={webhookForm.url} onChange={e => setWebhookForm({ ...webhookForm, url: e.target.value })} placeholder="https://example.com/hook" /></div>
                      <div className="form-group"><label className="form-label">Events</label>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {['server.created', 'server.deleted', 'server.power.start', 'server.power.stop', 'server.power.restart', 'server.power.kill'].map(ev => {
                            const has = webhookForm.events.includes(ev)
                            return <button key={ev} type="button" onClick={() => toggleWebhookEvent(ev)} style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '0.8rem', border: has ? '1px solid var(--color-primary)' : '1px solid var(--border-color)', background: has ? 'rgba(56,189,248,0.1)' : 'transparent', color: has ? 'var(--color-primary)' : 'var(--text-muted)', cursor: 'pointer' }}>{ev}</button>
                          })}
                        </div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={webhookForm.is_active} onChange={e => setWebhookForm({ ...webhookForm, is_active: e.target.checked })} style={{ accentColor: 'var(--color-primary)' }} /> Active
                      </label>
                      <div className="popup-actions">
                        <button className="btn btn-outline" onClick={() => setShowWebhookDialog(false)}>Cancel</button>
                        <button className="btn btn-primary" onClick={saveWebhook} disabled={webhookSaving}>{webhookSaving ? 'Saving...' : 'Save Webhook'}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'settings' && (
              <div style={{ maxWidth: '600px' }}>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Settings</h1><p className="header-desc">Manage your account</p></div>
                </div>
                <div className="tabs-container" style={{ marginBottom: '24px' }}>
                  <button onClick={() => setSettingsTab('profile')} className={`tab-btn ${settingsTab === 'profile' ? 'active' : ''}`}><User size={16} /> Profile</button>
                  <button onClick={() => setSettingsTab('security')} className={`tab-btn ${settingsTab === 'security' ? 'active' : ''}`}><Shield size={16} /> Security</button>
                  {user.root_admin && <button onClick={() => setSettingsTab('panel')} className={`tab-btn ${settingsTab === 'panel' ? 'active' : ''}`}><Settings2 size={16} /> Panel</button>}
                </div>
                {settingsTab === 'profile' && (
                  <div className="card">
                    <h3 style={{ marginBottom: '16px' }}>Profile Information</h3>
                    <div className="form-group">
                      <label className="form-label">Username</label>
                      <input className="form-control" value={user?.username || ''} disabled style={{ opacity: 0.6 }} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Email</label>
                      <input className="form-control" type="email" value={settingsEmail || user?.email || ''} onChange={e => setSettingsEmail(e.target.value)} placeholder="your@email.com" />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <button onClick={saveSettings} className="btn btn-primary"><Save size={16} /> Save Changes</button>
                    </div>
                  </div>
                )}
                {settingsTab === 'security' && (
                  <div className="card">
                    <h3 style={{ marginBottom: '16px' }}>Change Password</h3>
                    <div className="form-group">
                      <label className="form-label">New Password</label>
                      <input className="form-control" type="password" value={settingsNewPass} onChange={e => setSettingsNewPass(e.target.value)} placeholder="min 8 characters" />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Confirm Password</label>
                      <input className="form-control" type="password" value={settingsConfirmPass} onChange={e => setSettingsConfirmPass(e.target.value)} placeholder="Confirm new password" />
                    </div>
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '16px' }}>
                      <button onClick={saveSettings} className="btn btn-primary"><Save size={16} /> Update Password</button>
                    </div>
                  </div>
                )}
                {settingsTab === 'panel' && user.root_admin && (
                  <div>
                    <div className="card" style={{ marginBottom: '24px' }}>
                      <h3 style={{ marginBottom: '16px' }}>Panel Settings</h3>
                      <div className="form-group"><label className="form-label">Site Name</label><input className="form-control" value={panelSettings.site_name || ''} onChange={e => setPanelSettings({ ...panelSettings, site_name: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label">Default Theme</label><select className="form-control" value={panelSettings.default_theme || 'dark'} onChange={e => setPanelSettings({ ...panelSettings, default_theme: e.target.value })}><option value="dark">Dark</option><option value="light">Light</option></select></div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={!!panelSettings.maintenance_mode} onChange={e => setPanelSettings({ ...panelSettings, maintenance_mode: e.target.checked })} style={{ accentColor: 'var(--color-primary)' }} /> Maintenance mode (blocks login)
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={!!panelSettings.registration_enabled} onChange={e => setPanelSettings({ ...panelSettings, registration_enabled: e.target.checked })} style={{ accentColor: 'var(--color-primary)' }} /> Allow registration
                      </label>
                      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <button onClick={savePanelSettings} className="btn btn-primary"><Save size={16} /> Save Panel Settings</button>
                      </div>
                    </div>
                    <div className="card" style={{ padding: 0 }}>
                      <div className="header-wrapper" style={{ padding: '16px' }}>
                        <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Announcements</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Banners shown on the dashboard</p></div>
                        <button onClick={() => { setEditingAnnouncement(null); setAnnouncementForm({ title: '', content: '', color: '#38bdf8', is_active: true }); setShowAnnouncementDialog(true) }} className="btn btn-primary"><Plus size={14} /><span>New Announcement</span></button>
                      </div>
                      <div style={{ padding: '0 16px 16px' }}>
                        {announcements.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No announcements</p>
                        ) : (
                          <div style={{ display: 'grid', gap: '8px' }}>
                            {announcements.map(a => (
                              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: a.color || '#38bdf8', flexShrink: 0 }}></div>
                                  <div style={{ minWidth: 0 }}>
                                    <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.title} {!a.is_active && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>(hidden)</span>}</p>
                                    {a.content && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.content}</p>}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                                  <button onClick={() => { setEditingAnnouncement(a.id); setAnnouncementForm({ title: a.title, content: a.content || '', color: a.color || '#38bdf8', is_active: a.is_active }); setShowAnnouncementDialog(true) }} className="btn btn-outline" style={{ padding: '4px 8px' }}><Pencil size={14} /></button>
                                  <button onClick={() => deleteAnnouncement(a.id, a.title)} className="btn btn-danger" style={{ padding: '4px 8px' }}><Trash2 size={14} /></button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {showAnnouncementDialog && (
                      <div className="popup-overlay" onClick={() => setShowAnnouncementDialog(false)}>
                        <div className="popup-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
                          <h3 className="popup-title">{editingAnnouncement ? 'Edit Announcement' : 'New Announcement'}</h3>
                          <div className="form-group"><label className="form-label">Title</label><input className="form-control" value={announcementForm.title} onChange={e => setAnnouncementForm({ ...announcementForm, title: e.target.value })} /></div>
                          <div className="form-group"><label className="form-label">Content</label><textarea className="form-control" rows={3} value={announcementForm.content} onChange={e => setAnnouncementForm({ ...announcementForm, content: e.target.value })} /></div>
                          <div className="form-group"><label className="form-label">Color</label><input type="color" value={announcementForm.color} onChange={e => setAnnouncementForm({ ...announcementForm, color: e.target.value })} style={{ width: '60px', height: '34px', padding: 0, background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '6px' }} /></div>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '0.85rem' }}>
                            <input type="checkbox" checked={!!announcementForm.is_active} onChange={e => setAnnouncementForm({ ...announcementForm, is_active: e.target.checked })} style={{ accentColor: 'var(--color-primary)' }} /> Active
                          </label>
                          <div className="popup-actions">
                            <button className="btn btn-outline" onClick={() => setShowAnnouncementDialog(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={saveAnnouncement} disabled={announcementSaving}>{announcementSaving ? 'Saving...' : 'Save Announcement'}</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
</>) : (<div>
<div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <button onClick={() => setSelectedServer(null)} className="btn btn-outline" style={{ padding: '8px 12px' }}>&larr; Back</button>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginLeft: '8px' }}>{selectedServer.name}</h2>
              <span className={`status-pill ${stats.status}`} style={{ marginLeft: '12px' }}><span className="status-glow"></span>{stats.status}</span>
            </div>
            <div className="card" style={{ display: 'flex', gap: '16px', padding: '16px', marginBottom: '24px', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => sendPowerAction('start')} className="btn btn-outline" style={{ color: 'var(--color-success)', borderColor: 'rgba(16,185,129,0.2)' }}><Play size={16} /><span>Start</span></button>
                <button onClick={() => sendPowerAction('stop')} className="btn btn-outline" style={{ color: 'var(--color-warning)', borderColor: 'rgba(245,158,11,0.2)' }}><Square size={16} /><span>Stop</span></button>
                <button onClick={() => sendPowerAction('kill')} className="btn btn-danger"><Skull size={16} /><span>Kill</span></button>
                <button onClick={() => sendPowerAction('restart')} className="btn btn-outline"><RotateCw size={16} /><span>Restart</span></button>
              </div>
              <div style={{ height: '24px', borderRight: '1px solid var(--border-color)', margin: '0 8px' }}></div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(user.root_admin || selectedServer.owner_id === user.id) && <button onClick={() => reinstallServer(selectedServer)} className="btn btn-outline" style={{ color: 'var(--color-warning)', borderColor: 'rgba(245,158,11,0.2)' }}><RotateCcw size={16} /><span>Reinstall</span></button>}
                {user.root_admin && <button onClick={() => transferServer(selectedServer)} className="btn btn-outline"><ArrowRight size={16} /><span>Transfer</span></button>}
                {user.root_admin && <button onClick={() => suspendServer(selectedServer, selectedServer.status !== 'suspended')} className="btn btn-outline" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)' }}><PauseCircle size={16} /><span>{selectedServer.status === 'suspended' ? 'Unsuspend' : 'Suspend'}</span></button>}
                {(user.root_admin || selectedServer.owner_id === user.id) && <button onClick={() => { setCloneName(`${selectedServer.name}-clone`); setShowCloneDialog(true) }} className="btn btn-outline" style={{ color: 'var(--color-secondary)', borderColor: 'rgba(168,85,247,0.2)' }}><Layers size={16} /><span>Clone</span></button>}
              </div>
              <div style={{ height: '24px', borderRight: '1px solid var(--border-color)', margin: '0 8px' }}></div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(user.root_admin || selectedServer.owner_id === user.id) && <button onClick={() => openSettingsDialog(selectedServer)} className="btn btn-outline"><Settings2 size={16} /><span>Settings</span></button>}
                {(user.root_admin || selectedServer.owner_id === user.id) && <button onClick={() => { if (window.confirm(`Delete server "${selectedServer.name}"? This permanently removes its container and data.`)) deleteServer(selectedServer) }} className="btn btn-danger"><Trash2 size={16} /><span>Delete</span></button>}
                {(user.root_admin || selectedServer.owner_id === user.id) && <button onClick={() => openShareDialog(selectedServer)} className="btn btn-outline"><Share2 size={16} /><span>Share</span></button>}
                {user.root_admin && <button onClick={() => { setTemplateForm({ name: `${selectedServer.name} Template`, description: selectedServer.description || '', docker_image: selectedServer.docker_image, docker_network: selectedServer.docker_network, startup_command: selectedServer.startup_command || '', cpu_limit: selectedServer.cpu_limit, memory_limit: selectedServer.memory_limit, disk_limit: selectedServer.disk_limit, alloc_port: selectedServer.allocations?.[0]?.port, featured: false }); setShowTemplateDialog(true) }} className="btn btn-outline"><FileText size={16} /><span>Save as Template</span></button>}
              </div>
              <div style={{ height: '24px', borderRight: '1px solid var(--border-color)', margin: '0 8px' }}></div>
              <div style={{ display: 'flex', gap: '24px' }}>
                <div><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CPU</span><p style={{ fontWeight: 600 }}>{stats.cpu}%</p></div>
                <div><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>MEMORY</span><p style={{ fontWeight: 600 }}>{stats.memory} / {selectedServer.memory_limit} MB</p></div>
                <div><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>DISK</span><p style={{ fontWeight: 600 }}>{stats.disk} / {selectedServer.disk_limit} MB</p></div>
              </div>
            </div>
            {showCloneDialog && (
              <div className="popup-overlay" onClick={() => setShowCloneDialog(false)}>
                <div className="popup-box" onClick={e => e.stopPropagation()}>
                  <h3 className="popup-title">Clone Server</h3>
                  <p className="popup-message">Enter a name for the cloned server.</p>
                  <div className="form-group">
                    <input className="form-control" value={cloneName} onChange={e => setCloneName(e.target.value)} placeholder="Cloned server name" autoFocus />
                  </div>
                  <div className="popup-actions">
                    <button className="btn btn-outline" onClick={() => setShowCloneDialog(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => cloneServer(selectedServer!)} disabled={cloning}>{cloning ? 'Cloning...' : 'Clone'}</button>
                  </div>
                </div>
              </div>
            )}
            {showScheduleDialog && selectedServer && (
              <div className="popup-overlay" onClick={() => setShowScheduleDialog(false)}>
                <div className="popup-box" onClick={e => e.stopPropagation()}>
                  <h3 className="popup-title">Schedule Power Action</h3>
                  <div className="form-group">
                    <label className="form-label">Action</label>
                    <select className="form-control" value={scheduleAction} onChange={e => setScheduleAction(e.target.value)}>
                      <option value="start">Start</option>
                      <option value="stop">Stop</option>
                      <option value="kill">Kill</option>
                      <option value="restart">Restart</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Scheduled Time</label>
                    <input className="form-control" type="datetime-local" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                      <input type="checkbox" checked={scheduleRecurring} onChange={e => setScheduleRecurring(e.target.checked)} style={{ accentColor: 'var(--color-primary)' }} /> Recurring (cron pattern)
                    </label>
                  </div>
                  {scheduleRecurring && (
                    <div className="form-group">
                      <label className="form-label">Cron Pattern <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(minute hour day month weekday)</span></label>
                      <input className="form-control" value={scheduleCron} onChange={e => setScheduleCron(e.target.value)} placeholder="e.g. 0 4 * * *" style={{ fontFamily: 'var(--font-mono)' }} />
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>Examples: <code style={{ color: 'var(--color-primary)' }}>*/5 * * * *</code> every 5 min, <code style={{ color: 'var(--color-primary)' }}>0 4 * * *</code> daily 04:00, <code style={{ color: 'var(--color-primary)' }}>0 2 * * 1</code> Mondays 02:00</p>
                    </div>
                  )}
                  <div className="popup-actions">
                    <button className="btn btn-outline" onClick={() => setShowScheduleDialog(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={createSchedule}>Schedule</button>
                  </div>
                </div>
              </div>
            )}
            {showSettingsDialog && selectedServer && (
              <div className="popup-overlay" onClick={() => setShowSettingsDialog(false)}>
                <div className="popup-box" onClick={e => e.stopPropagation()}>
                  <h3 className="popup-title">Server Settings</h3>
                  <p className="popup-message">Update server configuration. Image/startup changes apply on next reinstall.</p>
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-control" value={settingsName} onChange={e => setSettingsName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <textarea className="form-control" rows={2} value={settingsDesc} onChange={e => setSettingsDesc(e.target.value)} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                    <div className="form-group">
                      <label className="form-label">CPU %</label>
                      <input className="form-control" type="number" value={settingsCpu} onChange={e => setSettingsCpu(Number(e.target.value))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Memory (MB)</label>
                      <input className="form-control" type="number" value={settingsMemory} onChange={e => setSettingsMemory(Number(e.target.value))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Disk (MB)</label>
                      <input className="form-control" type="number" value={settingsDisk} onChange={e => setSettingsDisk(Number(e.target.value))} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Docker Image</label>
                    <input className="form-control" value={settingsImage} onChange={e => setSettingsImage(e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Startup Command</label>
                    <textarea className="form-control" rows={2} value={settingsStartup} onChange={e => setSettingsStartup(e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }} />
                  </div>
                  <div className="popup-actions">
                    <button className="btn btn-outline" onClick={() => setShowSettingsDialog(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={saveServerSettings} disabled={settingsSaving}>{settingsSaving ? 'Saving...' : 'Save'}</button>
                  </div>
                </div>
              </div>
            )}
            {showShareDialog && selectedServer && (
              <div className="popup-overlay" onClick={() => setShowShareDialog(false)}>
                <div className="popup-box" onClick={e => e.stopPropagation()}>
                  <h3 className="popup-title">Share Server</h3>
                  <p className="popup-message">Grant other panel users access to "{selectedServer.name}".</p>
                  <div className="form-group">
                    <label className="form-label">Username or Email</label>
                    <input className="form-control" value={shareUsername} onChange={e => setShareUsername(e.target.value)} placeholder="e.g. friend@example.com" onKeyDown={e => { if (e.key === 'Enter') addMember() }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Permissions</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.8rem' }}>
                      {['console', 'power', 'files', 'schedules', 'logs'].map(p => (
                        <label key={p} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={sharePerms.includes(p)} onChange={() => setSharePerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])} style={{ accentColor: 'var(--color-primary)' }} /> {p}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                    <button className="btn btn-primary" onClick={addMember} style={{ padding: '6px 14px' }}><Plus size={14} /> Add Member</button>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px', maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {members.length === 0 && <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No shared members yet.</p>}
                    {members.map(m => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{m.username}</span>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{m.permissions.split(',').join(', ')}</div>
                        </div>
                        <button onClick={() => removeMember(m)} className="btn btn-danger" style={{ padding: '4px 8px' }}><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <div className="popup-actions">
                    <button className="btn btn-outline" onClick={() => setShowShareDialog(false)}>Close</button>
                  </div>
                </div>
              </div>
            )}
            {showNetworkDialog && (
              <div className="popup-overlay" onClick={() => setShowNetworkDialog(false)}>
                <div className="popup-box" onClick={e => e.stopPropagation()}>
                  <h3 className="popup-title">Create Docker Network</h3>
                  <div className="form-group">
                    <label className="form-label">Network Name</label>
                    <input className="form-control" value={networkName} onChange={e => setNetworkName(e.target.value)} placeholder="e.g. my-network" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Driver</label>
                    <select className="form-control" value={networkDriver} onChange={e => setNetworkDriver(e.target.value)}>
                      <option value="bridge">bridge</option>
                      <option value="overlay">overlay</option>
                      <option value="host">host</option>
                    </select>
                  </div>
                  <div className="popup-actions">
                    <button className="btn btn-outline" onClick={() => setShowNetworkDialog(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={createNetwork}>Create</button>
                  </div>
                </div>
              </div>
            )}
            {showGroupDialog && (
              <div className="popup-overlay" onClick={() => setShowGroupDialog(false)}>
                <div className="popup-box" onClick={e => e.stopPropagation()}>
                  <h3 className="popup-title">{editingGroup ? 'Edit Group' : 'Create Group'}</h3>
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <input className="form-control" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <input className="form-control" value={groupDescription} onChange={e => setGroupDescription(e.target.value)} placeholder="Optional description" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Color</label>
                    <input className="form-control" type="color" value={groupColor} onChange={e => setGroupColor(e.target.value)} />
                  </div>
                  <div className="popup-actions">
                    <button className="btn btn-outline" onClick={() => setShowGroupDialog(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={createServerGroup}>Save</button>
                  </div>
                </div>
              </div>
            )}
            {showCloudflareDialog && (
              <div className="popup-overlay" onClick={() => setShowCloudflareDialog(false)}>
                <div className="popup-box" onClick={e => e.stopPropagation()}>
                  <h3 className="popup-title">Add DNS Record</h3>
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <select className="form-control" value={cfRecordType} onChange={e => setCfRecordType(e.target.value)}>
                      <option value="A">A</option>
                      <option value="AAAA">AAAA</option>
                      <option value="CNAME">CNAME</option>
                      <option value="TXT">TXT</option>
                      <option value="SRV">SRV</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Name (subdomain)</label>
                    <input className="form-control" value={cfRecordName} onChange={e => setCfRecordName(e.target.value)} placeholder="e.g. mc.example.com" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Content (IP or target)</label>
                    <input className="form-control" value={cfRecordContent} onChange={e => setCfRecordContent(e.target.value)} placeholder="e.g. 192.168.1.100" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">TTL (seconds)</label>
                    <input className="form-control" type="number" value={cfRecordTTL} onChange={e => setCfRecordTTL(Number(e.target.value))} min={60} max={86400} />
                  </div>
                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.875rem' }}>
                      <input type="checkbox" checked={cfRecordProxied} onChange={e => setCfRecordProxied(e.target.checked)} style={{ accentColor: 'var(--color-primary)' }} /> Proxied (Cloudflare CDN)
                    </label>
                  </div>
                  <div className="popup-actions">
                    <button className="btn btn-outline" onClick={() => setShowCloudflareDialog(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={createCloudflareRecord} disabled={cfLoading}>{cfLoading ? 'Saving...' : 'Create'}</button>
                  </div>
                </div>
              </div>
            )}
            {showPlayitDialog && (
              <div className="popup-overlay" onClick={() => setShowPlayitDialog(false)}>
                <div className="popup-box" onClick={e => e.stopPropagation()}>
                  <h3 className="popup-title">Create Playit.gg Tunnel</h3>
                  <div className="form-group">
                    <label className="form-label">Tunnel Name</label>
                    <input className="form-control" value={playitTunnelName} onChange={e => setPlayitTunnelName(e.target.value)} placeholder="e.g. my-mc-server" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Port</label>
                    <input className="form-control" type="number" value={playitTunnelPort} onChange={e => setPlayitTunnelPort(Number(e.target.value))} min={1} max={65535} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Protocol</label>
                    <select className="form-control" value={playitTunnelProtocol} onChange={e => setPlayitTunnelProtocol(e.target.value)}>
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                    </select>
                  </div>
                  <div className="popup-actions">
                    <button className="btn btn-outline" onClick={() => setShowPlayitDialog(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={createPlayitTunnel} disabled={playitLoading}>{playitLoading ? 'Creating...' : 'Create'}</button>
                  </div>
                </div>
              </div>
            )}
            {showBugReport && (
              <div className="popup-overlay" onClick={() => setShowBugReport(false)}>
                <div className="popup-box" onClick={e => e.stopPropagation()}>
                  <h3 className="popup-title">Report a Bug</h3>
                  <div className="form-group">
                    <label className="form-label">Title</label>
                    <input className="form-control" value={bugReportTitle} onChange={e => setBugReportTitle(e.target.value)} placeholder="Short summary of the issue" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <textarea className="form-control" value={bugReportDesc} onChange={e => setBugReportDesc(e.target.value)} placeholder="What happened? Steps to reproduce, expected vs actual..." rows={4} style={{ resize: 'vertical' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Severity</label>
                    <select className="form-control" value={bugReportSeverity} onChange={e => setBugReportSeverity(e.target.value)}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div className="popup-actions">
                    <button className="btn btn-outline" onClick={() => setShowBugReport(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={submitBugReport} disabled={bugReportLoading}>{bugReportLoading ? 'Submitting...' : 'Submit'}</button>
                  </div>
                </div>
              </div>
            )}
            <div className="tabs-container">
              <button onClick={() => setDetailTab('console')} className={`tab-btn ${detailTab === 'console' ? 'active' : ''}`}><TerminalIcon size={16} /> Console</button>
              <button onClick={() => setDetailTab('stats')} className={`tab-btn ${detailTab === 'stats' ? 'active' : ''}`}><Cpu size={16} /> Stats</button>
              <button onClick={() => setDetailTab('files')} className={`tab-btn ${detailTab === 'files' ? 'active' : ''}`}><Folder size={16} /> Files</button>
              <button onClick={() => { setDetailTab('backups'); fetchBackups(selectedServer.id) }} className={`tab-btn ${detailTab === 'backups' ? 'active' : ''}`}><HardDrive size={16} /> Backups</button>
              <button onClick={() => setDetailTab('members')} className={`tab-btn ${detailTab === 'members' ? 'active' : ''}`}><Users size={16} /> Members</button>
              <button onClick={() => { setDetailTab('logs'); fetchLogs(selectedServer.id) }} className={`tab-btn ${detailTab === 'logs' ? 'active' : ''}`}><Bug size={16} /> Logs</button>
              <button onClick={() => { setDetailTab('schedules'); fetchSchedules(selectedServer.id) }} className={`tab-btn ${detailTab === 'schedules' ? 'active' : ''}`}><Activity size={16} /> Schedules</button>
              <button onClick={() => { setDetailTab('activity'); fetchServerActivity(selectedServer.id) }} className={`tab-btn ${detailTab === 'activity' ? 'active' : ''}`}><FileText size={16} /> Activity</button>
            </div>

            {detailTab === 'console' && (
              <div className="terminal-window">
                <div className="terminal-header">
                  <div className="terminal-dots"><span className="terminal-dot" style={{ backgroundColor: '#ef4444' }}></span><span className="terminal-dot" style={{ backgroundColor: '#f59e0b' }}></span><span className="terminal-dot" style={{ backgroundColor: '#10b981' }}></span></div>
                  <span>wings@{selectedServer.uuid.substring(0, 8)}</span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {consoleConnected && <span style={{ color: 'var(--color-success)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}><span className="status-glow"></span>Connected</span>}
                    {consoleConnected && <button onClick={() => stopConsole()} className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '0.8rem' }}><LogOut size={14} /> Disconnect</button>}
                  </div>
                </div>
                <div
                  ref={terminalContainerRef}
                  style={{ height: '520px', background: '#0d1117', padding: '10px 6px' }}
                />
                {!consoleConnected && (
                  <div style={{ padding: '14px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '10px' }}>
                    {consoleError && <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', margin: 0 }}>{consoleError}</p>}
                    <button
                      onClick={() => startConsole(selectedServer.id)}
                      className="btn btn-primary"
                      disabled={consoleLoading}
                      style={{ padding: '10px 32px', fontSize: '0.9rem', opacity: consoleLoading ? 0.5 : 1 }}
                    >
                      {consoleLoading ? 'Connecting...' : <><TerminalIcon size={16} /> Open Console</>}
                    </button>
                  </div>
                )}
              </div>
            )}

            {detailTab === 'logs' && (
              <div className="terminal-window">
                <div className="terminal-header">
                  <div className="terminal-dots"><span className="terminal-dot" style={{ backgroundColor: '#ef4444' }}></span><span className="terminal-dot" style={{ backgroundColor: '#f59e0b' }}></span><span className="terminal-dot" style={{ backgroundColor: '#10b981' }}></span></div>
                  <span>Container Logs — {selectedServer.name}</span>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select className="form-control" value={logsTail} onChange={e => setLogsTail(Number(e.target.value))} style={{ width: '80px', padding: '4px 8px', fontSize: '0.8rem' }}>
                      <option value={50}>50 lines</option>
                      <option value={100}>100 lines</option>
                      <option value={500}>500 lines</option>
                      <option value={1000}>1000 lines</option>
                    </select>
                    <button onClick={() => fetchLogs(selectedServer.id)} className="btn btn-outline" style={{ padding: '4px 10px', fontSize: '0.8rem' }}><RefreshCw size={14} /> Refresh</button>
                  </div>
                </div>
                <div className="terminal-body" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {logsLoading ? (
                    <span style={{ color: 'var(--text-muted)' }}>Loading logs...</span>
                  ) : logsContent ? (
                    logsContent.split('\n').map((line, i) => (
                      <div key={i} style={{ color: line.includes('ERROR') || line.includes('error') || line.includes('ERR') ? 'var(--color-danger)' : line.includes('WARN') || line.includes('warn') ? 'var(--color-warning)' : 'var(--text-muted)' }}>{line}</div>
                    ))
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>No logs available</span>
                  )}
                </div>
              </div>
            )}

            {detailTab === 'schedules' && (
              <div>
                <div className="header-wrapper">
                  <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Power Schedules</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Schedule automatic power actions for this server</p></div>
                  <button onClick={() => { setScheduleAction('start'); setScheduleTime(''); setScheduleRecurring(false); setScheduleCron('0 0 * * *'); setShowScheduleDialog(true) }} className="btn btn-primary"><Plus size={14} /><span>New Schedule</span></button>
                </div>
                {schedules.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No schedules configured yet.</div>
                ) : (
                  <div className="card" style={{ padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Action</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Scheduled</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Recurring</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Active</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}></th>
                      </tr></thead>
                      <tbody>
                        {schedules.map(s => (
                          <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '12px 14px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: '4px', background: s.action === 'start' ? 'rgba(16,185,129,0.1)' : s.action === 'stop' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', color: s.action === 'start' ? 'var(--color-success)' : s.action === 'stop' ? 'var(--color-danger)' : 'var(--color-warning)', fontSize: '0.8rem', fontWeight: 600 }}>{s.action.toUpperCase()}</span>
                            </td>
                            <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{new Date(s.scheduled_time).toLocaleString()}</td>
                            <td style={{ padding: '12px 14px' }}>{s.recurring ? 'Yes' : 'No'}</td>
                            <td style={{ padding: '12px 14px' }}><span style={{ color: s.is_active ? 'var(--color-success)' : 'var(--text-muted)' }}>{s.is_active ? 'Active' : 'Paused'}</span></td>
                            <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button onClick={() => toggleSchedule(s.id, s.is_active)} className="btn btn-outline" style={{ padding: '4px 8px', marginRight: '8px' }} title={s.is_active ? 'Pause schedule' : 'Activate schedule'}>{s.is_active ? <PauseCircle size={14} /> : <Play size={14} />}</button>
                              <button onClick={() => deleteSchedule(s.id)} className="btn btn-danger" style={{ padding: '4px 8px' }}><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {detailTab === 'stats' && (
              <div>
                <div className="header-wrapper">
                  <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Live Resource Usage</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Auto-refreshing every 3 seconds</p></div>
                  <button onClick={() => fetchLiveStats(selectedServer.id)} className="btn btn-outline"><RefreshCw size={14} /><span>Refresh Now</span></button>
                </div>
                <div className="card-grid">
                  <div className="card" style={{ textAlign: 'center' }}>
                    <Cpu size={22} style={{ color: 'var(--color-primary)', margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-primary)' }}>{Math.round((liveStats?.cpu_percentage || 0) * 100) / 100}%</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>CPU Usage</p>
                    <div style={{ height: '8px', borderRadius: '4px', background: 'var(--border-color)', overflow: 'hidden', marginTop: '12px' }}>
                      <div style={{ width: `${Math.min(100, liveStats?.cpu_percentage || 0)}%`, height: '100%', background: 'var(--color-primary)' }}></div>
                    </div>
                  </div>
                  <div className="card" style={{ textAlign: 'center' }}>
                    <HardDrive size={22} style={{ color: 'var(--color-secondary)', margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-secondary)' }}>{Math.round(liveStats?.memory_mb || 0)}<span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}> / {liveStats?.memory_limit_mb || selectedServer.memory_limit} MB</span></p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Memory</p>
                    <div style={{ height: '8px', borderRadius: '4px', background: 'var(--border-color)', overflow: 'hidden', marginTop: '12px' }}>
                      <div style={{ width: `${Math.min(100, ((liveStats?.memory_mb || 0) / (liveStats?.memory_limit_mb || selectedServer.memory_limit || 1)) * 100)}%`, height: '100%', background: 'var(--color-secondary)' }}></div>
                    </div>
                  </div>
                  <div className="card" style={{ textAlign: 'center' }}>
                    <Layers size={22} style={{ color: '#fbbf24', margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: '2rem', fontWeight: 700, color: '#fbbf24' }}>{Math.round(liveStats?.disk_mb || 0)}<span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}> / {selectedServer.disk_limit} MB</span></p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Disk</p>
                    <div style={{ height: '8px', borderRadius: '4px', background: 'var(--border-color)', overflow: 'hidden', marginTop: '12px' }}>
                      <div style={{ width: `${Math.min(100, ((liveStats?.disk_mb || 0) / (selectedServer.disk_limit || 1)) * 100)}%`, height: '100%', background: '#fbbf24' }}></div>
                    </div>
                  </div>
                  <div className="card" style={{ textAlign: 'center' }}>
                    <Power size={22} style={{ color: (liveStats?.status || 'offline') === 'running' ? 'var(--color-success)' : 'var(--color-danger)', margin: '0 auto 8px', display: 'block' }} />
                    <p style={{ fontSize: '1.6rem', fontWeight: 700, color: (liveStats?.status || 'offline') === 'running' ? 'var(--color-success)' : 'var(--color-danger)', textTransform: 'capitalize' }}>{liveStats?.status || 'offline'}</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Container Status</p>
                  </div>
                </div>
                {liveStats && (
                  <div className="card" style={{ marginTop: '24px' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px' }}>Raw Stats</h3>
                    <pre style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontFamily: 'var(--font-mono)' }}>{JSON.stringify(liveStats, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}

            {detailTab === 'backups' && (
              <div>
                <div className="header-wrapper">
                  <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Backups</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Snapshot and restore server files</p></div>
                  {(user.root_admin || selectedServer.owner_id === user.id) && <button onClick={createBackup} className="btn btn-primary" disabled={creatingBackup}><HardDrive size={14} /><span>{creatingBackup ? 'Creating...' : 'Create Backup'}</span></button>}
                </div>
                {backupsLoading ? (
                  <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading backups...</div>
                ) : backups.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No backups yet. Create one to snapshot the server files.</div>
                ) : (
                  <div className="card" style={{ padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Name</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Size</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Created</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}></th>
                      </tr></thead>
                      <tbody>
                        {backups.map((b: any) => (
                          <tr key={b.id || b.name} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '12px 14px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{b.name || b.id}</td>
                            <td style={{ padding: '12px 14px' }}>{b.size ? `${(b.size / 1048576).toFixed(1)} MB` : '—'}</td>
                            <td style={{ padding: '12px 14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{b.created_at ? new Date(b.created_at).toLocaleString() : '—'}</td>
                            <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {(user.root_admin || selectedServer.owner_id === user.id) && <>
                                <button onClick={() => restoreBackup(b.id)} className="btn btn-outline" style={{ padding: '4px 10px', marginRight: '8px' }}><RotateCcw size={14} /><span>Restore</span></button>
                                <button onClick={() => deleteBackup(b.id)} className="btn btn-danger" style={{ padding: '4px 8px' }}><Trash2 size={14} /></button>
                              </>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {detailTab === 'members' && (
              <div>
                <div className="header-wrapper">
                  <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Members</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Users with access to this server</p></div>
                </div>
                {(user.root_admin || selectedServer.owner_id === user.id) ? (
                <div className="card" style={{ marginBottom: '24px', display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '220px' }}>
                    <label className="form-label">Username or Email</label>
                    <input className="form-control" value={shareUsername} onChange={e => setShareUsername(e.target.value)} placeholder="Share with user..." />
                  </div>
                  <button onClick={addMember} className="btn btn-primary"><Plus size={14} /><span>Add Member</span></button>
                </div>
                ) : (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>Only the owner can manage members.</p>
                )}
                {members.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No members. Only the owner has access.</div>
                ) : (
                  <div className="card" style={{ padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>User</th>
                        <th style={{ padding: '12px 14px', textAlign: 'left' }}>Permissions</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}></th>
                      </tr></thead>
                      <tbody>
                        {members.map((m: any) => (
                          <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                            <td style={{ padding: '12px 14px' }}><strong>{m.username}</strong> <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({m.email})</span></td>
                            <td style={{ padding: '12px 14px' }}>
                              {(user.root_admin || selectedServer.owner_id === user.id) && (
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {(['console', 'power', 'files', 'schedules', 'logs'] as const).map(p => {
                                  const has = (m.permissions || '').split(',').map((x: string) => x.trim()).includes(p)
                                  return (
                                    <button key={p} onClick={() => updateMemberPerms(m, (m.permissions || '').split(',').map((x: string) => x.trim()).filter((x: string) => x !== p).concat(has ? [] : [p]))} style={{ padding: '3px 10px', borderRadius: '4px', fontSize: '0.75rem', border: has ? '1px solid var(--color-primary)' : '1px solid var(--border-color)', background: has ? 'rgba(56,189,248,0.1)' : 'transparent', color: has ? 'var(--color-primary)' : 'var(--text-muted)', cursor: 'pointer' }}>{p}</button>
                                  )
                                })}
                              </div>
                              )}
                            </td>
                            <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                              {(user.root_admin || selectedServer.owner_id === user.id) && <button onClick={() => removeMember(m)} className="btn btn-danger" style={{ padding: '4px 8px' }}><Trash2 size={14} /></button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {detailTab === 'activity' && (
              <div>
                <div className="header-wrapper">
                  <div><h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Server Activity</h3><p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Recent actions on this server</p></div>
                  <button onClick={() => fetchServerActivity(selectedServer.id)} className="btn btn-outline"><RefreshCw size={14} /><span>Refresh</span></button>
                </div>
                <div className="card" style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 14px', textAlign: 'left' }}>Time</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left' }}>User</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left' }}>Action</th>
                      <th style={{ padding: '12px 14px', textAlign: 'left' }}>Detail</th>
                    </tr></thead>
                    <tbody>
                      {serverActivity.map(e => (
                        <tr key={e.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{e.created_at ? new Date(e.created_at).toLocaleString() : '—'}</td>
                          <td style={{ padding: '12px 14px' }}>{e.username || e.user_id}</td>
                          <td style={{ padding: '12px 14px' }}><span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(56,189,248,0.1)', color: 'var(--color-primary)', fontSize: '0.8rem' }}>{e.action}</span></td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{e.detail || '—'}</td>
                        </tr>
                      ))}
                      {serverActivity.length === 0 && <tr><td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No activity for this server yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {detailTab === 'files' && (
              <div>
                {editingFile ? (
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                      <span style={{ color: 'var(--color-primary)', fontSize: '0.9rem' }}>Editing: {editingFile.path}</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setEditingFile(null)} className="btn btn-outline">Close</button>
                        <button onClick={saveFileContent} className="btn btn-primary"><Save size={14} /> Save</button>
                      </div>
                    </div>
                    <textarea className="form-control" rows={18} value={editingFile.content} onChange={e => setEditingFile({ ...editingFile, content: e.target.value })} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', whiteSpace: 'pre' }} />
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem' }}>
                        <span onClick={() => { setCurrentPath(''); fetchFiles(selectedServer.id, '') }} style={{ cursor: 'pointer', color: 'var(--color-primary)' }}>root</span>
                        {currentPath.split('/').filter(Boolean).map((part, i, arr) => (
                          <React.Fragment key={i}>
                            <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                            <span onClick={() => { const t = arr.slice(0, i + 1).join('/'); setCurrentPath(t); fetchFiles(selectedServer.id, t) }} style={{ cursor: 'pointer', color: 'var(--color-primary)' }}>{part}</span>
                          </React.Fragment>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
                        <button onClick={() => fileInputRef.current?.click()} className="btn btn-outline" disabled={uploading} style={{ padding: '8px 12px' }}><Upload size={16} /><span>{uploading ? 'Uploading...' : 'Upload'}</span></button>
                        {isCreatingFolder ? (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input className="form-control" placeholder="Folder name" value={newPathName} onChange={e => setNewPathName(e.target.value)} style={{ padding: '6px 10px', width: '160px' }} />
                            <button onClick={createFolder} className="btn btn-primary" style={{ padding: '6px 12px' }}>Create</button>
                            <button onClick={() => setIsCreatingFolder(false)} className="btn btn-outline" style={{ padding: '6px 12px' }}><X size={14} /></button>
                          </div>
                        ) : <button onClick={() => setIsCreatingFolder(true)} className="btn btn-outline" style={{ padding: '8px 12px' }}><Plus size={16} /><span>Folder</span></button>}
                        <button onClick={navigateUp} className="btn btn-outline" disabled={!currentPath} style={{ padding: '8px 12px' }}>Up</button>
                      </div>
                    </div>
                    <div className="file-list">
                      {fileError && <div style={{ padding: '12px 14px', marginBottom: '8px', borderRadius: '6px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'var(--color-danger)', fontSize: '0.85rem' }}>{fileError}</div>}
                      {renameTarget && (
                        <div style={{ display: 'flex', gap: '8px', padding: '8px 12px', alignItems: 'center', borderBottom: '1px solid var(--border-color)' }}>
                          <Pencil size={14} style={{ color: 'var(--color-primary)' }} />
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currentPath ? `${currentPath}/` : ''}</span>
                          <input className="form-control" autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') renameFile() }} placeholder={renameTarget.name} style={{ padding: '4px 8px', width: '220px' }} />
                          <button onClick={renameFile} className="btn btn-primary" style={{ padding: '4px 10px' }}>Rename</button>
                          <button onClick={() => setRenameTarget(null)} className="btn btn-outline" style={{ padding: '4px 10px' }}><X size={14} /></button>
                        </div>
                      )}
                      {files.map(f => (
                        <div key={f.name} className="file-row">
                          <div className="file-name" onClick={() => handleFileClick(f)}>
                            {f.is_directory ? <Folder size={18} style={{ color: 'var(--color-secondary)' }} /> : <FileText size={18} style={{ color: 'var(--text-muted)' }} />}
                            <span>{f.name}</span>
                          </div>
                          <div className="file-meta">{!f.is_directory && `${(f.size / 1024).toFixed(1)} KB`}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '16px' }}>
                            {!f.is_directory && <button onClick={() => downloadFile(f)} title="Download" style={{ color: 'var(--text-muted)', opacity: 0.6 }}><Download size={16} /></button>}
                            <button onClick={() => { setRenameTarget(f); setRenameValue(f.name) }} title="Rename" style={{ color: 'var(--text-muted)', opacity: 0.6 }}><Pencil size={16} /></button>
                            <button onClick={() => deleteFile(f)} title="Delete" style={{ color: 'var(--color-danger)', opacity: 0.6 }}><Trash2 size={16} /></button>
                          </div>
                        </div>
                      ))}
                      {files.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Empty directory</div>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>)}
        </div>
        <footer className="app-footer">
          <Layers size={14} style={{ color: 'var(--color-primary)', opacity: 0.8 }} />
          <span>Wings Panel × Pterodactyl Panel &copy; 2026</span>
          <span className="footer-dot">·</span>
          <span>Self-hosted Game Server Management Platform</span>
        </footer>
      </main>
      {popup.open && (
        <div className="popup-overlay" onClick={() => setPopup({ ...popup, open: false })}>
          <div className="popup-box" onClick={e => e.stopPropagation()}>
            <div className={`popup-icon popup-icon-${popup.type}`}>
              {popup.type === 'success' && <CheckCircle size={28} />}
              {popup.type === 'error' && <AlertTriangle size={28} />}
              {popup.type === 'info' && <Info size={28} />}
              {popup.type === 'confirm' && <AlertTriangle size={28} />}
            </div>
            <h3 className="popup-title">{popup.title}</h3>
            <p className="popup-message">{popup.message}</p>
            {popup.type === 'error' && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>Report bugs to: wingspanelsupport@gmail.com</p>}
            <div className="popup-actions">
              {popup.type === 'confirm' && (<>
                <button className="btn btn-outline" onClick={() => setPopup({ ...popup, open: false })}>Cancel</button>
                <button className="btn btn-danger" onClick={() => { popup.onConfirm?.(); setPopup({ ...popup, open: false }) }}>Confirm</button>
              </>)}
              {popup.type !== 'confirm' && (<button className="btn btn-primary" onClick={() => setPopup({ ...popup, open: false })}>OK</button>)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
