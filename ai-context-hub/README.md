# AI Context Hub — v1 (no filesystem sharing)

## Purpose

This version connects your existing Dockerized Open WebUI to host-installed OpenCode without changing the `open-terminal` container or sharing host directories into it.

It provides:

1. A shared searchable SQLite index of Open WebUI and OpenCode conversations.
2. Durable shared `save_memory` and `save_decision` tools.
3. `ask_opencode_agent` for Open WebUI models to delegate a task to host OpenCode.
4. `ask_openwebui_model` for OpenCode agents to delegate a task to an Open WebUI model.
5. Automatic Open WebUI chat synchronization every minute.
6. Automatic OpenCode session synchronization whenever an OpenCode session becomes idle.

## Network layout

```text
Open WebUI container ─────┐
                          │ Compose default network
Context Hub container ────┤
                          │
                          └──> http://open-webui:8080
                                  
Context Hub container ─────────> host.docker.internal:4096
                                       │
                                       ▼
                              host OpenCode server
```

`open-terminal` is deliberately not modified.

## Why v1 does not touch open-terminal

The Open WebUI model can still call `ask_opencode_agent` and give OpenCode a host path such as `/home/gp/Code/Python/Website-Code`. OpenCode runs on the host and can therefore inspect that path normally.

However, the Open WebUI model's terminal remains in its existing isolated container. The same host path is NOT magically visible to it in v1.

That is intentional. Filesystem translation and access control are a separate layer for v2.

## Install

### 1. Add the Context Hub service

Put the `context-hub:` service from `compose.patch.yml` into your existing compose file. Do not replace your `open-webui` or `open-terminal` services.

Your final Compose project should have three services:

- `open-webui`
- `open-terminal`
- `context-hub`

The three will share the Compose default network automatically.

### 2. Create environment variables

Add the variables from `.env.context-hub.example` to the same `.env` file used by your Compose project.

Generate secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Use one for `CONTEXT_HUB_TOKEN` and one for `OPENCODE_PASSWORD`.

For `OPENWEBUI_API_KEY`, create an API key in Open WebUI under Settings → Account. Current Open WebUI docs require API-key authentication for its API and note that API keys must be enabled by an administrator. See:
https://docs.openwebui.com/reference/api-endpoints/

### 3. Start Context Hub

From the directory containing your compose file:

```bash
docker compose up -d --build context-hub
```

Then:

```bash
curl -fsS http://127.0.0.1:3000 >/dev/null && echo "Open WebUI is reachable"
curl -fsS http://127.0.0.1:8765/health || true
```

The Context Hub host port is bound to `127.0.0.1:8765`, so it is not published to the LAN. `open-webui` reaches it over the Compose network; host OpenCode reaches it through that loopback port. If you want strict container-only access later, v2 can move OpenCode communication behind a dedicated host bridge.

### 4. Start an OpenCode HTTP server

OpenCode's current headless server is:

```bash
OPENCODE_SERVER_PASSWORD="$OPENCODE_PASSWORD" \
opencode serve --hostname 0.0.0.0 --port 4096
```

The server uses HTTP Basic auth when `OPENCODE_SERVER_PASSWORD` is set. OpenCode's current server API exposes sessions and messages at `/session` and `/session/:id/message`, and project selection is controlled by the `x-opencode-directory` request header.

For persistence, install `opencode-server.service.example` as a user systemd service after replacing its password.

Because the server binds to `0.0.0.0`, firewall TCP/4096 if your machine is reachable from untrusted networks. Context Hub authenticates to it with HTTP Basic auth.

### 5. Configure OpenCode's MCP server

Merge the `mcp` entry from `opencode.mcp.example.jsonc` into your OpenCode config, normally `~/.config/opencode/opencode.json`.

Also export the Context Hub token before launching OpenCode:

```bash
export CONTEXT_HUB_TOKEN='...'
```

For a persistent shell, put it in the environment that starts OpenCode, not in project `.env` files that agents might inspect.

OpenCode currently supports remote MCP servers with URL, headers, and `oauth: false` configuration.

### 6. Install the OpenCode sync plugin

Copy:

```text
opencode-plugin/context-hub.ts
```

to:

```text
~/.config/opencode/plugins/context-hub.ts
```

The global plugin directory is automatically loaded by OpenCode.

The plugin only sends the completed session ID and host directory to Context Hub. Context Hub then retrieves the transcript over OpenCode's authenticated API.

### 7. Add Context Hub to Open WebUI

In Open WebUI:

```text
Settings → Admin → Integrations → External Tool Servers → Add Connection
```

Choose:

```text
MCP (Streamable HTTP)
```

Server URL inside the Compose network:

```text
http://context-hub:8765/mcp
```

Header:

```json
{"Authorization":"Bearer YOUR_CONTEXT_HUB_TOKEN"}
```

Open WebUI currently supports native remote MCP over Streamable HTTP and allows bearer/custom headers for external tool servers.

## First tests

### Test the bridge itself

In an Open WebUI chat, with the MCP server enabled:

```text
Use context_hub_stats.
```

You should get counts for indexed documents.

Then:

```text
Use sync_openwebui_conversations, then search_shared_context for our previous discussions about OpenCode.
```

### Test OpenCode delegation

In Open WebUI:

```text
Use ask_opencode_agent.
Directory: /home/gp/Code/Python/Website-Code
Ask OpenCode to inspect the project architecture and report the important files and design decisions. Do not edit anything.
```

### Test the reverse direction

In OpenCode:

```text
Use the ai-context-hub MCP server and ask_openwebui_model to get another model's perspective on the current design.
```

## Important v1 limitation

There are two notions of a path right now:

- OpenCode path: the real host path, e.g. `/home/gp/Code/Python/Website-Code`.
- Open WebUI terminal path: whatever is mounted in the `open-terminal` container today.

They are not translated in v1.

That is deliberate. The bridge can synchronize conversation/knowledge without changing filesystem isolation.

## V2 design boundary

Do NOT let a model edit `docker-compose.yml` to obtain arbitrary mounts.

A safer v2 design is deterministic project registration:

```yaml
projects:
  website:
    host_root: /home/gp/Code/Python/Website-Code
    terminal_root: /workspace/website
    access: read_write
```

Then the bridge can:

1. accept `project_id=website`, not an arbitrary host path;
2. validate the project against a static registry;
3. expose only that registry entry to OpenCode and Open WebUI;
4. generate/update a controlled sidecar compose override or Docker API configuration;
5. restart only `open-terminal` when its mount set changes;
6. mount `/home/gp/Code/Python/Website-Code` as `/workspace/website` inside the terminal container.

No AI should make the authorization decision. The model can request `project_id=website`; deterministic policy code decides whether the project is allowed and what it maps to.

This also avoids the much worse pattern of allowing a model to rewrite your primary Compose file or request arbitrary `/home/gp`, `/`, `/etc`, Docker sockets, SSH keys, etc.


## Current architecture-specific notes

Your existing `open-terminal` service has two mounts:

```text
open-terminal:/home/gp
/home/gp/Code:/home/gp/CodeWorkspace/
```

V1 does not change either one. This means an Open WebUI model using Open Terminal still sees its existing container filesystem. It does NOT see arbitrary host paths such as `/home/gp/Downloads/openwebui`.

When Open WebUI calls `ask_opencode_agent` with a real host directory, only host OpenCode receives that directory. OpenCode can inspect it because OpenCode itself is running on the host. The response comes back through the Context Hub.

That separation is intentional and is the basis for the V2 project-mount layer.
