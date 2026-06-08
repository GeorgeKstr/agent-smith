export function sanitizeMarkdownForHtml(md: string): string {
  if (!md) return "";
  // Escape HTML first
  let out = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return out;
}

export function renderMarkdownHtml(md: string): string {
  if (!md) return "";
  let out = sanitizeMarkdownForHtml(md);

  // Fenced code blocks
  out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang: string, code: string) =>
    `<pre><code class="${lang}">${code.trim()}</code></pre>`);

  // Inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Bullet lists — group consecutive bullet lines
  out = out.replace(/(?:^|\n)([-*] .+)/g, "\n<li>$1</li>");
  out = out.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Numbered lists
  out = out.replace(/(?:^|\n)(\d+\. .+)/g, "\n<li>$1</li>");
  out = out.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Headings
  out = out.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  out = out.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  out = out.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Paragraphs: double newlines become paragraph breaks
  out = out.replace(/\n\n/g, "</p><p>");
  out = "<p>" + out + "</p>";
  out = out.replace(/<p>\s*<\/p>/g, "");

  return out;
}

export function renderMarkdownForTerminal(md: string): string {
  if (!md) return "";
  // Light terminal rendering — preserve structure, avoid raw control chars
  let out = md
    .replace(/```(\w*)\n/g, "```\n")
    .replace(/\*\*(.+?)\*\*/g, "\x1b[1m$1\x1b[22m")
    .replace(/\*(.+?)\*/g, "\x1b[3m$1\x1b[23m")
    // Strip other markdown syntax, keep text readable
    .replace(/^#{1,3}\s/gm, "");
  return out;
}
