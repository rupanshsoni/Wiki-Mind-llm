#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js"
import {
  WikiMindApiClient,
  type ApiFileNode,
  type ApiGraphNode,
  type ApiReviewItem,
  type ApiReviewsResponse,
  type ApiChatResponse,
  type ApiSearchResult,
} from "./api-client.js"
import { VERSION } from "./version.js"

const DEFAULT_PROJECT_ID = "current"
const MAX_TEXT_BYTES = 120_000

const GUIDE_TEXT = `# WikiMind Guide

You are connected to a WikiMind workspace. WikiMind compiles and maintains structured wiki pages from raw source documents with autonomous continuous auditing.

## Architecture

1. **Raw Sources** (path: \`raw/sources/\`) — Source documents (PDFs, transcripts, markdown files, etc.). Read-only.
2. **Compiled Wiki** (path: \`wiki/\`) — Markdown pages containing concepts and entities.
3. **Claims** (path: \`wiki/claims/\`) — Atomic factual claims extracted from wiki pages.
4. **Contradictions** (path: \`wiki/contradictions/\`) — Conflicting claims detected by an ensemble of LLM judges.
5. **Log** (path: \`wiki/log.md\`) — Chronological record of all updates, ingests, and lint passes.

## Page Categories & Standards

### Concepts (\`wiki/concepts/\`)
Abstract ideas, methods, frameworks (e.g., \`wiki/concepts/scaling-laws.md\`).

### Entities (\`wiki/entities/\`)
Concrete things, companies, papers, systems (e.g., \`wiki/entities/lancedb.md\`).

### Formatting & Metadata
All wiki pages MUST start with a YAML frontmatter block containing:
- \`title\`: Page title
- \`date\`: Last updated date (YYYY-MM-DD)
- \`tags\`: Array of relevant categories
- \`sources\`: Array of source file paths

Outlinks must be formatted as wiki links: \`[[slug]]\` or \`[[slug|Label]]\`.

## Confidence Decay & Maintenance
Claims carry a confidence score that decays over time based on domain volatility:
- **Fresh**: Recently verified claims.
- **Aging**: Approaching decay threshold.
- **Stale**: Requires validation.
- **Decayed**: Confidence has dropped below active threshold; must be re-evaluated.
`

const client = new WikiMindApiClient()

const server = new Server(
  { name: "wikimind", version: VERSION },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "wikimind_status",
      description: "Check whether the WikiMind desktop local API is reachable and list the current project.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_projects",
      description: "List known WikiMind projects. The response includes currentProject when the desktop app has an active project.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_files",
      description: "List files from a project using the desktop app's API permissions. project_id may be a UUID, filesystem path, or 'current'.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          root: { type: "string", enum: ["wiki", "sources", "all"], description: "Tree root to list. Defaults to wiki." },
          recursive: { type: "boolean", description: "Whether to list recursively. Defaults to true." },
          max_files: { type: "number", description: "Maximum files returned by the local API. Max 10000." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_read_file",
      description: "Read a text file from a project through the desktop app API. Only public project paths such as wiki/ and raw/sources/ are allowed by the API.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          path: { type: "string", description: "Project-relative file path, for example wiki/index.md." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_reviews",
      description: "List Review tab items from a project. Defaults to unresolved items so agent clients can help manage pending wiki review work.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          status: { type: "string", enum: ["unresolved", "resolved", "all"], description: "Review status filter. Defaults to unresolved." },
          type: { type: "string", description: "Optional Review item type filter, for example missing-page, duplicate, contradiction, confirm, or suggestion." },
          limit: { type: "number", description: "Maximum review items returned. The local API clamps to its configured maximum." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_search",
      description: "Search a project using the same backend keyword/vector retrieval used by the desktop API.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          query: { type: "string", description: "Search query." },
          top_k: { type: "number", description: "Maximum results. The local API clamps to its configured maximum." },
          include_content: { type: "boolean", description: "Include full page content in results when supported by the API." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_chat",
      description: "Ask the WikiMind backend Agent a question about a project. This initial backend Agent uses the desktop API's shared retrieval service and returns references.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          message: { type: "string", description: "User message or question." },
          session_id: { type: "string", description: "Optional caller-managed session id." },
          mode: { type: "string", enum: ["fast", "standard", "deep", "local_first"], description: "Agent mode. Defaults to standard." },
          top_k: { type: "number", description: "Maximum wiki references to retrieve. The API clamps to its configured maximum." },
          include_content: { type: "boolean", description: "Include full page content in retrieval when supported by the API. Defaults to false." },
          wiki: { type: "boolean", description: "Enable wiki retrieval. Defaults to true." },
          web: { type: "boolean", description: "Enable backend web.search when the Agent router decides external search is useful. Defaults to false." },
          anytxt: { type: "boolean", description: "Enable backend anytxt.search for source/local-file questions when AnyTXT is configured. Defaults to false." },
          skills: {
            type: "array",
            items: { type: "string" },
            description: "Optional project skills to inject from .wikimind/skills.",
          },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_graph",
      description: "Query the project knowledge graph through the desktop app API.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          q: { type: "string", description: "Optional text filter." },
          node_type: { type: "string", description: "Optional node type filter." },
          limit: { type: "number", description: "Maximum nodes. The local API clamps to its configured maximum." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_rescan_sources",
      description: "Trigger the desktop app's source folder rescan for a project, using the user's Source Watch rules.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_guide",
      description: "Get the comprehensive user guide detailing concepts, entities, claims, decay mechanics, and structural rules.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_create",
      description: "Create a new wiki page or file with validation.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          path: { type: "string", description: "Project-relative file path, for example wiki/concepts/attention.md." },
          content: { type: "string", description: "Markdown content to write." },
          overwrite: { type: "boolean", description: "Whether to overwrite if file exists. Defaults to false." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_edit",
      description: "Modify an existing file with exact-text string replacement validation.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          path: { type: "string", description: "Project-relative file path, for example wiki/concepts/attention.md." },
          old_text: { type: "string", description: "The exact content sequence to find and replace." },
          new_text: { type: "string", description: "The replacement content." },
        },
        required: ["path", "old_text", "new_text"],
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_append",
      description: "Append content to a wiki page, preserving footnote definitions at EOF.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          path: { type: "string", description: "Project-relative file path, for example wiki/concepts/attention.md." },
          content: { type: "string", description: "Content to append." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_delete",
      description: "Safely delete a wiki page.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          path: { type: "string", description: "Project-relative file path to delete." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_lint",
      description: "Run hygiene and structural check audits on wiki content (orphans, broken links, dead-ends).",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_claims",
      description: "List knowledge vault claims filterable by decay freshness state.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          state: { type: "string", enum: ["fresh", "aging", "stale", "decayed"], description: "Freshness state filter." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_contradictions",
      description: "List unresolved contradictory disputes detected by the judge voter ensemble.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          status: { type: "string", enum: ["open", "under_review", "resolved", "escalated"], description: "Status filter." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_decay_status",
      description: "Get vault-wide statistics and metrics of claim confidence decay.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_maintenance_log",
      description: "Get recent logs of scheduled maintenance audits and job resolutions.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_youtube_ingest",
      description: "Fetch YouTube video transcript and ingest it to the wiki.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          url: { type: "string", description: "YouTube URL (watch?v=, Shorts, etc.)." },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "wikimind_github_ingest",
      description: "Clone GitHub repository documentation and ingest it to the wiki.",
      inputSchema: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "Project UUID, project path, or 'current'. Defaults to current." },
          url: { type: "string", description: "GitHub URL." },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = asObject(request.params.arguments ?? {})
  try {
    switch (request.params.name) {
      case "wikimind_status": {
        const [health, projects] = await Promise.all([
          client.health(),
          client.projects().catch(() => ({ projects: [], currentProject: null })),
        ])
        return textResult(JSON.stringify({ ...health, ...projects }, null, 2))
      }
      case "wikimind_projects": {
        await assertMcpEnabled()
        return textResult(JSON.stringify(await client.projects(), null, 2))
      }
      case "wikimind_files": {
        await assertMcpEnabled()
        const response = await client.files(projectId(args), {
          root: enumArg(args.root, ["wiki", "sources", "all"] as const, "wiki"),
          recursive: boolArg(args.recursive, true),
          maxFiles: numberArg(args.max_files),
        })
        return textResult(formatFileTree(response.files, response.truncated))
      }
      case "wikimind_read_file": {
        await assertMcpEnabled()
        const relPath = stringArg(args.path, "path")
        const { path, content } = await client.fileContent(projectId(args), relPath)
        return textResult(`# ${path}\n\n${truncateText(content, MAX_TEXT_BYTES)}`)
      }
      case "wikimind_reviews": {
        await assertMcpEnabled()
        const reviews = await client.reviews(projectId(args), {
          status: enumArg(args.status, ["unresolved", "resolved", "all"] as const, "unresolved"),
          type: optionalStringArg(args.type),
          limit: numberArg(args.limit),
        })
        return textResult(formatReviews(reviews))
      }
      case "wikimind_search": {
        await assertMcpEnabled()
        const query = stringArg(args.query, "query")
        const search = await client.search(projectId(args), query, {
          topK: numberArg(args.top_k),
          includeContent: boolArg(args.include_content, false),
        })
        return textResult(formatSearchResults(query, search))
      }
      case "wikimind_chat": {
        await assertMcpEnabled()
        const message = stringArg(args.message, "message")
        const chat = await client.chat(projectId(args), message, {
          sessionId: optionalStringArg(args.session_id),
          mode: enumArg(args.mode, ["fast", "standard", "deep", "local_first"] as const, "standard"),
          topK: numberArg(args.top_k),
          includeContent: boolArg(args.include_content, false),
          wiki: boolArg(args.wiki, true),
          web: boolArg(args.web, false),
          anytxt: boolArg(args.anytxt, false),
          skills: stringArrayArg(args.skills),
          persistSession: optionalStringArg(args.session_id) !== undefined,
        })
        return textResult(formatChatResponse(chat))
      }
      case "wikimind_graph": {
        await assertMcpEnabled()
        const graph = await client.graph(projectId(args), {
          q: optionalStringArg(args.q),
          nodeType: optionalStringArg(args.node_type),
          limit: numberArg(args.limit),
        })
        return textResult(formatGraph(graph.nodes, graph.edges))
      }
      case "wikimind_rescan_sources": {
        await assertMcpEnabled()
        return textResult(JSON.stringify(await client.rescan(projectId(args)), null, 2))
      }
      case "wikimind_guide": {
        return textResult(GUIDE_TEXT)
      }
      case "wikimind_create": {
        await assertMcpEnabled()
        const path = stringArg(args.path, "path")
        const content = stringArg(args.content, "content")
        const overwrite = boolArg(args.overwrite, false)
        if (!path.startsWith("wiki/") && !path.startsWith("raw/sources/")) {
          throw new McpError(ErrorCode.InvalidParams, "path must be inside wiki/ or raw/sources/")
        }
        if (path.startsWith("wiki/") && !content.startsWith("---")) {
          throw new McpError(ErrorCode.InvalidParams, "Wiki pages must start with YAML frontmatter metadata (--- block)")
        }
        const result = await client.createFile(projectId(args), path, content, overwrite)
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_edit": {
        await assertMcpEnabled()
        const path = stringArg(args.path, "path")
        const oldText = stringArg(args.old_text, "old_text")
        const newText = stringArg(args.new_text, "new_text")
        const file = await client.fileContent(projectId(args), path)
        const occurrences = file.content.split(oldText).length - 1
        if (occurrences === 0) {
          throw new McpError(ErrorCode.InvalidParams, `old_text not found in file: ${path}`)
        }
        if (occurrences > 1) {
          throw new McpError(ErrorCode.InvalidParams, `old_text matches multiple occurrences (${occurrences}) in file: ${path}. Make it more specific.`)
        }
        const updated = file.content.replace(oldText, newText)
        const result = await client.createFile(projectId(args), path, updated, true)
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_append": {
        await assertMcpEnabled()
        const path = stringArg(args.path, "path")
        const appendContent = stringArg(args.content, "content")
        const file = await client.fileContent(projectId(args), path)
        const lines = file.content.split("\n")
        let footnoteStartIndex = lines.length
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i]
          if (line.trim().match(/^\[\^[a-zA-Z0-9_-]+\]:/)) {
            footnoteStartIndex = i
          } else if (line.trim() === "" && footnoteStartIndex < lines.length) {
            // skip
          } else if (footnoteStartIndex < lines.length) {
            break
          }
        }
        const body = lines.slice(0, footnoteStartIndex).join("\n").trim()
        const footnotes = lines.slice(footnoteStartIndex).join("\n").trim()
        const newBody = body + "\n\n" + appendContent.trim()
        const finalContent = footnotes ? newBody + "\n\n" + footnotes : newBody
        const result = await client.createFile(projectId(args), path, finalContent, true)
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_delete": {
        await assertMcpEnabled()
        const path = stringArg(args.path, "path")
        const result = await client.deleteFile(projectId(args), path)
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_claims": {
        await assertMcpEnabled()
        const state = optionalStringArg(args.state)
        const result = await client.claims(projectId(args), state)
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_contradictions": {
        await assertMcpEnabled()
        const status = optionalStringArg(args.status)
        const result = await client.contradictions(projectId(args), status)
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_decay_status": {
        await assertMcpEnabled()
        const result = await client.decayStatus(projectId(args))
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_maintenance_log": {
        await assertMcpEnabled()
        const result = await client.maintenanceLog(projectId(args))
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_youtube_ingest": {
        await assertMcpEnabled()
        const url = stringArg(args.url, "url")
        const result = await client.ingestYoutube(projectId(args), url)
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_github_ingest": {
        await assertMcpEnabled()
        const url = stringArg(args.url, "url")
        const result = await client.ingestGithub(projectId(args), url)
        return textResult(JSON.stringify(result, null, 2))
      }
      case "wikimind_lint": {
        await assertMcpEnabled()
        const filesResponse = await client.files(projectId(args), { root: "wiki", recursive: true })
        const mdFiles: string[] = []
        const flatten = (nodes: ApiFileNode[]) => {
          for (const node of nodes) {
            if (!node.isDir && node.path.endsWith(".md")) {
              mdFiles.push(node.path)
            }
            if (node.children) flatten(node.children)
          }
        }
        flatten(filesResponse.files)
        const pages: Array<{ path: string; title: string; content: string; outlinks: string[]; slug: string; hasFrontmatter: boolean }> = []
        for (const file of mdFiles) {
          try {
            const { content } = await client.fileContent(projectId(args), file)
            let slug = file
            if (slug.startsWith("wiki/")) slug = slug.slice(5)
            if (slug.endsWith(".md")) slug = slug.slice(0, -3)
            slug = slug.toLowerCase().replace(/\\/g, "/")
            const hasFrontmatter = content.startsWith("---")
            let title = ""
            if (hasFrontmatter) {
              const lines = content.split("\n")
              for (const line of lines) {
                if (line.startsWith("title:")) {
                  title = line.slice(6).trim().replace(/['"]/g, "")
                  break
                }
              }
            }
            if (!title) {
              title = file.split("/").pop()?.replace(".md", "") || file
            }
            const outlinks: string[] = []
            const wikiRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
            let m
            while ((m = wikiRegex.exec(content)) !== null) {
              const target = m[1].trim().toLowerCase().replace(/\s+/g, "-")
              outlinks.push(target)
            }
            pages.push({ path: file, title, content, outlinks, slug, hasFrontmatter })
          } catch {
            // skip
          }
        }
        const warnings: Array<{ type: string; path: string; message: string }> = []
        const allSlugs = new Set(pages.map(p => p.slug))
        const allTitles = new Set(pages.map(p => p.title.toLowerCase().replace(/\s+/g, "-")))
        const targetedSlugs = new Set<string>()
        for (const page of pages) {
          for (const link of page.outlinks) {
            targetedSlugs.add(link)
          }
        }
        for (const page of pages) {
          if (!page.hasFrontmatter) {
            warnings.push({
              type: "missing_frontmatter",
              path: page.path,
              message: "Page is missing YAML frontmatter block",
            })
          } else {
            const hasTitle = page.content.includes("title:")
            const hasDate = page.content.includes("date:")
            const hasTags = page.content.includes("tags:")
            const hasSources = page.content.includes("sources:")
            if (!hasTitle || !hasDate || !hasTags || !hasSources) {
              const missing: string[] = []
              if (!hasTitle) missing.push("title")
              if (!hasDate) missing.push("date")
              if (!hasTags) missing.push("tags")
              if (!hasSources) missing.push("sources")
              warnings.push({
                type: "missing_metadata_keys",
                path: page.path,
                message: `Frontmatter is missing required keys: ${missing.join(", ")}`,
              })
            }
          }
          const isSpecial = page.path.includes("log.md") || page.path.includes("index.md") || page.path.includes("overview.md") || page.path.includes("claims/") || page.path.includes("contradictions/")
          if (page.outlinks.length === 0 && !isSpecial) {
            warnings.push({
              type: "dead_end",
              path: page.path,
              message: "Page has no outbound wiki links (dead-end)",
            })
          }
          for (const link of page.outlinks) {
            const matchesAny = allSlugs.has(link) || 
                               allSlugs.has(`concepts/${link}`) || 
                               allSlugs.has(`entities/${link}`) || 
                               allTitles.has(link)
            if (!matchesAny) {
              warnings.push({
                type: "broken_link",
                path: page.path,
                message: `Outbound link [[${link}]] target does not exist`,
              })
            }
          }
          if (!isSpecial && !targetedSlugs.has(page.slug) && !targetedSlugs.has(page.title.toLowerCase().replace(/\s+/g, "-"))) {
            warnings.push({
              type: "orphan",
              path: page.path,
              message: "Page has no inbound links from other pages (orphan)",
            })
          }
        }
        return textResult(JSON.stringify({ total: warnings.length, warnings }, null, 2))
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`)
    }
  } catch (err) {
    if (err instanceof McpError) throw err
    throw new McpError(
      ErrorCode.InternalError,
      err instanceof Error ? err.message : String(err),
    )
  }
})

async function assertMcpEnabled(): Promise<void> {
  const health = await client.health()
  if (health.mcpEnabled === false) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "WikiMind MCP access is disabled. Enable Settings -> API + MCP -> Enable MCP access in the desktop app.",
    )
  }
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function projectId(args: Record<string, unknown>): string {
  return optionalStringArg(args.project_id) ?? DEFAULT_PROJECT_ID
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new McpError(ErrorCode.InvalidParams, `${name} is required`)
  }
  return value
}

function optionalStringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function boolArg(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function enumArg<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback
}

function stringArrayArg(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
}

function truncateText(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8")
  if (bytes <= maxBytes) return value
  let out = ""
  let used = 0
  for (const ch of value) {
    const size = Buffer.byteLength(ch, "utf8")
    if (used + size > maxBytes) break
    out += ch
    used += size
  }
  return `${out}\n\n[truncated: ${bytes - used} bytes omitted]`
}

function formatFileTree(files: ApiFileNode[], truncated = false): string {
  if (files.length === 0) return "No files found."
  const lines: string[] = truncated
    ? ["[warning] File tree was truncated by the LLM Wiki API maxFiles limit.", ""]
    : []
  const walk = (nodes: ApiFileNode[], depth: number) => {
    for (const node of nodes) {
      const prefix = "  ".repeat(depth)
      lines.push(`${prefix}${node.isDir ? "📁" : "📄"} ${node.path}`)
      if (node.children) walk(node.children, depth + 1)
    }
  }
  walk(files, 0)
  return lines.join("\n")
}

function formatSearchResults(query: string, search: { results: ApiSearchResult[]; mode?: string; tokenHits?: number; vectorHits?: number }): string {
  const { results } = search
  if (results.length === 0) return `No results for "${query}".`
  const meta = [
    search.mode ? `Mode: ${search.mode}` : null,
    typeof search.tokenHits === "number" ? `Token hits: ${search.tokenHits}` : null,
    typeof search.vectorHits === "number" ? `Vector hits: ${search.vectorHits}` : null,
  ].filter(Boolean)
  const lines = [`# Search results for "${query}"`, ...(meta.length > 0 ? [meta.join(" | ")] : []), ""]
  results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${result.title}`)
    lines.push(`Path: ${result.path}`)
    lines.push(`Score: ${result.score.toFixed(6)}${typeof result.vectorScore === "number" ? ` | Vector score: ${result.vectorScore.toFixed(6)}` : ""}`)
    if (result.snippet) lines.push(`Snippet: ${result.snippet}`)
    if (result.images && result.images.length > 0) {
      lines.push(`Images: ${result.images.map((image) => image.url).join(", ")}`)
    }
    lines.push("")
  })
  return lines.join("\n")
}

function formatChatResponse(chat: ApiChatResponse): string {
  const lines = [
    "# LLM Wiki Agent response",
    "",
    `Session: ${chat.sessionId || "(none)"}`,
    chat.mode ? `Mode: ${chat.mode}` : null,
    chat.projectId ? `Project: ${chat.projectId}` : null,
    chat.usage
      ? `Usage: promptChars=${chat.usage.promptChars ?? 0}, completionChars=${chat.usage.completionChars ?? 0}, references=${chat.usage.referenceCount ?? chat.references.length}`
      : null,
    "",
    chat.message.content || "(empty response)",
    "",
  ].filter((line): line is string => line !== null)

  if (chat.references.length > 0) {
    lines.push("## References")
    chat.references.forEach((reference, index) => {
      lines.push(`${index + 1}. ${reference.title || reference.path}`)
      lines.push(`   Kind: ${reference.kind}`)
      lines.push(`   Path: ${reference.path}`)
      if (typeof reference.score === "number") lines.push(`   Score: ${reference.score.toFixed(6)}`)
      if (reference.snippet) lines.push(`   Snippet: ${reference.snippet}`)
    })
    lines.push("")
  }

  if (chat.toolEvents.length > 0) {
    lines.push("## Tool events")
    chat.toolEvents.forEach((event) => {
      lines.push(`- ${event.tool}: ${event.status}${event.detail ? ` (${event.detail})` : ""}`)
    })
  }

  return lines.join("\n")
}

function formatReviews(response: ApiReviewsResponse): string {
  const { reviews } = response
  if (reviews.length === 0) return `No ${response.status} review items found.`
  const lines = [
    "# Review items",
    "",
    `Status: ${response.status}`,
    `Count: ${response.count}`,
    "",
  ]
  reviews.forEach((review, index) => {
    lines.push(`## ${index + 1}. ${review.title || review.id}`)
    lines.push(`ID: ${review.id}`)
    lines.push(`Type: ${review.type}`)
    lines.push(`Resolved: ${review.resolved ? "yes" : "no"}`)
    if (review.sourcePath) lines.push(`Source: ${review.sourcePath}`)
    if (review.affectedPages && review.affectedPages.length > 0) {
      lines.push(`Affected pages: ${review.affectedPages.join(", ")}`)
    }
    if (review.searchQueries && review.searchQueries.length > 0) {
      lines.push(`Search queries: ${review.searchQueries.join(", ")}`)
    }
    if (review.description) lines.push(`Description: ${review.description}`)
    const optionSummary = formatReviewOptions(review)
    if (optionSummary) lines.push(`Options: ${optionSummary}`)
    lines.push("")
  })
  return lines.join("\n")
}

function formatReviewOptions(review: ApiReviewItem): string {
  if (!review.options || review.options.length === 0) return ""
  return review.options
    .map((option) => option.label ? `${option.label} (${option.action})` : option.action)
    .join(", ")
}

function formatGraph(nodes: ApiGraphNode[], edges: Array<{ source: string; target: string; weight?: number }>): string {
  const typeCounts = new Map<string, number>()
  for (const node of nodes) typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1)
  const lines = [
    "# Knowledge graph",
    "",
    `Nodes: ${nodes.length}`,
    `Edges: ${edges.length}`,
    "",
    "## Node types",
    ...[...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## Top nodes",
    ...nodes
      .slice()
      .sort((a, b) => (b.linkCount ?? 0) - (a.linkCount ?? 0))
      .slice(0, 30)
      .map((node) => `- ${node.label} (${node.type}, ${node.linkCount ?? 0} links)${node.path ? ` — ${node.path}` : ""}`),
  ]
  return lines.join("\n")
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`WikiMind MCP server v${VERSION} connected to ${process.env.WIKIMIND_API_BASE_URL ?? "http://127.0.0.1:19828"}`)
}

main().catch((err) => {
  console.error("Failed to start WikiMind MCP server:", err)
  process.exit(1)
})
