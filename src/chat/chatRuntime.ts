import type { SmithDatabase } from "../db/db.js";
import type { SmithConfig } from "../types/index.js";
import type { ChatSession, ChatMessage, RuntimeTaskResult } from "../types/index.js";
import type { Indexer } from "../index/indexer.js";
import { createSmithRuntime } from "../runtime/smithRuntime.js";
import { createChatSession, getChatSession, addChatMessage, updateChatMessage, listChatMessages, getChatMessage, getOpenQuestions } from "./chatStore.js";

type SendChatArgs = {
  root: string;
  config: SmithConfig;
  db: SmithDatabase;
  events: NodeJS.EventEmitter;
  indexer: Indexer;
  sessionId?: string;
  prompt: string;
  actionKind?: string;
  model?: string;
  metadata?: unknown;
  signal?: AbortSignal;
};

type SendChatResult = {
  ok: boolean;
  session: ChatSession;
  userMessage: ChatMessage;
  assistantMessage?: ChatMessage;
  result?: RuntimeTaskResult;
  error?: string;
};

export async function sendChatMessage(args: SendChatArgs): Promise<SendChatResult> {
  const { root, config, db, events, indexer, prompt, actionKind, model, metadata } = args;
  let session: ChatSession;

  if (args.sessionId) {
    const s = getChatSession(db, args.sessionId);
    if (!s) return { ok: false, session: null as unknown as ChatSession, userMessage: null as unknown as ChatMessage, error: "Session not found" };
    session = s;
  } else {
    session = createChatSession(db, { title: prompt.slice(0, 80), scope: "local" });
  }

  const kind = actionKind ?? "ask";

  const userMsg = addChatMessage(db, {
    sessionId: session.id,
    role: "user",
    content: prompt,
    status: "complete",
    model: model ?? undefined,
    actionKind: kind,
    metadata
  });

  const assistantMsg = addChatMessage(db, {
    sessionId: session.id,
    role: "assistant",
    content: "",
    status: "streaming",
    model: model ?? undefined,
    actionKind: kind,
    parentMessageId: userMsg.id
  });

  const runtime = createSmithRuntime({ root, config, db, events, indexer });

  let result: RuntimeTaskResult;
  try {
    result = await runtime.dispatch({
      kind: kind as "ask" | "patch" | "retrieve" | "context" | "index" | "check",
      prompt,
      model,
      apply: true,
      dryRun: false,
      signal: args.signal,
    });
  } catch (err) {
    updateChatMessage(db, assistantMsg.id, { content: `Error: ${err instanceof Error ? err.message : String(err)}`, status: "failed" });
    return { ok: false, session, userMessage: userMsg, error: err instanceof Error ? err.message : String(err) };
  }

  const content = result.answer || result.message || JSON.stringify(result.data ?? result);
  const msgMeta = { taskId: result.taskId, data: result.data };

  updateChatMessage(db, assistantMsg.id, {
    content,
    status: result.ok ? "complete" : "failed",
    runtimeTaskId: result.taskId,
    metadata: msgMeta
  });

  const updatedMsg = getChatMessage(db, assistantMsg.id);
  return { ok: result.ok, session, userMessage: userMsg, assistantMessage: updatedMsg, result };
}

export async function getSessionWithMessages(db: SmithDatabase, sessionId: string) {
  const session = getChatSession(db, sessionId);
  if (!session) return null;
  const messages = listChatMessages(db, sessionId);
  const openQuestions = getOpenQuestions(db, sessionId);
  return { session, messages, openQuestions };
}
