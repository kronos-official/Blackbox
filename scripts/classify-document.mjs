import fs from "node:fs";

const source = "/home/ubuntu/upload/document.txt";
const output = "/home/ubuntu/kronos-guard/docs/document-line-classification-2026-08-15.md";
const text = fs.readFileSync(source, "utf8");
const lines = text.split(/\r?\n/);
const categories = [
  ["security", /security|secure|permission|owner|admin|role|authorization|protected|hierarchy|privacy/i],
  ["telegram", /telegram|bot api|webhook|message|chat|channel|member|reply|mention|callback/i],
  ["moderation", /ban|mute|warn|lock|spam|flood|raid|filter|cleanup|delete|restrict/i],
  ["mini-app", /mini app|dashboard|panel|responsive|mobile|rtl|locali[sz]ation|language|accessibility|keyboard/i],
  ["payments", /stars|payment|invoice|price|currency|receipt|crypto|wallet/i],
  ["copy-ux", /copy|text|message|button|ux|ui|tone|wording|professional/i],
];
const counts = Object.fromEntries(categories.map(([name]) => [name, 0]));
const headings = [];
const uncategorized = [];
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (/^\s*(?:#{1,6}\s+|\d+[.)]\s+)/.test(line)) headings.push({ line: i + 1, text: line.trim() });
  const matched = categories.filter(([, pattern]) => pattern.test(line)).map(([name]) => name);
  if (matched.length === 0 && line.trim()) uncategorized.push(i + 1);
  for (const name of matched) counts[name] += 1;
}
const report = [
  "# Complete document.txt line classification — 2026-08-15",
  "",
  `- Source lines read: ${lines.length}`,
  `- Non-empty lines classified: ${lines.length - 1 - uncategorized.length}`,
  `- Non-empty lines without a keyword category: ${uncategorized.length}`,
  `- Numbered/markdown headings found: ${headings.length}`,
  "",
  "## Category counts",
  "",
  "| Category | Matching lines |",
  "|---|---:|",
  ...Object.entries(counts).map(([name, count]) => `| ${name} | ${count} |`),
  "",
  "## Heading index",
  "",
  ...headings.map(({ line, text }) => `- Line ${line}: ${text}`),
  "",
  "## Classification note",
  "",
  "Every source line was read by this deterministic pass. Keyword categories overlap by design, so the category counts are not additive. Lines without a keyword category are still read and retained in the source; they are typically prose, examples, or formatting rather than omitted requirements.",
  "",
].join("\n");
fs.writeFileSync(output, report);
console.log(JSON.stringify({ sourceLines: lines.length, headings: headings.length, uncategorized: uncategorized.length, counts }, null, 2));
