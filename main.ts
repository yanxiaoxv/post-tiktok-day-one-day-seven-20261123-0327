// main.ts — entrypoint for the "Day one, day seven" entry.
// It validates the two submission files at the repository root —
// VIDEO.json (the TikTok address of the posted video) and CAPTION.txt
// (the caption it was posted with) — then copies VIDEO.json to the
// output directory, unchanged, byte for byte. The house reads the
// TikTok video itself from the address VIDEO.json names.
//
// VIDEO.json may carry an empty url before the video is posted; that is
// a valid state and is reported as "not posted yet". Once filled in,
// the url must look like https://www.tiktok.com/@<handle>/video/<id>.
//
// Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// With no MAKEFUN_OUTPUT_DIR (or an empty one) it writes to
// /output/VIDEO.json.
//
// Node 22, standard library only, no network.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const videoSource = join(repoRoot, "VIDEO.json");
const captionSource = join(repoRoot, "CAPTION.txt");
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const target = join(outDir, "VIDEO.json");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// --- VIDEO.json: must exist, parse, and hold a string url. ---
if (!existsSync(videoSource)) {
  fail(`VIDEO.json not found at ${videoSource}`);
}
const raw = readFileSync(videoSource);
let parsed: unknown;
try {
  parsed = JSON.parse(raw.toString("utf8"));
} catch {
  fail("VIDEO.json is not valid JSON");
}
if (
  typeof parsed !== "object" ||
  parsed === null ||
  Array.isArray(parsed) ||
  typeof (parsed as { url?: unknown }).url !== "string"
) {
  fail('VIDEO.json must be a JSON object with a string "url" field');
}
const url = (parsed as { url: string }).url;
if (url !== "" && !/^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+\/?$/.test(url)) {
  fail(
    "VIDEO.json url must be empty (not posted yet) or look like " +
      `https://www.tiktok.com/@<handle>/video/<id>; got: ${url}`,
  );
}

// --- CAPTION.txt: must exist and carry the play code line. ---
if (!existsSync(captionSource)) {
  fail(`CAPTION.txt not found at ${captionSource}`);
}
const caption = readFileSync(captionSource, "utf8");
const captionLines = caption.split("\n").filter((line) => line.length > 0);
if (captionLines.length < 2) {
  fail("CAPTION.txt must hold at least the caption line and the play code");
}

// --- Copy VIDEO.json byte for byte and report. ---
mkdirSync(outDir, { recursive: true });
copyFileSync(videoSource, target);

const sha256 = createHash("sha256").update(raw).digest("hex");
console.log(`copied VIDEO.json -> ${target}`);
console.log(`url: ${url === "" ? "(not posted yet)" : url}`);
console.log(`caption: ${captionLines[0]}`);
console.log(`play code: ${captionLines[captionLines.length - 2] ?? ""}`);
console.log(`bytes: ${raw.length}`);
console.log(`sha256: ${sha256}`);
