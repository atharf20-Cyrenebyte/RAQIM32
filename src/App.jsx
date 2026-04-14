import { useState, useEffect, useRef, useCallback } from "react";
const SHEET_ID = "1et6H2oNeaRLaUws_0l8xSxnyIG1A8MZuWoU4xjIPjIA";

const ROOMS = [
  { id: "office1", label: "Office 1", sheetName: "office1", icon: "desktop" },
  { id: "office2", label: "Office 2", sheetName: "office2", icon: "desktop" },
  {
    id: "meeting1",
    label: "Meeting Room 1",
    sheetName: "meeting1",
    icon: "users",
  },
  {
    id: "meeting2",
    label: "Meeting Room 2",
    sheetName: "meeting2",
    icon: "users",
  },
];

const APPS_SCRIPT_URL = "GANTI_DENGAN_APPS_SCRIPT_URL";

const ML_API_URL = "/api/predict";

const ML_LABELS = {
  0: {
    text: "Nyaman",
    color: "#22c55e",
    bg: "#f0fdf4",
    border: "#bbf7d0",
    icon: "😊",
  },
  1: {
    text: "Netral",
    color: "#f59e0b",
    bg: "#fffbeb",
    border: "#fde68a",
    icon: "😐",
  },
  2: {
    text: "Tidak Nyaman",
    color: "#ef4444",
    bg: "#fef2f2",
    border: "#fecaca",
    icon: "😟",
  },
};

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

const THRESHOLDS = {
  temp: (v) => (v >= 28 ? "danger" : v <= 18 ? "cold" : "ok"),
  hum: (v) => (v > 70 ? "danger" : v < 30 ? "warn" : "ok"),
  co2: (v) => (v >= 1000 ? "danger" : v >= 800 ? "warn" : "ok"),
};

const COLORS = {
  danger: "#ef4444",
  warn: "#f59e0b",
  cold: "#60a5fa",
  ok: "#22c55e",
};
const getColor = (type, val) => COLORS[THRESHOLDS[type](val)] ?? COLORS.ok;

function parseSheetTimestamp(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  const dateMatch = s.match(
    /^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/,
  );
  if (dateMatch) {
    const [, Y, M, D, h = 0, m = 0, sec = 0] = dateMatch.map(Number);
    return new Date(Y, M, D, h, m, sec);
  }

  // Format ISO / string biasa
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function findClosestRow(rows) {
  if (!rows.length) return null;
  const now = Date.now();
  let best = null,
    bestDiff = Infinity;

  for (const row of rows) {
    const rawTs = row.c?.[3]?.v ?? null;
    const ts = parseSheetTimestamp(rawTs);
    if (!ts) continue;
    const diff = Math.abs(ts.getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = row;
    }
  }
  return best ?? rows[rows.length - 1];
}

function parseComments(raw) {
  if (!raw) return [];
  try {
    const p = JSON.parse(String(raw));
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

async function fetchRoomData(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  const text = await res.text();

  const jsonStr = text.replace(/^[^(]+\(/, "").replace(/\);?\s*$/, "");
  const json = JSON.parse(jsonStr);
  const rows = json.table?.rows ?? [];
  if (!rows.length) return null;

  const row = findClosestRow(rows);
  const get = (i) => row.c?.[i]?.v ?? null;

  const rawTs = get(3);
  const tsObj = parseSheetTimestamp(rawTs);

  return {
    temp: Number(get(0)) || 0,
    hum: Number(get(1)) || 0,
    co2: Number(get(2)) || 0,
    timestamp: tsObj
      ? tsObj.toLocaleString("id-ID", {
          dateStyle: "short",
          timeStyle: "short",
        })
      : rawTs
        ? String(rawTs)
        : null,
    comments: parseComments(get(4)),
  };
}

// ════════════════════════════════════════════════════════════════
//  ML Prediction
// ════════════════════════════════════════════════════════════════
async function fetchPrediction(temp, hum, co2) {
  if (!ML_API_URL || ML_API_URL.startsWith("GANTI")) return null;
  try {
    const res = await fetch(ML_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temp, hum, co2 }),
    });
    const data = await res.json();
    // Support { label: 0 } atau { prediction: 0 } atau { result: 0 }
    const label = data.label ?? data.prediction ?? data.result ?? null;
    return label !== null ? Number(label) : null;
  } catch (e) {
    console.warn("ML predict gagal:", e);
    return null;
  }
}

async function writeCommentToSheet(sheetName, comments) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("GANTI")) return false;
  try {
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetName, comments: JSON.stringify(comments) }),
    });
    return true;
  } catch {
    return false;
  }
}

function GaugeArc({ fraction, color }) {
  const r = 42,
    cx = 56,
    cy = 56;
  const toRad = (d) => (d * Math.PI) / 180;
  const start = -215,
    sweep = 250;
  const end = start + sweep * clamp(fraction, 0, 1);

  const arc = (from, to) => {
    const large = to - from > 180 ? 1 : 0;
    const x1 = cx + r * Math.cos(toRad(from)),
      y1 = cy + r * Math.sin(toRad(from));
    const x2 = cx + r * Math.cos(toRad(to)),
      y2 = cy + r * Math.sin(toRad(to));
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  return (
    <svg width="112" height="112" viewBox="0 0 112 112">
      <path
        d={arc(start, start + sweep)}
        fill="none"
        stroke="#e5e7eb"
        strokeWidth="9"
        strokeLinecap="round"
      />
      {fraction > 0 && (
        <path
          d={arc(start, end)}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 5px ${color}66)` }}
        />
      )}
    </svg>
  );
}

function Icon({ name, size = 20, color = "currentColor" }) {
  const s = { width: size, height: size, display: "block", flexShrink: 0 };
  const p = {
    fill: "none",
    stroke: color,
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  if (name === "desktop")
    return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    );
  if (name === "users")
    return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <circle cx="9" cy="7" r="4" />
        <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        <path d="M21 21v-2a4 4 0 0 0-3-3.85" />
      </svg>
    );
  if (name === "send")
    return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <path d="M22 2L11 13" />
        <path d="M22 2L15 22l-4-9-9-4 20-7z" />
      </svg>
    );
  if (name === "alert")
    return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  if (name === "info")
    return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="8" />
        <line x1="12" y1="12" x2="12" y2="16" />
      </svg>
    );
  if (name === "refresh")
    return (
      <svg style={s} viewBox="0 0 24 24" {...p}>
        <path d="M23 4v6h-6" />
        <path d="M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    );
  return null;
}

function MLBadge({ label, loading }) {
  if (loading)
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 12px",
          borderRadius: 10,
          background: "#f9fafb",
          border: "1px solid #f3f4f6",
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            border: "2px solid #d1d5db",
            borderTopColor: "#9ca3af",
            borderRadius: "50%",
            animation: "spin .8s linear infinite",
          }}
        />
        <span
          style={{
            fontFamily: "'DM Sans',sans-serif",
            fontSize: 12,
            color: "#9ca3af",
          }}
        >
          Menganalisis...
        </span>
      </div>
    );

  if (label === null || label === undefined)
    return (
      <div
        style={{
          padding: "7px 12px",
          borderRadius: 10,
          background: "#f9fafb",
          border: "1px solid #f3f4f6",
        }}
      >
        <span
          style={{
            fontFamily: "'DM Sans',sans-serif",
            fontSize: 12,
            color: "#d1d5db",
          }}
        >
          Model belum terhubung
        </span>
      </div>
    );

  const info = ML_LABELS[label] ?? ML_LABELS[1];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        borderRadius: 10,
        background: info.bg,
        border: `1.5px solid ${info.border}`,
      }}
    >
      <span style={{ fontSize: 18 }}>{info.icon}</span>
      <div>
        <p
          style={{
            margin: 0,
            fontFamily: "'DM Sans',sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1,
            color: info.color,
            textTransform: "uppercase",
          }}
        >
          Kondisi Ruangan
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: "'DM Sans',sans-serif",
            fontSize: 14,
            fontWeight: 700,
            color: info.color,
          }}
        >
          {info.text}
        </p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, unit, icon, fraction, color, warn }) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 18,
        padding: "18px 14px 14px",
        flex: "1 1 130px",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        position: "relative",
        transition: "all .3s",
        border: warn ? `1.5px solid ${color}40` : "1.5px solid #f3f4f6",
        boxShadow: warn ? `0 4px 20px ${color}18` : "0 2px 12px #0001",
      }}
    >
      {warn && (
        <span style={{ position: "absolute", top: 10, right: 10 }}>
          <Icon name="alert" size={15} color={color} />
        </span>
      )}
      <p
        style={{
          margin: 0,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          color: "#9ca3af",
          fontFamily: "'DM Sans',sans-serif",
        }}
      >
        {label}
      </p>
      <div style={{ position: "relative", width: 112, height: 112 }}>
        <GaugeArc fraction={fraction} color={color} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
          }}
        >
          {icon}
        </div>
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: "'DM Mono',monospace",
          fontWeight: 700,
          fontSize: 20,
          color: "#111",
          lineHeight: 1,
        }}
      >
        {value}
        <span style={{ fontSize: 12, fontWeight: 500, color, marginLeft: 2 }}>
          {unit}
        </span>
      </p>
    </div>
  );
}

function CommentItem({ comment }) {
  return (
    <div
      style={{
        padding: "9px 11px",
        borderRadius: 10,
        background: "#f9fafb",
        border: "1px solid #f3f4f6",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginBottom: 4,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#fef2f2",
            border: "1.5px solid #fecaca",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontWeight: 700,
            color: "#b91c1c",
            fontFamily: "'DM Sans',sans-serif",
            flexShrink: 0,
          }}
        >
          {(comment.user || "A")[0].toUpperCase()}
        </div>
        <span
          style={{
            fontFamily: "'DM Sans',sans-serif",
            fontSize: 12,
            fontWeight: 700,
            color: "#b91c1c",
          }}
        >
          {comment.user || "anonymous"}
        </span>
        {comment.ts && (
          <span
            style={{
              fontFamily: "'DM Mono',monospace",
              fontSize: 10,
              color: "#9ca3af",
              marginLeft: "auto",
            }}
          >
            {comment.ts}
          </span>
        )}
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: "'DM Sans',sans-serif",
          fontSize: 13,
          color: "#374151",
          lineHeight: 1.5,
        }}
      >
        {comment.text}
      </p>
    </div>
  );
}

function CommentSection({ comments, onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setLoading(true);
    const ts = new Date().toLocaleString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    await onAdd({ user: name.trim() || "anonymous", text: text.trim(), ts });
    setText("");
    setName("");
    setOpen(false);
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: "'DM Sans',sans-serif",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.5,
            color: "#9ca3af",
            textTransform: "uppercase",
          }}
        >
          Comments{" "}
          {comments.length > 0 && (
            <span
              style={{
                background: "#fef2f2",
                color: "#b91c1c",
                borderRadius: 10,
                padding: "1px 7px",
                fontSize: 11,
              }}
            >
              {comments.length}
            </span>
          )}
        </p>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            background: open ? "#b91c1c" : "#fff",
            color: open ? "#fff" : "#b91c1c",
            border: "1.5px solid #b91c1c",
            borderRadius: 8,
            padding: "4px 12px",
            fontFamily: "'DM Sans',sans-serif",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all .15s",
          }}
        >
          {open ? "Tutup" : "+ Tambah"}
        </button>
      </div>

      {open && (
        <div
          style={{
            background: "#fef2f2",
            border: "1.5px solid #fecaca",
            borderRadius: 12,
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            animation: "slideDown .2s ease",
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama kamu (opsional)"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1.5px solid #fecaca",
              background: "#fff",
              fontFamily: "'DM Sans',sans-serif",
              fontSize: 13,
              outline: "none",
              color: "#111",
            }}
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Tulis komentar..."
            rows={2}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1.5px solid #fecaca",
              background: "#fff",
              fontFamily: "'DM Sans',sans-serif",
              fontSize: 13,
              outline: "none",
              resize: "vertical",
              color: "#111",
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={loading || !text.trim()}
            style={{
              background: loading || !text.trim() ? "#9ca3af" : "#b91c1c",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 0",
              fontFamily: "'DM Sans',sans-serif",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading || !text.trim() ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              transition: "background .15s",
            }}
          >
            <Icon name="send" size={14} color="#fff" />
            {loading ? "Menyimpan..." : "Kirim Komentar"}
          </button>
        </div>
      )}

      {comments.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "22px 0",
            borderRadius: 12,
            border: "1.5px dashed #e5e7eb",
            background: "#fafafa",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "'DM Sans',sans-serif",
              fontSize: 13,
              color: "#d1d5db",
            }}
          >
            Belum ada komentar
          </p>
          <p
            style={{
              margin: "4px 0 0",
              fontFamily: "'DM Sans',sans-serif",
              fontSize: 11,
              color: "#e5e7eb",
            }}
          >
            Klik "+ Tambah" untuk mulai
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 7,
            maxHeight: comments.length > 4 ? 260 : "none",
            overflowY: comments.length > 4 ? "auto" : "visible",
            paddingRight: comments.length > 4 ? 4 : 0,
          }}
        >
          {comments.map((c, i) => (
            <CommentItem key={i} comment={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function SupportModal({ onClose }) {
  const [waPhone, setWaPhone] = useState("");
  const [waMsg, setWaMsg] = useState(
    "Halo, saya butuh bantuan dengan sistem monitoring ruangan.",
  );
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0007",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 20,
          width: 400,
          maxWidth: "92vw",
          padding: 26,
          boxShadow: "0 24px 64px #0003",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "'DM Sans',sans-serif",
              fontWeight: 700,
              fontSize: 17,
            }}
          >
            Support
          </p>
          <button
            onClick={onClose}
            style={{
              background: "#f3f4f6",
              border: "none",
              borderRadius: 8,
              width: 30,
              height: 30,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label
            style={{
              fontFamily: "'DM Sans',sans-serif",
              fontSize: 12,
              color: "#6b7280",
              fontWeight: 600,
            }}
          >
            Nomor WhatsApp
          </label>
          <input
            value={waPhone}
            onChange={(e) => setWaPhone(e.target.value)}
            placeholder="628123456789"
            style={{
              padding: "9px 12px",
              borderRadius: 9,
              border: "1.5px solid #e5e7eb",
              fontFamily: "'DM Mono',monospace",
              fontSize: 13,
              outline: "none",
            }}
          />
          <label
            style={{
              fontFamily: "'DM Sans',sans-serif",
              fontSize: 12,
              color: "#6b7280",
              fontWeight: 600,
            }}
          >
            Pesan
          </label>
          <textarea
            value={waMsg}
            onChange={(e) => setWaMsg(e.target.value)}
            rows={3}
            style={{
              padding: "9px 12px",
              borderRadius: 9,
              border: "1.5px solid #e5e7eb",
              fontFamily: "'DM Sans',sans-serif",
              fontSize: 13,
              resize: "vertical",
              outline: "none",
            }}
          />
          <button
            onClick={() =>
              window.open(
                `https://wa.me/${waPhone.replace(/\D/g, "")}?text=${encodeURIComponent(waMsg)}`,
                "_blank",
              )
            }
            style={{
              padding: "10px 0",
              background: "#25d366",
              border: "none",
              borderRadius: 11,
              color: "#fff",
              fontFamily: "'DM Sans',sans-serif",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              marginTop: 4,
            }}
          >
            Buka WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

const INIT_STATE = Object.fromEntries(
  ROOMS.map((r) => [
    r.id,
    {
      temp: null,
      hum: null,
      co2: null,
      timestamp: null,
      comments: [],
      loading: true,
      error: false,
      mlLabel: null,
      mlLoading: false,
    },
  ]),
);

export default function App() {
  const [activeId, setActiveId] = useState(ROOMS[0].id);
  const [navOpen, setNavOpen] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [roomData, setRoomData] = useState(INIT_STATE);
  const [lastRefresh, setLastRefresh] = useState(null);
  const navRef = useRef();

  const activeRoom = ROOMS.find((r) => r.id === activeId);
  const data = roomData[activeId];

  // ── Fetch satu room + ML predict ──────────────────────────────
  const fetchRoom = useCallback(async (room) => {
    // 1. Fetch Sheets
    let result = null;
    try {
      result = await fetchRoomData(room.sheetName);
    } catch (e) {
      console.error(`Sheets error [${room.sheetName}]:`, e);
    }

    setRoomData((prev) => ({
      ...prev,
      [room.id]: {
        ...prev[room.id],
        ...(result ?? {}),
        loading: false,
        error: !result,
        mlLoading: !!result, // mulai loading ML kalau data ada
      },
    }));

    // 2. ML predict (paralel, tidak blokir UI)
    if (result) {
      const label = await fetchPrediction(result.temp, result.hum, result.co2);
      setRoomData((prev) => ({
        ...prev,
        [room.id]: { ...prev[room.id], mlLabel: label, mlLoading: false },
      }));
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setRoomData((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([k, v]) => [k, { ...v, loading: true }]),
      ),
    );
    await Promise.all(ROOMS.map(fetchRoom));
    setLastRefresh(new Date());
  }, [fetchRoom]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, 60_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  useEffect(() => {
    const h = (e) => {
      if (navRef.current && !navRef.current.contains(e.target))
        setNavOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── Add comment ───────────────────────────────────────────────
  const handleAddComment = useCallback(
    async (newComment) => {
      const updated = [...(roomData[activeId]?.comments ?? []), newComment];
      setRoomData((prev) => ({
        ...prev,
        [activeId]: { ...prev[activeId], comments: updated },
      }));
      await writeCommentToSheet(activeRoom.sheetName, updated);
    },
    [activeId, activeRoom, roomData],
  );

  // ── Derived values ────────────────────────────────────────────
  const tempFrac = data.temp != null ? clamp(data.temp / 50, 0, 1) : 0;
  const humFrac = data.hum != null ? clamp(data.hum / 100, 0, 1) : 0;
  const co2Frac = data.co2 != null ? clamp(data.co2 / 2000, 0, 1) : 0;
  const tempColor = data.temp != null ? getColor("temp", data.temp) : "#e5e7eb";
  const humColor = data.hum != null ? getColor("hum", data.hum) : "#e5e7eb";
  const co2Color = data.co2 != null ? getColor("co2", data.co2) : "#e5e7eb";
  const co2Warn = data.co2 >= 1000;
  const tempWarn = data.temp >= 28 || data.temp <= 18;
  const humWarn = data.hum > 70 || data.hum < 30;

  const alerts = [];
  if (co2Warn)
    alerts.push({ level: "high", msg: "[High Risk] CO₂ terlalu tinggi" });
  if (data.co2 >= 800 && !co2Warn)
    alerts.push({ level: "warn", msg: "Cek sistem ventilasi" });
  if (tempWarn)
    alerts.push({
      level: "warn",
      msg: `Suhu ${data.temp <= 18 ? "terlalu rendah" : "terlalu tinggi"}`,
    });
  if (humWarn)
    alerts.push({
      level: "warn",
      msg: `Kelembapan ${data.hum < 30 ? "terlalu rendah" : "terlalu tinggi"}`,
    });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500;700&display=swap');
        *, *::before, *::after { box-sizing:border-box; }
        html, body { margin:0; padding:0; background:#7f1d1d; min-height:100vh; }
        ::-webkit-scrollbar { width:4px; } ::-webkit-scrollbar-thumb { background:#e5e7eb; border-radius:4px; }
        @keyframes slideDown { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @media (max-width:600px) {
          .db-body     { flex-direction:column !important; }
          .sidebar-dt  { display:none !important; }
          .metrics-row { flex-wrap:wrap !important; }
          .bot-section { flex-direction:column !important; }
          .cmt-col     { border-left:none !important; padding-left:0 !important;
                         border-top:1px solid #f3f4f6 !important; padding-top:16px !important; }
          .mob-nav     { display:flex !important; }
        }
      `}</style>

      <div
        style={{
          minHeight: "100vh",
          background: "#7f1d1d",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "clamp(8px,3vw,32px)",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 24,
            width: "100%",
            maxWidth: 920,
            boxShadow: "0 32px 80px #0005",
          }}
        >
          {/* ── Top bar ─────────────────────────────────────────── */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 24px",
              borderBottom: "1px solid #f3f4f6",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  background: "#b91c1c",
                  borderRadius: 10,
                  padding: "5px 12px",
                  fontFamily: "'DM Mono',monospace",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "#fff",
                }}
              >
                @AH4D Logo
              </div>
              <span style={{ color: "#e5e7eb", fontSize: 18 }}>|</span>
              <span
                style={{
                  fontFamily: "'DM Sans',sans-serif",
                  fontWeight: 600,
                  fontSize: 15,
                  color: "#111",
                }}
              >
                {activeRoom?.label}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {lastRefresh && (
                <span
                  style={{
                    fontFamily: "'DM Mono',monospace",
                    fontSize: 11,
                    color: "#9ca3af",
                  }}
                >
                  {lastRefresh.toLocaleTimeString("id-ID")}
                </span>
              )}
              <button
                onClick={fetchAll}
                style={{
                  background: "none",
                  border: "1.5px solid #e5e7eb",
                  borderRadius: 8,
                  width: 32,
                  height: 32,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "#b91c1c")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor = "#e5e7eb")
                }
              >
                <Icon name="refresh" size={14} color="#9ca3af" />
              </button>
              <button
                onClick={() => setShowSupport(true)}
                style={{
                  background: "none",
                  border: "1.5px solid #e5e7eb",
                  borderRadius: 9,
                  padding: "6px 16px",
                  fontFamily: "'DM Sans',sans-serif",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#374151",
                  transition: "all .15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#b91c1c";
                  e.currentTarget.style.color = "#fff";
                  e.currentTarget.style.borderColor = "#b91c1c";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = "#374151";
                  e.currentTarget.style.borderColor = "#e5e7eb";
                }}
              >
                Support
              </button>
            </div>
          </div>

          {/* ── Body ────────────────────────────────────────────── */}
          <div
            className="db-body"
            style={{ display: "flex", padding: "20px 24px 24px", gap: 18 }}
          >
            {/* Sidebar desktop */}
            <div
              ref={navRef}
              className="sidebar-dt"
              style={{ position: "relative", zIndex: 10 }}
            >
              <button
                onClick={() => setNavOpen((o) => !o)}
                style={{
                  background: "#b91c1c",
                  border: "none",
                  borderRadius: 14,
                  padding: "10px 8px",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  alignItems: "center",
                  boxShadow: "0 4px 16px #b91c1c40",
                }}
              >
                {ROOMS.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 8,
                      background:
                        r.id === activeId ? "#ffffff25" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "background .15s",
                    }}
                  >
                    <Icon name={r.icon} size={18} color="#fff" />
                  </div>
                ))}
              </button>
              {navOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    background: "#b91c1c",
                    borderRadius: 14,
                    minWidth: 210,
                    overflow: "hidden",
                    boxShadow: "0 8px 32px #0004",
                    zIndex: 20,
                    animation: "slideDown .15s ease",
                  }}
                >
                  {ROOMS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setActiveId(r.id);
                        setNavOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        padding: "12px 16px",
                        border: "none",
                        cursor: "pointer",
                        textAlign: "left",
                        background:
                          r.id === activeId ? "#7f1d1d" : "transparent",
                        fontFamily: "'DM Sans',sans-serif",
                        fontWeight: 700,
                        fontSize: 13,
                        color: "#fff",
                        transition: "background .1s",
                      }}
                      onMouseEnter={(e) => {
                        if (r.id !== activeId)
                          e.currentTarget.style.background = "#991b1b";
                      }}
                      onMouseLeave={(e) => {
                        if (r.id !== activeId)
                          e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <Icon name={r.icon} size={16} color="#fff" />
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Content */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 18,
                minWidth: 0,
              }}
            >
              {/* Mobile nav */}
              <div
                className="mob-nav"
                style={{
                  display: "none",
                  gap: 8,
                  overflowX: "auto",
                  paddingBottom: 2,
                }}
              >
                {ROOMS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setActiveId(r.id)}
                    style={{
                      flexShrink: 0,
                      padding: "6px 14px",
                      borderRadius: 20,
                      border: "none",
                      cursor: "pointer",
                      background: r.id === activeId ? "#b91c1c" : "#f3f4f6",
                      color: r.id === activeId ? "#fff" : "#374151",
                      fontFamily: "'DM Sans',sans-serif",
                      fontWeight: 600,
                      fontSize: 12,
                      transition: "all .15s",
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              {/* Metrics */}
              {data.loading ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 140,
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      border: "2px solid #b91c1c",
                      borderTopColor: "transparent",
                      borderRadius: "50%",
                      animation: "spin .8s linear infinite",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "'DM Sans',sans-serif",
                      fontSize: 13,
                      color: "#9ca3af",
                    }}
                  >
                    Memuat data...
                  </span>
                </div>
              ) : data.error ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "24px",
                    border: "1.5px dashed #fecaca",
                    borderRadius: 12,
                    background: "#fef2f2",
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 4px",
                      fontFamily: "'DM Sans',sans-serif",
                      fontSize: 13,
                      color: "#ef4444",
                    }}
                  >
                    Gagal memuat data dari sheet{" "}
                    <strong>{activeRoom?.sheetName}</strong>
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontFamily: "'DM Mono',monospace",
                      fontSize: 11,
                      color: "#fca5a5",
                    }}
                  >
                    Pastikan nama tab sheet benar &amp; akses sudah publik
                  </p>
                </div>
              ) : (
                <>
                  <div
                    className="metrics-row"
                    style={{ display: "flex", gap: 12 }}
                  >
                    <MetricCard
                      label="Temp"
                      value={data.temp ?? "-"}
                      unit="°C"
                      icon="🌡️"
                      fraction={tempFrac}
                      color={tempColor}
                      warn={tempWarn}
                    />
                    <MetricCard
                      label="Humidity"
                      value={data.hum ?? "-"}
                      unit="%"
                      icon="💧"
                      fraction={humFrac}
                      color={humColor}
                      warn={humWarn}
                    />
                    <MetricCard
                      label="CO₂"
                      value={data.co2 ?? "-"}
                      unit=" ppm"
                      icon="☁️"
                      fraction={co2Frac}
                      color={co2Color}
                      warn={co2Warn}
                    />
                  </div>

                  {/* Timestamp + ML badge */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    {data.timestamp && (
                      <p
                        style={{
                          margin: 0,
                          fontFamily: "'DM Mono',monospace",
                          fontSize: 11,
                          color: "#9ca3af",
                        }}
                      >
                        Data: {data.timestamp}
                      </p>
                    )}
                    <MLBadge label={data.mlLabel} loading={data.mlLoading} />
                  </div>
                </>
              )}

              <div style={{ borderTop: "1px solid #f3f4f6" }} />

              {/* Alerts + Comments */}
              <div
                className="bot-section"
                style={{ display: "flex", gap: 20, alignItems: "flex-start" }}
              >
                <div
                  style={{
                    flex: "0 0 auto",
                    minWidth: 190,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <p
                    style={{
                      margin: "0 0 2px",
                      fontFamily: "'DM Sans',sans-serif",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 1.5,
                      color: "#9ca3af",
                      textTransform: "uppercase",
                    }}
                  >
                    Status
                  </p>
                  {alerts.length === 0 ? (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span style={{ fontSize: 14 }}>✅</span>
                      <span
                        style={{
                          fontFamily: "'DM Sans',sans-serif",
                          fontSize: 13,
                          color: "#22c55e",
                          fontWeight: 500,
                        }}
                      >
                        Semua normal
                      </span>
                    </div>
                  ) : (
                    alerts.map((a, i) => (
                      <div
                        key={i}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 7,
                        }}
                      >
                        <Icon
                          name={a.level === "high" ? "alert" : "info"}
                          size={15}
                          color={a.level === "high" ? "#ef4444" : "#f59e0b"}
                        />
                        <span
                          style={{
                            fontFamily: "'DM Sans',sans-serif",
                            fontSize: 13,
                            lineHeight: 1.4,
                            fontWeight: 500,
                            color: a.level === "high" ? "#b91c1c" : "#78350f",
                          }}
                        >
                          {a.msg}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <div
                  className="cmt-col"
                  style={{
                    flex: 1,
                    borderLeft: "1px solid #f3f4f6",
                    paddingLeft: 20,
                    minWidth: 0,
                  }}
                >
                  <CommentSection
                    comments={data.comments}
                    onAdd={handleAddComment}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showSupport && <SupportModal onClose={() => setShowSupport(false)} />}
    </>
  );
}
