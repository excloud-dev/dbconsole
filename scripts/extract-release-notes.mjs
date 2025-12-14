import fs from "node:fs";

function die(msg) {
    console.error(msg);
    process.exit(1);
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tagArg = (process.argv[2] || process.env.GITHUB_REF_NAME || "").trim();
if (!tagArg) die("GITHUB_REF_NAME is missing (or pass the tag as argv[2])");

const candidates = [tagArg];
if (tagArg.startsWith("v")) candidates.push(tagArg.slice(1));
else candidates.push(`v${tagArg}`);

const changelog =
    (fs.existsSync("CHANGELOG.md") && "CHANGELOG.md") ||
    (fs.existsSync("CHANGELOG") && "CHANGELOG") ||
    "";
if (!changelog) {
    die("No changelog file found. Expected CHANGELOG.md or CHANGELOG at repo root.");
}

const text = fs.readFileSync(changelog, "utf8");
const lines = text.split(/\r?\n/);

function isHeading(line) {
    return /^##\s+/.test(line);
}

function matchesTagHeading(line, cand) {
    const esc = escapeRegExp(cand);
    const re = new RegExp(`^##\\s+\\[?${esc}\\]?(?:\\s+-.*)?\\s*$`);
    return re.test(line);
}

for (const cand of candidates) {
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (matchesTagHeading(lines[i], cand)) {
            start = i;
            break;
        }
    }
    if (start === -1) continue;

    const out = [];
    for (let i = start + 1; i < lines.length; i++) {
        if (isHeading(lines[i])) break;
        out.push(lines[i]);
    }

    while (out.length > 0 && out[0].trim() === "") out.shift();
    const content = out.join("\n").trimEnd() + "\n";
    if (!content.trim()) continue;

    fs.writeFileSync("release-notes.md", content, "utf8");
    console.log(`Wrote release-notes.md from ${changelog} section: ${cand}`);
    process.exit(0);
}

die(
    `No changelog section found for tag '${tagArg}' in ${changelog}.\n` +
    `Add a heading like: '## ${tagArg} - YYYY-MM-DD' (or '## [${tagArg}] - YYYY-MM-DD')`,
);

