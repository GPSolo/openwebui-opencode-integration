# v1 vs v2

| Capability | v1 | v2 design |
|---|---|---|
| Open WebUI conversation history | Yes | Same |
| OpenCode conversation history | Yes | Same |
| Shared memory | Yes | Same |
| Shared project decisions | Yes | Same |
| Open WebUI model -> OpenCode | Yes | Yes |
| OpenCode -> Open WebUI model | Yes | Yes |
| Existing Open WebUI Knowledge Base search | Yes | Yes |
| OpenCode sees host projects | Yes, through host path passed to OpenCode | Yes |
| Open WebUI terminal sees same project | No | Yes |
| Changes open-terminal mounts | No | Controlled registry/override |
| AI decides filesystem permissions | No | No |
| Arbitrary host path accepted | v1 tool accepts a path for delegation; recommended deployment should constrain usage | No; project IDs only |

The important architectural boundary is that conversation sharing does not require filesystem sharing.
