# AI Context Hub v2 — controlled working-directory sharing

This file is intentionally a design document only. v2 is NOT installed by the current package.

## Goal

Make a project appear at a stable path inside `open-terminal` while OpenCode continues to use the real host path.

Example:

```text
Host / OpenCode:
  /home/gp/Code/Python/Website-Code

Open WebUI open-terminal:
  /workspace/projects/website
```

## Do not let an LLM authorize mounts

The model should never be allowed to rewrite the main Compose file or request an arbitrary Docker bind mount.

Use a deterministic registry owned by the user:

```yaml
projects:
  website:
    host_root: /home/gp/Code/Python/Website-Code
    terminal_root: /workspace/projects/website
    mode: read_write

  openwebui:
    host_root: /home/gp/Downloads/openwebui
    terminal_root: /workspace/projects/openwebui
    mode: read_write
```

The model can request `project_id: website`; policy code decides whether that ID exists and what it maps to.

## Why a project ID is better than a path

A raw path gives the model a way to turn a prompt into an arbitrary host-file request. A project ID creates a closed set of resources.

The bridge should reject:

```text
/home/gp
/
/etc
/var/lib/docker
~/.ssh
/dev
```

unless the user explicitly registers a path as a project.

## Recommended implementation

1. Keep the existing `open-terminal` service as the long-lived container.
2. Maintain a generated Compose override, such as `docker-compose.context-projects.yml`.
3. For an approved project, add exactly one bind mount:

```yaml
services:
  open-terminal:
    volumes:
      - /home/gp/Code/Python/Website-Code:/workspace/projects/website:rw
```

4. Validate every requested host root against the registry before writing the override.
5. Never mount `/var/run/docker.sock` into Open Terminal just to implement this.
6. Restart/recreate only `open-terminal` when the mount set changes.
7. Keep the Context Hub itself independent of project mounts.

## Synchronization model

The Context Hub should expose:

```text
list_projects()
get_project(project_id)
request_project_access(project_id, mode)
```

The first two can be read-only. `request_project_access` should be a policy-gated action.

## Future path aliasing

The Context Hub can tell agents:

```text
project_id=website
host_root=/home/gp/Code/Python/Website-Code
terminal_root=/workspace/projects/website
```

OpenCode uses `host_root`.
Open WebUI's terminal uses `terminal_root`.

This prevents a model from assuming that `/home/gp/Code/Python/Website-Code` exists inside the container.

## Conversation/knowledge remains unchanged

v2 should reuse the v1 Context Hub database and MCP tools. Working-directory management is a separate capability layered on top.
