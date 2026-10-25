import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

async function samePath(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const canonical = async (value) => fs.realpath(value).catch(() => path.resolve(value));
  return (await canonical(left)) === (await canonical(right));
}

// A conversation runs locally without navigating the Desktop UI. The process
// exits after its turn finishes, releasing the cross-process writer lock.
export class AppServerThreadClient {
  constructor({ cli, home, cwd, spawnProcess = spawn, timeoutMs = 30000, onNotice = () => {} }) {
    this.timeoutMs = timeoutMs;
    this.onNotice = onNotice;
    this.pending = new Map();
    this.approvals = new Map();
    this.loaded = new Set();
    this.active = new Map();
    this.closed = false;
    this.closing = false;
    this.failure = null;
    this.nextId = 0;
    const env = { ...process.env, CODEX_HOME: home };
    // Keep this client's identity stable when launched from another Codex task.
    delete env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
    this.child = spawnProcess(cli, ["app-server"], {
      cwd, env, stdio: ["pipe", "pipe", "pipe"]
    });
    this.exited = new Promise((resolve) => this.child.once("close", () => {
      this.closed = true;
      this.fail(new Error("Codex app-server connection closed."));
      resolve();
    }));
    this.child.on("error", (error) => this.fail(error));
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.stderr.resume();
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    this.child.stdout.on("data", (chunk) => {
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) {
        this.fail(new Error("Codex app-server response exceeded the size limit."));
        return;
      }
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error();
          this.handleMessage(message);
        } catch {
          this.fail(new Error("Codex app-server returned an invalid JSON response."));
          return;
        }
      }
    });
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    if (!this.closing) for (const id of this.active.keys()) this.onNotice(id, error.message);
    this.active.clear();
    this.loaded.clear();
    this.approvals.clear();
    if (!this.closed && !this.closing) void this.close();
  }

  write(message) {
    if (this.failure) throw this.failure;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Codex app-server ${method} timed out. Check the conversation before sending again.`);
        error.status = 504;
        reject(error);
        this.closeIfFinished();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  handleMessage(message) {
    if (message.method && message.id != null) {
      if (/^item\/(commandExecution|fileChange|permissions)\/requestApproval$/.test(message.method)) {
        this.approvals.set(String(message.id), { ...message, timestamp: new Date().toISOString() });
      } else {
        // Unsupported interactive tools receive an explicit error, never automatic approval.
        this.write({ id: message.id, error: { code: -32601, message: "This interaction is not supported by the LAN companion. Ask the user in a normal message." } });
      }
      return;
    }
    if (message.method) {
      const params = message.params || {};
      const id = params.threadId;
      if (message.method === "turn/started" && id) this.active.set(id, params.turn?.id);
      if (message.method === "serverRequest/resolved") this.approvals.delete(String(params.requestId));
      if (message.method === "turn/completed" && id) {
        this.active.delete(id);
        for (const [key, request] of this.approvals) if (request.params.threadId === id) this.approvals.delete(key);
        if (params.turn?.error?.message) this.onNotice(id, params.turn.error.message);
        // Unsubscribe alone retains the writer in current CLI builds.
        this.finished = true;
        this.closeIfFinished();
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(`Codex app-server: ${String(message.error.message || "request failed").slice(0, 500)}`));
    else pending.resolve(message.result);
    this.closeIfFinished();
  }

  closeIfFinished() {
    if (this.finished && !this.active.size && !this.pending.size) void this.close();
  }

  async initialize() {
    this.ready ||= this.request("initialize", {
      clientInfo: { name: "codex_lan_companion", version: "0.1.0" },
      capabilities: { experimentalApi: true }
    }).then(() => this.write({ method: "initialized" }));
    await this.ready;
  }

  async createThread({ cwd, workspaceRoots, projectId, title }) {
    await this.initialize();
    const result = await this.request("thread/start", {
      cwd,
      runtimeWorkspaceRoots: workspaceRoots,
      ...(projectId ? { projectId } : {}),
      threadSource: "user"
    });
    const threadId = result?.thread?.id || "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
      throw new Error("Codex app-server did not return a valid thread id.");
    }
    if (!(await samePath(result.cwd, cwd)) || !(await samePath(result.thread.cwd, cwd))) {
      throw new Error("Codex app-server did not preserve the selected working directory. No message was sent.");
    }
    if (projectId && result.thread.projectId !== projectId) {
      throw new Error("Codex app-server did not preserve the selected project assignment. No message was sent.");
    }
    const actualRoots = result.runtimeWorkspaceRoots;
    if (!Array.isArray(actualRoots) || actualRoots.length !== workspaceRoots.length
      || !(await Promise.all(workspaceRoots.map((root, index) => samePath(actualRoots[index], root)))).every(Boolean)) {
      throw new Error("Codex app-server did not preserve the selected workspace roots. No message was sent.");
    }
    // thread/start is lazy: naming it materializes the rollout before we disconnect.
    try { await this.request("thread/name/set", { threadId, name: title }); } catch (error) {
      error.threadId = threadId;
      throw error;
    }
    this.loaded.add(threadId);
    return { threadId };
  }

  async resumeThread(threadId) {
    await this.initialize();
    if (this.loaded.has(threadId)) return;
    await this.request("thread/resume", { threadId });
    this.loaded.add(threadId);
  }

  async startTurn(threadId, input, settings = {}) {
    await this.resumeThread(threadId);
    this.active.set(threadId, null);
    try {
      const result = await this.request("turn/start", { threadId, input, clientUserMessageId: randomUUID(), ...settings });
      if (this.active.has(threadId)) this.active.set(threadId, result.turn?.id);
      return result;
    } catch (error) {
      // A timeout can hide acceptance; keep the process alive for notifications.
      if (error.status !== 504) {
        this.active.delete(threadId);
        await this.close();
      }
      throw error;
    }
  }

  async interrupt(threadId) {
    const turnId = this.active.get(threadId);
    if (!turnId) throw Object.assign(new Error("No active turn found."), { status: 409 });
    await this.request("turn/interrupt", { threadId, turnId });
  }

  pendingApprovals(threadId) {
    return [...this.approvals.values()].filter((request) => request.params?.threadId === threadId);
  }

  respondToApproval(threadId, requestId, decision) {
    const request = this.approvals.get(String(requestId));
    if (!request || request.params?.threadId !== threadId) throw Object.assign(new Error("Approval request is no longer pending."), { status: 409 });
    if (!["accept", "decline", "acceptForSession"].includes(decision)) throw new Error("Unknown approval decision");
    const result = request.method === "item/permissions/requestApproval"
      ? { permissions: decision === "decline" ? {} : request.params.permissions, scope: decision === "acceptForSession" ? "session" : "turn" }
      : { decision };
    this.write({ id: request.id, result });
    this.approvals.delete(String(requestId));
  }

  async close() {
    if (this.closing) return this.exited;
    this.closing = true;
    this.child.stdin.end();
    const killTimer = setTimeout(() => { if (!this.closed) this.child.kill("SIGKILL"); }, 2000);
    await this.exited;
    clearTimeout(killTimer);
  }
}

export async function createAppServerThread(options, runtime = {}) {
  const client = new AppServerThreadClient({ ...options, ...runtime });
  try { return await client.createThread(options); } finally { await client.close(); }
}
