'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Server as ServerIcon, Cpu, HardDrive, Terminal as TerminalIcon, Folder,
  Layers, PlusCircle, RotateCw, Power, Trash2, FileText, ChevronRight,
  Plus, RefreshCw, Play, Square, Skull, LogOut, User, Shield,
  Network, Settings, Save, X, CheckCircle, AlertTriangle, Info,
  Activity, Key, Copy,
  RotateCcw, PauseCircle, ArrowRight, Bug, Coffee, Users
} from 'lucide-react'


const API_BASE = process.env.NEXT_PUBLIC_PANEL_URL || 'http://localhost:8000'

interface Server {
  id: number; uuid: string; name: string; description?: string; owner_id: number;
  node_id: number; primary_allocation_id: number; cpu_limit: number; memory_limit: number;
  disk_limit: number; docker_image: string; startup_command: string; status: string;
  installed: boolean; allocations?: any[]
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

  const [activeTab, setActiveTab] = useState<'servers' | 'nodes' | 'allocations' | 'create-server' | 'system' | 'activity' | 'api-keys' | 'users' | 'settings'>('servers')
  const [nodes, setNodes] = useState<Node[]>([])
  const [servers, setServers] = useState<Server[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [selectedServer, setSelectedServer] = useState<Server | null>(null)
  const [detailTab, setDetailTab] = useState<'console' | 'files'>('console')

  const [stats, setStats] = useState({ cpu: 0, memory: 0, disk: 0, status: 'offline' })

  const [consoleUrl, setConsoleUrl] = useState('')
  const [consoleLoading, setConsoleLoading] = useState(false)
  const [consoleError, setConsoleError] = useState('')

  const [currentPath, setCurrentPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null)
  const [newPathName, setNewPathName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)

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
  const [dockerNetworks, setDockerNetworks] = useState<{ name: string; id: string; driver: string; scope: string }[]>([])
  const [formUseDockerfile, setFormUseDockerfile] = useState(false)
  const [formDockerfile, setFormDockerfile] = useState('')
  const [formImageName, setFormImageName] = useState('')
  const [isBuildingImage, setIsBuildingImage] = useState(false)

  const GAME_PRESETS: { id: string; label: string; image: string; startup: string; memory: number; disk: number; icon: string; allocPort: number }[] = [
    { id: 'mc-java', label: 'Minecraft: Java Edition', image: 'itzg/minecraft-server', startup: 'java -Xmx$MEMORY -jar server.jar nogui', memory: 2048, disk: 10240, icon: '⛏', allocPort: 25565 },
    { id: 'mc-bedrock', label: 'Minecraft: Bedrock Edition', image: 'itzg/minecraft-bedrock-server', startup: '', memory: 2048, disk: 10240, icon: '⛏', allocPort: 25535 },
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

  const [settingsTab, setSettingsTab] = useState<'profile' | 'security'>('profile')
  const [settingsEmail, setSettingsEmail] = useState('')
  const [settingsNewPass, setSettingsNewPass] = useState('')
  const [settingsConfirmPass, setSettingsConfirmPass] = useState('')
  const [selectedServerIds, setSelectedServerIds] = useState<number[]>([])
  const [bulkAction, setBulkAction] = useState('')

  const authHeaders = useCallback((): Record<string, string> => token ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' } : {}, [token])

  const apiFetch = useCallback(async (path: string, opts: RequestInit = {}) => {
    const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { ...authHeaders(), ...opts.headers } })
    return res
  }, [authHeaders])

  useEffect(() => {
    const saved = localStorage.getItem('panel_token')
    if (saved) { setToken(saved); verifyToken(saved) }
  }, [])

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
      if (nRes.ok) setNodes(await nRes.json())
      const sRes = await apiFetch('/api/servers')
      if (sRes.ok) setServers(await sRes.json())
      const aRes = await apiFetch('/api/allocations')
      if (aRes.ok) setAllocations(await aRes.json())
      try { const sysRes = await apiFetch('/api/system/status'); if (sysRes.ok) setSystemStatus(await sysRes.json()) } catch {}
      try { const sumRes = await apiFetch('/api/system/nodes-summary'); if (sumRes.ok) setNodeSummaries(await sumRes.json()) } catch {}
      try { const netRes = await apiFetch('/api/system/docker-networks'); if (netRes.ok) setDockerNetworks(await netRes.json()) } catch {}
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (!selectedServer) { cleanupConsole(); return }
    setEditingFile(null); setCurrentPath('')
    fetchFiles(selectedServer.id, ''); fetchStats(selectedServer.id)
    cleanupConsole()
    return () => { cleanupConsole() }
  }, [selectedServer])

  const cleanupConsole = () => {
    setConsoleUrl('')
    setConsoleError('')
  }

  useEffect(() => {
    if (!selectedServer) return
    const id = setInterval(() => { fetchStats(selectedServer.id) }, 3000)
    return () => clearInterval(id)
  }, [selectedServer])

  const startConsole = async (serverId: number) => {
    setConsoleLoading(true)
    setConsoleError('')
    try {
      const startRes = await apiFetch(`/api/servers/${serverId}/console/start`, { method: 'POST' })
      if (!startRes.ok) {
        const err = await startRes.json()
        setConsoleError(err.detail || 'Failed to start console')
        setConsoleLoading(false)
        return
      }
      const urlRes = await apiFetch(`/api/servers/${serverId}/console/url`)
      if (urlRes.ok) {
        const data = await urlRes.json()
        setConsoleUrl(data.url)
      } else {
        setConsoleError('Failed to get console URL')
      }
    } catch {
      setConsoleError('Cannot reach daemon')
    }
    setConsoleLoading(false)
  }

  const stopConsole = async (serverId: number) => {
    try { await apiFetch(`/api/servers/${serverId}/console/stop`, { method: 'DELETE' }) } catch {}
    setConsoleUrl('')
  }

  const disconnectConsole = () => { cleanupConsole() }

  const fetchStats = async (serverId: number) => {
    try { const res = await apiFetch(`/api/servers/${serverId}/stats`); if (res.ok) { const d = await res.json(); setStats({ cpu: d.cpu_percentage || 0, memory: d.memory_mb || 0, disk: d.disk_mb || 0, status: d.status || 'offline' }) } } catch {}
  }

  const fetchFiles = async (serverId: number, path: string) => {
    try { const res = await apiFetch(`/api/servers/${serverId}/files/list?path=${encodeURIComponent(path)}`); if (res.ok) setFiles(await res.json()) } catch {}
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
    else { try { const res = await apiFetch(`/api/servers/${selectedServer.id}/files/read?path=${encodeURIComponent(fp)}`); if (res.ok) { const d = await res.json(); setEditingFile({ path: fp, content: d.content }) } } catch {} }
  }

  const saveFileContent = async () => {
    if (!selectedServer || !editingFile) return
    try { const res = await apiFetch(`/api/servers/${selectedServer.id}/files/write`, { method: 'POST', body: JSON.stringify({ path: editingFile.path, content: editingFile.content }) }); if (res.ok) { setEditingFile(null); showPopup('success', 'Saved', 'File saved successfully.'); refreshFiles() } } catch {}
  }

  const createFolder = async () => {
    if (!selectedServer || !newPathName) return
    const fp = currentPath ? `${currentPath}/${newPathName}` : newPathName
    try { const res = await apiFetch(`/api/servers/${selectedServer.id}/files/folder`, { method: 'POST', body: JSON.stringify({ path: fp }) }); if (res.ok) { setNewPathName(''); setIsCreatingFolder(false); refreshFiles() } } catch {}
  }

  const deleteFile = async (file: FileEntry) => {
    if (!selectedServer) return
    const fp = currentPath ? `${currentPath}/${file.name}` : file.name
    showPopup('confirm', 'Delete File', `Delete "${file.name}"?`, async () => {
      try { const res = await apiFetch(`/api/servers/${selectedServer.id}/files/delete?path=${encodeURIComponent(fp)}`, { method: 'DELETE' }); if (res.ok) refreshFiles() } catch {}
    })
  }

  const navigateUp = () => {
    if (!currentPath) return
    const parts = currentPath.split('/'); parts.pop()
    const pp = parts.join('/'); setCurrentPath(pp)
    if (selectedServer) fetchFiles(selectedServer.id, pp)
  }

  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formNodeId) { showPopup('error', 'Missing Info', 'Select a node'); return }
    if (!formImage || !formImage.trim()) { showPopup('error', 'Missing Info', 'Docker image is required'); return }
    try {
      const body: any = { name: formName, description: formDesc, node_id: formNodeId, primary_allocation_id: formAllocId || 0, cpu_limit: formCpu, memory_limit: formMemory, disk_limit: formDisk, docker_image: formImage, docker_network: formNetwork, startup_command: formUseDockerfile ? '' : formStartup }
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
    try { const res = await apiFetch('/api/keys'); if (res.ok) setApiKeys(await res.json()) } catch {}
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
    try { const res = await apiFetch('/api/users'); if (res.ok) setPanelUsers(await res.json()) } catch {}
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
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)' }}>
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
          {authPage === 'login' && <p style={{ textAlign: 'center', marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>Default: admin / admin12345</p>}
        </div>
        <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>Wings Panel × Pterodactyl Panel &copy; 2026</p>
      </div>
    )
  }

  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <div className="logo"><Layers size={24} /><span>WINGS PANEL</span></div>
        <nav className="nav-links">
          <button onClick={() => { setActiveTab('servers'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'servers' && !selectedServer ? 'active' : ''}`}><ServerIcon size={18} /><span>Servers</span></button>
          {user.root_admin && <button onClick={() => { setActiveTab('nodes'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'nodes' ? 'active' : ''}`}><Network size={18} /><span>Nodes</span></button>}
          {user.root_admin && <button onClick={() => { setActiveTab('allocations'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'allocations' ? 'active' : ''}`}><Settings size={18} /><span>Allocations</span></button>}
          {user.root_admin && <button onClick={() => { setActiveTab('system'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'system' ? 'active' : ''}`}><Cpu size={18} /><span>System</span></button>}
          <button onClick={() => { setActiveTab('activity'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'activity' ? 'active' : ''}`}><Activity size={18} /><span>Activity</span></button>
          <button onClick={() => { setActiveTab('api-keys'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'api-keys' ? 'active' : ''}`}><Key size={18} /><span>API Keys</span></button>
          {user.root_admin && <button onClick={() => { setActiveTab('users'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'users' ? 'active' : ''}`}><Users size={18} /><span>Users</span></button>}
          <button onClick={() => { setActiveTab('create-server'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'create-server' ? 'active' : ''}`}><PlusCircle size={18} /><span>Deploy</span></button>
          <button onClick={() => { setActiveTab('settings'); setSelectedServer(null) }} className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}><User size={18} /><span>Settings</span></button>
        </nav>
        <div style={{ marginTop: 'auto' }}>
          <div style={{ padding: '12px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.8rem', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={14} style={{ color: 'var(--color-primary)' }} />
              <span>{user.username}</span>
              {user.root_admin && <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'rgba(168,85,247,0.15)', color: 'var(--color-secondary)', borderRadius: '4px' }}>ADMIN</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={logout} className="nav-link" style={{ flex: 1, justifyContent: 'center', fontSize: '0.75rem' }}><LogOut size={14} /><span>Sign Out</span></button>
            <button onClick={() => window.open('mailto:wingspanelsupport@gmail.com?subject=Bug Report&body=Describe the bug here...', '_blank')} className="nav-link" style={{ flex: 1, justifyContent: 'center', fontSize: '0.75rem' }} title="Report Bug"><Bug size={14} /><span>Report</span></button>
            <button onClick={() => window.open('https://ko-fi.com/wingspanel', '_blank')} className="nav-link" style={{ flex: 1, justifyContent: 'center', fontSize: '0.75rem' }} title="Support on Ko-Fi"><Coffee size={14} /><span>Donate</span></button>
          </div>
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)', fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Wings Panel × Pterodactyl Panel &copy; 2026
          </div>
        </div>
      </aside>
      <main className="main-content">
        {!selectedServer ? (<>
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
                          <div><h3 style={{ fontSize: '1rem', fontWeight: 600 }}>{s.name}</h3><p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.uuid.substring(0, 8)}...</p></div>
                        </div>
                        <span className={`status-pill ${s.status}`}><span className="status-glow"></span>{s.status}</span>
                      </div>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '20px', minHeight: '40px' }}>{s.description || 'No description'}</p>
                      <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '16px', marginBottom: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Cpu size={14} /><span>{s.cpu_limit}%</span></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><HardDrive size={14} /><span>{s.memory_limit} MB</span></div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setSelectedServer(s)} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Manage</button>
                        {user.root_admin && <button onClick={() => deleteServer(s)} className="btn btn-danger" style={{ padding: '8px 12px' }}><Trash2 size={14} /></button>}
                      </div>
                    </div>
                  ))}
                  {servers.length === 0 && <div className="card" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>No servers yet. Deploy one!</div>}
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
                    <thead><tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}><th style={{ padding: '16px' }}>Name</th><th style={{ padding: '16px' }}>Address</th><th style={{ padding: '16px' }}>Port</th><th style={{ padding: '16px' }}>Status</th></tr></thead>
                    <tbody>
                      {nodes.map(n => (
                        <tr key={n.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '16px', fontWeight: 600 }}>{n.name}</td>
                          <td style={{ padding: '16px' }}>{n.fqdn} ({n.ip_address})</td>
                          <td style={{ padding: '16px' }}>{n.daemon_port}</td>
                          <td style={{ padding: '16px' }}><span className="status-pill running"><span className="status-glow"></span>{n.is_active ? 'Active' : 'Inactive'}</span></td>
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
                        <div key={p.id} onClick={() => { setFormPreset(p.id); if (p.id !== 'custom') { setFormImage(p.image); const memStr = `${Math.floor(p.memory / 1024)}G`; setFormStartup(p.startup.replace('$MEMORY', memStr)); setFormMemory(p.memory); setFormDisk(p.disk); setFormStartupAuto(true) } else { setFormImage(''); setFormStartup(''); setFormStartupAuto(false) } if (!formName || GAME_PRESETS.some(gp => gp.label === formName)) { setFormName(p.id === 'custom' ? '' : p.label) } }} style={{ padding: '16px', borderRadius: '10px', cursor: 'pointer', border: formPreset === p.id ? '2px solid var(--color-primary)' : '1px solid var(--border-color)', background: formPreset === p.id ? 'rgba(56,189,248,0.08)' : 'rgba(255,255,255,0.02)', transition: 'all 0.15s ease', textAlign: 'center' }}>
                          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>{p.icon}</div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)' }}>{p.label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                      <button type="button" onClick={() => setFormUseDockerfile(false)} className={`btn ${!formUseDockerfile ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1, justifyContent: 'center' }}>Pull Image</button>
                      <button type="button" onClick={() => { setFormUseDockerfile(true); if (!formDockerfile) setFormDockerfile('FROM ubuntu:22.04\n\nRUN apt-get update && apt-get install -y curl wget\n\nWORKDIR /home/container\nCOPY . /home/container\n\nEXPOSE 25565\nCMD ["/bin/bash"]') }} className={`btn ${formUseDockerfile ? 'btn-primary' : 'btn-outline'}`} style={{ flex: 1, justifyContent: 'center' }}>Build from Dockerfile</button>
                    </div>
                    {!formUseDockerfile ? (
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label className="form-label">Docker Image</label>
                        <input className="form-control" value={formImage} onChange={e => { setFormImage(e.target.value); setFormPreset('') }} placeholder="e.g. itzg/minecraft-server" required />
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px' }}>Enter any public Docker Hub or registry image</p>
                      </div>
                    ) : (<>
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
            {activeTab === 'settings' && (
              <div style={{ maxWidth: '600px' }}>
                <div className="header-wrapper">
                  <div><h1 className="header-title">Settings</h1><p className="header-desc">Manage your account</p></div>
                </div>
                <div className="tabs-container" style={{ marginBottom: '24px' }}>
                  <button onClick={() => setSettingsTab('profile')} className={`tab-btn ${settingsTab === 'profile' ? 'active' : ''}`}><User size={16} /> Profile</button>
                  <button onClick={() => setSettingsTab('security')} className={`tab-btn ${settingsTab === 'security' ? 'active' : ''}`}><Shield size={16} /> Security</button>
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
                <button onClick={() => reinstallServer(selectedServer)} className="btn btn-outline" style={{ color: 'var(--color-warning)', borderColor: 'rgba(245,158,11,0.2)' }}><RotateCcw size={16} /><span>Reinstall</span></button>
                {user.root_admin && <button onClick={() => transferServer(selectedServer)} className="btn btn-outline"><ArrowRight size={16} /><span>Transfer</span></button>}
                {user.root_admin && <button onClick={() => suspendServer(selectedServer, selectedServer.status !== 'suspended')} className="btn btn-outline" style={{ color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.2)' }}><PauseCircle size={16} /><span>{selectedServer.status === 'suspended' ? 'Unsuspend' : 'Suspend'}</span></button>}
              </div>
              <div style={{ height: '24px', borderRight: '1px solid var(--border-color)', margin: '0 8px' }}></div>
              <div style={{ display: 'flex', gap: '24px' }}>
                <div><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CPU</span><p style={{ fontWeight: 600 }}>{stats.cpu}%</p></div>
                <div><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>MEMORY</span><p style={{ fontWeight: 600 }}>{stats.memory} / {selectedServer.memory_limit} MB</p></div>
                <div><span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>DISK</span><p style={{ fontWeight: 600 }}>{stats.disk} / {selectedServer.disk_limit} MB</p></div>
              </div>
            </div>
            <div className="tabs-container">
              <button onClick={() => setDetailTab('console')} className={`tab-btn ${detailTab === 'console' ? 'active' : ''}`}><TerminalIcon size={16} /> Console</button>
              <button onClick={() => setDetailTab('files')} className={`tab-btn ${detailTab === 'files' ? 'active' : ''}`}><Folder size={16} /> Files</button>
            </div>

            {detailTab === 'console' && (
              <div className="terminal-window">
                <div className="terminal-header">
                  <div className="terminal-dots"><span className="terminal-dot" style={{ backgroundColor: '#ef4444' }}></span><span className="terminal-dot" style={{ backgroundColor: '#f59e0b' }}></span><span className="terminal-dot" style={{ backgroundColor: '#10b981' }}></span></div>
                  <span>wings@{selectedServer.uuid.substring(0, 8)}</span>
                </div>
                {consoleUrl ? (
                  <>
                    <iframe src={consoleUrl} style={{ width: '100%', height: '600px', border: 'none', background: '#000' }} />
                    <div style={{ padding: '8px 12px', borderTop: '1px solid #30363d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Connected to {selectedServer.name}</span>
                      <button onClick={() => stopConsole(selectedServer.id)} className="btn btn-outline" style={{ padding: '4px 12px', fontSize: '0.8rem' }}><LogOut size={14} /> Disconnect</button>
                    </div>
                  </>
                ) : (
                  <div style={{ height: '500px', background: '#0d1117', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', padding: '24px' }}>
                    <Shield size={40} style={{ color: 'var(--color-primary)', marginBottom: '4px' }} />
                    <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1rem' }}>Open Server Console</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', maxWidth: '400px' }}>
                      Click below to open an interactive shell session to the container via ttyd.
                    </p>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', marginBottom: '4px' }}>
                      Server: {selectedServer.name} ({selectedServer.uuid.substring(0, 8)})
                    </div>
                    {consoleError && <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', margin: 0 }}>{consoleError}</p>}
                    <button
                      onClick={() => startConsole(selectedServer.id)}
                      className="btn btn-primary"
                      disabled={consoleLoading}
                      style={{ padding: '10px 32px', fontSize: '0.9rem', opacity: consoleLoading ? 0.5 : 1 }}
                    >
                      {consoleLoading ? 'Starting...' : <><TerminalIcon size={16} /> Open Console</>}
                    </button>
                  </div>
                )}
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
                      <div style={{ display: 'flex', gap: '12px' }}>
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
                      {files.map(f => (
                        <div key={f.name} className="file-row">
                          <div className="file-name" onClick={() => handleFileClick(f)}>
                            {f.is_directory ? <Folder size={18} style={{ color: 'var(--color-secondary)' }} /> : <FileText size={18} style={{ color: 'var(--text-muted)' }} />}
                            <span>{f.name}</span>
                          </div>
                          <div className="file-meta">{!f.is_directory && `${(f.size / 1024).toFixed(1)} KB`}</div>
                          <button onClick={() => deleteFile(f)} style={{ color: 'var(--color-danger)', opacity: 0.6, marginLeft: '24px' }}><Trash2 size={16} /></button>
                        </div>
                      ))}
                      {files.length === 0 && <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>Empty directory</div>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>)}
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
