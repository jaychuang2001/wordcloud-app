import { mergeCsv, normalizeWord, type TopicData } from "./wordcloud-core";

/* Excel (.xlsx) export / import. SheetJS is loaded on demand so it never
 * weighs down the audience page. */

const pad = (n: number) => String(n).padStart(2, "0");

/** 2026-11-14 10:50:12 in local time (what people expect to see in Excel). */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 主題名稱_20261114_105012.xlsx — the time is the moment of export. */
export function exportFilename(topicName: string, now = new Date()): string {
  const cleaned = topicName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 60) || "topic";
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${cleaned}_${stamp}.xlsx`;
}

export async function downloadXlsx(topicName: string, data: TopicData): Promise<void> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const recordRows: (string | number)[][] = [["投稿時間", "主題", "詞彙"]];
  for (const r of data.records) recordRows.push([formatTime(r.t), topicName, r.w]);
  const wsRecords = XLSX.utils.aoa_to_sheet(recordRows);
  wsRecords["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 40 }];

  const countRows: (string | number)[][] = [["詞彙", "次數"]];
  for (const [w, n] of Object.entries(data.counts).sort((a, b) => b[1] - a[1])) countRows.push([w, n]);
  const wsCounts = XLSX.utils.aoa_to_sheet(countRows);
  wsCounts["!cols"] = [{ wch: 40 }, { wch: 10 }];

  XLSX.utils.book_append_sheet(wb, wsRecords, "投稿紀錄");
  XLSX.utils.book_append_sheet(wb, wsCounts, "統計");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilename(topicName);
  a.click();
  URL.revokeObjectURL(url);
}

function toMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel serial date (user re-saved the file in Excel) → local wall time.
    const days = Math.floor(v);
    const secs = Math.round((v - days) * 86400);
    return new Date(1899, 11, 30 + days, 0, 0, secs).getTime();
  }
  const s = String(v ?? "").trim();
  if (!s) return Date.now();
  const t = Date.parse(s.replace(" ", "T"));
  return Number.isFinite(t) ? t : Date.now();
}

/** Merge an exported .xlsx (or a legacy .csv) into existing data. */
export async function mergeFile(existing: TopicData, file: File): Promise<TopicData> {
  if (/\.csv$/i.test(file.name)) return mergeCsv(existing, await file.text());

  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const counts = { ...existing.counts };
  const records = existing.records.slice();

  const recSheet = wb.Sheets["投稿紀錄"] ?? wb.Sheets[wb.SheetNames[0]!];
  const cntSheet = wb.Sheets["統計"];

  if (recSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(recSheet, { header: 1, raw: true, defval: "" });
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const word = normalizeWord(String(row[2] ?? ""));
      if (!word) continue;
      records.push({ w: word, t: toMs(row[0]) });
      // A file without a 統計 sheet still has to add to the cloud.
      if (!cntSheet) counts[word] = (counts[word] ?? 0) + 1;
    }
  }
  if (cntSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(cntSheet, { header: 1, raw: true, defval: "" });
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]!;
      const word = normalizeWord(String(row[0] ?? ""));
      const n = Number(row[1]);
      if (word && Number.isFinite(n) && n > 0) counts[word] = (counts[word] ?? 0) + n;
    }
  }
  return { counts, records };
}
