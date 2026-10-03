/**
 * Global OpenCode plugin for AI Context Hub v1.
 *
 * It deliberately does NOT mount or expose any Open WebUI filesystem.
 * Its only job is to publish completed OpenCode session IDs + their host
 * working directories to the Context Hub, which then reads the transcript
 * through OpenCode's HTTP API.
 */

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const ENV_FILE = join(homedir(), ".config", "opencode", "context-hub.env")
const HUB_URL = process.env.CONTEXT_HUB_URL ?? "http://127.0.0.1:8765"

function loadToken(): string {
  const fromProcess = process.env.CONTEXT_HUB_TOKEN
  if (fromProcess) return fromProcess
  try {
    const text = readFileSync(ENV_FILE, "utf8")
    const line = text.split(/\r?\n/).find((entry) => entry.startsWith("CONTEXT_HUB_TOKEN="))
    return line?.slice("CONTEXT_HUB_TOKEN=".length).trim() ?? ""
  } catch {
    return ""
  }
}

export const ContextHubPlugin = async ({ directory, client }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return
      const hubToken = loadToken()
      if (!hubToken) return

      const sessionID = event.properties?.sessionID
      if (!sessionID) return

      try {
        // The hub owns transcript retrieval. That keeps the plugin tiny and
        // means OpenCode session schema changes are isolated to the hub.
        const response = await fetch(`${HUB_URL}/internal/ingest/opencode`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${hubToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            session_id: sessionID,
            directory,
          }),
        })

        if (!response.ok) {
          const body = await response.text()
          await client.app.log({
            body: {
              service: "context-hub",
              level: "warn",
              message: `Context Hub sync failed (${response.status})`,
              extra: { sessionID, body },
            },
          })
        }
      } catch (error) {
        await client.app.log({
          body: {
            service: "context-hub",
            level: "warn",
            message: "Context Hub sync request failed",
            extra: { sessionID, error: String(error) },
          },
        })
      }
    },
  }
}
