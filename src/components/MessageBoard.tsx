import { useMemo, type CSSProperties } from "react";

type WordRecord = { w: string; t: number };

type MessageBoardProps = {
  records: WordRecord[];
  maxNotes?: number;
};

// Classic sticky-note palette: pastel card + a matching darker ink colour so
// text stays readable without needing a theme lookup.
const NOTE_STYLES = [
  { bg: "#fff3b0", ink: "#6b5900" },
  { bg: "#ffd1dc", ink: "#7a1f3d" },
  { bg: "#bde0fe", ink: "#1b3a5c" },
  { bg: "#caffbf", ink: "#1f5c2e" },
  { bg: "#ffd6a5", ink: "#7a3e00" },
  { bg: "#e0c3fc", ink: "#4b2578" },
];

/** Deterministic pseudo-random in [0,1) from an integer seed, so a given note's
 * look stays stable across re-renders instead of flickering every refresh. */
function seeded(seed: number): number {
  const x = Math.sin(seed * 999.17) * 43758.5453;
  return x - Math.floor(x);
}

export function MessageBoard({ records, maxNotes = 48 }: MessageBoardProps) {
  const notes = useMemo(() => {
    return records
      .slice()
      .sort((a, b) => b.t - a.t)
      .slice(0, maxNotes)
      .reverse(); // oldest-of-the-visible-set first, so newest lands last/top in DOM order
  }, [records, maxNotes]);

  if (notes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-center text-projection-muted">
        <p className="text-lg">還沒有留言，等觀眾送出就會貼在這裡 📌</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-wrap content-start items-start justify-center gap-4 overflow-hidden px-6 pb-8"
      style={{ paddingTop: 190 }}
    >
      {notes.map((note) => {
        // Seeded only from the note's own content/timestamp (not its index in
        // the list), so its color/rotation stay fixed even as older notes
        // age out and everyone else's position in the array shifts.
        const seed = note.t + note.w.length * 7919;
        const style = NOTE_STYLES[Math.floor(seeded(seed) * NOTE_STYLES.length)]!;
        const rotate = (seeded(seed + 1) - 0.5) * 12; // -6deg .. 6deg
        const longText = note.w.length > 24;
        return (
          <div
            key={`${note.t}-${note.w}`}
            className="sticky-note-pop flex min-h-[110px] w-[200px] shrink-0 items-center justify-center rounded-md p-4 text-center shadow-lg"
            style={
              {
                background: style.bg,
                color: style.ink,
                boxShadow: "0 8px 16px rgba(0,0,0,0.35)",
                "--rot": `${rotate.toFixed(2)}deg`,
              } as CSSProperties
            }
          >
            <p className={longText ? "text-sm font-bold leading-snug" : "text-xl font-black leading-snug"}>
              {note.w}
            </p>
          </div>
        );
      })}
      <style>{`
        @keyframes sticky-note-pop-in {
          0% { opacity: 0; transform: scale(0.4) rotate(0deg); }
          70% { opacity: 1; transform: scale(1.08) rotate(var(--rot, 0deg)); }
          100% { opacity: 1; transform: scale(1) rotate(var(--rot, 0deg)); }
        }
        .sticky-note-pop {
          animation: sticky-note-pop-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }
      `}</style>
    </div>
  );
}
