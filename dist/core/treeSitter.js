import crypto from "node:crypto";
/**
 * Lightweight, dependency-free symbol/import extraction.
 *
 * The spec calls for tree-sitter, but native tree-sitter grammars require a
 * compiled toolchain that is brittle across machines. This module delivers the
 * same product capability (functions, classes, methods, types, components and
 * local imports) using language-aware heuristics with brace/indentation aware
 * block detection, so the index works everywhere out of the box.
 */
const TS_LIKE = new Set(["typescript", "typescript-react", "javascript", "javascript-react"]);
export function isParseableLanguage(language) {
    return TS_LIKE.has(language) || language === "python";
}
export function extractSymbols(language, content) {
    if (TS_LIKE.has(language))
        return extractTsSymbols(content);
    if (language === "python")
        return extractPythonSymbols(content);
    return [];
}
export function extractImports(language, content) {
    if (TS_LIKE.has(language))
        return extractTsImports(content);
    if (language === "python")
        return extractPythonImports(content);
    return [];
}
function hashSlice(slice) {
    return crypto.createHash("sha1").update(slice).digest("hex").slice(0, 16);
}
function lineAt(content, index) {
    let line = 1;
    for (let i = 0; i < index && i < content.length; i++) {
        if (content[i] === "\n")
            line++;
    }
    return line;
}
/** Find the index just past the block that opens at the first `{` at/after `from`. */
function matchBraceBlock(content, from) {
    const open = content.indexOf("{", from);
    if (open === -1)
        return -1;
    let depth = 0;
    let inString = null;
    let escaped = false;
    for (let i = open; i < content.length; i++) {
        const ch = content[i];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (ch === "\\")
                escaped = true;
            else if (ch === inString)
                inString = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
            inString = ch;
        }
        else if (ch === "{") {
            depth++;
        }
        else if (ch === "}") {
            depth--;
            if (depth === 0)
                return i + 1;
        }
    }
    return content.length;
}
/** Skip a balanced `(...)` starting at/after `from`; returns index past the `)`. */
function skipParens(content, from) {
    const open = content.indexOf("(", from);
    if (open === -1)
        return from;
    let depth = 0;
    let inString = null;
    for (let i = open; i < content.length; i++) {
        const ch = content[i];
        if (inString) {
            if (ch === inString && content[i - 1] !== "\\")
                inString = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`")
            inString = ch;
        else if (ch === "(")
            depth++;
        else if (ch === ")") {
            depth--;
            if (depth === 0)
                return i + 1;
        }
    }
    return content.length;
}
/**
 * End of a function body, skipping the parameter list first so object-typed or
 * destructured parameters (which contain `{`) don't terminate the symbol early.
 */
function functionBodyEnd(content, headerIndex) {
    const afterParams = skipParens(content, headerIndex);
    const end = matchBraceBlock(content, afterParams);
    return end === -1 ? afterParams : end;
}
function isPascalCase(name) {
    return /^[A-Z][A-Za-z0-9]*$/.test(name);
}
function looksLikeJsx(slice) {
    return /return\s*\(?\s*</.test(slice) || /=>\s*\(?\s*</.test(slice) || /<\/[A-Za-z]/.test(slice);
}
function extractTsSymbols(content) {
    const symbols = [];
    const seen = new Set();
    const push = (name, kind, start, end) => {
        const slice = content.slice(start, end);
        const startLine = lineAt(content, start);
        const endLine = lineAt(content, end);
        const key = `${name}:${kind}:${startLine}`;
        if (seen.has(key))
            return;
        seen.add(key);
        symbols.push({
            name,
            kind,
            startLine,
            endLine,
            signature: slice.split("\n")[0].trim().slice(0, 200),
            hash: hashSlice(slice)
        });
    };
    // Functions: optional export/default, async.
    const fnRe = /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_$]+)\s*[<(]/g;
    for (let m; (m = fnRe.exec(content));) {
        const name = m[1];
        const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
        const end = functionBodyEnd(content, m.index);
        const slice = content.slice(start, end);
        const kind = isPascalCase(name) && looksLikeJsx(slice) ? "component" : "function";
        push(name, kind, start, end);
    }
    // Arrow / function-expression consts: const Name = (..) => / async (..) =>
    const arrowRe = /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?const\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/g;
    for (let m; (m = arrowRe.exec(content));) {
        const name = m[1];
        const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
        const arrowEnd = content.indexOf("=>", m.index) + 2;
        let cursor = arrowEnd;
        while (cursor < content.length && /\s/.test(content[cursor]))
            cursor++;
        const end = content[cursor] === "{" ? matchBraceBlock(content, cursor) : findExpressionEnd(content, arrowEnd);
        const slice = content.slice(start, end);
        const kind = isPascalCase(name) && looksLikeJsx(slice) ? "component" : "function";
        push(name, kind, start, end);
    }
    // Classes.
    const classRe = /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g;
    for (let m; (m = classRe.exec(content));) {
        const name = m[1];
        const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
        const end = matchBraceBlock(content, m.index);
        const classEnd = end === -1 ? start + m[0].length : end;
        push(name, "class", start, classEnd);
        extractClassMethods(content, start, classEnd, name, push);
    }
    // Interfaces & types & enums.
    const ifaceRe = /(?:^|\n)[ \t]*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/g;
    for (let m; (m = ifaceRe.exec(content));) {
        const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
        const end = matchBraceBlock(content, m.index);
        push(m[1], "interface", start, end === -1 ? start + m[0].length : end);
    }
    const typeRe = /(?:^|\n)[ \t]*(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*(?:<[^=]*>)?\s*=/g;
    for (let m; (m = typeRe.exec(content));) {
        const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
        const end = findStatementEnd(content, m.index);
        push(m[1], "type", start, end);
    }
    const enumRe = /(?:^|\n)[ \t]*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z0-9_$]+)/g;
    for (let m; (m = enumRe.exec(content));) {
        const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
        const end = matchBraceBlock(content, m.index);
        push(m[1], "enum", start, end === -1 ? start + m[0].length : end);
    }
    return symbols.sort((a, b) => a.startLine - b.startLine);
}
function extractClassMethods(content, classStart, classEnd, className, push) {
    const body = content.slice(classStart, classEnd);
    const methodRe = /\n[ \t]+(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|get\s+|set\s+|\*\s*)*([A-Za-z0-9_$]+)\s*\([^)]*\)\s*(?::[^={]+)?\{/g;
    const reserved = new Set(["if", "for", "while", "switch", "catch", "return", "function"]);
    for (let m; (m = methodRe.exec(body));) {
        const name = m[1];
        if (reserved.has(name))
            continue;
        const absStart = classStart + m.index + 1;
        const absEnd = matchBraceBlock(content, classStart + m.index);
        push(`${className}.${name}`, "method", absStart, absEnd === -1 ? absStart + m[0].length : absEnd);
    }
}
function findExpressionEnd(content, from) {
    // Walk to the end of an arrow expression body (until ; or newline at depth 0).
    let depth = 0;
    for (let i = from; i < content.length; i++) {
        const ch = content[i];
        if (ch === "(" || ch === "[" || ch === "{")
            depth++;
        else if (ch === ")" || ch === "]" || ch === "}")
            depth--;
        else if ((ch === ";" || ch === "\n") && depth <= 0)
            return i + 1;
    }
    return content.length;
}
function findStatementEnd(content, from) {
    let depth = 0;
    for (let i = content.indexOf("=", from); i < content.length && i !== -1; i++) {
        const ch = content[i];
        if (ch === "(" || ch === "[" || ch === "{" || ch === "<")
            depth++;
        else if (ch === ")" || ch === "]" || ch === "}" || ch === ">")
            depth--;
        else if (ch === ";" && depth <= 0)
            return i + 1;
        else if (ch === "\n" && depth <= 0)
            return i + 1;
    }
    return content.length;
}
function extractPythonSymbols(content) {
    const symbols = [];
    const lines = content.split("\n");
    const stack = [];
    const indentOf = (line) => line.length - line.trimStart().length;
    const flush = (downTo, endLineNo, endOffset) => {
        while (stack.length && stack[stack.length - 1].indent >= downTo) {
            const sym = stack.pop();
            const slice = content.slice(sym.start, endOffset);
            symbols.push({
                name: sym.name,
                kind: sym.kind,
                startLine: sym.lineNo,
                endLine: endLineNo,
                signature: slice.split("\n")[0].trim().slice(0, 200),
                hash: hashSlice(slice)
            });
        }
    };
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const indent = indentOf(line);
        if (trimmed && !trimmed.startsWith("#")) {
            flush(indent === 0 ? 0 : indent, i, offset);
            const fn = /^(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/.exec(trimmed);
            const cls = /^class\s+([A-Za-z0-9_]+)/.exec(trimmed);
            if (fn) {
                const kind = stack.some((s) => s.kind === "class") ? "method" : "function";
                const name = stack.length && stack[stack.length - 1].kind === "class" ? `${stack[stack.length - 1].name}.${fn[1]}` : fn[1];
                stack.push({ name, indent, kind, start: offset, lineNo: i + 1 });
            }
            else if (cls) {
                stack.push({ name: cls[1], indent, kind: "class", start: offset, lineNo: i + 1 });
            }
        }
        offset += line.length + 1;
    }
    flush(0, lines.length, content.length);
    return symbols.sort((a, b) => a.startLine - b.startLine);
}
function extractTsImports(content) {
    const imports = [];
    const seen = new Set();
    const add = (importText, specifier) => {
        if (!specifier || seen.has(specifier))
            return;
        seen.add(specifier);
        imports.push({ importText: importText.trim().slice(0, 200), specifier });
    };
    const patterns = [
        /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
        /import\s+['"]([^'"]+)['"]/g,
        /export\s+[^'"]*from\s+['"]([^'"]+)['"]/g,
        /require\(\s*['"]([^'"]+)['"]\s*\)/g,
        /import\(\s*['"]([^'"]+)['"]\s*\)/g
    ];
    for (const re of patterns) {
        for (let m; (m = re.exec(content));)
            add(m[0], m[1]);
    }
    return imports;
}
function extractPythonImports(content) {
    const imports = [];
    const seen = new Set();
    const lineRe = /^[ \t]*(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/gm;
    for (let m; (m = lineRe.exec(content));) {
        const specifier = (m[1] ?? m[2] ?? "").trim();
        if (!specifier || seen.has(specifier))
            continue;
        seen.add(specifier);
        imports.push({ importText: m[0].trim().slice(0, 200), specifier });
    }
    return imports;
}
