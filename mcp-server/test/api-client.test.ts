import assert from "node:assert/strict"
import { test } from "node:test"
import { WikiMindApiClient, normalizeBaseUrl } from "../src/api-client.js"

test("normalizeBaseUrl trims trailing slashes and falls back to localhost", () => {
  assert.equal(normalizeBaseUrl("http://127.0.0.1:19828///"), "http://127.0.0.1:19828")
  assert.equal(normalizeBaseUrl(""), "http://127.0.0.1:19828")
})

test("projects sends bearer token and parses current project", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({
      ok: true,
      projects: [{ id: "p1", name: "Demo", path: "/tmp/demo", current: true }],
      currentProject: { id: "p1", name: "Demo", path: "/tmp/demo", current: true },
    }), { status: 200 })
  }

  const client = new WikiMindApiClient({
    baseUrl: "http://localhost:19828/",
    token: "secret",
    fetchImpl,
  })
  const result = await client.projects()

  assert.equal(calls[0]?.url, "http://localhost:19828/api/v1/projects")
  assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, "Bearer secret")
  assert.equal(result.currentProject?.id, "p1")
  assert.equal(result.projects[0]?.current, true)
})

test("health does not send authorization", async () => {
  const calls: Array<RequestInit | undefined> = []
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push(init)
    return new Response(JSON.stringify({ ok: true, status: "running" }), { status: 200 })
  }

  const client = new WikiMindApiClient({ token: "secret", fetchImpl })
  await client.health()

  assert.equal((calls[0]?.headers as Record<string, string> | undefined)?.Authorization, undefined)
})

test("search posts JSON body to current project", async () => {
  let body = ""
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    body = String(init?.body ?? "")
    return new Response(JSON.stringify({
      ok: true,
      mode: "hybrid",
      tokenHits: 2,
      vectorHits: 1,
      results: [{ path: "wiki/a.md", title: "A", snippet: "hit", score: 0.5, vectorScore: 0.9 }],
    }), { status: 200 })
  }

  const client = new WikiMindApiClient({ fetchImpl })
  const results = await client.search("current", "query", { topK: 3, includeContent: true })

  assert.deepEqual(JSON.parse(body), { query: "query", topK: 3, includeContent: true })
  assert.equal(results.mode, "hybrid")
  assert.equal(results.tokenHits, 2)
  assert.equal(results.vectorHits, 1)
  assert.equal(results.results[0]?.vectorScore, 0.9)
})

test("chat posts agent request and parses references", async () => {
  let url = ""
  let body = ""
  const fetchImpl = async (requestUrl: string | URL | Request, init?: RequestInit): Promise<Response> => {
    url = String(requestUrl)
    body = String(init?.body ?? "")
    return new Response(JSON.stringify({
      ok: true,
      projectId: "p1",
      sessionId: "s1",
      mode: "standard",
      message: { role: "assistant", content: "answer" },
      references: [{ title: "A", path: "wiki/a.md", kind: "wiki", snippet: "hit", score: 0.5 }],
      toolEvents: [{ tool: "wiki.search", status: "completed", detail: "1 result" }],
      events: [{ type: "toolEnd", tool: "wiki.search" }],
      usage: { promptChars: 100, completionChars: 6, referenceCount: 1, toolEventCount: 1 },
    }), { status: 200 })
  }

  const client = new WikiMindApiClient({ baseUrl: "http://localhost:19828", fetchImpl })
  const response = await client.chat("current", "question", {
    sessionId: "s1",
    mode: "standard",
    topK: 4,
    includeContent: true,
    wiki: true,
    web: false,
    anytxt: true,
    skills: ["reviewer"],
  })

  assert.equal(url, "http://localhost:19828/api/v1/projects/current/chat")
  assert.deepEqual(JSON.parse(body), {
    message: "question",
    sessionId: "s1",
    mode: "standard",
    topK: 4,
    includeContent: true,
    tools: { wiki: true, web: false, anytxt: true },
    skills: ["reviewer"],
  })
  assert.equal(response.sessionId, "s1")
  assert.equal(response.message.content, "answer")
  assert.equal(response.references[0]?.path, "wiki/a.md")
  assert.equal(response.toolEvents[0]?.tool, "wiki.search")
  assert.equal(response.events[0]?.type, "toolEnd")
  assert.equal(response.usage?.promptChars, 100)
})

test("cancelChat posts to the chat cancellation endpoint", async () => {
  let url = ""
  let method = ""
  const fetchImpl = async (requestUrl: string | URL | Request, init?: RequestInit): Promise<Response> => {
    url = String(requestUrl)
    method = String(init?.method ?? "")
    return new Response(JSON.stringify({
      ok: true,
      sessionId: "s1",
      cancelled: true,
    }), { status: 200 })
  }

  const client = new WikiMindApiClient({ baseUrl: "http://localhost:19828", fetchImpl })
  const response = await client.cancelChat("current", "s1")

  assert.equal(url, "http://localhost:19828/api/v1/projects/current/chat/s1/cancel")
  assert.equal(method, "POST")
  assert.deepEqual(response, { sessionId: "s1", cancelled: true })
})

test("graph parses nodeType from API graph nodes", async () => {
  const fetchImpl = async (): Promise<Response> => (
    new Response(JSON.stringify({
      ok: true,
      nodes: [{ id: "n1", label: "Node", nodeType: "concept", path: "wiki/concepts/n1.md", linkCount: 4 }],
      edges: [{ source: "n1", target: "n2", weight: 0.75 }],
    }), { status: 200 })
  )

  const client = new WikiMindApiClient({ fetchImpl })
  const graph = await client.graph("current")

  assert.equal(graph.nodes[0]?.type, "concept")
  assert.equal(graph.nodes[0]?.linkCount, 4)
  assert.equal(graph.edges[0]?.weight, 0.75)
})

test("files exposes truncated flag", async () => {
  const fetchImpl = async (): Promise<Response> => (
    new Response(JSON.stringify({
      ok: true,
      files: [{ name: "index.md", path: "wiki/index.md", isDir: false }],
      truncated: true,
    }), { status: 200 })
  )

  const client = new WikiMindApiClient({ fetchImpl })
  const files = await client.files("current")

  assert.equal(files.truncated, true)
  assert.equal(files.files[0]?.path, "wiki/index.md")
})

test("reviews requests unresolved review items with filters", async () => {
  const calls: string[] = []
  const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
    calls.push(String(url))
    return new Response(JSON.stringify({
      ok: true,
      projectId: "p1",
      status: "unresolved",
      count: 1,
      reviews: [{
        id: "r1",
        type: "missing-page",
        title: "Missing page: Attention",
        description: "Add the Attention page",
        options: [],
        resolved: false,
        createdAt: 1,
      }],
    }), { status: 200 })
  }

  const client = new WikiMindApiClient({ baseUrl: "http://localhost:19828", fetchImpl })
  const result = await client.reviews("current", {
    status: "unresolved",
    type: "missing-page",
    limit: 5,
  })

  assert.equal(calls[0], "http://localhost:19828/api/v1/projects/current/reviews?status=unresolved&type=missing-page&limit=5")
  assert.equal(result.status, "unresolved")
  assert.equal(result.count, 1)
  assert.equal(result.reviews[0]?.id, "r1")
  assert.equal(result.reviews[0]?.resolved, false)
})

test("network failures include desktop app hint", async () => {
  const fetchImpl = async (): Promise<Response> => {
    throw new Error("ECONNREFUSED")
  }

  const client = new WikiMindApiClient({ fetchImpl })
  await assert.rejects(() => client.projects(), /Is the desktop app running\? ECONNREFUSED/)
})

test("non-JSON responses include status and body preview", async () => {
  const fetchImpl = async (): Promise<Response> => (
    new Response("not json", { status: 502, statusText: "Bad Gateway" })
  )

  const client = new WikiMindApiClient({ fetchImpl })
  await assert.rejects(() => client.projects(), /non-JSON response \(502\): not json/)
})

test("API errors include status and server message", async () => {
  const fetchImpl = async (): Promise<Response> => (
    new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 })
  )

  const client = new WikiMindApiClient({ fetchImpl })
  await assert.rejects(() => client.projects(), /WikiMind API 401: Unauthorized/)
})

test("createFile sends POST payload and parses response", async () => {
  let body = ""
  let url = ""
  const fetchImpl = async (requestUrl: string | URL | Request, init?: RequestInit): Promise<Response> => {
    url = String(requestUrl)
    body = String(init?.body ?? "")
    return new Response(JSON.stringify({ ok: true, path: "wiki/concepts/attention.md" }), { status: 200 })
  }

  const client = new WikiMindApiClient({ fetchImpl })
  const result = await client.createFile("current", "wiki/concepts/attention.md", "hello", true)

  assert.equal(url, "http://127.0.0.1:19828/api/v1/projects/current/files")
  assert.deepEqual(JSON.parse(body), { path: "wiki/concepts/attention.md", content: "hello", overwrite: true })
  assert.equal(result.ok, true)
  assert.equal(result.path, "wiki/concepts/attention.md")
})

test("deleteFile sends DELETE payload and parses response", async () => {
  let body = ""
  let url = ""
  let method = ""
  const fetchImpl = async (requestUrl: string | URL | Request, init?: RequestInit): Promise<Response> => {
    url = String(requestUrl)
    body = String(init?.body ?? "")
    method = init?.method ?? ""
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  const client = new WikiMindApiClient({ fetchImpl })
  const result = await client.deleteFile("current", "wiki/concepts/attention.md")

  assert.equal(url, "http://127.0.0.1:19828/api/v1/projects/current/files")
  assert.equal(method, "DELETE")
  assert.deepEqual(JSON.parse(body), { path: "wiki/concepts/attention.md" })
  assert.equal(result.ok, true)
})

test("claims parses list of claims", async () => {
  let url = ""
  const fetchImpl = async (requestUrl: string | URL | Request): Promise<Response> => {
    url = String(requestUrl)
    return new Response(JSON.stringify({ claims: [{ title: "claim1", confidence: 0.8 }] }), { status: 200 })
  }

  const client = new WikiMindApiClient({ fetchImpl })
  const result = await client.claims("current", "fresh")

  assert.equal(url, "http://127.0.0.1:19828/api/v1/projects/current/claims?state=fresh")
  assert.equal(result[0].title, "claim1")
})

test("ingestYoutube sends POST payload and parses response", async () => {
  let body = ""
  let url = ""
  const fetchImpl = async (requestUrl: string | URL | Request, init?: RequestInit): Promise<Response> => {
    url = String(requestUrl)
    body = String(init?.body ?? "")
    return new Response(JSON.stringify({ ok: true, path: "raw/sources/youtube_123.md" }), { status: 200 })
  }

  const client = new WikiMindApiClient({ fetchImpl })
  const result = await client.ingestYoutube("current", "https://youtube.com/watch?v=123")

  assert.equal(url, "http://127.0.0.1:19828/api/v1/projects/current/ingest/youtube")
  assert.deepEqual(JSON.parse(body), { url: "https://youtube.com/watch?v=123" })
  assert.equal(result.ok, true)
  assert.equal(result.path, "raw/sources/youtube_123.md")
})

