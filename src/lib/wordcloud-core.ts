// Shared, browser-safe helpers for the live word cloud app.

export type TopicId = string;
export const MIN_TOPICS = 1;
export const MAX_TOPICS = 12;

export type TopicConfig = { id: TopicId; name: string };

/** Smallest unused topic number, so newly added topics keep tidy, short ids like "4", "5"… */
export function nextTopicId(existing: TopicConfig[]): string {
  let max = 0;
  for (const t of existing) {
    const n = Number(t.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

export type RoomConfig = {
  room: string;
  topics: TopicConfig[];
  filterEnabled: boolean;
};

export const DEFAULT_ROOM = "main";

export const DEFAULT_CONFIG: RoomConfig = {
  room: DEFAULT_ROOM,
  topics: [
    { id: "1", name: "主題 A" },
    { id: "2", name: "主題 B" },
    { id: "3", name: "主題 C" },
  ],
  filterEnabled: true,
};

const CONFIG_KEY = "wc:config";

export function loadConfig(): RoomConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<RoomConfig>;
    return {
      room: parsed.room || DEFAULT_ROOM,
      topics:
        Array.isArray(parsed.topics) &&
        parsed.topics.length >= MIN_TOPICS &&
        parsed.topics.length <= MAX_TOPICS
          ? (parsed.topics as TopicConfig[])
          : DEFAULT_CONFIG.topics,
      filterEnabled: parsed.filterEnabled !== false,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: RoomConfig) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/* ------------------------------------------------------------------ */
/* Sensitive words                                                     */
/* ------------------------------------------------------------------ */

const BUILT_IN_BLOCKLIST = [
  "幹你娘",
  "幹您娘",
  "靠北",
  "白痴",
  "智障",
  "去死",
  "廢物",
  "垃圾人",
  "婊子",
  "賤人",
  "他媽的",
  "媽的",
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "cunt",
  "dick",
  "retard",
  "nigger",
];

const EXTRA_KEY = "wc:blocklist";

export function loadBlocklist(): string[] {
  if (typeof window === "undefined") return BUILT_IN_BLOCKLIST;
  try {
    const raw = window.localStorage.getItem(EXTRA_KEY);
    const extra: string[] = raw ? JSON.parse(raw) : [];
    return [...BUILT_IN_BLOCKLIST, ...extra];
  } catch {
    return BUILT_IN_BLOCKLIST;
  }
}

export function saveExtraBlocklist(words: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EXTRA_KEY, JSON.stringify(words));
}

export function isBlocked(word: string, list = loadBlocklist()): boolean {
  const lower = word.toLowerCase();
  return list.some((bad) => bad && lower.includes(bad.toLowerCase()));
}

export const MAX_WORD_LENGTH = 20;

export function normalizeWord(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_WORD_LENGTH);
}

/* ------------------------------------------------------------------ */
/* Storage of topic data                                               */
/* ------------------------------------------------------------------ */

export type TopicData = {
  counts: Record<string, number>;
  records: { w: string; t: number }[];
};

export const EMPTY_DATA: TopicData = { counts: {}, records: [] };

export function dataKey(room: string, topicId: TopicId) {
  return `wc:data:${room}:${topicId}`;
}

export function loadTopicData(room: string, topicId: TopicId): TopicData {
  if (typeof window === "undefined") return { counts: {}, records: [] };
  try {
    const raw = window.localStorage.getItem(dataKey(room, topicId));
    if (!raw) return { counts: {}, records: [] };
    const parsed = JSON.parse(raw) as TopicData;
    return {
      counts: parsed.counts ?? {},
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return { counts: {}, records: [] };
  }
}

export function saveTopicData(room: string, topicId: TopicId, data: TopicData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(dataKey(room, topicId), JSON.stringify(data));
  } catch {
    // storage full — drop the oldest half of the log and retry once
    const trimmed: TopicData = {
      counts: data.counts,
      records: data.records.slice(-Math.floor(data.records.length / 2)),
    };
    try {
      window.localStorage.setItem(dataKey(room, topicId), JSON.stringify(trimmed));
    } catch {
      /* give up silently; the in-memory cloud keeps working */
    }
  }
}

export function mergeWords(data: TopicData, words: string[], ts: number): TopicData {
  const counts = { ...data.counts };
  const records = data.records.slice();
  for (const w of words) {
    counts[w] = (counts[w] ?? 0) + 1;
    records.push({ w, t: ts });
  }
  return { counts, records };
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

function csvEscape(value: string | number) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(data: TopicData, topicName: string): string {
  const lines = ["type,topic,word,count,time"];
  const sorted = Object.entries(data.counts).sort((a, b) => b[1] - a[1]);
  for (const [word, count] of sorted) {
    lines.push(["count", topicName, word, count, ""].map(csvEscape).join(","));
  }
  for (const r of data.records) {
    lines.push(
      ["record", topicName, r.w, "", new Date(r.t).toISOString()].map(csvEscape).join(","),
    );
  }
  return "\uFEFF" + lines.join("\n");
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Merge an exported CSV back into existing data. Returns the merged copy. */
export function mergeCsv(existing: TopicData, csv: string): TopicData {
  const counts = { ...existing.counts };
  const records = existing.records.slice();
  const text = csv.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return existing;

  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const hasTypeCol = header[0] === "type";
  const idx = (name: string) => header.indexOf(name);

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    if (hasTypeCol) {
      const type = cells[0]?.trim();
      const word = normalizeWord(cells[idx("word")] ?? "");
      if (!word) continue;
      if (type === "count") {
        const n = Number(cells[idx("count")] ?? 0);
        if (Number.isFinite(n) && n > 0) counts[word] = (counts[word] ?? 0) + n;
      } else if (type === "record") {
        const t = Date.parse(cells[idx("time")] ?? "");
        records.push({ w: word, t: Number.isFinite(t) ? t : Date.now() });
      }
    } else {
      // Tolerate a plain "word,count" file.
      const word = normalizeWord(cells[0] ?? "");
      const n = Number(cells[1] ?? 1);
      if (word) counts[word] = (counts[word] ?? 0) + (Number.isFinite(n) && n > 0 ? n : 1);
    }
  }
  return { counts, records };
}

export function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Colour themes                                                       */
/* ------------------------------------------------------------------ */

export type Palette = {
  id: string;
  name: string;
  background: string;
  colors: string[];
  stroke: string;
};

export const PALETTES: Palette[] = [
  {
    id: "grey-wall",
    name: "灰牆超高對比",
    background: "#000000",
    colors: ["#FFFFFF", "#FFE600", "#00F0FF", "#22C55E", "#F59E0B", "#EC4899"],
    stroke: "#000000",
  },
  {
    id: "aurora",
    name: "極光霓虹",
    background: "#070b1a",
    colors: ["#7dd3fc", "#a78bfa", "#f472b6", "#34d399", "#60a5fa", "#e0e7ff"],
    stroke: "#02040d",
  },
  {
    id: "dark",
    name: "深色暗黑",
    background: "#1a1a1b",
    colors: ["#ffffff", "#d4d4d8", "#67e8f9", "#86efac", "#fcd34d", "#f9a8d4"],
    stroke: "#09090b",
  },
  {
    id: "bright",
    name: "明亮高對比",
    background: "#f4f4f5",
    colors: ["#09090b", "#0047AB", "#006B3C", "#9F1239", "#7C2D12", "#581C87"],
    stroke: "#ffffff",
  },
  {
    id: "sunset",
    name: "落日",
    background: "#1a0b10",
    colors: ["#fb7185", "#fbbf24", "#f97316", "#fcd34d", "#f472b6", "#fee2e2"],
    stroke: "#120408",
  },
  {
    id: "forest",
    name: "森林",
    background: "#06140f",
    colors: ["#34d399", "#a3e635", "#22d3ee", "#86efac", "#fde68a", "#ecfdf5"],
    stroke: "#020b08",
  },
  {
    id: "mono",
    name: "純白",
    background: "#0a0a0a",
    colors: ["#ffffff", "#d4d4d8", "#a1a1aa", "#e4e4e7", "#f4f4f5"],
    stroke: "#000000",
  },
  {
    id: "candy",
    name: "霓虹",
    background: "#0b0718",
    colors: ["#ff5fd2", "#5eead4", "#c084fc", "#facc15", "#38bdf8"],
    stroke: "#030108",
  },
];

export function paletteById(id: string): Palette {
  const selected = PALETTES.find((p) => p.id === id);
  if (selected) return selected;
  return {
    id: "grey-wall",
    name: "灰牆超高對比",
    background: "#000000",
    colors: ["#FFFFFF", "#FFE600", "#00F0FF", "#22C55E", "#F59E0B", "#EC4899"],
    stroke: "#000000",
  };
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function joinUrl(
  origin: string,
  room: string,
  topics: TopicConfig[],
  topicId?: TopicId,
) {
  const params = new URLSearchParams({ room, ids: topics.map((t) => t.id).join(",") });
  topics.forEach((t) => params.set(`n${t.id}`, t.name));
  if (topicId) params.set("topic", topicId);
  return `${origin}/join?${params.toString()}`;
}

/** Reads the topic list out of the audience URL, falling back to defaults. */
export function topicsFromSearch(search: URLSearchParams): TopicConfig[] {
  const idsParam = search.get("ids");
  const ids = idsParam
    ? idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_CONFIG.topics.map((t) => t.id);
  return ids.map((id, i) => ({
    id,
    name: search.get(`n${id}`) || DEFAULT_CONFIG.topics[i]?.name || `主題 ${id}`,
  }));
}

export function channelName(room: string, topicId: TopicId) {
  return `wc:${room}:topic${topicId}`;
}
