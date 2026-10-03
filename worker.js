// Private helper for VID CREATOR.
// Keys live here as secrets. The website never sees them.
// Deploy on Cloudflare Workers, then paste the worker URL into the app Settings.

const SYSP = {
  vidy: "You are Vidy, the editing assistant inside a video editor. The user edits only by prompt. Reply with ONLY JSON: {\"reply\":string,\"ops\":[{\"i\":number,...}]}. \"i\" is the 1-based scene number. Allowed op fields: d (seconds, 1-30), tr (Cut|Dissolve 0.4s|Wipe 0.3s|Whip 0.2s), mu (Off|Low|Medium|High), cs (caption size multiplier 0.7-1.8), t (new narration text), fx (none|push|pan|drift), search (stock footage search query). Only touch scenes the user asked about; use \"selected\" when they say \"this scene\". For questions or things you cannot do, return ops [] and explain briefly. Reply under 40 words, plain language.",
  plan: "You are a video director and writer. Input: an idea, topic or script, plus platform, format, length and style. If it is only a topic, write a tight script first. Reply with ONLY JSON: {\"title\":string,\"scenes\":[{\"name\":string,\"text\":string,\"visual\":string,\"type\":\"stock|ai|screen\",\"queries\":[string,string,string],\"emphasis\":[string],\"d\":number}]}. Scene count: Short 4-6, Medium 8-12, Long 14-20. text is the narration for that scene, one or two sentences. The visual must show what the narration says, described concretely. Use stock when real footage exists, ai only for fictional or impossible things, diagrams or custom graphics, and screen for screen recordings. queries are 2-4 word stock searches, never the whole sentence. emphasis lists 1-3 exact words from text to highlight in captions. Do not invent facts; if unsure, keep claims general."
};

function cors(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...extra
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ "Content-Type": "application/json" })
  });
}

async function gemini(env, route, payload) {
  const model = env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": env.GEMINI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSP[route] }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  if (!r.ok) return json({ error: "gemini", status: r.status }, r.status);
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  try { return json(JSON.parse(text)); }
  catch { return json({ reply: "I could not read that reply.", ops: [] }); }
}

async function pexels(env, url) {
  const kind = url.searchParams.get("kind") === "photo" ? "photo" : "video";
  const q = url.searchParams.get("q") || "nature";
  const o = url.searchParams.get("orientation") || "portrait";
  const api = kind === "photo"
    ? "https://api.pexels.com/v1/search"
    : "https://api.pexels.com/videos/search";
  const r = await fetch(`${api}?query=${encodeURIComponent(q)}&orientation=${o}&per_page=12`, {
    headers: { Authorization: env.PEXELS_API_KEY }
  });
  if (!r.ok) return json({ error: "pexels", status: r.status }, r.status);
  const j = await r.json();
  const out = kind === "photo"
    ? (j.photos || []).map(p => ({
        id: p.id, kind: "photo", thumb: p.src.medium, url: p.src.large2x,
        alt: p.alt, credit: p.photographer, page: p.url
      }))
    : (j.videos || []).map(v => {
        const files = (v.video_files || []).filter(x => x.file_type === "video/mp4");
        const f = files.sort((a, b) => a.width - b.width).find(x => x.width >= 720) || v.video_files?.[0];
        return {
          id: v.id, kind: "video", thumb: v.image, url: f?.link, dur: v.duration,
          w: v.width, h: v.height, alt: (v.url || "").split("/").slice(-2, -1)[0] || "",
          credit: v.user?.name, page: v.url
        };
      });
  return json(out);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (path === "/search") {
      if (!env.PEXELS_API_KEY) return json({ error: "missing pexels key" }, 500);
      return pexels(env, url);
    }
    if (path === "/vidy" || path === "/plan") {
      if (!env.GEMINI_API_KEY) return json({ error: "missing gemini key" }, 500);
      const payload = await request.json().catch(() => ({}));
      return gemini(env, path.slice(1), payload);
    }
    return json({ ok: true, routes: ["/vidy", "/plan", "/search"] });
  }
};
