package main

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"
	"github.com/gorilla/websocket"
)

// Config holds the daemon options loaded from environment variables
var (
	DaemonToken    = getEnv("DAEMON_TOKEN", "secure_default_wings_api_key_123456")
	ServersDir     = getEnv("SERVERS_DIR", getDefaultServersDir())
	DockerURL      = getEnv("DOCKER_URL", getDefaultDockerURL())
	HostServersDir = getEnv("HOST_SERVERS_DIR", ServersDir)
	DockerNetwork  = getEnv("DOCKER_NETWORK", "pterodactyl-net")
	ServerVolume   = getEnv("SERVER_VOLUME", "")
	startTime      = time.Now()
)

// ttyd process management
type TtydInstance struct {
	Port    int
	Process *os.Process
	Cmd     *exec.Cmd
}

var (
	ttydInstances = make(map[string]*TtydInstance)
	ttydMutex     sync.Mutex
	ttydBasePort  = 7681
	ttydMaxPort   = 7781
	ttydNextPort  = 7681
)

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

// findAvailablePort finds the next available ttyd port
func findAvailablePort() int {
	ttydMutex.Lock()
	defer ttydMutex.Unlock()

	startPort := ttydNextPort
	for {
		port := ttydNextPort
		ttydNextPort++
		if ttydNextPort > ttydMaxPort {
			ttydNextPort = ttydBasePort
		}
		if ttydNextPort == startPort {
			return 0 // no ports available
		}

		// Check if port is in use by any ttyd instance
		inUse := false
		for _, inst := range ttydInstances {
			if inst.Port == port {
				inUse = true
				break
			}
		}
		if !inUse {
			return port
		}
	}
}

// startTtyd starts a ttyd process for the given server container
func startTtyd(uuid string) (int, error) {
	ttydMutex.Lock()
	if inst, exists := ttydInstances[uuid]; exists {
		ttydMutex.Unlock()
		return inst.Port, nil
	}
	ttydMutex.Unlock()

	port := findAvailablePort()
	if port == 0 {
		return 0, fmt.Errorf("no available ttyd ports")
	}

	containerName := "wings-" + uuid
	cmd := exec.Command("ttyd",
		"--port", fmt.Sprintf("%d", port),
		"--writable",
		"--base", fmt.Sprintf("/%s", uuid),
		"docker", "exec", "-it", containerName, "/bin/sh", "-l",
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("failed to start ttyd: %v", err)
	}

	ttydMutex.Lock()
	ttydInstances[uuid] = &TtydInstance{
		Port:    port,
		Process: cmd.Process,
		Cmd:     cmd,
	}
	ttydMutex.Unlock()

	log.Printf("[%s] ttyd started on port %d (PID: %d)", uuid, port, cmd.Process.Pid)

	// Wait for process in background to clean up
	go func() {
		cmd.Wait()
		ttydMutex.Lock()
		delete(ttydInstances, uuid)
		ttydMutex.Unlock()
		log.Printf("[%s] ttyd process exited", uuid)
	}()

	return port, nil
}

// stopTtyd stops the ttyd process for the given server
func stopTtyd(uuid string) {
	ttydMutex.Lock()
	inst, exists := ttydInstances[uuid]
	if exists {
		delete(ttydInstances, uuid)
	}
	ttydMutex.Unlock()

	if exists && inst.Process != nil {
		inst.Process.Kill()
		log.Printf("[%s] ttyd stopped (port %d)", uuid, inst.Port)
	}
}

// getTtydPort returns the ttyd port for a server, or 0 if not running
func getTtydPort(uuid string) int {
	ttydMutex.Lock()
	defer ttydMutex.Unlock()
	if inst, exists := ttydInstances[uuid]; exists {
		return inst.Port
	}
	return 0
}

func getDefaultServersDir() string {
	if runtime.GOOS == "windows" {
		return "C:\\srv\\daemon\\servers"
	}
	return "/srv/daemon/servers"
}

func getDefaultDockerURL() string {
	if runtime.GOOS == "windows" {
		return "npipe:////./pipe/docker_engine"
	}
	return "unix:///var/run/docker.sock"
}

var (
	dockerClient *client.Client
	clientMutex  sync.RWMutex
	upgrader     = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true }, // Allow all origins for simplicity
	}
)

// initDockerClient attempts to connect to the Docker daemon with retry logic
func initDockerClient() error {
	clientMutex.Lock()
	defer clientMutex.Unlock()

	var err error
	log.Printf("Connecting to Docker Daemon at %s...", DockerURL)
	dockerClient, err = client.NewClientWithOpts(
		client.WithHost(DockerURL),
		client.WithAPIVersionNegotiation(),
	)
	if err != nil {
		return err
	}

	// Verify connection by pinging
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = dockerClient.Ping(ctx)
	if err != nil {
		dockerClient = nil
		return err
	}

	log.Println("Connected to Docker Daemon successfully.")
	return nil
}

// getDockerClient returns the active Docker client, attempting to reconnect if nil
func getDockerClient() (*client.Client, error) {
	clientMutex.RLock()
	c := dockerClient
	clientMutex.RUnlock()

	if c != nil {
		return c, nil
	}

	// Reconnect attempt
	err := initDockerClient()
	if err != nil {
		return nil, fmt.Errorf("docker daemon is unreachable: %v", err)
	}

	clientMutex.RLock()
	c = dockerClient
	clientMutex.RUnlock()
	return c, nil
}

// verifyToken checks the X-Daemon-Token header or token query parameter
func verifyToken(w http.ResponseWriter, r *http.Request) bool {
	token := r.Header.Get("X-Daemon-Token")
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	if token != DaemonToken {
		http.Error(w, `{"error": "Unauthorized: invalid daemon token"}`, http.StatusUnauthorized)
		return false
	}
	return true
}

// SafePath resolves and normalizes a relative path inside a server's sandboxed root directory, preventing traversal escapes.
func SafePath(serverUUID, relativePath string) (string, error) {
	cleanUUID := filepath.Base(serverUUID)
	serverRoot, err := filepath.Abs(filepath.Join(ServersDir, cleanUUID))
	if err != nil {
		return "", err
	}

	// Clean up user relative path input
	relativePath = strings.TrimLeft(relativePath, "/\\")
	joinedPath := filepath.Join(serverRoot, relativePath)
	resolvedPath, err := filepath.Abs(joinedPath)
	if err != nil {
		return "", err
	}

	// Check if resolved target lies strictly inside serverRoot
	if !strings.HasPrefix(resolvedPath, serverRoot+string(filepath.Separator)) && resolvedPath != serverRoot {
		return "", errors.New("path traversal detected: access denied")
	}

	return resolvedPath, nil
}

// Payload structs matching Panel schema contract
type AllocationPayload struct {
	IPAddress string `json:"ip_address"`
	Port      int    `json:"port"`
}

type ServerInstallPayload struct {
	UUID           string              `json:"uuid"`
	DockerImage    string              `json:"docker_image"`
	DockerNetwork  string              `json:"docker_network"`
	CPULimit       float64             `json:"cpu_limit"` // e.g. 100.0 (1 core)
	MemoryLimit    int64               `json:"memory_limit"` // MB
	DiskLimit      int64               `json:"disk_limit"` // MB
	PrimaryPort    int                 `json:"primary_port"`
	Allocations    []AllocationPayload `json:"allocations"`
	StartupCommand string              `json:"startup_command"`
	HostNetwork     bool                `json:"host_network"`
}

type PowerPayload struct {
	Action string `json:"action"`
}

type FileWritePayload struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type FileFolderPayload struct {
	Path string `json:"path"`
}

type FileRenamePayload struct {
	OldPath string `json:"old_path"`
	NewPath string `json:"new_path"`
}

type DockerBuildPayload struct {
	ImageName string `json:"image_name"`
	Dockerfile string `json:"dockerfile"`
}

type BackupCreatePayload struct {
	Name     string `json:"name"`
	BackupID string `json:"backup_id"`
}

func main() {
	// Create storage root directory
	if err := os.MkdirAll(ServersDir, 0755); err != nil {
		log.Fatalf("Failed to create servers directory: %v", err)
	}

	// Connect to Docker at start
	go func() {
		for {
			if err := initDockerClient(); err != nil {
				log.Printf("Docker Connection failed: %v. Retrying in 5 seconds...", err)
				time.Sleep(5 * time.Second)
			} else {
				break
			}
		}
	}()

	// --- Configure Router Endpoints ---
	http.HandleFunc("/api/system", handleSystem)
	http.HandleFunc("/api/system/networks", handleSystemNetworks)
	http.HandleFunc("/api/system/build", handleDockerBuild)
	http.HandleFunc("/api/servers", handleServers)
	http.HandleFunc("/api/servers/", handleServerSpecific)

	// Console (ttyd) management endpoints
	http.HandleFunc("/api/console/", handleConsoleManagement)

	port := getEnv("PORT", "8080")
	log.Printf("Wings Daemon listening on port %s...", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// handleConsoleManagement handles ttyd-based console access
// POST /api/console/{uuid}/start - Start ttyd for a server
// DELETE /api/console/{uuid}/stop - Stop ttyd for a server
// GET /api/console/{uuid}/url - Get ttyd URL for a server
func handleConsoleManagement(w http.ResponseWriter, r *http.Request) {
	if !verifyToken(w, r) {
		return
	}

	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/console/"), "/"), "/")
	if len(parts) < 2 {
		http.Error(w, "Invalid path", http.StatusNotFound)
		return
	}

	uuid := parts[0]
	action := parts[1]

	switch action {
	case "start":
		port, err := startTtyd(uuid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "started",
			"port":   port,
		})

	case "stop":
		stopTtyd(uuid)
		json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})

	case "url":
		port := getTtydPort(uuid)
		if port == 0 {
			http.Error(w, "Console not running", http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"port": port,
			"url":  fmt.Sprintf("/console/%s/", uuid),
		})

	default:
		http.Error(w, "Invalid action", http.StatusBadRequest)
	}
}

// handleSystem returns daemon status for panel health checks
func handleSystem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	dockerOK := false
	clientMutex.RLock()
	c := dockerClient
	clientMutex.RUnlock()
	if c != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, pingErr := c.Ping(ctx)
		dockerOK = pingErr == nil
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"version":          "1.0.0",
		"docker_connected": dockerOK,
		"uptime_seconds":   int(time.Since(startTime).Seconds()),
		"servers_dir":      ServersDir,
		"docker_url":       DockerURL,
	})
}

func handleSystemNetworks(w http.ResponseWriter, r *http.Request) {
	if !verifyToken(w, r) {
		return
	}
	cli, err := getDockerClient()
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	networks, err := cli.NetworkList(context.Background(), types.NetworkListOptions{})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	type netInfo struct {
		Name   string `json:"name"`
		ID     string `json:"id"`
		Driver string `json:"driver"`
		Scope  string `json:"scope"`
	}
	var result []netInfo
	for _, n := range networks {
		result = append(result, netInfo{
			Name:   n.Name,
			ID:     n.ID[:12],
			Driver: n.Driver,
			Scope:  n.Scope,
		})
	}
	json.NewEncoder(w).Encode(result)
}

func handleDockerBuild(w http.ResponseWriter, r *http.Request) {
	if !verifyToken(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var payload DockerBuildPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if payload.ImageName == "" || payload.Dockerfile == "" {
		http.Error(w, "image_name and dockerfile required", http.StatusBadRequest)
		return
	}

	cli, err := getDockerClient()
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}

	// Write Dockerfile to temp dir and build
	buildDir, err := os.MkdirTemp("", "wings-build-*")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(buildDir)

	if err := os.WriteFile(filepath.Join(buildDir, "Dockerfile"), []byte(payload.Dockerfile), 0644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Return 202 immediately, build in background
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "build_started", "image": payload.ImageName})

	go func() {
		ctx := context.Background()
		tarReader, err := createTarContext(buildDir)
		if err != nil {
			log.Printf("[BUILD] Failed to create tar: %v", err)
			return
		}
		defer tarReader.Close()

		buildOpts := types.ImageBuildOptions{
			Tags:       []string{payload.ImageName},
			Remove:     true,
			ForceRemove: true,
		}
		resp, err := cli.ImageBuild(ctx, tarReader, buildOpts)
		if err != nil {
			log.Printf("[BUILD] Failed to build image %s: %v", payload.ImageName, err)
			return
		}
		defer resp.Body.Close()
		// Consume output so the build completes
		io.Copy(io.Discard, resp.Body)
		log.Printf("[BUILD] Image %s built successfully.", payload.ImageName)
	}()
}

func createTarContext(dir string) (io.ReadCloser, error) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		hdr := &tar.Header{
			Name:     entry.Name(),
			Size:     info.Size(),
			Mode:     0644,
			ModTime:  info.ModTime(),
			Typeflag: tar.TypeReg,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return nil, err
		}
		if _, err := tw.Write(data); err != nil {
			return nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	return io.NopCloser(&buf), nil
}

// handleServers handles bulk / server creation operations
func handleServers(w http.ResponseWriter, r *http.Request) {
	if !verifyToken(w, r) {
		return
	}

	if r.Method == http.MethodPost {
		var payload ServerInstallPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		cli, err := getDockerClient()
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}

		// Accept immediately, do pull+create+start in background
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]string{"status": "accepted", "uuid": payload.UUID})

		go createAndStartServer(cli, payload)
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func createAndStartServer(cli *client.Client, payload ServerInstallPayload) {
	ctx := context.Background()

	// 1. Pull Image (with retries)
	log.Printf("[%s] Pulling image: %s", payload.UUID, payload.DockerImage)
	var pullErr error
	for i := 0; i < 3; i++ {
		var reader io.ReadCloser
		reader, pullErr = cli.ImagePull(ctx, payload.DockerImage, types.ImagePullOptions{})
		if pullErr == nil {
			io.Copy(io.Discard, reader)
			reader.Close()
			break
		}
		log.Printf("[%s] Pull failed (attempt %d/3): %v. Retrying...", payload.UUID, i+1, pullErr)
		time.Sleep(2 * time.Second)
	}
	if pullErr != nil {
		log.Printf("[%s] CRITICAL: Failed to pull image after 3 attempts: %v", payload.UUID, pullErr)
		return
	}
	log.Printf("[%s] Image pulled successfully.", payload.UUID)

	// 2. Setup server folders
	serverRoot, err := filepath.Abs(filepath.Join(ServersDir, payload.UUID))
	if err != nil {
		log.Printf("[%s] Failed to resolve server root: %v", payload.UUID, err)
		return
	}
	os.MkdirAll(serverRoot, 0755)

	// Only create start.sh if a startup command is provided
	if payload.StartupCommand != "" {
		startScript := filepath.Join(serverRoot, "start.sh")
		if _, err := os.Stat(startScript); os.IsNotExist(err) {
			scriptContent := fmt.Sprintf("#!/bin/bash\necho 'Running startup command...'\n%s\n", payload.StartupCommand)
			os.WriteFile(startScript, []byte(scriptContent), 0755)
		}
	}

	// 3. Define port bindings
	portBindings := nat.PortMap{}
	exposedPorts := nat.PortSet{}
	for _, alloc := range payload.Allocations {
		portStr := fmt.Sprintf("%d", alloc.Port)
		tcpPort := nat.Port(portStr + "/tcp")
		exposedPorts[tcpPort] = struct{}{}
		portBindings[tcpPort] = []nat.PortBinding{{HostIP: "0.0.0.0", HostPort: portStr}}
		udpPort := nat.Port(portStr + "/udp")
		exposedPorts[udpPort] = struct{}{}
		portBindings[udpPort] = []nat.PortBinding{{HostIP: "0.0.0.0", HostPort: portStr}}
	}

	useHostNetwork := payload.HostNetwork || len(payload.Allocations) == 0

	// 4. Configure resource caps
	nanoCPUs := int64((payload.CPULimit / 100.0) * 1_000_000_000)
	memLimitBytes := payload.MemoryLimit * 1024 * 1024

	containerName := "wings-" + payload.UUID
	cli.ContainerRemove(ctx, containerName, types.ContainerRemoveOptions{Force: true})

	// 5. Create per-server named volume
	volumeName := "wings-" + payload.UUID
	volumeBinds := []string{
		fmt.Sprintf("%s:/data:rw", volumeName),
		fmt.Sprintf("%s:/home/container:rw", volumeName),
	}

	// 6. Create container — let the image's own entrypoint handle everything.
	// Game server images (itzg, etc.) read STARTUP/MEMORY/EULA env vars
	// and handle jar download, setup, and execution themselves.
	config := &container.Config{
		Image:        payload.DockerImage,
		User:          "root",
		ExposedPorts: exposedPorts,
		Env: []string{
			fmt.Sprintf("SERVER_PORT=%d", payload.PrimaryPort),
			fmt.Sprintf("STARTUP=%s", payload.StartupCommand),
			"EULA=TRUE",
			"MEMORY=2G",
		},
		WorkingDir: "/data",
		Tty:        false,
		OpenStdin:  true,
	}
	resp, err := cli.ContainerCreate(ctx, config,
		&container.HostConfig{
			PortBindings: portBindings,
			Binds:        volumeBinds,
			Resources: container.Resources{
				NanoCPUs:   nanoCPUs,
				Memory:     memLimitBytes,
				MemorySwap: memLimitBytes,
			},
			NetworkMode: container.NetworkMode(func() string {
				if useHostNetwork {
					return "host"
				}
				if payload.DockerNetwork != "" {
					return payload.DockerNetwork
				}
				return DockerNetwork
			}()),
			RestartPolicy: container.RestartPolicy{
				Name: "no",
			},
		},
		&network.NetworkingConfig{},
		nil,
		containerName,
	)
	if err != nil {
		log.Printf("[%s] Failed to create container: %v", payload.UUID, err)
		return
	}

	// 7. Auto-start
	if startErr := cli.ContainerStart(ctx, containerName, types.ContainerStartOptions{}); startErr != nil {
		log.Printf("[%s] Container created but failed to start: %v", payload.UUID, startErr)
		return
	}
	log.Printf("[%s] Container started successfully (ID: %s)", payload.UUID, resp.ID[:12])
}

// handleServerSpecific routes action/logs/files requests per server UUID
func handleServerSpecific(w http.ResponseWriter, r *http.Request) {
	// Parse UUID
	// path structure: /api/servers/{uuid}/[action/resources/files...]
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 {
		http.Error(w, "Invalid path", http.StatusNotFound)
		return
	}
	uuid := parts[2]
	subPath := ""
	if len(parts) > 3 {
		subPath = strings.Join(parts[3:], "/")
	}

	// 1. WebSocket Console Log streaming endpoint
	if subPath == "console" {
		handleConsoleWS(w, r, uuid)
		return
	}

	// REST Endpoints require standard token authorization
	if !verifyToken(w, r) {
		return
	}

	cli, err := getDockerClient()
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	ctx := context.Background()
	containerName := "wings-" + uuid

	switch subPath {
	case "install-status":
		if r.Method == http.MethodGet {
			inspect, err := cli.ContainerInspect(ctx, containerName)
			if err != nil {
				json.NewEncoder(w).Encode(map[string]interface{}{
					"exists":  false,
					"status":  "missing",
					"message": "Container not found",
				})
				return
			}
			json.NewEncoder(w).Encode(map[string]interface{}{
				"exists":  true,
				"status":  inspect.State.Status,
				"running": inspect.State.Running,
			})
			return
		}

	case "power":
		if r.Method == http.MethodPost {
			var body PowerPayload
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			action := strings.ToLower(body.Action)
			switch action {
			case "start":
				err = cli.ContainerStart(ctx, containerName, types.ContainerStartOptions{})
			case "stop":
				dur := 15 * time.Second
				err = cli.ContainerStop(ctx, containerName, &dur)
			case "kill":
				err = cli.ContainerKill(ctx, containerName, "SIGKILL")
			case "restart":
				dur := 5 * time.Second
				cli.ContainerStop(ctx, containerName, &dur)
				err = cli.ContainerStart(ctx, containerName, types.ContainerStartOptions{})
			default:
				http.Error(w, "Invalid power action", http.StatusBadRequest)
				return
			}
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "success", "action": action})
			return
		}

	case "resources":
		if r.Method == http.MethodGet {
			inspect, err := cli.ContainerInspect(ctx, containerName)
			if err != nil {
				json.NewEncoder(w).Encode(map[string]interface{}{
					"status":         "stopped",
					"cpu_percentage": 0.0,
					"memory_mb":      0.0,
					"disk_mb":        0.0,
				})
				return
			}

			if !inspect.State.Running {
				json.NewEncoder(w).Encode(map[string]interface{}{
					"status":         inspect.State.Status,
					"cpu_percentage": 0.0,
					"memory_mb":      0.0,
					"disk_mb":        0.0,
				})
				return
			}

			// Get one-shot stats
			statsResp, err := cli.ContainerStats(ctx, containerName, false)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			defer statsResp.Body.Close()

			var stats types.StatsJSON
			if err := json.NewDecoder(statsResp.Body).Decode(&stats); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}

			// CPU % Calculation
			cpuPercent := 0.0
			cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage) - float64(stats.PreCPUStats.CPUUsage.TotalUsage)
			sysDelta := float64(stats.CPUStats.SystemUsage) - float64(stats.PreCPUStats.SystemUsage)
			onlineCPUs := float64(stats.CPUStats.OnlineCPUs)
			if onlineCPUs == 0 {
				onlineCPUs = float64(len(stats.CPUStats.CPUUsage.PercpuUsage))
			}
			if onlineCPUs == 0 {
				onlineCPUs = 1
			}
			if sysDelta > 0 && cpuDelta > 0 {
				cpuPercent = (cpuDelta / sysDelta) * onlineCPUs * 100.0
			}

			// Memory MB
			memBytes := stats.MemoryStats.Usage
			if cache, ok := stats.MemoryStats.Stats["cache"]; ok {
				if memBytes > cache {
					memBytes -= cache
				}
			}
			memMB := float64(memBytes) / (1024 * 1024)

			// Get disk usage via exec
			diskMB := 0.0
			diskOut, diskErr := runExec(cli, ctx, containerName, []string{
				"/bin/sh", "-c", "du -sm /data 2>/dev/null | cut -f1",
			})
			if diskErr == nil {
				diskOut = strings.TrimSpace(diskOut)
				if diskOut != "" {
					fmt.Sscanf(diskOut, "%f", &diskMB)
				}
			}

			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":         inspect.State.Status,
				"cpu_percentage": mathRound(cpuPercent, 2),
				"memory_mb":      mathRound(memMB, 2),
				"disk_mb":        mathRound(diskMB, 2),
			})
			return
		}

	case "files/list":
		if r.Method == http.MethodGet {
			if !ensureContainerRunning(cli, ctx, containerName) {
				http.Error(w, "Container does not exist", http.StatusNotFound)
				return
			}
			relPath := r.URL.Query().Get("path")
			result, err := listFilesViaDocker(cli, ctx, containerName, relPath)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(result)
			return
		}

	case "files/read":
		if r.Method == http.MethodGet {
			if !ensureContainerRunning(cli, ctx, containerName) {
				http.Error(w, "Container does not exist", http.StatusNotFound)
				return
			}
			relPath := r.URL.Query().Get("path")
			content, err := readFileViaDocker(cli, ctx, containerName, relPath)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"content": content})
			return
		}

	case "files/write":
		if r.Method == http.MethodPost {
			if !ensureContainerRunning(cli, ctx, containerName) {
				http.Error(w, "Container does not exist", http.StatusNotFound)
				return
			}
			var body FileWritePayload
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if err := writeFileViaDocker(cli, ctx, containerName, body.Path, body.Content); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
			return
		}

	case "files/folder":
		if r.Method == http.MethodPost {
			if !ensureContainerRunning(cli, ctx, containerName) {
				http.Error(w, "Container does not exist", http.StatusNotFound)
				return
			}
			var body FileFolderPayload
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if err := createFolderViaDocker(cli, ctx, containerName, body.Path); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
			return
		}

	case "files/delete":
		if r.Method == http.MethodDelete {
			if !ensureContainerRunning(cli, ctx, containerName) {
				http.Error(w, "Container does not exist", http.StatusNotFound)
				return
			}
			relPath := r.URL.Query().Get("path")
			if err := deletePathViaDocker(cli, ctx, containerName, relPath); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
			return
		}

	case "files/rename":
		if r.Method == http.MethodPost {
			if !ensureContainerRunning(cli, ctx, containerName) {
				http.Error(w, "Container does not exist", http.StatusNotFound)
				return
			}
			var body FileRenamePayload
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if err := renamePathViaDocker(cli, ctx, containerName, body.OldPath, body.NewPath); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "success"})
			return
		}
	}

	// Handle backup routes (backups, backups/{id}, backups/{id}/restore)
	if strings.HasPrefix(subPath, "backups") {
		handleBackupRoutes(w, r, uuid, subPath, cli, ctx)
		return
	}

	// Delete server route
	if r.Method == http.MethodDelete && subPath == "" {
		cli.ContainerRemove(ctx, containerName, types.ContainerRemoveOptions{Force: true})
		volumeName := "wings-" + uuid
		cli.VolumeRemove(ctx, volumeName, true)
		serverRoot, _ := filepath.Abs(filepath.Join(ServersDir, uuid))
		os.RemoveAll(serverRoot)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	http.Error(w, "Not found", http.StatusNotFound)
}

// handleConsoleWS upgrades connection to WebSocket, creates a persistent interactive shell inside the container.
// Architecture: Browser (xterm.js) <--WS--> Daemon <--exec TTY--> /bin/sh in container
func handleConsoleWS(w http.ResponseWriter, r *http.Request, uuid string) {
	token := r.URL.Query().Get("token")
	if token != DaemonToken {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	cli, err := getDockerClient()
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}

	containerName := "wings-" + uuid
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Verify container exists and is running
	info, err := cli.ContainerInspect(ctx, containerName)
	if err != nil {
		http.Error(w, "Container not found", http.StatusNotFound)
		return
	}
	if !info.State.Running {
		// Auto-start stopped container
		if startErr := cli.ContainerStart(ctx, containerName, types.ContainerStartOptions{}); startErr != nil {
			http.Error(w, fmt.Sprintf("Container stopped and failed to start: %v", startErr), http.StatusServiceUnavailable)
			return
		}
		// Brief wait
		time.Sleep(1 * time.Second)
	}

	// Create persistent interactive exec session with TTY
	// This is the key: Tty=true means Docker sends raw bytes (no multiplexed headers)
	execCfg := types.ExecConfig{
		Cmd:          []string{"/bin/sh", "-l"},
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          true,
		Detach:       false,
	}
	execID, err := cli.ContainerExecCreate(ctx, containerName, execCfg)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create exec: %v", err), http.StatusInternalServerError)
		return
	}

	// Attach to exec — this gives us a bidirectional connection
	// resp.Conn is the stdin writer, resp.Reader is stdout/stderr
	resp, err := cli.ContainerExecAttach(ctx, execID.ID, types.ExecStartCheck{Tty: true})
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to attach exec: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Close()

	// Now upgrade to WebSocket — after this, all communication is bidirectional
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[%s] WS Upgrade failed: %v", uuid, err)
		return
	}
	defer conn.Close()

	log.Printf("[%s] Interactive shell session started (exec ID: %s)", uuid, execID.ID[:12])

	// Write mutex — gorilla/websocket is NOT safe for concurrent writes
	var writeMu sync.Mutex
	safeWrite := func(msgType int, data []byte) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteMessage(msgType, data)
	}

	doneChan := make(chan struct{})
	defer close(doneChan)

	// 1. Read from Docker exec stdout -> send to WebSocket client
	//    With TTY=true, Docker sends raw bytes (no multiplexed stream headers)
	go func() {
		defer func() {
			select {
			case <-doneChan:
			default:
				close(doneChan)
			}
		}()
		buf := make([]byte, 4096)
		for {
			n, readErr := resp.Reader.Read(buf)
			if n > 0 {
				// Send raw bytes as binary message to xterm.js
				data := make([]byte, n)
				copy(data, buf[:n])
				if writeErr := safeWrite(websocket.BinaryMessage, data); writeErr != nil {
					return
				}
			}
			if readErr != nil {
				return
			}
		}
	}()

	// 2. Read from WebSocket client -> write to Docker exec stdin
	for {
		messageType, message, err := conn.ReadMessage()
		if err != nil {
			break
		}

		switch messageType {
		case websocket.TextMessage, websocket.BinaryMessage:
			// Write directly to the exec stdin (Tty mode = raw bytes)
			if _, writeErr := resp.Conn.Write(message); writeErr != nil {
				log.Printf("[%s] Exec stdin write error: %v", uuid, writeErr)
				break
			}
		case websocket.PingMessage:
			safeWrite(websocket.PongMessage, message)
		}
	}

	log.Printf("[%s] Interactive shell session ended.", uuid)
}

// stripStreamHeaders parses Docker multiplexed stream and returns plain output
func stripStreamHeaders(data []byte) []byte {
	var result []byte
	for len(data) >= 8 {
		streamType := data[0]
		frameSize := uint32(data[4])<<24 | uint32(data[5])<<16 | uint32(data[6])<<8 | uint32(data[7])
		data = data[8:]
		if int(frameSize) > len(data) {
			frameSize = uint32(len(data))
		}
		if streamType == 1 || streamType == 2 {
			result = append(result, data[:frameSize]...)
		}
		data = data[frameSize:]
	}
	if len(data) > 0 && len(result) == 0 {
		result = data
	}
	return result
}

func mathRound(val float64, precision int) float64 {
	ratio := 1.0
	for i := 0; i < precision; i++ {
		ratio *= 10
	}
	return float64(int(val*ratio+0.5)) / ratio
}

// --- Docker-based file operations (work with named volumes) ---

// ensureContainerRunning starts the container if it exists but is stopped.
// Returns true if the container is running (or was started), false if it doesn't exist.
func ensureContainerRunning(cli *client.Client, ctx context.Context, containerName string) bool {
	inspect, err := cli.ContainerInspect(ctx, containerName)
	if err != nil {
		return false // container doesn't exist
	}
	if inspect.State.Running {
		return true
	}
	// Container exists but is stopped — start it
	_ = cli.ContainerStart(ctx, containerName, types.ContainerStartOptions{})
	// Brief wait for container to be running
	time.Sleep(500 * time.Millisecond)
	inspect2, err := cli.ContainerInspect(ctx, containerName)
	if err != nil {
		return false
	}
	return inspect2.State.Running
}

func runExec(cli *client.Client, ctx context.Context, containerName string, cmd []string) (string, error) {
	execConfig := types.ExecConfig{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	}
	execID, err := cli.ContainerExecCreate(ctx, containerName, execConfig)
	if err != nil {
		return "", err
	}
	resp, err := cli.ContainerExecAttach(ctx, execID.ID, types.ExecStartCheck{})
	if err != nil {
		return "", err
	}
	defer resp.Close()

	// Docker multiplexed stream: 8-byte header per frame [stream_type(1), 0, 0, 0, size(4)]
	var result strings.Builder
	buf := make([]byte, 8192)
	for {
		n, readErr := resp.Reader.Read(buf)
		if n > 0 {
			data := buf[:n]
			// Parse Docker stream frames
			for len(data) >= 8 {
				streamType := data[0]
				size := uint32(data[4])<<24 | uint32(data[5])<<16 | uint32(data[6])<<8 | uint32(data[7])
				data = data[8:]
				if int(size) > len(data) {
					size = uint32(len(data))
				}
				if streamType == 1 || streamType == 2 {
					result.Write(data[:size])
				}
				data = data[size:]
			}
			if len(data) > 0 {
				result.Write(data)
			}
		}
		if readErr != nil {
			break
		}
	}
	return result.String(), nil
}

func runExecStdIn(cli *client.Client, ctx context.Context, containerName string, cmd []string, stdinData []byte) (string, error) {
	execConfig := types.ExecConfig{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
		AttachStdin:  true,
	}
	execID, err := cli.ContainerExecCreate(ctx, containerName, execConfig)
	if err != nil {
		return "", err
	}
	resp, err := cli.ContainerExecAttach(ctx, execID.ID, types.ExecStartCheck{})
	if err != nil {
		return "", err
	}
	defer resp.Close()

	if len(stdinData) > 0 {
		resp.Conn.Write(stdinData)
		resp.CloseWrite()
	}

	var result strings.Builder
	buf := make([]byte, 8192)
	for {
		n, readErr := resp.Reader.Read(buf)
		if n > 0 {
			data := buf[:n]
			for len(data) >= 8 {
				streamType := data[0]
				size := uint32(data[4])<<24 | uint32(data[5])<<16 | uint32(data[6])<<8 | uint32(data[7])
				data = data[8:]
				if int(size) > len(data) {
					size = uint32(len(data))
				}
				if streamType == 1 || streamType == 2 {
					result.Write(data[:size])
				}
				data = data[size:]
			}
			if len(data) > 0 {
				result.Write(data)
			}
		}
		if readErr != nil {
			break
		}
	}
	return result.String(), nil
}

func listFilesViaDocker(cli *client.Client, ctx context.Context, containerName string, relPath string) ([]map[string]interface{}, error) {
	absPath := "/data/" + strings.TrimLeft(relPath, "/")
	// Use ls -la and parse output — works on Alpine/busybox
	out, err := runExec(cli, ctx, containerName, []string{
		"/bin/sh", "-c",
		fmt.Sprintf(`ls -1a "%s" 2>/dev/null`, absPath),
	})
	if err != nil {
		if strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "No such container") {
			return []map[string]interface{}{}, nil
		}
		return nil, err
	}
	result := []map[string]interface{}{}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || line == "." || line == ".." {
			continue
		}
		// Stat each entry to get size and type
		statOut, statErr := runExec(cli, ctx, containerName, []string{
			"/bin/sh", "-c",
			fmt.Sprintf(`if [ -d "%s/%s" ]; then echo "d 0"; else sz=$(stat -c "%%s" "%s/%s" 2>/dev/null || echo 0); echo "f $sz"; fi`, absPath, line, absPath, line),
		})
		if statErr != nil {
			continue
		}
		statParts := strings.Fields(strings.TrimSpace(statOut))
		isDir := len(statParts) > 0 && statParts[0] == "d"
		var size int64
		if len(statParts) > 1 {
			fmt.Sscanf(statParts[1], "%d", &size)
		}
		result = append(result, map[string]interface{}{
			"name":         line,
			"is_directory": isDir,
			"size":         size,
			"modified_at":  0,
		})
	}
	return result, nil
}

func readFileViaDocker(cli *client.Client, ctx context.Context, containerName string, relPath string) (string, error) {
	absPath := "/data/" + strings.TrimLeft(relPath, "/")
	out, err := runExec(cli, ctx, containerName, []string{
		"/bin/sh", "-c",
		fmt.Sprintf("cat %s 2>/dev/null || echo -n ''", absPath),
	})
	if err != nil {
		return "", err
	}
	return strings.TrimRight(out, "\n"), nil
}

func writeFileViaDocker(cli *client.Client, ctx context.Context, containerName string, relPath string, content string) error {
	absPath := "/data/" + strings.TrimLeft(relPath, "/")
	dirPath := filepath.Dir(absPath)
	_, err := runExec(cli, ctx, containerName, []string{
		"/bin/sh", "-c",
		fmt.Sprintf("mkdir -p %s", dirPath),
	})
	if err != nil {
		return err
	}
	// Use printf with escaped content to write file
	escaped := strings.ReplaceAll(content, "\\", "\\\\")
	escaped = strings.ReplaceAll(escaped, "'", "'\\''")
	_, err = runExec(cli, ctx, containerName, []string{
		"/bin/sh", "-c",
		fmt.Sprintf("printf '%%s' '%s' > %s", escaped, absPath),
	})
	return err
}

func createFolderViaDocker(cli *client.Client, ctx context.Context, containerName string, relPath string) error {
	absPath := "/data/" + strings.TrimLeft(relPath, "/")
	_, err := runExec(cli, ctx, containerName, []string{
		"/bin/sh", "-c",
		fmt.Sprintf("mkdir -p %s", absPath),
	})
	return err
}

func deletePathViaDocker(cli *client.Client, ctx context.Context, containerName string, relPath string) error {
	absPath := "/data/" + strings.TrimLeft(relPath, "/")
	// Safety: prevent deleting root
	if absPath == "/data" || absPath == "/data/" {
		return fmt.Errorf("cannot delete root directory")
	}
	_, err := runExec(cli, ctx, containerName, []string{
		"/bin/sh", "-c",
		fmt.Sprintf("rm -rf %s", absPath),
	})
	return err
}

func renamePathViaDocker(cli *client.Client, ctx context.Context, containerName string, oldPath string, newPath string) error {
	absOld := "/data/" + strings.TrimLeft(oldPath, "/")
	absNew := "/data/" + strings.TrimLeft(newPath, "/")
	dirNew := filepath.Dir(absNew)
	_, err := runExec(cli, ctx, containerName, []string{
		"/bin/sh", "-c",
		fmt.Sprintf("mkdir -p %s && mv %s %s", dirNew, absOld, absNew),
	})
	return err
}

// handleBackupRoutes handles backup creation, deletion, and restoration
func handleBackupRoutes(w http.ResponseWriter, r *http.Request, uuid string, subPath string, cli *client.Client, ctx context.Context) {
	containerName := "wings-" + uuid
	backupsDir := filepath.Join(ServersDir, uuid, ".wings_backups")

	// POST /api/servers/{uuid}/backups — create backup
	if subPath == "backups" && r.Method == http.MethodPost {
		var payload BackupCreatePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if payload.BackupID == "" {
			http.Error(w, "backup_id required", http.StatusBadRequest)
			return
		}

		os.MkdirAll(backupsDir, 0755)
		backupFile := filepath.Join(backupsDir, payload.BackupID+".tar.gz")

		// Create tar.gz of /data via docker exec
		tarCmd := fmt.Sprintf("tar czf /tmp/backup_%s.tar.gz -C /data . 2>/dev/null", payload.BackupID)
		if _, err := runExec(cli, ctx, containerName, []string{"/bin/sh", "-c", tarCmd}); err != nil {
			http.Error(w, fmt.Sprintf("tar create failed: %v", err), http.StatusInternalServerError)
			return
		}

		// Copy tar.gz from container to host via docker exec
		copyCmd := fmt.Sprintf("cat /tmp/backup_%s.tar.gz", payload.BackupID)
		out, err := runExec(cli, ctx, containerName, []string{"/bin/sh", "-c", copyCmd})
		if err != nil {
			http.Error(w, fmt.Sprintf("copy failed: %v", err), http.StatusInternalServerError)
			return
		}

		backupData := []byte(out)
		writeErr := os.WriteFile(backupFile, backupData, 0644)

		// Clean up temp file in container
		runExec(cli, ctx, containerName, []string{"/bin/sh", "-c",
			fmt.Sprintf("rm -f /tmp/backup_%s.tar.gz", payload.BackupID)})

		size := int64(len(backupData))
		if writeErr != nil {
			// Fallback: keep backup inside container volume
			cpExec := fmt.Sprintf("cp /tmp/backup_%s.tar.gz /data/.wings_backups/%s.tar.gz", payload.BackupID, payload.BackupID)
			runExec(cli, ctx, containerName, []string{"/bin/sh", "-c", cpExec})
			sizeOut, _ := runExec(cli, ctx, containerName, []string{"/bin/sh", "-c",
				fmt.Sprintf("stat -c %%s /data/.wings_backups/%s.tar.gz 2>/dev/null || echo 0", payload.BackupID)})
			fmt.Sscanf(strings.TrimSpace(sizeOut), "%d", &size)
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":     "success",
			"backup_id":  payload.BackupID,
			"size_bytes": size,
			"path":       backupFile,
		})
		return
	}

	// Parse remaining path parts for delete/restore
	parts := strings.Split(strings.TrimPrefix(subPath, "backups/"), "/")
	if len(parts) < 1 || parts[0] == "" {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	backupID := parts[0]
	subAction := ""
	if len(parts) >= 2 {
		subAction = parts[1]
	}

	// DELETE /api/servers/{uuid}/backups/{backup_id}
	if r.Method == http.MethodDelete && subAction == "" {
		backupFile := filepath.Join(backupsDir, backupID+".tar.gz")
		containerBackupPath := fmt.Sprintf("/data/.wings_backups/%s.tar.gz", backupID)
		os.Remove(backupFile)
		runExec(cli, ctx, containerName, []string{"/bin/sh", "-c", fmt.Sprintf("rm -f %s", containerBackupPath)})
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
		return
	}

	// POST /api/servers/{uuid}/backups/{backup_id}/restore
	if r.Method == http.MethodPost && subAction == "restore" {
		containerBackupPath := fmt.Sprintf("/data/.wings_backups/%s.tar.gz", backupID)
		backupFile := filepath.Join(backupsDir, backupID+".tar.gz")

		// Check if backup exists in container or on host
		checkOut, _ := runExec(cli, ctx, containerName, []string{"/bin/sh", "-c",
			fmt.Sprintf("test -f %s && echo exists || echo missing", containerBackupPath)})
		if strings.TrimSpace(checkOut) != "exists" {
			if _, err := os.Stat(backupFile); os.IsNotExist(err) {
				http.Error(w, "Backup not found", http.StatusNotFound)
				return
			}
			hostData, err := os.ReadFile(backupFile)
			if err != nil {
				http.Error(w, "Failed to read backup file", http.StatusInternalServerError)
				return
			}
			execID, err := runExecStdIn(cli, ctx, containerName, []string{"/bin/sh", "-c",
				fmt.Sprintf("mkdir -p /data/.wings_backups && cat > %s", containerBackupPath)}, hostData)
			if err != nil || strings.TrimSpace(execID) == "" {
				http.Error(w, "Failed to copy backup into container", http.StatusInternalServerError)
				return
			}
		}

		restoreCmd := fmt.Sprintf("cd /data && tar xzf %s --exclude='.wings_backups' 2>/dev/null", containerBackupPath)
		if _, err := runExec(cli, ctx, containerName, []string{"/bin/sh", "-c", restoreCmd}); err != nil {
			http.Error(w, fmt.Sprintf("restore failed: %v", err), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]string{"status": "restored", "backup_id": backupID})
		return
	}

	http.Error(w, "Not found", http.StatusNotFound)
}
