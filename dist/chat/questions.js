import { addChatMessage, createUserQuestion, answerUserQuestion, cancelUserQuestion } from "./chatStore.js";
export function askConfirm(db, sessionId, prompt, defaultValue) {
    const msg = addChatMessage(db, { sessionId, role: "question", content: prompt, status: "complete", metadata: { kind: "confirm", defaultValue } });
    return createUserQuestion(db, { sessionId, messageId: msg.id, kind: "confirm", prompt, options: ["yes", "no"], defaultValue: defaultValue ?? false });
}
export function askSelect(db, sessionId, prompt, options, defaultValue) {
    const msg = addChatMessage(db, { sessionId, role: "question", content: `${prompt}\n${options.map((o, i) => `[${i + 1}] ${o}`).join("\n")}`, status: "complete", metadata: { kind: "select", defaultValue } });
    return createUserQuestion(db, { sessionId, messageId: msg.id, kind: "select", prompt, options, defaultValue });
}
export function askText(db, sessionId, prompt, defaultValue) {
    const msg = addChatMessage(db, { sessionId, role: "question", content: prompt, status: "complete", metadata: { kind: "text", defaultValue } });
    return createUserQuestion(db, { sessionId, messageId: msg.id, kind: "text", prompt, defaultValue });
}
export function askSecret(db, sessionId, prompt) {
    const msg = addChatMessage(db, { sessionId, role: "question", content: prompt, status: "complete", metadata: { kind: "secret" } });
    return createUserQuestion(db, { sessionId, messageId: msg.id, kind: "secret", prompt });
}
export async function resolveQuestion(db, questionId, answer) {
    const q = await cancelUserQuestion(db, questionId); // cancel first to get fresh state
    if (!q || q.status !== "open")
        return { ok: false, error: "Question not found or already answered" };
    const updated = answerUserQuestion(db, questionId, answer);
    if (!updated)
        return { ok: false, error: "Failed to answer question" };
    addChatMessage(db, { sessionId: q.sessionId, role: "user", content: `Answered: ${typeof answer === "string" ? answer : JSON.stringify(answer)}`, status: "complete" });
    return { ok: true, question: updated };
}
