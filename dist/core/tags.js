/**
 * Global numeric tag map.
 *
 * These IDs are stable and shared across every project so the model can reason
 * about a small, fixed taxonomy instead of inventing free-form labels. The
 * model is only ever asked to pick from this list by number.
 */
export const GLOBAL_TAGS = [
    { id: 1, name: "auth", description: "authentication, sessions, tokens, permissions" },
    { id: 2, name: "api", description: "HTTP endpoints, controllers, route handlers" },
    { id: 3, name: "ui", description: "components, views, screens, rendering" },
    { id: 4, name: "database", description: "schema, queries, migrations, ORM, persistence" },
    { id: 5, name: "state", description: "stores, reducers, state management" },
    { id: 6, name: "routing", description: "navigation, URL routing, links" },
    { id: 7, name: "config", description: "configuration, environment, settings" },
    { id: 8, name: "testing", description: "tests, fixtures, mocks, specs" },
    { id: 9, name: "build", description: "build tooling, bundling, compilation" },
    { id: 10, name: "utils", description: "generic helpers and utilities" },
    { id: 11, name: "types", description: "type definitions, interfaces, schemas" },
    { id: 12, name: "styling", description: "CSS, themes, design tokens" },
    { id: 13, name: "networking", description: "fetch, websockets, clients, transport" },
    { id: 14, name: "validation", description: "input validation, parsing, sanitization" },
    { id: 15, name: "logging", description: "logging, telemetry, metrics" },
    { id: 16, name: "error-handling", description: "errors, exceptions, recovery" },
    { id: 17, name: "payments", description: "checkout, billing, pricing, discounts" },
    { id: 18, name: "data-model", description: "domain entities, models, DTOs" },
    { id: 19, name: "cli", description: "command line interface, argument parsing" },
    { id: 20, name: "docs", description: "documentation, comments, readme" },
    { id: 21, name: "concurrency", description: "async, queues, workers, scheduling" },
    { id: 22, name: "security", description: "encryption, secrets, hardening" },
    { id: 23, name: "io", description: "filesystem, streams, serialization" },
    { id: 24, name: "search", description: "indexing, retrieval, querying" },
    { id: 25, name: "events", description: "event bus, pub/sub, listeners" },
    { id: 26, name: "caching", description: "caches, memoization, invalidation" },
    { id: 27, name: "i18n", description: "localization, translation, formatting" },
    { id: 28, name: "media", description: "images, audio, video, assets" },
    { id: 29, name: "analytics", description: "tracking, reporting, dashboards" },
    { id: 30, name: "infra", description: "deployment, CI, containers, ops" }
];
const TAG_BY_NAME = new Map(GLOBAL_TAGS.map((t) => [t.name, t]));
const TAG_BY_ID = new Map(GLOBAL_TAGS.map((t) => [t.id, t]));
export function tagName(id) {
    return TAG_BY_ID.get(id)?.name ?? `tag:${id}`;
}
export function tagId(name) {
    return TAG_BY_NAME.get(name.trim().toLowerCase())?.id;
}
/** Idempotently seed the global tag taxonomy into the database. */
export function seedTags(db) {
    const upsert = db.prepare(`
    INSERT INTO tags (id, name, description)
    VALUES (@id, @name, @description)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description
  `);
    const tx = db.transaction(() => {
        for (const tag of GLOBAL_TAGS)
            upsert.run(tag);
    });
    tx();
}
/** Render the global tag map as a compact list for prompting. */
export function tagMapForPrompt() {
    return GLOBAL_TAGS.map((t) => `${t.id}=${t.name}`).join(", ");
}
/**
 * Heuristic tagging fallback used when Ollama is unavailable.
 * Scans path + content for keyword signals mapped to tag IDs.
 */
export function heuristicTags(relativePath, content) {
    const haystack = `${relativePath}\n${content.slice(0, 4000)}`.toLowerCase();
    const hits = new Set();
    const signals = [
        [1, /\b(auth|login|logout|session|token|jwt|password|oauth|permission)\b/],
        [2, /\b(router\.|app\.(get|post|put|delete)|endpoint|controller|@get|@post|fastify|express|handler)\b/],
        [3, /\b(component|render|jsx|tsx|view|screen|widget|<\/?[a-z])\b/],
        [4, /\b(sql|select |insert |update |delete |schema|migration|prisma|sequelize|mongoose|database|sqlite)\b/],
        [5, /\b(usestate|usereducer|store|reducer|dispatch|zustand|redux|signal)\b/],
        [6, /\b(route|navigate|navigation|link|history|usenavigate)\b/],
        [7, /\b(config|\.env|process\.env|settings|options)\b/],
        [8, /\b(test|describe\(|it\(|expect\(|spec|mock|fixture)\b/],
        [9, /\b(webpack|vite|rollup|esbuild|tsconfig|build|bundle)\b/],
        [11, /\b(interface |type [a-z]|enum |declare |\.d\.ts)\b/],
        [12, /\b(css|style|theme|tailwind|styled|className)\b/],
        [13, /\b(fetch\(|axios|websocket|http|request|client)\b/],
        [14, /\b(validate|zod|yup|joi|schema\.parse|sanitiz)\b/],
        [15, /\b(logger|console\.log|pino|winston|telemetry|metric)\b/],
        [16, /\b(try\s*{|catch\s*\(|throw |error|exception)\b/],
        [17, /\b(payment|checkout|stripe|billing|invoice|price|discount|cart)\b/],
        [19, /\b(commander|yargs|argv|process\.argv|cli|command)\b/],
        [21, /\b(async |await |promise|queue|worker|concurren|settimeout)\b/],
        [24, /\b(index|retriev|search|query|embedding|rank|score)\b/],
        [25, /\b(emit\(|eventemitter|on\(|addeventlistener|pub|subscribe)\b/]
    ];
    for (const [id, pattern] of signals) {
        if (pattern.test(haystack))
            hits.add(id);
    }
    return [...hits].slice(0, 6);
}
