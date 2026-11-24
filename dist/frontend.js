// src/capture.ts
var DEFAULT_CAPTURE_SETTINGS = {
  captureMode: "on-demand",
  cadenceSeconds: 5,
  changeThreshold: 6,
  autoStopMinutes: 30,
  maxEdge: 1280,
  jpegQuality: 0.7,
  thumbEdge: 320,
  excludeSelf: true,
  monitorSurfaces: "allow"
};
var GATE_EDGE = 32;
function fitWithin(width, height, maxEdge) {
  if (width <= 0 || height <= 0)
    return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (!(maxEdge > 0) || longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}
function toGrey(rgba) {
  const pixels = Math.floor(rgba.length / 4);
  const out = new Uint8Array(pixels);
  for (let i = 0;i < pixels; i++) {
    const o = i * 4;
    out[i] = Math.round(0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2]);
  }
  return out;
}
function meanAbsDiff(a, b) {
  if (a.length === 0 || b.length === 0)
    return 255;
  if (a.length !== b.length)
    return 255;
  let sum = 0;
  for (let i = 0;i < a.length; i++)
    sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}
function frameChanged(previous, current, threshold) {
  if (!previous)
    return { changed: true, diff: 255 };
  if (threshold <= 0)
    return { changed: true, diff: meanAbsDiff(previous, current) };
  const diff = meanAbsDiff(previous, current);
  return { changed: diff >= threshold, diff };
}
function base64ByteLength(b64) {
  if (!b64)
    return 0;
  let padding = 0;
  if (b64.endsWith("=="))
    padding = 2;
  else if (b64.endsWith("="))
    padding = 1;
  return Math.floor(b64.length * 3 / 4) - padding;
}
function dataUrlToBase64(dataUrl) {
  const comma = dataUrl.indexOf(",");
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
}
function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function classifyTrackLabel(label) {
  const trimmed = label.trim();
  if (!trimmed)
    return "empty";
  if (/^(window|screen|monitor|web-contents|browser|tab)[:\-]/i.test(trimmed))
    return "opaque-id";
  if (/^[a-z-]+:\/\//i.test(trimmed))
    return "opaque-id";
  if (/^\S{20,}$/.test(trimmed))
    return "opaque-id";
  return "title";
}
function titleCandidate(label) {
  if (classifyTrackLabel(label) !== "title")
    return null;
  let title = label.trim();
  title = title.replace(/\s+[—–-]\s+(Mozilla Firefox|Firefox|Google Chrome|Chromium|Microsoft\s?Edge|Brave|Opera|Vivaldi)\s*$/i, "").trim();
  title = title.slice(0, 80).trim();
  return title || null;
}
function watchingLine(w) {
  if (w.confirmed)
    return `Watching: ${w.confirmed}`;
  return w.candidate || w.lastConfirmed ? "Watching: ?" : "";
}
var STOP_WARNING_MS = 120000;
function stopWarningMs(windowMs) {
  return Math.min(STOP_WARNING_MS, Math.floor(windowMs / 2));
}
function stopWarningText(autoStopAt, stopWarnAt, now) {
  if (!autoStopAt || !stopWarnAt || now < stopWarnAt || now >= autoStopAt)
    return "";
  const secs = Math.ceil((autoStopAt - now) / 1000);
  return `Stops in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
var EYE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
  <circle cx="12" cy="12" r="3"/></svg>`;
var HOUSELIGHTS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a2 2 0 0 0 0-4 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0-4 0 2 2 0 0 0 0 4"/>
  <path d="M10 22 9 8"/><path d="m14 22 1-14"/>
  <path d="M20 8c.5 0 .9.4.8 1l-2.6 12c-.1.5-.7 1-1.2 1H7c-.6 0-1.1-.4-1.2-1L3.2 9c-.1-.6.3-1 .8-1Z"/></svg>`;
function isMobileUserAgent(ua) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}
function describeSupport(env) {
  if (!env.isSecureContext) {
    return {
      screen: false,
      note: "Sharing your screen needs a secure page (https or localhost). This page is plain http, so " + "the browser does not offer it. Take a photo and Choose a picture still work here."
    };
  }
  if (!env.hasGetDisplayMedia) {
    if (env.clientKind === "mobile" || env.clientKind === "pwa") {
      return {
        screen: false,
        note: "Phones and tablets cannot share their screen to a web page. Use the camera instead."
      };
    }
    if (env.clientKind === "desktop") {
      return {
        screen: false,
        note: "This Lumiverse desktop app cannot share your screen. Open Lumiverse in " + "a browser (Chrome, Edge, Firefox or Safari) to use Look."
      };
    }
    return {
      screen: false,
      note: "This browser cannot share your screen. Try Chrome, Edge, Firefox or Safari."
    };
  }
  if (env.clientKind === "desktop") {
    return {
      screen: true,
      note: "You are in the Lumiverse desktop app. Sharing your screen works here on Windows and, " + "unofficially, on macOS. If the share dialog misbehaves, open Lumiverse in a browser."
    };
  }
  return { screen: true, note: "" };
}
var TICK_WORKER_SOURCE = `
let timer = null;
self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type === 'start') {
    if (timer !== null) clearInterval(timer);
    const ms = Math.max(250, Number(msg.intervalMs) || 5000);
    timer = setInterval(() => self.postMessage({ type: 'tick', at: Date.now() }), ms);
  } else if (msg.type === 'stop') {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }
};
`.trim();
var DEFAULT_STANCE = "character";
var STANCES = [
  { id: "heckler", label: "Heckler", blurb: "Mocks what it sees, in a line or two. No help." },
  { id: "coach", label: "Coach", blurb: "Notices what you are doing and offers a pointer, without talking down." },
  { id: "character", label: "In character", blurb: "No act. The character is told what is on screen and reacts as themselves." },
  { id: "custom", label: "Custom", blurb: "Follows your own instruction, written under Custom instruction on the Who reacts card." }
];
function progressText(p) {
  if (p.phase === "seeing")
    return "Reading the picture…";
  if (p.phase === "searching")
    return "Looking things up…";
  const who = p.name?.trim() || "The character";
  if (p.seat && p.of && p.of > 1)
    return `${who} is ${p.seat > 1 ? "answering" : "writing"} (${p.seat} of ${p.of})…`;
  return `${who} is writing…`;
}
function speakerOf(boxSpeakers, chatId, seated) {
  const chosen = boxSpeakers?.[chatId];
  return chosen && seated.some((v) => v.id === chosen) ? chosen : null;
}

// src/prompt.ts
var DEFAULT_CUSTOM_INSTRUCTION = `[OOC: Here is what is {{seenVia}} right now:

{{scene}}

Always act in character. React to it as {{char}} would — no act to put on, no job to do. Say what you, {{char}}, would actually say on seeing this. One or two sentences.
{{ifhushed}}
{{hushed}} You saw everything that happened while you were hushed - comment on one of them and the fact that you'd been silenced.
{{/ifhushed}}
Guidelines:
- React to what is ACTUALLY on screen. Do not invent events you cannot see.
- Do not narrate the scene back — {{user}} is looking at it.
- No quotation marks. No "{{char}}:" name tag. Output only the comment itself.]`;
// spindle.json
var spindle_default = {
  version: "1.0.0",
  name: "Houselights",
  identifier: "houselights",
  author: "MissusMeesecks",
  github: "https://github.com/MissusMeesecks/Houselights",
  homepage: "https://github.com/MissusMeesecks/Houselights",
  description: "Your character watches your screen and heckles you about it. Screen, webcam or photo, in-character, in your chat.",
  permissions: [
    "generation",
    "chat_mutation",
    "chats",
    "characters",
    "ui_panels",
    "media",
    "web_search"
  ],
  entry_backend: "dist/backend.js",
  entry_frontend: "dist/frontend.js",
  minimum_lumiverse_version: "0.9.7"
};

// src/mediakey.ts
var SILENT_LOOP_SECONDS = 6;
function silentWavDataUrl(seconds = SILENT_LOOP_SECONDS) {
  const rate = 8000;
  const samples = rate * seconds;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  let bin = "";
  for (const b of bytes)
    bin += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(bin)}`;
}
function createMediaKeyLook(deps) {
  const session = deps.mediaSession !== undefined ? deps.mediaSession : typeof navigator !== "undefined" && ("mediaSession" in navigator) ? navigator.mediaSession : null;
  const doc = deps.doc ?? (typeof document !== "undefined" ? document : { visibilityState: "visible", hasFocus: () => true });
  const now = deps.now ?? (() => Date.now());
  let enabled = false;
  let audio = null;
  let holding = false;
  let holdError = null;
  let presses = 0;
  let last = null;
  const state = () => ({ supported: !!session, enabled, holding, holdError, presses, last });
  const changed = () => deps.onChange(state());
  const handler = () => {
    presses += 1;
    const outcome = deps.onPress();
    last = { at: now(), hidden: doc.visibilityState === "hidden", focused: doc.hasFocus(), holding, outcome };
    changed();
  };
  function claim() {
    if (!session)
      return;
    try {
      session.setActionHandler("nexttrack", handler);
      const Meta = globalThis.MediaMetadata;
      if (Meta && !session.metadata)
        session.metadata = new Meta({ title: "Houselights", artist: "Next-track key = Look" });
    } catch {}
  }
  function release() {
    if (!session)
      return;
    try {
      session.setActionHandler("nexttrack", null);
      session.metadata = null;
    } catch {}
  }
  return {
    state,
    setEnabled(on) {
      if (on === enabled)
        return;
      enabled = on;
      if (on)
        claim();
      else
        release();
      changed();
    },
    async setHold(on) {
      holdError = null;
      if (!on) {
        audio?.pause();
        audio = null;
        holding = false;
        if (session)
          session.playbackState = "none";
        changed();
        return;
      }
      if (holding)
        return;
      try {
        const a = deps.makeAudio ? deps.makeAudio() : new Audio;
        a.src = silentWavDataUrl();
        a.loop = true;
        await a.play();
        audio = a;
        holding = true;
        if (session)
          session.playbackState = "playing";
        if (enabled)
          claim();
      } catch (err) {
        holdError = err instanceof Error ? err.message : String(err);
        holding = false;
      }
      changed();
    },
    keepAlive() {
      if (!enabled)
        return;
      claim();
      if (!holding || !audio)
        return;
      if (session && session.playbackState !== "playing")
        session.playbackState = "playing";
      if (audio.paused)
        audio.play().catch(() => {});
    },
    destroy() {
      release();
      audio?.pause();
      audio = null;
      holding = false;
    }
  };
}

// src/reasoning.ts
var LIGHT_MODEL_EXAMPLES = "Gemma 4";
var LIGHT_MODEL_ADVICE = "Choose a light chat model, not a reasoning one: a reaction is a line or two, and a reasoning model thinks for seconds first. More in the guide.";
var LIGHT_MODEL_GUIDE = `Pick a light chat model, not a reasoning one. A heckle is one line; a reasoning or "Pro" model ` + `spends seconds and hundreds of tokens thinking before it says anything. DeepSeek V4 thinks by ` + `default (Flash as well as Pro), and reasoning-only models (DeepSeek R1, the o-series) can't be told ` + `not to. ${LIGHT_MODEL_EXAMPLES} answers in a second or two and is what Houselights is tested with.`;

// src/guide.ts
var GUIDE_TITLE = "Houselights";
function unwrapMarkdown(markdown) {
  const out = [];
  for (const line of markdown.split(`
`)) {
    const blank = line.trim() === "";
    const starts = /^(#{1,6} |[-*+] |\d+\. |```|\||>)/.test(line);
    const prev = out.length ? out[out.length - 1] : "";
    if (!blank && !starts && out.length && prev.trim() !== "" && !/^(#{1,6} |```)/.test(prev)) {
      out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
    } else {
      out.push(blank ? "" : line);
    }
  }
  return out.join(`
`);
}
var GUIDE_SOURCE = `# Houselights

Your character looks at your screen and reacts in its own voice. Start session, Look and Stop are in
the Houselights tab; the full settings hold what you set once.

## Session

**Start session** opens your browser's share dialog, where you choose a window or screen. While
anything is shared, the browser shows its own sharing indicator the whole time. **Look** sends one
picture, scaled down first. **Stop** ends the session, and so does the browser's own Stop sharing
button.

On a phone or tablet there is no screen sharing: your character sees through your camera or a
picture you choose, under **Camera and pictures**.

A session stops itself after 30 minutes; **Extend** adds more time, and the length is in the full
settings under Capture. For its last two minutes the widget shows **Stops in m:ss · Extend**.

When a session ends, by **Stop** or by itself, the character says one closing line about it: the
curtain call. It looks back on the session's most interesting moments. There is none after a session
under two minutes, after one with nothing worth mentioning, or while hushed, and **Curtain call when
a session ends**, under Pacing, turns it off.

## Watching

**Watching** is the name of the game or app on your screen, which the character is told. Houselights
suggests one and asks before using it. A confirmed name lasts for the session: the next session asks
**Still …?** and sends nothing until you answer. It also asks when the screen stops looking like
it (in Describe mode, after two looks in a row that clearly show something else).

## Box Seat

A Box Seat is a chat with more than one viewer: a group chat, or a solo chat with council members
sitting in it. Each Look goes viewer by viewer. One viewer opens, and the viewers take turns at
opening; the next one answers; each line is its own message. Each viewer has a stance of their own.

With more viewers than **Lines per Look**, the lines after the opener go to whoever has waited
longest.

## Look things up

With **Look things up** on in a chat, the character gets a few notes from your own Lumiverse web
search, whatever the stance. It is off by default and set for each chat. The search uses only the Watching name and the objective, mission or place name printed on
screen, never your picture or a window title.

- One search happens per change of that text, not per Look.
- A reaction marked "had notes" had them in front of it, which is not the same as using them.
- A Coach uses the notes to help. Every other stance is told to use them only where they fit who
  the character is, and never to recite them.
- Custom instructions need no special wording: the notes arrive in their own block, with their own
  rules (use them as your own knowledge, never quote them, ignore them if they do not fit). Your
  instruction can still steer them, for example "If you have notes about the game, slip in one
  thing you happen to know" or "Never give hints, even if you know them."

## The widget

The widget is a small floating window with the last picture, the newest reaction and the buttons
you need mid-chat. **Show widget** and **Hide widget**, at the top of the Houselights tab, switch it.
A computer and a phone or tablet each have their own switch.

On a phone or tablet the widget is a small toolbar over the chat instead: reactions are read in the
chat itself. Drag it anywhere; it remembers where, and moves up out of the way of the keyboard.
**Fold** folds it to the popcorn; tap the popcorn to bring it back. Tap **?** and then any button,
and the toolbar says what that button does without doing it.

The **Look** button in Lumiverse's input bar becomes **Send + look** while something is typed in the
chat box: a fresh Look, and your line goes with it as your message. The chat box empties once your
line is in the chat; if the Look fails, what you typed stays.

On the widget, **Send** answers with the last picture the character saw; **Send + look** takes a
fresh Look first (Ctrl+Enter). With the widget's own line empty, Send + look takes what is typed in
Lumiverse's chat box instead; the button lights up when it would. **Open in Lumiverse** takes you to
the chat reactions land in. In the expanded widget, a reaction marked **told: hush** had a hush
you pressed in its prompt, and **told: held back** means it was told it held back while you talked.

## Speaking aloud

**Speak reactions aloud** (under During the show) reads each reaction aloud. Each character speaks
in the voice set on its Voice tab in Lumiverse's character editor, or your default TTS voice if it
has none, so in a Box Seat every viewer can sound different. A council member has no card, so it
gets a Voice picker of its own under the Box Seat. **Speaks aloud** there picks everyone, or just one
viewer. With a pinned chat that isn't the one open on screen, reactions are still read aloud, but in
your default voice: Lumiverse finds a character's voice only for the chat you're looking at.
Hush and the mic stop speech at once. While a reaction is being read aloud, and for one minimum gap
after, a Continuous session holds its automatic Looks.

## Following your computer from a phone or tablet

With **Follow my computer** on, open the chat on your phone or tablet and reply from there. Type in
Lumiverse's chat box and the toolbar's **Look** button changes to **Send + look**: press it, and your
computer takes a fresh Look and your line goes with it. With the chat box empty the button reads
**Look**, and it just looks. The chat box's own menu has the same **Send + look**. **Photo** and **Picture** still use the phone's
own camera. If the
chat on screen is not the one Houselights is reacting in, the button says **Go to chat**. A phone or
tablet cannot start a session itself, and reactions to a Look your computer takes are read aloud on
the computer.

# The full settings

## Models

${LIGHT_MODEL_GUIDE}

**Let the models think** is off by default, and Houselights asks the model not to reason before it
answers. A model that reasons anyway is given extra room once, and remembered.

## Pacing

While hushed, the characters keep watching: interesting moments go into the chat as hidden notes, at
most one per minimum gap. In Describe the vision model keeps running, and costing, during a hush.

## Pinned chat

The list holds your most recent chats. While you're in another chat, reactions read aloud use your
default voice, not each character's own.

## Prompts

Each chat chooses its stance on the Who reacts card or on the widget, and a Custom instruction is
written there.

In **Box Seat focus**, **{{answerNote}}** names whose line to answer (empty for the opener) and
**{{talkNote}}** says you spoke to the Box Seat. Each viewer's own stance instruction still carries
what was seen.
`;
var GUIDE_MARKDOWN = unwrapMarkdown(GUIDE_SOURCE);

// src/icons.ts
var SHAPES = {
  "monitor-play": '<path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M12 17v4"/><path d="M8 21h8"/><rect x="2" y="3" width="20" height="14" rx="2"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  clapperboard: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  "scan-eye": '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/><path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  armchair: '<path d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"/><path d="M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z"/><path d="M5 18v2"/><path d="M19 18v2"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  "file-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  "volume-2": '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  "volume-x": '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
  "maximize-2": '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  "minimize-2": '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
  "picture-in-picture-2": '<path d="M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4"/><rect width="10" height="7" x="12" y="13" rx="2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
  "circle-help": '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'
};
var ICON_NAMES = Object.keys(SHAPES);
function iconSvg(name, size = 16) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${SHAPES[name]}</svg>`;
}
function icon(name, size = 16) {
  const span = document.createElement("span");
  span.className = `hl-icon hl-icon-${name}`;
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = iconSvg(name, size);
  return span;
}

// src/ui.ts
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children)
    node.append(c);
  return node;
}
function note(text, extraClass) {
  return el("p", { className: extraClass ? `hl-sub ${extraClass}` : "hl-sub", textContent: text });
}
function statusClass(kind) {
  return kind === "err" ? "hl-status err" : kind === "ok" ? "hl-status ok" : "hl-status";
}
var X_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
var SEARCH_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
function statusLines() {
  const statusEl = el("div", { className: "hl-status" });
  statusEl.setAttribute("role", "status");
  const failText = el("span");
  const dismiss = el("button", { className: "hl-icon-btn" });
  dismiss.type = "button";
  dismiss.innerHTML = X_ICON;
  dismiss.setAttribute("aria-label", "Dismiss");
  const failEl = el("div", { className: "hl-status err hl-failure" }, [failText, dismiss]);
  failEl.setAttribute("role", "alert");
  statusEl.hidden = true;
  failEl.hidden = true;
  const clearFailure = () => {
    failText.textContent = "";
    failEl.hidden = true;
  };
  dismiss.addEventListener("click", clearFailure);
  return {
    root: el("div", { className: "hl-lines" }, [statusEl, failEl]),
    status(text) {
      statusEl.textContent = text;
      statusEl.hidden = !text;
    },
    fail(text) {
      failText.textContent = text;
      failEl.hidden = !text;
    },
    clearFailure,
    get failure() {
      return failEl.hidden ? "" : failText.textContent ?? "";
    }
  };
}
var HELP_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
var openHelp = new Set;
var helpSetters = new WeakMap;
var helpSeq = 0;
function helpKey(label, content) {
  const first = Array.isArray(content) ? content[0] : content;
  const text = typeof first === "string" ? first : first?.textContent ?? "";
  return `${label}|${text.slice(0, 48)}`;
}
function helpTip(label, content, onOpen) {
  const id = `hl-help-${++helpSeq}`;
  const key = helpKey(label, content);
  const noteEl = el("div", { className: "hl-help", id });
  noteEl.setAttribute("role", "note");
  for (const part of Array.isArray(content) ? content : [content]) {
    noteEl.appendChild(typeof part === "string" ? el("p", { textContent: part }) : part);
  }
  const b = el("button", { className: "hl-help-btn" });
  b.type = "button";
  b.innerHTML = HELP_ICON;
  b.setAttribute("aria-label", `Help: ${label}`);
  b.setAttribute("aria-controls", id);
  const set = (open, remember = true) => {
    noteEl.hidden = !open;
    b.setAttribute("aria-expanded", String(open));
    if (!remember)
      return;
    if (open)
      openHelp.add(key);
    else
      openHelp.delete(key);
  };
  set(openHelp.has(key));
  helpSetters.set(noteEl, set);
  b.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const opening = noteEl.hidden;
    delete noteEl.dataset.hlBySearch;
    set(opening);
    if (opening)
      onOpen?.();
  });
  b.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !noteEl.hidden) {
      ev.stopPropagation();
      set(false);
    }
  });
  return { button: b, note: noteEl };
}
function helpRow(row, label, content) {
  const tip = helpTip(label, content);
  return el("div", { className: "hl-stack" }, [el("div", { className: "hl-helprow" }, [row, tip.button]), tip.note]);
}
function captionHelp(caption, label, content) {
  const tip = helpTip(label, content);
  const row = el("div", { className: "hl-caprow" }, [caption, tip.button]);
  if (caption.classList?.contains("hl-subhead-gap")) {
    caption.classList.remove("hl-subhead-gap");
    row.classList.add("hl-subhead-gap");
  }
  return el("div", { className: "hl-stack" }, [row, tip.note]);
}
function buttonClass(kind = "default") {
  return kind === "default" ? "hl-btn" : `hl-btn hl-btn-${kind}`;
}
function button(label, onClick, kind = "default") {
  const k = kind === true ? "primary" : kind === false ? "default" : kind;
  const b = el("button", { className: buttonClass(k), textContent: label });
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}
async function confirmDanger(ctx, title, message, confirmLabel) {
  const ui = ctx.ui;
  if (typeof ui.showConfirm === "function") {
    try {
      return (await ui.showConfirm({ title, message, variant: "danger", confirmLabel })).confirmed === true;
    } catch {
      return false;
    }
  }
  return typeof window !== "undefined" && typeof window.confirm === "function" ? window.confirm(`${title}

${message}`) : false;
}
var SEARCH_OUT = "hl-search-out";
var lower = (node) => (node?.textContent ?? "").toLowerCase();
function isCaption(node) {
  if (node.classList.contains("hl-subhead"))
    return true;
  const first = node.firstElementChild;
  return node.classList.contains("hl-stack") && !!first && first.classList.contains("hl-caprow");
}
function settingsSearch(scope) {
  const input = el("input", { className: "hl-search-input" });
  input.type = "text";
  input.placeholder = "Search settings";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Search settings");
  const glass = el("span", { className: "hl-search-icon" });
  glass.innerHTML = SEARCH_ICON;
  const clear = el("button", { className: "hl-icon-btn" });
  clear.type = "button";
  clear.innerHTML = X_ICON;
  clear.setAttribute("aria-label", "Clear the search");
  clear.hidden = true;
  const empty = el("div", { className: "hl-status" });
  empty.setAttribute("role", "status");
  empty.hidden = true;
  const root = el("div", { className: "hl-search" }, [el("div", { className: "hl-search-field" }, [glass, input, clear]), empty]);
  function apply() {
    const query = input.value.trim().toLowerCase();
    clear.hidden = !input.value;
    let shown = 0;
    const out = (node, hide) => {
      node.classList.toggle(SEARCH_OUT, hide);
    };
    for (const card of Array.from(scope.querySelectorAll("details.hl-fold[data-section]"))) {
      const body = Array.from(card.children).find((c) => c.classList.contains("hl-fold-body"));
      const rows = body ? Array.from(body.children) : [];
      if (!query) {
        out(card, false);
        for (const row of rows)
          out(row, false);
        if (card.dataset.hlBySearch) {
          delete card.dataset.hlBySearch;
          card.open = card.dataset.hlWasOpen === "1";
        }
        continue;
      }
      const head = Array.from(card.children).filter((c) => c.tagName === "SUMMARY" || c.classList.contains("hl-help"));
      const whole = head.some((c) => lower(c).includes(query));
      let any = whole;
      let caption = null;
      let captionHit = false;
      let previousOut = false;
      for (const row of rows) {
        if (row.classList.contains("hl-help")) {
          out(row, previousOut);
          continue;
        }
        if (isCaption(row)) {
          caption = row;
          captionHit = lower(row).includes(query);
          out(row, !(whole || captionHit));
          if (captionHit && !row.hidden)
            any = true;
          previousOut = !(whole || captionHit);
          continue;
        }
        const hit = whole || captionHit || lower(row).includes(query);
        out(row, !hit);
        previousOut = !hit;
        if (hit && !row.hidden) {
          any = true;
          if (caption)
            out(caption, false);
        }
      }
      out(card, !any);
      if (any) {
        shown++;
        if (!card.open) {
          if (!card.dataset.hlBySearch)
            card.dataset.hlWasOpen = "0";
          card.dataset.hlBySearch = "1";
          card.open = true;
        } else if (!card.dataset.hlBySearch) {
          card.dataset.hlWasOpen = "1";
        }
      }
    }
    empty.textContent = query && !shown ? "No settings match." : "";
    empty.hidden = !empty.textContent;
    revealHelp(scope, query);
  }
  input.addEventListener("input", apply);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && input.value) {
      ev.stopPropagation();
      input.value = "";
      apply();
    }
  });
  clear.addEventListener("click", () => {
    input.value = "";
    apply();
    input.focus();
  });
  return { root, input, apply };
}
function revealHelp(scope, query) {
  for (const n of Array.from(scope.querySelectorAll(".hl-help"))) {
    const set = helpSetters.get(n);
    if (!set)
      continue;
    if (query && lower(n).includes(query)) {
      if (n.hidden) {
        n.dataset.hlBySearch = "1";
        set(true, false);
      }
    } else if (n.dataset.hlBySearch) {
      delete n.dataset.hlBySearch;
      set(false, false);
    }
  }
}
function createUiKit(ctx) {
  const components = ctx.components && typeof ctx.components.mountSelect === "function" ? ctx.components : null;
  function scope() {
    const handles = [];
    const track = (h) => {
      handles.push(h);
      return h;
    };
    const some = (hint) => Array.isArray(hint) ? hint.length > 0 : !!hint;
    const labelled = (label, control, hint) => {
      const text = el("label", { textContent: label });
      if (!some(hint))
        return el("div", { className: "hl-row" }, [text, control]);
      const tip = helpTip(label, hint);
      const row = el("div", { className: "hl-row" }, [el("span", { className: "hl-label" }, [text, tip.button]), control]);
      return el("div", { className: "hl-stack" }, [row, tip.note]);
    };
    return {
      reset() {
        for (const h of handles.splice(0)) {
          try {
            h.destroy();
          } catch {}
        }
      },
      numberRow(label, value, attrs, onChange, hint) {
        if (components) {
          const slot = el("div", { className: "hl-control" });
          track(components.mountNumberStepper(slot, {
            value,
            min: attrs.min,
            max: attrs.max,
            step: attrs.step,
            disabled: attrs.disabled === true,
            onChange: (v) => {
              if (typeof v === "number" && Number.isFinite(v))
                onChange(v);
            }
          }));
          return labelled(label, slot, hint);
        }
        const input = el("input", { type: "number", value: String(value), className: "hl-input" });
        input.min = String(attrs.min);
        input.max = String(attrs.max);
        input.step = String(attrs.step);
        input.disabled = attrs.disabled === true;
        input.addEventListener("change", () => {
          const n = Number(input.value);
          if (Number.isFinite(n))
            onChange(n);
        });
        return labelled(label, input, hint);
      },
      checkboxRow(label, value, onChange, hint, disabled) {
        if (components) {
          const slot = el("div", { className: "hl-control-wide" });
          track(components.mountCheckbox(slot, { checked: value, label, onChange, disabled: disabled === true }));
          if (disabled)
            slot.classList.add("hl-disabled");
          return some(hint) ? helpRow(slot, label, hint) : slot;
        }
        const input = el("input", { type: "checkbox", checked: value, disabled: disabled === true });
        input.addEventListener("change", () => onChange(input.checked));
        const row = el("label", { className: "hl-row" }, [el("span", { textContent: label }), input]);
        return some(hint) ? helpRow(row, label, hint) : row;
      },
      rangeRow(label, value, attrs, onCommit, onDrag, hint) {
        if (components && typeof components.mountRangeSlider === "function") {
          const slot = el("div", { className: "hl-control-wide" });
          track(components.mountRangeSlider(slot, {
            label,
            value,
            min: attrs.min,
            max: attrs.max,
            step: attrs.step,
            integer: Number.isInteger(attrs.step),
            disabled: attrs.disabled === true,
            format: attrs.suffix ? { suffix: attrs.suffix } : undefined,
            onCommit: (v) => {
              if (Number.isFinite(v))
                onCommit(v);
            },
            onDragValue: onDrag
          }));
          if (attrs.disabled)
            slot.classList.add("hl-disabled");
          return some(hint) ? helpRow(slot, label, hint) : slot;
        }
        const shown = el("span", { textContent: `${value}${attrs.suffix ?? ""}` });
        const input = el("input", { type: "range", value: String(value) });
        input.min = String(attrs.min);
        input.max = String(attrs.max);
        input.step = String(attrs.step);
        input.disabled = attrs.disabled === true;
        input.addEventListener("input", () => {
          shown.textContent = `${input.value}${attrs.suffix ?? ""}`;
          onDrag?.(Number(input.value));
        });
        input.addEventListener("change", () => {
          const n = Number(input.value);
          if (Number.isFinite(n))
            onCommit(n);
        });
        const row = labelled(label, el("div", { className: "hl-range" }, [input, shown]), hint);
        if (attrs.disabled)
          row.classList.add("hl-disabled");
        return row;
      },
      selectRow(label, value, options, onChange, hint) {
        if (components) {
          const slot = el("div", { className: "hl-control" });
          track(components.mountSelect(slot, {
            value,
            options: options.map((o) => ({ value: o.value, label: o.label })),
            onChange: (v) => onChange(v),
            searchThreshold: 8
          }));
          return labelled(label, slot, hint);
        }
        const select = el("select", { className: "hl-input" });
        for (const o of options)
          select.appendChild(el("option", { value: o.value, textContent: o.label }));
        select.value = value;
        select.addEventListener("change", () => onChange(select.value));
        return labelled(label, select, hint);
      },
      textField(label, hint, value, rows, onInput, onReset) {
        const title = el("span", { textContent: label });
        const wrap = el("div", { className: "hl-field" });
        if (some(hint)) {
          const tip = helpTip(label, hint);
          wrap.append(el("div", { className: "hl-field-head" }, [title, tip.button]), tip.note);
        } else {
          wrap.appendChild(el("div", { className: "hl-field-head" }, [title]));
        }
        if (components) {
          const slot = el("div", { className: "hl-control-wide" });
          track(components.mountTextArea(slot, { value, rows, onChange: onInput }));
          wrap.appendChild(slot);
        } else {
          const area = el("textarea", { value, rows, className: "hl-input hl-prompt" });
          area.addEventListener("input", () => onInput(area.value));
          wrap.appendChild(area);
        }
        if (onReset) {
          const reset = () => {
            confirmDanger(ctx, `Reset ${label}`, "Your text for this prompt is replaced with the stock text.", "Reset").then((yes) => {
              if (yes)
                onReset();
            });
          };
          wrap.appendChild(el("div", { className: "hl-field-foot" }, [button("Reset to stock", reset, "small")]));
        }
        return wrap;
      },
      badge(text, color) {
        if (components) {
          const slot = el("span", { className: "hl-badge-slot" });
          const handle = track(components.mountBadge(slot, { text, color, size: "pill" }));
          return { element: slot, set: (t, c) => handle.update({ text: t, color: c }) };
        }
        const span = el("span", { className: `hl-badge hl-badge-${color}`, textContent: text });
        return {
          element: span,
          set: (t, c) => {
            span.textContent = t;
            span.className = `hl-badge hl-badge-${c}`;
          }
        };
      }
    };
  }
  return { native: components !== null, scope };
}
var SHARED_STYLES = `
  /* D-089: the four sizes (style guide §2), card title 1, label 0.92, help and status 0.8, caption
     0.72, of 14 px times Lumiverse's own text-size setting, as its own components scale. Every
     font-size in these stylesheets is one of the four variables (a test holds it). */
  .hl-panel, .hl-tab {
    --hl-fs-title: calc(14px * var(--lumiverse-font-scale, 1));
    --hl-fs-label: calc(12.88px * var(--lumiverse-font-scale, 1));
    --hl-fs-help: calc(11.2px * var(--lumiverse-font-scale, 1));
    --hl-fs-caption: calc(10.08px * var(--lumiverse-font-scale, 1));
    display: flex; flex-direction: column; gap: 14px; padding: 14px;
    font-size: var(--hl-fs-label); color: var(--lumiverse-text, inherit); }
  .hl-panel h3, .hl-tab h3 { margin: 0; font-size: var(--hl-fs-title); font-weight: 600; color: var(--lumiverse-text, inherit); }
  .hl-sub { margin: 0; font-size: var(--hl-fs-help); line-height: 1.5; color: var(--lumiverse-text-muted, inherit); opacity: 0.9; }
  /* D-089: two levels of chrome. A card is a border; nothing inside a card is another box. */
  .hl-group { display: flex; flex-direction: column; gap: 8px; padding: 12px;
              border-radius: var(--lumiverse-radius, 8px);
              border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.25));
              background: transparent; }
  details.hl-fold:not([open]) { row-gap: 0; }
  .hl-group .hl-fold:not(.hl-group) { border-top: 1px solid var(--lumiverse-border, rgba(128,128,128,0.25)); padding-top: 6px; }
  /* One caption for every group label inside a card: no dashes, no colons. */
  .hl-subhead, .hl-eyes-head, .hl-viewer-name {
    display: block; margin: 0; font-size: var(--hl-fs-caption); line-height: 1.5; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em; color: var(--lumiverse-text-muted, inherit); }
  .hl-subhead-gap { margin-top: 10px; }
  .hl-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; line-height: 0;
             color: var(--lumiverse-text-muted, currentColor); }
  .hl-icon svg { display: block; }
  .hl-card-title { display: inline-flex; align-items: center; gap: 8px; font-size: var(--hl-fs-title); }
  .hl-stack { display: flex; flex-direction: column; gap: 4px; }
  .hl-row { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
  .hl-row > label, .hl-row > .hl-label { flex: 0 1 auto; }
  .hl-label { display: inline-flex; align-items: center; gap: 2px; min-width: 0; }
  .hl-tab [hidden], .hl-panel [hidden], .hl-panel .hl-search-out { display: none !important; }
  .hl-help-btn { flex: none; display: inline-flex; align-items: center; justify-content: center;
                 width: 28px; height: 28px; margin: -6px 0; padding: 0; border: 0; border-radius: 50%;
                 background: transparent; cursor: pointer; color: var(--lumiverse-text-dim, var(--lumiverse-text-muted, currentColor));
                 opacity: 0.7; transition: opacity var(--lumiverse-transition-fast, 120ms), color var(--lumiverse-transition-fast, 120ms); }
  .hl-help-btn:hover, .hl-help-btn:focus-visible, .hl-help-btn[aria-expanded="true"] {
                 opacity: 1; color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-help-btn:focus-visible { outline: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); outline-offset: -4px; }
  .hl-help { display: flex; flex-direction: column; gap: 4px; margin: 2px 0 4px; padding: 4px 0 4px 10px;
             border-left: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor));
             font-size: var(--hl-fs-help); line-height: 1.5; color: var(--lumiverse-text-muted, inherit); }
  .hl-help p { margin: 0; }
  .hl-helprow { display: flex; align-items: flex-start; gap: 4px; }
  .hl-helprow > :first-child { flex: 1 1 auto; min-width: 0; }
  .hl-helprow > .hl-help-btn { margin: -4px 0; }
  .hl-caprow { display: flex; align-items: center; gap: 2px; }
  .hl-field-head { display: flex; align-items: center; gap: 2px; }
  .hl-field-head > span { font-size: var(--hl-fs-label); font-weight: 600; color: var(--lumiverse-text, inherit); }
  .hl-control { flex: 1 1 160px; max-width: 260px; min-width: 120px; }
  .hl-control > * { max-width: 100%; } /* a select is capped at its row's width (style guide §2) */
  .hl-control-wide { width: 100%; }
  /* D-086: Lumiverse's settings input (style guide §2), on the inputs Houselights draws itself
     (class hl-input). Never on a bare element selector: Lumiverse's own components render
     inside these panels and must keep their own look. */
  .hl-input { box-sizing: border-box; max-width: 100%; padding: 6px 10px; font: inherit; font-size: var(--hl-fs-label);
              border-radius: var(--lumiverse-radius, 8px);
              border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
              background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.08)); color: var(--lumiverse-text, inherit);
              transition: border-color var(--lumiverse-transition-fast, 120ms); }
  .hl-row > .hl-input, .hl-range { flex: 1 1 160px; max-width: 260px; min-width: 120px; }
  .hl-input:hover { border-color: var(--lumiverse-border-hover, var(--lumiverse-border, rgba(128,128,128,0.5))); }
  .hl-input:focus, .hl-input:focus-visible { outline: none; border-color: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); }
  textarea.hl-input { width: 100%; resize: vertical; line-height: 1.5; }
  textarea.hl-prompt { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: var(--hl-fs-help); }
  select.hl-input option { background: var(--lumiverse-bg, #1e1e1e); color: var(--lumiverse-text, inherit); }
  .hl-btn:focus-visible, .hl-icon-btn:focus-visible {
              outline: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); outline-offset: 1px; }
  .hl-row input[type="checkbox"] { flex: 0 0 auto; width: 16px; height: 16px; cursor: pointer;
              accent-color: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); }
  label.hl-row { cursor: pointer; }
  .hl-disabled { opacity: 0.55; }
  .hl-range { display: flex; align-items: center; gap: 8px; }
  .hl-range input[type="range"] { flex: 1 1 auto; accent-color: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); }
  .hl-field { display: flex; flex-direction: column; gap: 5px; }
  .hl-field-foot { display: flex; justify-content: flex-end; }
  .hl-btn { padding: 7px 14px; cursor: pointer; font-size: var(--hl-fs-label); font-family: inherit;
            border-radius: var(--lumiverse-radius, 6px);
            border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
            background: var(--lumiverse-fill, rgba(128,128,128,0.12)); color: var(--lumiverse-text, inherit);
            transition: border-color var(--lumiverse-transition-fast, 120ms), filter var(--lumiverse-transition-fast, 120ms); }
  .hl-btn:hover:not(:disabled) { border-color: var(--lumiverse-border-hover, var(--lumiverse-border, rgba(128,128,128,0.5))); filter: brightness(1.1); }
  .hl-btn:disabled { opacity: 0.4; cursor: default; }
  .hl-btn-primary { font-weight: 600; background: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2));
                    color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); border-color: transparent; }
  /* D-086: three intents and the one filled button (style guide §2). Small is 28 px high, the floor. */
  .hl-btn-small { padding: 3px 10px; font-size: var(--hl-fs-help); min-height: 28px; }
  .hl-btn-danger { background: transparent; color: var(--lumiverse-danger, rgb(220,70,70));
                   border-color: var(--lumiverse-danger-050, rgba(220,70,70,0.5)); }
  .hl-btn-danger:hover:not(:disabled) { filter: none; border-color: var(--lumiverse-danger, rgb(220,70,70));
                   background: var(--lumiverse-danger-015, rgba(220,70,70,0.15)); }
  .hl-btn.hl-btn-on { border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-btns { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .hl-btns-apart { margin-left: auto; }
  /* D-088: Reset to factory, a card's last line: small, dim until hovered, red then (style guide §2). */
  .hl-reset { opacity: 0.75; }
  .hl-reset:hover:not(:disabled), .hl-reset:focus-visible { opacity: 1; color: var(--lumiverse-danger, rgb(220,70,70));
                 border-color: var(--lumiverse-danger, rgb(220,70,70)); }
  .hl-card-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px; padding-top: 8px;
                  border-top: 1px dashed var(--lumiverse-border, rgba(128,128,128,0.3)); }
  .hl-card-foot > .hl-status { flex: 1 1 auto; min-width: 0; }
  .hl-icon-btn { flex: none; display: inline-flex; align-items: center; justify-content: center;
                 width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: transparent;
                 cursor: pointer; color: inherit; opacity: 0.7; }
  .hl-icon-btn:hover { opacity: 1; }
  /* D-086: status is a plain line, not a box; a failure is a line in the danger colour with a rule
     on its left (style guide §2). Colours are Lumiverse's own, set by its theme engine. */
  .hl-status { margin: 0; font-size: var(--hl-fs-help); line-height: 1.5; overflow-wrap: anywhere;
               color: var(--lumiverse-text-muted, inherit); }
  .hl-status.err { color: var(--lumiverse-danger, rgb(220,70,70)); padding-left: 8px;
                   border-left: 2px solid var(--lumiverse-danger, rgb(220,70,70)); }
  .hl-status.err .hl-sub { color: inherit; }
  .hl-failure { display: flex; align-items: flex-start; gap: 6px; }
  .hl-failure > span { flex: 1 1 auto; min-width: 0; }
  .hl-failure > .hl-icon-btn { margin: -5px 0; }
  .hl-lines { display: flex; flex-direction: column; gap: 4px; }
  .hl-lines:not(:has(> :not([hidden]))) { display: none; }
  /* D1: the search, after Lumiverse's SearchField. */
  .hl-search { display: flex; flex-direction: column; gap: 4px; }
  .hl-search-field { display: flex; align-items: center; gap: 6px; padding: 0 4px 0 10px; border-radius: 10px;
                     border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                     background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.08)); }
  .hl-search-field:focus-within { border-color: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); }
  .hl-search-icon { display: inline-flex; opacity: 0.6; flex: none; }
  .hl-search-input { flex: 1 1 auto; min-width: 0; box-sizing: border-box; padding: 6px 0; min-height: 30px; border: 0; outline: none;
                     background: transparent; color: var(--lumiverse-text, inherit); font: inherit; font-size: var(--hl-fs-label); }
  .hl-kinds { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 2px 12px; }
  .hl-kinds label.hl-row { justify-content: flex-start; gap: 6px; }
  .hl-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: var(--hl-fs-caption); font-weight: 600;
              letter-spacing: 0.04em; border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
              background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.2)); color: var(--lumiverse-text, inherit); }
  .hl-badge-danger { background: var(--lumiverse-danger, rgba(220,70,70,0.85)); color: #fff; border-color: transparent; }
  .hl-badge-success { background: var(--lumiverse-success, rgba(70,180,110,0.85)); color: #fff; border-color: transparent; }
  .hl-badge-warning { background: var(--lumiverse-warning, rgba(230,160,40,0.9)); color: #111; border-color: transparent; }
  .hl-badge-slot { display: inline-flex; }
  /* D-090: the phone, in one block at the end (style guide §6). Lumiverse's own test for a phone: a
     coarse pointer, or a window 600 px wide or less. The desktop reads none of it. */
  @media (pointer: coarse), (max-width: 600px) {
    .hl-panel .hl-btn, .hl-tab .hl-btn, .hl-panel .hl-icon-btn, .hl-tab .hl-icon-btn { min-height: 28px; min-width: 28px; }
    .hl-panel .hl-input, .hl-tab .hl-input, .hl-search-input { min-height: 28px; }
    .hl-tab input[type="checkbox"].hl-input, .hl-row input[type="checkbox"] { width: 20px; height: 20px; }
    /* Nothing hovers on a phone: what is faint until hovered is drawn at its hovered strength. */
    .hl-help-btn, .hl-icon-btn { opacity: 1; }
    .hl-reset { opacity: 1; }
  }
`;

// src/capture-tab.ts
var TAB_ICONS = { session: "monitor-play", who: "users", watching: "eye", during: "clapperboard" };
var HUSH_HELP = "They keep watching. They just can't talk about it.";
var TAB_STYLES = `
  /* D-054: a Box Seat viewer's block — their name, then their options indented under a rule. */
  /* D-054, D-089: a Box Seat viewer is a caption (their name) with their rows under it. */
  .hl-viewer { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
  .hl-viewer-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .hl-viewer-tag { font-weight: 600; font-size: var(--hl-fs-caption); padding: 1px 7px; border-radius: 999px; text-transform: none;
                   letter-spacing: 0; color: var(--lumiverse-text-muted, inherit); background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.15));
                   border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3)); }
  .hl-fold > summary { list-style: none; cursor: pointer; display: flex; flex-direction: row; align-items: center;
                       justify-content: space-between; gap: 8px; width: 100%; min-height: 28px; box-sizing: border-box; text-align: left; }
  .hl-fold-head { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .hl-fold > summary > span:first-child { text-align: left; }
  .hl-fold-title { font-size: var(--hl-fs-title); font-weight: 600; color: var(--lumiverse-text, inherit); }
  .hl-seg { display: flex; border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.35)); border-radius: 10px; overflow: hidden; margin: 8px 0; }
  .hl-seg-btn { flex: 1 1 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 9px 12px; cursor: pointer;
                background: transparent; color: var(--lumiverse-text, inherit); border: 0; font: inherit; text-align: left; }
  .hl-seg-btn + .hl-seg-btn { border-left: 1px solid var(--lumiverse-border, rgba(128,128,128,0.35)); }
  .hl-seg-btn:hover:not(.hl-seg-on) { background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.08)); }
  .hl-seg-btn:focus-visible { outline: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); outline-offset: -2px; }
  .hl-seg-on { background: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2)); color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); }
  .hl-seg-title { font-weight: 600; }
  .hl-seg-sub { font-size: var(--hl-fs-help); opacity: 0.85; }
  .hl-eyes-part { margin: 8px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .hl-token-hint { display: flex; flex-direction: column; gap: 4px; }
  .hl-fold-body { display: flex; flex-direction: column; gap: 8px; }
  .hl-fold > summary::-webkit-details-marker { display: none; }
  .hl-fold > summary:focus-visible { outline: 2px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); outline-offset: 2px; border-radius: 4px; }
  .hl-fold-chevron { display: inline-flex; width: 16px; height: 16px; flex: none; color: var(--lumiverse-text-muted, currentColor);
                     transition: transform var(--lumiverse-transition-fast, 120ms); }
  .hl-fold[open] > summary .hl-fold-chevron { transform: rotate(90deg); }
  .hl-fold[open] > summary { margin-bottom: 6px; }
  .hl-watch-input { flex: 1; min-width: 120px; }
  .hl-thumb { max-width: 100%; border-radius: 6px; display: block;
              border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.25)); }
  .hl-thumb-empty { height: 90px; border-radius: 6px; display: flex; align-items: center;
                    justify-content: center; opacity: 0.6; font-size: var(--hl-fs-help);
                    border: 1px dashed var(--lumiverse-border, rgba(128,128,128,0.35)); }
  .hl-counters { font-size: var(--hl-fs-help); opacity: 0.8; line-height: 1.6; }
  .hl-preview { max-width: 100%; border-radius: 6px; display: block; background: #000;
                border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.25)); }
  .hl-hidden-input { display: none; }
`;
var CANVAS_MISSING = "This browser cannot draw the picture Houselights needs. Try a current Chrome, Edge, Firefox or Safari.";
var PERMISSIONS = [
  { name: "generation", without: "Houselights cannot describe a picture or write a reaction." },
  { name: "chats", without: "Houselights cannot tell which chat you are in." },
  { name: "chat_mutation", without: "reactions cannot be put into the chat." },
  { name: "characters", without: "Houselights cannot read character names or a Box Seat's cards." },
  { name: "ui_panels", without: "the widget cannot be shown." },
  { name: "media", without: "the speaker and the mic stay hidden. Everything else works.", optional: true },
  { name: "web_search", without: "Look things up stays off. Everything else works.", optional: true }
];
function tokenHint(lines) {
  const box = el("div", { className: "hl-token-hint" });
  for (const line of lines) {
    const p = el("p", { className: "hl-sub" });
    for (const part of line.split(/(\{\{(?:scene|hushed|ifhushed|\/ifhushed)\}\})/)) {
      if (!part)
        continue;
      p.appendChild(/^\{\{\/?(?:scene|hushed|ifhushed)\}\}$/.test(part) ? el("strong", { textContent: part }) : document.createTextNode(part));
    }
    box.appendChild(p);
  }
  return box;
}
function leadNote(lead, rest) {
  return el("p", { className: "hl-sub" }, [el("strong", { textContent: lead }), document.createTextNode(` ${rest}`)]);
}
function stanceHelp(chosen) {
  const lines = STANCES.map((s) => el("p", {}, [el("strong", { textContent: `${s.label}:` }), document.createTextNode(` ${s.blurb.charAt(0).toLowerCase()}${s.blurb.slice(1)}`)]));
  if (chosen === "coach") {
    lines.push(leadNote("Recommended usage:", "Coach works best in solo chats with Look things up on, On demand chosen, and Next-track key = Look on."));
  }
  return lines;
}
function foldSummary(text, className, help, iconName) {
  const summary = el("summary", { className });
  const title = el("span", { textContent: text });
  const head = iconName ? [icon(iconName), title] : [title];
  if (help)
    head.push(help);
  summary.appendChild(el("span", { className: "hl-fold-head" }, head));
  const chevron = el("span", { className: "hl-fold-chevron" });
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  summary.appendChild(chevron);
  return summary;
}
function clampPct(value, fallback, min, max) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
var AWAIT_SILENCE_MS = 150000;
var CURTAIN_WINDOW_MS = 300000;
function createCaptureTab(deps) {
  const { ctx } = deps;
  const removeStyle = ctx.dom.addStyle(TAB_STYLES);
  const kit = createUiKit(ctx);
  const staticScope = kit.scope();
  const settingsScope = kit.scope();
  const chatScope = kit.scope();
  const quickScope = kit.scope();
  const deviceScope = kit.scope();
  const webScope = kit.scope();
  const env = detectEnvironment(ctx);
  const support = describeSupport(env);
  const phone = env.isMobile === true;
  const stoppedOrphan = stopOrphanedCapture();
  let session = null;
  let ticker = null;
  let previousGate = null;
  let busy = false;
  let status = stoppedOrphan ? { text: "Stopped a session left over from before Houselights reloaded.", kind: "info" } : { text: "", kind: "info" };
  let lastThumbDataUrl = null;
  let lastReceipt = null;
  let lastSentAt = 0;
  let lastRoundTripMs = null;
  let chat = { type: "chat_state", chat: null, enabled: false };
  let watchingState = { confirmed: null, candidate: null };
  const watchScope = kit.scope();
  let lastReaction = null;
  let awaitingReaction = false;
  let sessionEndedAt = 0;
  let working = null;
  let partialLines = [];
  let lastProgressAt = 0;
  const isAwaiting = () => awaitingReaction && Date.now() - lastProgressAt < AWAIT_SILENCE_MS;
  let companionSince = 0;
  let remoteLookTimer = null;
  let remoteStop = null;
  let remoteAsked = false;
  const REMOTE_LOOK_WAIT_MS = 1e4;
  function companionOn() {
    return phone && deps.getSettings()?.companionPhone === true;
  }
  function companionWaiting() {
    return companionSince > 0 && Date.now() - companionSince < AWAIT_SILENCE_MS;
  }
  function clearRemoteLookTimer() {
    if (remoteLookTimer !== null)
      clearTimeout(remoteLookTimer);
    remoteLookTimer = null;
  }
  function remoteLookFor(talk) {
    if (!companionOn() || isAwaiting() || companionWaiting())
      return;
    clearRemoteLookTimer();
    remoteAsked = true;
    companionSince = Date.now();
    status = { text: talk ? "Asked your computer to look and send your line…" : "Asked your computer to look…", kind: "info" };
    ctx.sendToBackend({ type: "remote_look", ...talk ? { talk } : {} });
    remoteLookTimer = setTimeout(() => {
      remoteLookTimer = null;
      if (!remoteAsked)
        return;
      remoteAsked = false;
      companionSince = 0;
      status = { text: "Your computer did not answer. Is a session still running there, in this Lumiverse?", kind: "err" };
      refresh();
    }, REMOTE_LOOK_WAIT_MS);
    refresh();
  }
  const counters = { ticks: 0, sent: 0, skipped: 0, received: 0, failed: 0, reactions: 0 };
  const listeners = new Set;
  let webcam = null;
  const settings = () => deps.getSettings() ?? DEFAULT_CAPTURE_SETTINGS;
  const mainCanvas = document.createElement("canvas");
  const thumbCanvas = document.createElement("canvas");
  const gateCanvas = document.createElement("canvas");
  gateCanvas.width = GATE_EDGE;
  gateCanvas.height = GATE_EDGE;
  const mainCtx = mainCanvas.getContext("2d");
  const thumbCtx = thumbCanvas.getContext("2d");
  const gateCtx = gateCanvas.getContext("2d", { willReadFrequently: true });
  const tab = ctx.ui.registerDrawerTab({
    id: "houselights",
    title: "Houselights",
    shortName: "Houselights",
    description: "Let your character see your screen",
    keywords: ["screen", "capture", "look", "eyes", "share"],
    headerTitle: "Houselights",
    iconSvg: HOUSELIGHTS_ICON,
    guide: { markdown: GUIDE_MARKDOWN, title: GUIDE_TITLE }
  });
  const panel = el("div", { className: "hl-tab" });
  tab.root.appendChild(panel);
  const stateBadge = staticScope.badge("Idle", "neutral");
  const widgetToggle = button("Hide widget", () => {
    const on = paneShownHere();
    deps.patch(phone ? { showPaneMobile: !on } : { showPane: !on });
    queueMicrotask(() => renderSettings());
  });
  widgetToggle.classList.add("hl-btn-small");
  const extendBtn = el("button", { className: "hl-btn", textContent: "Extend" });
  extendBtn.type = "button";
  const sessionLines = statusLines();
  let failedStatus = null;
  const startBtn = el("button", { className: "hl-btn hl-btn-primary", textContent: "Start session" });
  const lookBtn = el("button", { className: "hl-btn hl-btn-primary", textContent: "Look" });
  const stopBtn = el("button", { className: "hl-btn", textContent: "Stop" });
  const testBtn = el("button", { className: "hl-btn", textContent: "Send a test picture" });
  const thumbWrap = el("div");
  const receiptBox = el("div", { className: "hl-status", textContent: "" });
  const sessionClock = el("div", { className: "hl-counters" });
  const countersBox = el("div", { className: "hl-counters" });
  const modeSlot = el("div");
  const quickGroup = el("div", { className: "hl-fold-body" });
  const tabHushBtn = el("button", { className: "hl-btn", textContent: "Hush" });
  const tabHushTip = helpTip("Hush", HUSH_HELP);
  const hushQuiet = note("Quiet for a moment after you spoke. Hush keeps them quiet for longer.");
  hushQuiet.hidden = true;
  const back = {
    capture: el("div"),
    device: el("div"),
    webSearch: el("div"),
    voiceCheck: el("div"),
    troubleshooting: el("div")
  };
  const lookupBox = el("div");
  let lookupStatus = null;
  let lookupAsked = false;
  const appearance = el("details", { className: "hl-field hl-fold" });
  const permissionLine = el("div", { className: "hl-status" });
  permissionLine.hidden = true;
  const settingsGroup = back.capture;
  const chatGroup = el("div", { className: "hl-fold-body" });
  const watchGroup = el("div", { className: "hl-fold-body" });
  const widgetGroup = el("div", { className: "hl-fold-body" });
  const folds = new Map;
  const reactionLines = statusLines();
  let failedReaction = null;
  const sentToNote = note("");
  const webcamBtn = el("button", { className: "hl-btn", textContent: "Open webcam" });
  const snapBtn = el("button", { className: "hl-btn hl-btn-primary", textContent: "Snap" });
  const webcamCancelBtn = el("button", { className: "hl-btn", textContent: "Close webcam" });
  const webcamPreview = el("div");
  const photoBtn = el("button", { className: "hl-btn", textContent: "Take a photo" });
  const pictureBtn = el("button", { className: "hl-btn", textContent: "Choose a picture" });
  const otherLines = statusLines();
  const cameraInput = el("input", { type: "file", className: "hl-hidden-input" });
  cameraInput.accept = "image/*";
  cameraInput.setAttribute("capture", "environment");
  const pictureInput = el("input", { type: "file", className: "hl-hidden-input" });
  pictureInput.accept = "image/*";
  const lookAction = ctx.ui.registerInputBarAction({
    id: "houselights-look",
    label: "Look",
    subtitle: "Show your character the screen",
    iconSvg: EYE_ICON,
    enabled: support.screen
  });
  function draftToSend() {
    const draft = deps.composer?.current();
    return draft && draft.text && chat.chat && draft.chatId === chat.chat.id ? draft : null;
  }
  let lookActionShown = "";
  function renderLookAction() {
    const sends = draftToSend() !== null;
    const reacting = !!chat.chat && chat.enabled;
    const remote = companionOn();
    const enabled = remote ? reacting && !isAwaiting() && !companionWaiting() : !phone && support.screen && !busy && reacting && !isAwaiting();
    const label = sends ? "Send + look" : "Look";
    const subtitle = remote ? sends ? "Ask your computer to look, and send what you typed" : "Ask your computer to look" : sends ? "Show your character the screen and send what you typed" : session ? "Session live: send one picture now" : "Show your character the screen";
    const shown = `${enabled}|${label}|${subtitle}`;
    if (shown === lookActionShown)
      return;
    lookActionShown = shown;
    try {
      lookAction.setEnabled(enabled);
      lookAction.setLabel(label);
      lookAction.setSubtitle(subtitle);
    } catch {}
  }
  const unsubComposer = deps.composer?.onChange(renderLookAction) ?? (() => {});
  const unsubLookClick = lookAction.onClick(() => {
    const draft = draftToSend();
    if (draft)
      deps.composer?.sent(draft.chatId, draft.text);
    if (companionOn())
      remoteLookFor(draft?.text);
    else
      pressLook(draft?.text);
  });
  const clock = setInterval(() => {
    if (companionSince > 0 && !companionWaiting())
      companionSince = 0;
    if (session)
      mediaKey.keepAlive();
    if (session || awaitingReaction || companionSince > 0 || lookActionShown.startsWith("false") && companionOn())
      refresh();
    if (deps.hush?.state().hushed)
      renderHushButton();
  }, 1000);
  const onPageHide = () => stopEverything("pagehide");
  window.addEventListener("pagehide", onPageHide);
  webcamBtn.addEventListener("click", () => void openWebcam());
  snapBtn.addEventListener("click", () => void snapWebcam());
  webcamCancelBtn.addEventListener("click", () => closeWebcam());
  photoBtn.addEventListener("click", () => cameraInput.click());
  pictureBtn.addEventListener("click", () => void choosePicture());
  cameraInput.addEventListener("change", () => {
    const file = cameraInput.files?.[0];
    cameraInput.value = "";
    if (file)
      sendImageBlob(file, "camera");
  });
  pictureInput.addEventListener("change", () => {
    const file = pictureInput.files?.[0];
    pictureInput.value = "";
    if (file)
      sendImageBlob(file, "file");
  });
  const popOutWanted = () => deps.getSettings()?.showPane !== false && deps.getSettings()?.popoutOnStart === true && env.hasDocumentPictureInPicture && !!deps.popOut;
  startBtn.addEventListener("click", () => {
    const starting = session === null;
    startSession("button");
    if (starting && popOutWanted())
      deps.popOut?.();
  });
  lookBtn.addEventListener("click", () => pressLook());
  function pressLook(talk) {
    const starting = session === null && deps.getSettings()?.captureMode !== "paranoid" && !isAwaiting();
    look(talk ? "talk" : "look", talk);
    if (starting && popOutWanted())
      deps.popOut?.();
  }
  stopBtn.addEventListener("click", () => stopSession("button"));
  extendBtn.addEventListener("click", () => extendSession());
  testBtn.addEventListener("click", () => void sendSyntheticFrame());
  const voiceStatus = el("div", { className: "hl-status" });
  const voiceProviders = el("div", { className: "hl-status" });
  const voiceAllowBtn = el("button", { className: "hl-btn", textContent: "Allow voice" });
  const voiceTestBtn = el("button", { className: "hl-btn", textContent: "Say a test line" });
  const voiceResult = el("div", { className: "hl-status" });
  voiceResult.hidden = true;
  let ttsConnections = null;
  function setVoiceResult(text, kind) {
    voiceResult.className = statusClass(kind);
    voiceResult.textContent = text;
    voiceResult.hidden = false;
  }
  function renderVoice() {
    const v = deps.voice;
    if (!v) {
      voiceStatus.hidden = true;
      voiceProviders.hidden = true;
      voiceAllowBtn.hidden = true;
      voiceTestBtn.hidden = true;
      return;
    }
    const a = v.availability();
    const caps = ctx.host?.capabilities ?? {};
    const bits = [
      `Speaking: ${a.tts ? "available" : "not available"}`,
      `Listening: ${a.stt ? "available" : "not available"}`,
      `Media permission: ${a.media === null ? "checking…" : a.media ? "granted" : "not granted"}`
    ];
    voiceStatus.hidden = false;
    voiceStatus.className = statusClass("info");
    voiceStatus.textContent = bits.join(" · ");
    voiceAllowBtn.hidden = a.media !== false || !a.tts && !a.stt;
    voiceTestBtn.hidden = !(a.tts && a.media === true);
    voiceProviders.hidden = true;
    if (a.tts && a.media === true && ttsConnections === null && Number(caps["connection-kinds-v1"] ?? 0) >= 1 && ctx.connections) {
      ttsConnections = [];
      ctx.connections.list({ kind: "tts" }).then((list) => {
        ttsConnections = list.map((c) => ({ id: c.id, name: `${c.name}${c.voice ? ` — ${c.voice}` : ""}` }));
        renderChat();
      }).catch(() => {
        ttsConnections = [];
      });
    }
  }
  voiceAllowBtn.addEventListener("click", () => {
    const v = deps.voice;
    if (!v)
      return;
    voiceAllowBtn.disabled = true;
    v.requestMedia().then((granted) => {
      setVoiceResult(granted ? "Granted. The speaker and the mic are on the widget now." : "Not granted. You can grant it later in Lumiverse's Extensions panel.", granted ? "ok" : "info");
    }).finally(() => {
      voiceAllowBtn.disabled = false;
      renderVoice();
      refresh();
    });
  });
  voiceTestBtn.addEventListener("click", () => {
    const v = deps.voice;
    if (!v)
      return;
    setVoiceResult("Speaking…", "info");
    v.speakText("Houselights can speak. This is the default voice of your text-to-speech connection.").then(() => setVoiceResult("Spoke the test line in your default TTS voice, the one reactions use.", "ok")).catch((err) => setVoiceResult(`Could not speak: ${err instanceof Error ? err.message : String(err)}`, "err"));
  });
  const mediaKey = createMediaKeyLook({
    onPress: () => {
      const outcome = !session ? "no-session" : busy || isAwaiting() ? "busy" : "looked";
      if (outcome === "looked")
        look("look");
      else {
        status = {
          text: outcome === "busy" ? `Next-track key: still on the last Look. ${working ?? "Waiting for the reaction…"}` : "Next-track key: no session is running, so there is nothing to look at.",
          kind: "info"
        };
        refresh();
      }
      ctx.sendToBackend({ type: "media_key", outcome, hidden: document.visibilityState === "hidden" });
      return outcome;
    },
    onChange: () => refresh()
  });
  const mediaKeyWanted = () => deps.getSettings()?.mediaKeyLook === true && mediaKey.state().supported;
  function armMediaKey() {
    if (!mediaKeyWanted())
      return;
    mediaKey.setEnabled(true);
    mediaKey.setHold(true);
  }
  function disarmMediaKey() {
    mediaKey.setEnabled(false);
    mediaKey.setHold(false);
  }
  buildStaticLayout();
  renderSettings();
  renderChat();
  refresh();
  function foldOpen(id) {
    const s = deps.getSettings();
    const saved = s?.folds?.[id];
    if (typeof saved === "boolean")
      return saved;
    if (id === "models" && s?.modelsOpen === false)
      return false;
    return folds.get(id)?.open ?? true;
  }
  function applyFold(id) {
    const f = folds.get(id);
    if (f)
      f.el.open = foldOpen(id);
  }
  function registerFold(id, d, defaultOpen) {
    folds.set(id, { el: d, open: defaultOpen });
    d.open = foldOpen(id);
    d.addEventListener("toggle", () => {
      if (d.open === foldOpen(id))
        return;
      deps.patch({ folds: { ...deps.getSettings()?.folds ?? {}, [id]: d.open } });
    });
  }
  function section(id, title, body, defaultOpen = true, help) {
    const d = el("details", { className: "hl-group hl-fold" });
    const tip = help ? helpTip(title, help, () => {
      d.open = true;
    }) : null;
    d.appendChild(foldSummary(title, "hl-fold-title", tip?.button, id === "session" && phone ? "camera" : TAB_ICONS[id]));
    if (tip)
      d.appendChild(tip.note);
    d.appendChild(body);
    registerFold(id, d, defaultOpen);
    return d;
  }
  function buildStaticLayout() {
    panel.appendChild(permissionLine);
    panel.appendChild(el("div", { className: "hl-row" }, [widgetToggle, stateBadge.element]));
    renderPermissions();
    let sessionHelp;
    if (phone) {
      sessionHelp = "On a phone or tablet, your character sees through your camera or a picture you choose. Screen sharing needs a computer.";
    } else {
      sessionHelp = "Start session opens your browser's share dialog, where you choose a window or screen. " + "Look sends one picture, scaled down first. Stop ends the session, and so does the browser's own " + "Stop sharing button. A session also stops itself after a while; Extend adds more time. " + "Change the length in Settings → Capture. More in the guide.";
      if (!support.screen) {
        panel.appendChild(el("div", { className: "hl-status err", textContent: support.note }));
      } else if (support.note) {
        panel.appendChild(el("div", { className: "hl-status", textContent: support.note }));
      }
    }
    const controls = el("div", { className: "hl-fold-body" });
    const hushBits = deps.hush ? [tabHushBtn, tabHushTip.button] : [];
    const sessionBtns = el("div", { className: "hl-btns" }, phone ? [] : [startBtn, lookBtn, stopBtn, ...hushBits, extendBtn]);
    sessionBtns.style.alignItems = "center";
    if (phone)
      sessionBtns.append(...hushBits);
    if (!phone || hushBits.length > 0)
      controls.appendChild(sessionBtns);
    if (deps.hush)
      controls.append(tabHushTip.note, hushQuiet);
    if (!phone)
      controls.appendChild(modeSlot);
    controls.appendChild(sentToNote);
    controls.appendChild(sessionLines.root);
    controls.appendChild(sessionClock);
    const other = el("details", { className: "hl-field hl-fold hl-other-eyes" });
    other.appendChild(foldSummary("Other eyes", "hl-subhead"));
    registerFold("otherEyes", other, phone);
    const webcamOk = env.isSecureContext && env.hasGetUserMedia;
    const webcamPart = el("div", { className: "hl-eyes-part" });
    const webcamHead = el("span", { className: "hl-eyes-head", textContent: "Webcam" });
    if (webcamOk)
      webcamPart.appendChild(captionHelp(webcamHead, "Webcam", "A preview appears and you press Snap. The camera is switched off the moment the photo is taken."));
    else
      webcamPart.append(webcamHead, note("The webcam needs a secure page (https or localhost), so it is not offered here."));
    if (webcamOk) {
      webcamPart.appendChild(el("div", { className: "hl-btns" }, [webcamBtn, snapBtn, webcamCancelBtn]));
      webcamPart.appendChild(webcamPreview);
    }
    const phonePart = el("div", { className: "hl-eyes-part" });
    phonePart.appendChild(captionHelp(el("span", { className: "hl-eyes-head", textContent: "Camera and pictures" }), "Camera and pictures", "Take a photo opens the camera app on a phone or tablet, and a file chooser on a computer. Choose a picture " + "takes any picture stored here. Both are scaled down before they are sent."));
    phonePart.appendChild(el("div", { className: "hl-btns" }, [photoBtn, pictureBtn]));
    phonePart.appendChild(staticScope.checkboxRow("Prefer the front camera", false, (v) => cameraInput.setAttribute("capture", v ? "user" : "environment"), "Many phones and tablets ignore this. If yours does, switch cameras in the camera app."));
    if (phone)
      other.append(phonePart, webcamPart);
    else
      other.append(webcamPart, phonePart);
    other.appendChild(otherLines.root);
    other.appendChild(cameraInput);
    other.appendChild(pictureInput);
    if (phone)
      controls.insertBefore(other, controls.firstChild);
    else
      controls.appendChild(other);
    panel.appendChild(section("session", phone ? "Camera and pictures" : "Session", controls, true, sessionHelp));
    panel.appendChild(section("who", "Who reacts", chatGroup));
    const watchBody = el("div", { className: "hl-fold-body" }, [watchGroup, lookupBox]);
    watchGroup.className = "";
    panel.appendChild(section("watching", "Watching", watchBody));
    tabHushBtn.addEventListener("click", () => {
      const h = deps.hush?.state();
      deps.hush?.set(!(h?.hushed && h.source === "button"));
    });
    registerFold("widgetLook", appearance, false);
    quickGroup.className = "";
    widgetGroup.className = "";
    const during = el("div", { className: "hl-fold-body" }, [quickGroup, widgetGroup]);
    panel.appendChild(section("during", "During the show", during, true, "Things you might change mid-chat."));
    const seen = el("div", { className: "hl-group" });
    seen.appendChild(captionHelp(el("span", { className: "hl-fold-title hl-card-title" }, [icon("image"), el("span", { textContent: "Last sent" })]), "Last sent", "The last picture that left your browser, and what came back. This card never folds."));
    seen.appendChild(thumbWrap);
    seen.appendChild(receiptBox);
    seen.appendChild(reactionLines.root);
    panel.appendChild(seen);
    const openSettings = button("Open the full settings", () => {
      ctx.events.emit("open-settings", { view: "extensions" });
    }, "small");
    panel.appendChild(el("div", { className: "hl-btns" }, [openSettings]));
    back.voiceCheck.appendChild(voiceStatus);
    back.voiceCheck.appendChild(voiceProviders);
    back.voiceCheck.appendChild(el("div", { className: "hl-btns" }, [voiceAllowBtn, voiceTestBtn]));
    back.voiceCheck.appendChild(voiceResult);
    renderVoice();
    const t = back.troubleshooting;
    t.appendChild(captionHelp(el("span", { className: "hl-subhead hl-subhead-gap", textContent: "Test the connection" }), "Test the connection", "Sends a made-up picture, the size of a real one, with no share dialog and no character involved. " + "It shows whether pictures arrive whole. The result appears on the Last sent card."));
    t.appendChild(el("div", { className: "hl-btns" }, [testBtn]));
    t.appendChild(el("span", { className: "hl-subhead hl-subhead-gap", textContent: "Session details" }));
    t.appendChild(note(`Running in: ${env.clientKind} on ${env.platform}. Secure page: ${env.isSecureContext ? "yes" : "no"}. ` + `Screen sharing offered by the browser: ${env.hasGetDisplayMedia ? "yes" : "no"}.`));
    t.appendChild(countersBox);
  }
  function renderDevice(paneOnHere) {
    deviceScope.reset();
    const d = back.device;
    d.replaceChildren();
    const phonePane = deps.getSettings()?.showPaneMobile !== false;
    d.appendChild(deviceScope.checkboxRow("Show the widget", phonePane, (v) => {
      deps.patch({ showPaneMobile: v });
      queueMicrotask(() => renderSettings());
    }, "A phone or tablet has its own switch, on by default. Your computer's is the Hide widget button at the top of the Houselights tab."));
    d.appendChild(deviceScope.checkboxRow("Follow my computer", deps.getSettings()?.companionPhone === true, (v) => {
      deps.patch({ companionPhone: v });
      refresh();
    }, "Off by default. For playing on your computer with a phone or tablet beside you: the phone's toolbar asks your computer to look, " + "and sends what you typed in the chat box with it. A session must already be running on the computer. More in the guide.", !phonePane));
  }
  function renderHushButton() {
    const h = deps.hush?.state();
    const pressed = !!h && h.hushed && h.source === "button";
    const secs = Math.max(0, Math.ceil((h?.remainingMs ?? 0) / 1000));
    tabHushBtn.textContent = pressed ? `Hushed · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : "Hush";
    tabHushBtn.classList.toggle("hl-btn-on", pressed);
  }
  function renderQuick() {
    quickScope.reset();
    quickGroup.replaceChildren();
    if (deps.hush) {
      renderHushButton();
      const h = deps.hush.state();
      hushQuiet.hidden = !(h.hushed && h.source === "conversation");
    }
    const va = deps.voice?.availability();
    if (deps.setVoiceOut && va?.tts && va.media === true) {
      quickGroup.appendChild(quickScope.checkboxRow("Speak reactions aloud", deps.getSettings()?.voiceOut === true, (v) => deps.setVoiceOut?.(v), "Reads each reaction aloud. The same switch as the widget's speaker button. The voice is chosen in Lumiverse's TTS settings."));
    }
  }
  function paneShownHere() {
    return phone ? deps.getSettings()?.showPaneMobile !== false : deps.getSettings()?.showPane !== false;
  }
  function renderSettings() {
    for (const id of folds.keys())
      applyFold(id);
    const s = settings();
    settingsScope.reset();
    settingsGroup.replaceChildren();
    modeSlot.replaceChildren();
    const bar = el("div", { className: "hl-seg" });
    bar.setAttribute("role", "radiogroup");
    bar.setAttribute("aria-label", "Mode");
    const choices = [
      { value: "on-demand", title: "On demand", sub: "Start once, Look when you want" },
      { value: "continuous", title: "Continuous", sub: "Looks by itself on a timer" }
    ];
    for (const c of choices) {
      const on = s.captureMode === c.value;
      const b = el("button", { className: `hl-seg-btn${on ? " hl-seg-on" : ""}` }, [
        el("span", { className: "hl-seg-title", textContent: c.title }),
        el("span", { className: "hl-seg-sub", textContent: c.sub })
      ]);
      b.type = "button";
      b.dataset.mode = c.value;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(on));
      b.addEventListener("click", () => {
        if (settings().captureMode === c.value)
          return;
        deps.patch({ captureMode: c.value });
        syncTicker();
        refresh();
        queueMicrotask(() => renderSettings());
      });
      bar.appendChild(b);
    }
    modeSlot.appendChild(bar);
    if (s.captureMode === "paranoid") {
      modeSlot.appendChild(note("Paranoid is on: every Look opens the share dialog. Choose On demand or Continuous to turn it off."));
    }
    const paneOn = paneShownHere();
    widgetToggle.textContent = paneOn ? "Hide widget" : "Show widget";
    widgetToggle.classList.toggle("hl-btn-on", paneOn);
    const widgetTop = [];
    if (phone) {
      widgetTop.push(settingsScope.checkboxRow("Follow my computer", deps.getSettings()?.companionPhone === true, (v) => {
        deps.patch({ companionPhone: v });
        refresh();
      }, "Off by default. For playing on your computer with a phone or tablet beside you: the toolbar's Look asks your computer to look, " + "and sends what you typed in the chat box with it. A session must already be running on the computer.", !paneOn));
      if (deps.showTips && paneOn) {
        const tipsBtn = button("Show tips again", () => {
          deps.showTips?.();
          tipsBtn.textContent = "Tips will show again";
          tipsBtn.disabled = true;
        }, "small");
        widgetTop.push(el("div", { className: "hl-btns" }, [tipsBtn]));
      }
    }
    if (env.hasDocumentPictureInPicture && deps.popOut && !phone) {
      const pop = settingsScope.checkboxRow("Pop out on start", paneOn && deps.getSettings()?.popoutOnStart === true, (v) => deps.patch({ popoutOnStart: v }), paneOn ? "Start session and Start + Look also open the widget in its own window, which stays over your game." : "Needs the widget. Press Show widget first.", !paneOn);
      widgetTop.push(pop);
    }
    if (mediaKey.state().supported && !phone) {
      const box = settingsScope.checkboxRow("Next-track key = Look", deps.getSettings()?.mediaKeyLook === true, (v) => {
        deps.patch({ mediaKeyLook: v });
        if (v && session) {
          mediaKey.setEnabled(true);
          mediaKey.setHold(true);
        } else if (!v)
          disarmMediaKey();
      }, "While a session runs, your keyboard's next-track key takes a Look, even with a game in front. " + "To get the key, Houselights plays silence, so music players will not " + "skip on that key until the session stops.");
      widgetTop.push(box);
    }
    renderDevice(paneOn);
    renderQuick();
    widgetGroup.replaceChildren();
    for (const row of widgetTop)
      widgetGroup.appendChild(row);
    appearance.replaceChildren(foldSummary("Widget appearance", "hl-subhead"));
    widgetGroup.appendChild(appearance);
    applyFold("widgetLook");
    const portraitSize = clampPct(deps.getSettings()?.portraitSizePct, 25, 10, 90);
    const portraitOpacity = clampPct(deps.getSettings()?.portraitOpacityPct, 100, 10, 100);
    appearance.appendChild(settingsScope.rangeRow("Portrait size", portraitSize, { min: 10, max: 90, step: 5, suffix: "%", disabled: !paneOn }, (v) => {
      deps.previewPortrait?.(null);
      deps.patch({ portraitSizePct: v });
    }, (v) => deps.previewPortrait?.(v === null ? null : { sizePct: v }), "How tall the speaker's portrait is, as a share of the widget's picture. It grows with the widget."));
    appearance.appendChild(settingsScope.rangeRow("Portrait opacity", portraitOpacity, { min: 10, max: 100, step: 5, suffix: "%", disabled: !paneOn }, (v) => {
      deps.previewPortrait?.(null);
      deps.patch({ portraitOpacityPct: v });
    }, (v) => deps.previewPortrait?.(v === null ? null : { opacityPct: v }), "Lower values let the picture show through the portrait."));
    appearance.appendChild(settingsScope.rangeRow("Text size", clampPct(deps.getSettings()?.paneTextPct, 100, 70, 200), { min: 70, max: 200, step: 5, suffix: "%", disabled: !paneOn }, (v) => {
      deps.previewPortrait?.(null);
      deps.patch({ paneTextPct: v });
    }, (v) => deps.previewPortrait?.(v === null ? null : { textPct: v }), "The size of all text on the widget and its pop-out. Buttons keep their size."));
    appearance.appendChild(settingsScope.checkboxRow("Hide picture", deps.getSettings()?.paneHidePicture === true, (v) => deps.patch({ paneHidePicture: v }), "Hides the last picture on the widget. The portraits and the lines stay. The same switch as the widget's Hide picture button.", !paneOn));
    appearance.appendChild(settingsScope.checkboxRow("Lines only", deps.getSettings()?.paneLinesOnly === true, (v) => deps.patch({ paneLinesOnly: v }), "Shows only what the characters say and what you say. Everything else on the widget is hidden. " + "The same switch as the widget's Lines only button.", !paneOn));
    if (!paneOn)
      widgetGroup.appendChild(note("The widget is hidden. Press Show widget."));
    settingsGroup.appendChild(settingsScope.checkboxRow("Paranoid mode", s.captureMode === "paranoid", (v) => {
      deps.patch({ captureMode: v ? "paranoid" : "on-demand" });
      syncTicker();
      refresh();
      queueMicrotask(() => renderSettings());
    }, "When on, no session stays open: every Look opens the browser's share dialog and stops sharing straight after. Turning it off goes back to On demand."));
    settingsGroup.appendChild(el("span", { className: "hl-subhead hl-subhead-gap", textContent: "Continuous" }));
    settingsGroup.appendChild(settingsScope.numberRow("Look every (seconds)", s.cadenceSeconds, { min: 1, max: 120, step: 1 }, (v) => {
      deps.patch({ cadenceSeconds: v });
      syncTicker();
    }));
    settingsGroup.appendChild(settingsScope.numberRow("Skip a Look when the screen changed less than (0–255)", s.changeThreshold, { min: 0, max: 255, step: 1 }, (v) => deps.patch({ changeThreshold: v }), "How much the screen must change before a Look is sent. 0 sends every Look. About 6 ignores a moving cursor and catches a change of scene."));
    settingsGroup.appendChild(settingsScope.numberRow("Stop the session after (minutes)", s.autoStopMinutes, { min: 1, max: 240, step: 5 }, (v) => deps.patch({ autoStopMinutes: v })));
    settingsGroup.appendChild(el("span", { className: "hl-subhead hl-subhead-gap", textContent: "What leaves the browser" }));
    settingsGroup.appendChild(settingsScope.numberRow("Longest edge (pixels)", s.maxEdge, { min: 320, max: 2560, step: 64 }, (v) => deps.patch({ maxEdge: v })));
    settingsGroup.appendChild(settingsScope.numberRow("JPEG quality (0–1)", s.jpegQuality, { min: 0.3, max: 1, step: 0.05 }, (v) => deps.patch({ jpegQuality: v })));
    settingsGroup.appendChild(settingsScope.numberRow("Thumbnail edge (pixels)", s.thumbEdge, { min: 96, max: 640, step: 32 }, (v) => deps.patch({ thumbEdge: v })));
    settingsGroup.appendChild(captionHelp(el("span", { className: "hl-subhead hl-subhead-gap", textContent: "Share dialog" }), "Share dialog", "Chrome and Edge follow these two; other browsers ignore them. The share dialog is always the browser's own."));
    settingsGroup.appendChild(settingsScope.checkboxRow("Leave this Lumiverse tab out of the share dialog", s.excludeSelf, (v) => deps.patch({ excludeSelf: v })));
    settingsGroup.appendChild(settingsScope.checkboxRow("Offer whole-screen sharing", s.monitorSurfaces === "allow", (v) => deps.patch({ monitorSurfaces: v ? "allow" : "exclude" })));
  }
  const WATCHING_HELP = 'The character is told this is the game or app on your screen. It lasts for the session; the next one asks "Still this?". It also asks when the screen stops looking like it.';
  function renderWatching() {
    watchScope.reset();
    watchGroup.replaceChildren();
    const w = watchingState;
    const row = el("div", { className: "hl-row" });
    const editor = (initial, onSave) => {
      const input = el("input", { value: initial });
      input.type = "text";
      input.maxLength = 80;
      input.placeholder = "e.g. Palworld";
      input.setAttribute("aria-label", "What is on screen");
      const label = el("label", { className: "hl-sub", textContent: "What is on screen" });
      input.className = "hl-input hl-watch-input";
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          onSave(input.value);
        }
      });
      return { label, input, save: button("Save", () => onSave(input.value), true) };
    };
    if (w.candidate) {
      row.appendChild(el("span", { textContent: `${w.candidate.text}?` }));
      row.appendChild(button("Confirm", () => deps.ctx.sendToBackend({ type: "confirm_watching", text: w.candidate.text }), true));
      row.appendChild(button("Edit", () => {
        row.replaceChildren();
        const { label, input, save } = editor(w.candidate.text, (t) => deps.ctx.sendToBackend({ type: "confirm_watching", text: t }));
        row.append(label, input, save);
        input.focus();
      }));
      watchGroup.appendChild(row);
      watchGroup.appendChild(note(w.candidate.source === "label" ? "This is the window's title, from your browser. Nothing is sent until you confirm. Edit it if it says too much." : "The vision model thinks this is what is on screen. Nothing is sent until you confirm. Edit it if it is wrong."));
    } else if (!w.confirmed && w.lastConfirmed) {
      const last = w.lastConfirmed;
      row.appendChild(el("span", { textContent: `Still ${last}?` }));
      row.appendChild(button("Confirm", () => deps.ctx.sendToBackend({ type: "confirm_watching", text: last }), true));
      row.appendChild(button("Change", () => {
        row.replaceChildren();
        const { label, input, save } = editor(last, (t) => deps.ctx.sendToBackend({ type: "confirm_watching", text: t }));
        row.append(label, input, save);
        input.focus();
        input.select();
      }));
      watchGroup.appendChild(row);
      watchGroup.appendChild(note(w.doubt === "screen" ? "The screen stopped looking like this. Nothing is sent until you confirm or change it." : "This is from your last session. Nothing is sent until you confirm or change it."));
    } else if (w.confirmed) {
      row.appendChild(el("span", { textContent: w.confirmed }));
      row.appendChild(button("Edit", () => {
        row.replaceChildren();
        const { label, input, save } = editor(w.confirmed, (t) => deps.ctx.sendToBackend({ type: "confirm_watching", text: t }));
        row.append(label, input, save);
        input.focus();
      }));
      const clear = button("Clear", () => deps.ctx.sendToBackend({ type: "confirm_watching", text: "" }), "danger");
      clear.classList.add("hl-btns-apart");
      row.appendChild(clear);
      watchGroup.appendChild(helpRow(row, "Watching", WATCHING_HELP));
    } else {
      const { label, input, save } = editor("", (t) => deps.ctx.sendToBackend({ type: "confirm_watching", text: t }));
      row.append(label, input, save);
      watchGroup.appendChild(helpRow(row, "Watching", [
        WATCHING_HELP,
        "Houselights suggests a name from the window's title (in Firefox) or from what the vision model sees, and asks before using it. You can also type one."
      ]));
    }
  }
  async function renderPermissions() {
    let granted;
    try {
      granted = await ctx.permissions.getGranted();
    } catch {
      return;
    }
    const missing = PERMISSIONS.filter((p) => !granted.includes(p.name));
    const versions = `Houselights ${spindle_default.version}${ctx.host?.lumiverseVersion ? ` · Lumiverse ${ctx.host.lumiverseVersion}` : ""}`;
    permissionLine.hidden = false;
    permissionLine.replaceChildren();
    if (missing.length === 0) {
      permissionLine.className = statusClass("ok");
      permissionLine.textContent = `${versions} · all permissions granted`;
      return;
    }
    const blocking = missing.some((p) => !p.optional);
    permissionLine.className = statusClass(blocking ? "err" : "info");
    permissionLine.appendChild(el("strong", { textContent: `${versions} · ${missing.length} permission${missing.length === 1 ? "" : "s"} not granted` }));
    for (const p of missing)
      permissionLine.appendChild(el("div", { textContent: `${p.name}: ${p.without}` }));
    permissionLine.appendChild(note("Press Update for Houselights in Lumiverse's Extensions panel, then reload the page. If Houselights is already up to date, grant the permission in that panel."));
  }
  function renderWebSearch() {
    if (!lookupAsked) {
      lookupAsked = true;
      ctx.sendToBackend({ type: "get_lookup_status" });
    }
    webScope.reset();
    const w = back.webSearch;
    w.replaceChildren();
    if (!lookupStatus) {
      w.appendChild(note("Checking whether web search is available…"));
      return;
    }
    if (!lookupStatus.granted) {
      w.appendChild(note("Look things up needs Lumiverse's web search permission, which Houselights does not have yet. " + "Lumiverse asks you, or the server's owner, to approve it."));
      w.appendChild(el("div", { className: "hl-btns" }, [
        button("Allow web search", () => {
          ctx.permissions.request(["web_search"], { reason: "To look up notes about the game you confirmed, and only in chats where Look things up is on." }).catch(() => {
            return;
          }).then(() => {
            lookupStatus = null;
            ctx.sendToBackend({ type: "get_lookup_status" });
            renderChat();
          });
        })
      ]));
      return;
    }
    w.appendChild(el("div", {
      className: statusClass(lookupStatus.enabled === false ? "info" : "ok"),
      textContent: lookupStatus.enabled === false ? "Permission granted, but web search is off in Lumiverse. Turn it on in Lumiverse's settings, under Web Search." : "Web search is allowed and ready. Look things up is on the Watching card in the Houselights tab, one switch per chat."
    }));
  }
  function renderLookup() {
    lookupBox.replaceChildren();
    renderWebSearch();
    const current = chat.chat;
    if (!current)
      return;
    const s = deps.getSettings() ?? { visionMode: "describe" };
    const on = chat.lookUp === true;
    if (!lookupStatus) {
      lookupBox.appendChild(note("Checking whether web search is available…"));
      return;
    }
    if (!lookupStatus.granted) {
      lookupBox.appendChild(note("Look things up needs Lumiverse's web search permission first."));
      const go = button("Set up web search in the full settings", () => ctx.events.emit("open-settings", { view: "extensions" }), "small");
      lookupBox.appendChild(el("div", { className: "hl-btns" }, [go]));
      return;
    }
    lookupBox.appendChild(chatScope.checkboxRow("Look things up", on, (v) => {
      chat = { ...chat, lookUp: v };
      ctx.sendToBackend({ type: "set_chat_lookup", chatId: current.id, on: v });
      renderChat();
    }, "Off by default, and set for each chat. When on, the character gets a few notes from your own Lumiverse web search, whatever the stance. " + "The search uses only the Watching name and the objective, mission or place name printed on screen, never your picture or a window title. " + "More in the guide."));
    lookupBox.appendChild(leadNote("Potential spoilers:", "the notes may mention what comes next, such as a later area, a twist or an ending."));
    if (on) {
      const problems = [];
      const last = lookupStatus.last;
      lookupBox.appendChild(el("div", {
        className: statusClass(last ? last.error ? "err" : last.count > 0 ? "ok" : "info" : "info"),
        textContent: last ? `Last search (${new Date(last.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}): "${last.query}" ${last.error ? `failed: ${last.error}` : `found ${last.count} note${last.count === 1 ? "" : "s"}${typeof last.pages === "number" ? `, ${last.pages} from the page itself` : ""}.`}` : "No search yet this session. One happens when the character is about to speak and the screen shows an objective, a mission name or a place name."
      }));
      if (last?.notes && last.notes.length > 0) {
        const details = el("details", { className: "hl-fold hl-notes" });
        details.appendChild(foldSummary("Notes it was given", "hl-subhead"));
        last.notes.forEach((n, i) => details.appendChild(note(`${i + 1}. ${n.title ? `${n.title} — ` : ""}${n.text}`)));
        lookupBox.appendChild(details);
      }
      if (lookupStatus.enabled === false)
        problems.push("Web search is off in Lumiverse, so nothing will be found. Turn it on in Lumiverse's settings, under Web Search.");
      if (!watchingState.confirmed)
        problems.push("There is no Watching name yet, so there is nothing to search for. Confirm or type one on this card.");
      if (s.visionMode === "attach")
        problems.push("How the character sees is set to Attach, so there is no description to take search words from. Look things up needs Describe.");
      for (const text of problems)
        lookupBox.appendChild(el("div", { className: statusClass("info"), textContent: text }));
    }
  }
  let customDraft = null;
  let presetName = "";
  let presetChatId = null;
  let presetNote = null;
  function renderChat() {
    chatScope.reset();
    lookupBox.replaceChildren();
    renderWebSearch();
    chatGroup.replaceChildren();
    if (!chat.chat) {
      chatGroup.appendChild(el("div", { className: "hl-status", textContent: "No chat is open. Open a chat with a character first." }));
      return;
    }
    const current = chat.chat;
    const pinned = chat.mode === "pinned";
    const label = current.characterName ? `${current.characterName} · ${current.name}` : current.name;
    chatGroup.appendChild(chatScope.checkboxRow(`React in ${pinned ? "the pinned chat" : "this chat"}`, chat.enabled, (v) => {
      ctx.sendToBackend({ type: "set_chat_enabled", chatId: current.id, enabled: v });
    }, "When on, each Look puts a reaction in this chat, with a hidden note of what was seen. Each chat has its own switch."));
    chatGroup.appendChild(note(label));
    const pinRow = el("div", { className: "hl-row" });
    const pinBtn = button(pinned ? "Unpin" : "Pin this chat", () => {
      ctx.sendToBackend({ type: "pin_chat", chatId: pinned ? null : current.id });
    });
    pinRow.appendChild(pinBtn);
    if (pinned && chat.activeChatId !== current.id && deps.openChat) {
      pinRow.appendChild(button("Go to chat", () => deps.openChat?.(current.id)));
    }
    if (pinned) {
      const away = chat.activeChatId !== current.id;
      const where = chatScope.badge(away ? "You're elsewhere" : "You're here", away ? "warning" : "success");
      pinRow.appendChild(where.element);
    }
    const waiting = chat.newReactions ?? 0;
    const elsewhere = pinned && chat.activeChatId !== current.id;
    if (!pinned) {
      const pinTip = helpTip("Pin this chat", "Reactions go to whichever chat you have open. Pin this chat and they keep landing here, wherever you are.");
      pinRow.style.justifyContent = "flex-start";
      pinRow.appendChild(pinTip.button);
      chatGroup.append(pinRow, pinTip.note);
    } else
      chatGroup.appendChild(pinRow);
    if (pinned)
      chatGroup.appendChild(note(elsewhere ? `Pinned: reactions land in this chat while you are in another.${waiting ? ` ${waiting} new reaction${waiting === 1 ? "" : "s"} waiting.` : ""}` : "Pinned: reactions land in this chat wherever you are."));
    if (!chat.box && chat.council?.length) {
      chatGroup.appendChild(captionHelp(el("span", { className: "hl-subhead", textContent: "Council members" }), "Council members", "A council member you turn on watches alongside the character. With anyone on, this chat runs as a Box Seat: each viewer speaks in turn, with a stance of their own."));
      for (const v of chat.council) {
        chatGroup.appendChild(chatScope.checkboxRow(`${v.name} joins this chat`, false, (on) => ctx.sendToBackend({ type: "set_council_seat", chatId: current.id, viewerId: v.id, seated: on })));
      }
    }
    const stance = chat.stance ?? DEFAULT_STANCE;
    if (!chat.box) {
      const stanceRow = chatScope.selectRow("Stance", stance, STANCES.map((s) => ({ value: s.id, label: s.label })), (v) => {
        customDraft = null;
        ctx.sendToBackend({ type: "set_stance", chatId: current.id, stance: v });
      }, stanceHelp(stance));
      chatGroup.appendChild(stanceRow);
    }
    renderLookup();
    if (chat.box) {
      const box = chat.box;
      const seated = box.viewers.filter((v) => v.seated !== false);
      const council = box.viewers.filter((v) => v.kind === "council");
      const boxHelp = [
        "Each Look goes viewer by viewer. One opens (they take turns), the next answers, and each line is its own message. " + "Each viewer has a stance of their own. More in the guide."
      ];
      if (box.solo)
        boxHelp.push("This is a solo chat with council members sitting in it. Turn them all off and it is an ordinary solo chat again.");
      chatGroup.appendChild(captionHelp(el("span", { className: "hl-subhead", textContent: "Box Seat" }), "Box Seat", boxHelp));
      if (!box.stamping) {
        chatGroup.appendChild(note("This Lumiverse version can't give each line its own name and avatar, so each line starts with the speaker's name instead. Updating Lumiverse fixes it."));
      }
      if (council.length > 0) {
        chatGroup.appendChild(captionHelp(el("span", { className: "hl-subhead", textContent: "Council members" }), "Council members", "Turn on the council members who sit in this chat's Box Seat. Each chat keeps its own choice" + (box.solo ? "." : "; a group chat starts with all of them.") + " More in the guide."));
        for (const v of council) {
          chatGroup.appendChild(chatScope.checkboxRow(`${v.name} sits in this Box Seat`, v.seated !== false, (on) => ctx.sendToBackend({ type: "set_council_seat", chatId: current.id, viewerId: v.id, seated: on })));
        }
      }
      const settingsNow = deps.getSettings();
      const voiceOn = settingsNow?.voiceOut === true && !!deps.voice;
      const speakers = settingsNow?.boxSpeakers ?? {};
      const chosenSpeaker = speakers[current.id] && seated.some((v) => v.id === speakers[current.id]) ? speakers[current.id] : "";
      if (voiceOn) {
        chatGroup.appendChild(chatScope.selectRow("Speaks aloud", chosenSpeaker, [{ value: "", label: "Everyone, one after another" }, ...seated.map((v) => ({ value: v.id, label: `Only ${v.name}` }))], (id) => {
          const next = { ...speakers };
          if (id)
            next[current.id] = id;
          else
            delete next[current.id];
          deps.patch({ boxSpeakers: next });
          queueMicrotask(() => renderChat());
        }, "Each viewer is read in their character's own voice, from its Voice tab in Lumiverse. Choose one viewer to be read aloud and the rest stay on screen."));
      }
      for (const v of seated) {
        const block = el("div", { className: "hl-viewer" });
        const head = el("div", { className: "hl-viewer-name", textContent: v.name });
        if (v.kind === "council")
          head.appendChild(el("span", { className: "hl-viewer-tag", textContent: "council" }));
        if (voiceOn && chosenSpeaker === v.id)
          head.appendChild(el("span", { className: "hl-viewer-tag", textContent: "speaks aloud" }));
        block.appendChild(head);
        block.appendChild(chatScope.selectRow("Stance", v.stance, STANCES.map((s) => ({ value: s.id, label: s.label })), (st) => ctx.sendToBackend({ type: "set_viewer_stance", chatId: current.id, viewerId: v.id, stance: st }), stanceHelp(v.stance)));
        if (v.stance === "custom") {
          const presets = deps.getSettings()?.customPresets ?? [];
          const match = v.custom ? presets.find((p) => p.text.trim() === v.custom.trim()) : undefined;
          const value = !v.custom ? "" : match ? `preset:${match.name}` : "own";
          const options = [
            { value: "", label: "This chat's Custom instruction" },
            ...presets.map((p) => ({ value: `preset:${p.name}`, label: p.name })),
            ...value === "own" ? [{ value: "own", label: "Their own instruction (no longer saved under a name)" }] : []
          ];
          block.appendChild(chatScope.selectRow("Instruction", value, options, (picked) => {
            if (picked === "own")
              return;
            const text = picked.startsWith("preset:") ? presets.find((p) => `preset:${p.name}` === picked)?.text ?? "" : "";
            ctx.sendToBackend({ type: "set_viewer_custom", chatId: current.id, viewerId: v.id, text });
          }, presets.length === 0 ? "To give this viewer an instruction of their own, save one under a name with Save as, then choose it here." : undefined));
        }
        const readAloud = chosenSpeaker === "" || chosenSpeaker === v.id;
        if (voiceOn && readAloud && deps.boxVoice && ttsConnections && ttsConnections.length > 0 && (!box.stamping || v.kind === "council")) {
          block.appendChild(chatScope.selectRow("Voice", deps.boxVoice.get(v.id), [{ value: "", label: "Your default TTS connection" }, ...ttsConnections.map((c) => ({ value: c.id, label: c.name }))], (id) => deps.boxVoice?.set(v.id, id)));
        }
        chatGroup.appendChild(block);
      }
    }
    const anyCustom = chat.box ? chat.box.viewers.some((v) => v.seated !== false && v.stance === "custom") : stance === "custom";
    if (anyCustom) {
      const customHint = tokenHint([
        chat.box ? "Replaces the stance block for every Custom viewer in this chat who has no saved instruction chosen under their own name." : "Replaces the stance block for this chat.",
        "{{scene}} is where what was seen goes; if you leave it out, it is automatically placed at the start of your instructions.",
        '{{hushed}} is empty unless a hush is part of the moment — then it says so, e.g. "{{user}} hushed you for 4 minutes. That is over now, and this is the first thing you have said since."',
        "Wrap hush-only guidance in {{ifhushed}}…{{/ifhushed}} so that these instructions are only sent if a hush actually occurred.",
        "The base block still applies: framing and self-recognition (on the Prompts card in the full settings) and the Watching name.",
        "Until you write your own, the stock instruction is shown and used. Reset to stock puts it back."
      ]);
      const field = chatScope.textField("Custom instruction", customHint, customDraft ?? (chat.customStance?.trim() ? chat.customStance : DEFAULT_CUSTOM_INSTRUCTION), 6, (v) => {
        customDraft = v;
      });
      chatGroup.appendChild(field);
      const saveRow = el("div", { className: "hl-btns" });
      saveRow.appendChild(button("Save instruction", () => {
        ctx.sendToBackend({ type: "set_stance", chatId: current.id, stance: chat.box ? stance : "custom", custom: customDraft ?? chat.customStance ?? "" });
        customDraft = null;
      }));
      saveRow.appendChild(el("div", { className: "hl-btns hl-btns-apart" }, [
        button("Reset to stock", () => {
          confirmDanger(ctx, "Reset Custom instruction", "This chat's Custom instruction goes back to the stock one. What you wrote here is lost unless it is saved under a name.", "Reset").then((yes) => {
            if (!yes)
              return;
            customDraft = null;
            ctx.sendToBackend({ type: "set_stance", chatId: current.id, stance: chat.box ? stance : "custom", custom: "" });
          });
        }, "danger")
      ]));
      chatGroup.appendChild(saveRow);
      const presets = deps.getSettings()?.customPresets ?? [];
      const current_text = () => (customDraft ?? (chat.customStance?.trim() ? chat.customStance : DEFAULT_CUSTOM_INSTRUCTION) ?? "").trim();
      if (presetChatId !== current.id) {
        presetChatId = current.id;
        presetName = "";
      }
      const using = (chat.customStance ?? "").trim();
      const matching = using ? presets.filter((p) => p.text.trim() === using) : [];
      const selected = (matching.find((p) => p.name === presetName) ?? matching[0])?.name ?? "";
      chatGroup.appendChild(chatScope.selectRow("Saved instructions", selected, [{ value: "", label: presets.length ? "Choose one to use here…" : "None saved yet" }, ...presets.map((p) => ({ value: p.name, label: p.name }))], (name) => {
        const p = presets.find((x) => x.name === name);
        if (!p)
          return;
        presetName = p.name;
        customDraft = null;
        ctx.sendToBackend({ type: "set_stance", chatId: current.id, stance: chat.box ? stance : "custom", custom: p.text });
      }, "Choose one and it becomes this chat's Custom instruction. Saved instructions are shared by every chat."));
      const nameInput = el("input", { type: "text", value: presetName, placeholder: "e.g. Dry narrator", className: "hl-input" });
      nameInput.maxLength = 60;
      nameInput.addEventListener("input", () => {
        presetName = nameInput.value;
      });
      chatGroup.appendChild(el("div", { className: "hl-row" }, [el("label", { textContent: "Name" }), nameInput]));
      const presetStatus = el("div", { className: statusClass("info") });
      presetStatus.hidden = true;
      const say = (text, kind) => {
        presetNote = { text, kind };
        presetStatus.className = statusClass(kind);
        presetStatus.textContent = text;
        presetStatus.hidden = false;
      };
      if (presetNote) {
        presetStatus.className = statusClass(presetNote.kind);
        presetStatus.textContent = presetNote.text;
        presetStatus.hidden = false;
        presetNote = null;
      }
      const presetRow = el("div", { className: "hl-btns" });
      presetRow.appendChild(button("Save as", () => {
        const name = presetName.trim().slice(0, 60);
        const text = current_text();
        if (!name)
          return say("Give it a name first.", "err");
        if (!text)
          return say("Nothing to save: the Custom instruction is empty.", "err");
        const existed = presets.some((p) => p.name === name);
        const next = [...presets.filter((p) => p.name !== name), { name, text: text.slice(0, 4000) }].sort((a, b) => a.name.localeCompare(b.name));
        if (next.length > 50)
          return say("You already have 50 saved instructions. Delete one first.", "err");
        presetName = name;
        deps.patch({ customPresets: next });
        ctx.sendToBackend({ type: "set_stance", chatId: current.id, stance: chat.box ? stance : "custom", custom: text });
        customDraft = null;
        say(existed ? `Updated "${name}".` : `Saved "${name}".`, "ok");
        queueMicrotask(() => renderChat());
      }));
      const deleteBtn = button("Delete", () => {
        const name = presetName.trim();
        if (!presets.some((p) => p.name === name))
          return say(name ? `No saved instruction is called "${name}".` : "Choose or type the name to delete.", "err");
        confirmDanger(ctx, "Delete saved instruction", `Delete "${name}"? Chats that already use it keep their instruction.`, "Delete").then((yes) => {
          if (!yes)
            return;
          const now = deps.getSettings()?.customPresets ?? [];
          deps.patch({ customPresets: now.filter((p) => p.name !== name) });
          presetName = "";
          say(`Deleted "${name}". This chat keeps its instruction.`, "info");
          queueMicrotask(() => renderChat());
        });
      }, "danger");
      presetRow.appendChild(el("div", { className: "hl-btns hl-btns-apart" }, [deleteBtn]));
      chatGroup.appendChild(presetRow);
      chatGroup.appendChild(presetStatus);
    }
  }
  function describeReaction(r) {
    if (r.ok) {
      const seen = r.scene ? ` (saw: ${r.scene})` : "";
      const guess = r.app ? ` · the vision model thinks it is ${r.app} (${Math.round((r.appConfidence ?? 0) * 100)}%)` : r.scene ? " · the vision model named no game or app" : "";
      const told = (r.watching ? ` · told: in ${r.watching}` : "") + (r.lookedUp ? ` · had notes: "${r.lookedUp.query}" (${r.lookedUp.fresh ? "searched now" : "reused"})` : "") + (r.hushTold === "hush" ? " · told about a hush" : r.hushTold === "quiet" ? " · told it held back while you talked" : "");
      if (r.lines && r.lines.length) {
        const script = r.lines.map((l) => `${l.name || "(unattributed)"}: ${l.text}`).join(" | ");
        const asked = r.boxOrder?.length ? `asked ${r.boxOrder.join(", then ")}. ` : "";
        const got = `${asked ? "Got" : "got"} ${r.lines.length} line${r.lines.length === 1 ? "" : "s"} (${r.lines.map((l) => l.name || "unattributed").join(", ")})`;
        return { text: `Box Seat: ${asked}${got}: ${script}${seen}${guess}${told}`, kind: "ok" };
      }
      return { text: `Reaction: "${r.text}"${seen}${guess}${told}`, kind: "ok" };
    }
    if (r.error)
      return { text: `Reaction failed: ${r.error}`, kind: "err" };
    const d = r.detail ?? {};
    switch (r.reason) {
      case "no-chat":
        return { text: "No chat to react in.", kind: "info" };
      case "chat-off":
        return { text: "Reactions are off for this chat. Turn on React in this chat, on the Who reacts card.", kind: "info" };
      case "busy":
        return { text: "Held back: a reply was being written in the chat.", kind: "info" };
      case "already-reacting":
        return { text: "Still on the previous picture.", kind: "info" };
      case "hush":
        return {
          text: (d.source === "conversation" ? "Staying quiet while you two are talking." : "Hushed.") + (d.kept ? " Still watching: noted what it saw." : ""),
          kind: "info"
        };
      case "cooldown":
        return { text: `Saw it. Staying quiet for another ${Math.ceil(Number(d.waitMs ?? 0) / 1000)} seconds (the minimum gap).`, kind: "info" };
      case "kind":
        return { text: `Not commenting on this (${String(d.kind)}).`, kind: "info" };
      case "boring":
        return { text: `Rated it ${String(d.interest)} out of 10, below your bar of ${String(d.bar)}.`, kind: "info" };
      case "repeat":
        return { text: "Nothing new since the last reaction.", kind: "info" };
      default:
        return { text: "Nothing said.", kind: "info" };
    }
  }
  function snapshot() {
    return {
      live: session !== null,
      busy,
      startedAt: session?.startedAt ?? null,
      autoStopAt: session?.autoStopAt ?? remoteStop?.at ?? null,
      stopWarnAt: session ? session.autoStopAt - stopWarningMs(session.windowMs) : remoteStop ? remoteStop.at - stopWarningMs(remoteStop.windowMs) : null,
      lastThumbDataUrl,
      lastReaction,
      awaitingReaction: isAwaiting() || companionWaiting(),
      working: isAwaiting() ? working : companionWaiting() ? remoteAsked ? "Asking your computer to look…" : "Your computer is looking…" : null,
      partialLines: isAwaiting() ? partialLines : [],
      chat,
      watching: watchingState,
      canCapture: support.screen,
      mediaKeyHeld: mediaKey.state().enabled && mediaKey.state().holding,
      status
    };
  }
  function notify() {
    if (listeners.size === 0)
      return;
    const s = snapshot();
    for (const l of listeners) {
      try {
        l(s);
      } catch {}
    }
  }
  function refresh() {
    notify();
    const live = session !== null;
    const s = settings();
    stateBadge.set(live ? "LIVE" : "Idle", live ? "danger" : "neutral");
    const waiting = chat.newReactions ?? 0;
    tab.setBadge(waiting > 0 ? `${waiting} new` : live ? "LIVE" : null);
    extendBtn.disabled = !live;
    extendBtn.textContent = `Extend +${Math.max(1, s.autoStopMinutes)} min`;
    extendBtn.style.display = live ? "" : "none";
    const reacting = !!chat.chat && chat.enabled;
    startBtn.disabled = !support.screen || live || busy || s.captureMode === "paranoid" || !reacting;
    lookBtn.disabled = !support.screen || busy || !reacting || isAwaiting();
    const offReason = !chat.chat ? "Open a chat with a character first." : "Turn on React in this chat, on the Who reacts card, first.";
    stopBtn.disabled = !live;
    lookBtn.textContent = busy ? "Looking…" : live || s.captureMode === "paranoid" ? "Look" : "Start + Look";
    const ambient = live ? s.captureMode === "continuous" ? "Live. Houselights looks by itself; Look still works." : "Live. Press Look when you want a reaction." : !reacting ? `No session. ${offReason}` : "No session.";
    if (status.kind === "err") {
      if (status !== failedStatus) {
        failedStatus = status;
        sessionLines.fail(status.text);
      }
      sessionLines.status(ambient);
    } else {
      sessionLines.status(status.text || ambient);
    }
    if (session) {
      const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
      const left = Math.max(0, Math.ceil((session.autoStopAt - Date.now()) / 1000));
      sessionClock.textContent = `Live for ${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s · ` + `stops itself in ${Math.floor(left / 60)}m ${String(left % 60).padStart(2, "0")}s`;
    } else {
      sessionClock.textContent = "";
    }
    sessionClock.hidden = !sessionClock.textContent;
    const details = [];
    if (session) {
      details.push(describeStream(session.stream));
      details.push(`Timer: ${ticker ? ticker.kind === "worker" ? "in the background (keeps time behind a game)" : "on the page (may slow down behind a game)" : "off"}.`);
    }
    details.push(`Looks ${counters.ticks} · sent ${counters.sent} · skipped, nothing changed ${counters.skipped} · received ${counters.received}` + ` · reactions ${counters.reactions}` + (counters.failed ? ` · failed ${counters.failed}` : ""));
    countersBox.replaceChildren(...details.map((d) => el("div", { textContent: d })));
    thumbWrap.replaceChildren(lastThumbDataUrl ? el("img", { className: "hl-thumb", src: lastThumbDataUrl, alt: "The last picture sent" }) : el("div", { className: "hl-thumb-empty", textContent: "Nothing sent yet" }));
    if (lastReceipt) {
      if (lastReceipt.ok) {
        const size = formatBytes(lastReceipt.measuredJpegBytes ?? 0);
        const dims = `${lastReceipt.width}×${lastReceipt.height}`;
        const trip = lastRoundTripMs !== null ? ` in ${lastRoundTripMs} ms` : "";
        receiptBox.className = lastReceipt.intact ? "hl-status ok" : "hl-status err";
        receiptBox.textContent = lastReceipt.intact ? `Received intact: ${dims}, ${size}${trip}.` : `Houselights received a different size than was sent (${size} against ${formatBytes(lastReceipt.declaredJpegBytes ?? 0)}). Please report this.`;
      } else {
        receiptBox.className = "hl-status err";
        receiptBox.textContent = `Not accepted: ${lastReceipt.error ?? "unknown error"}`;
      }
      receiptBox.style.display = "";
    } else {
      receiptBox.style.display = "none";
    }
    const m = deps.getSettings();
    const prose = deps.getConnectionName(m?.connectionId ?? null);
    const vision = m && m.visionMode === "describe" ? deps.getConnectionName(m.visionConnectionId ?? m.connectionId) : null;
    sentToNote.textContent = vision && vision !== prose ? `Sent to: ${vision} (vision model), then ${prose} (reaction model).` : `Sent to: ${prose}.`;
    const webcamOpen = webcam !== null;
    webcamBtn.disabled = busy || webcamOpen;
    snapBtn.disabled = busy || !webcamOpen;
    webcamCancelBtn.disabled = !webcamOpen;
    photoBtn.disabled = busy;
    pictureBtn.disabled = busy;
    if (isAwaiting()) {
      reactionLines.status(working ?? "Asking the character…");
    } else if (lastReaction) {
      const d = describeReaction(lastReaction);
      if (d.kind === "err") {
        if (lastReaction !== failedReaction) {
          failedReaction = lastReaction;
          reactionLines.fail(d.text);
        }
        reactionLines.status("");
      } else {
        reactionLines.status(d.text);
      }
    } else {
      reactionLines.status("");
    }
    renderLookAction();
  }
  function displayMediaOptions(s) {
    const options = {
      video: {
        displaySurface: "window",
        frameRate: { ideal: 2, max: 5 },
        width: { max: 1920 },
        height: { max: 1080 }
      },
      audio: false,
      selfBrowserSurface: s.excludeSelf ? "exclude" : "include",
      surfaceSwitching: "include",
      monitorTypeSurfaces: s.monitorSurfaces === "exclude" ? "exclude" : "include"
    };
    return options;
  }
  async function openStream(s) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions(s));
    } catch (err) {
      if (!isConstraintRejection(err))
        throw err;
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    }
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        await track.applyConstraints({ frameRate: { ideal: 2, max: 5 }, width: { max: 1920 }, height: { max: 1080 } });
      } catch {}
    }
    registerOrphanGuard(() => stopEverything("orphan"));
    if (track) {
      const st = track.getSettings();
      console.info(`[Houselights] R2 track.label=${JSON.stringify(track.label)} surface=${st.displaySurface ?? "?"} (${classifyTrackLabel(track.label ?? "")})`);
      const candidate = titleCandidate(track.label ?? "");
      if (candidate)
        ctx.sendToBackend({ type: "watch_candidate", text: candidate, source: "label" });
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
      await waitForFrames(video, 5000);
    } catch (err) {
      for (const t of stream.getTracks())
        t.stop();
      throw err;
    }
    return { stream, video };
  }
  function isConstraintRejection(err) {
    const name = err?.name;
    return err instanceof TypeError || name === "TypeError" || name === "OverconstrainedError";
  }
  function waitForFrames(video, timeoutMs) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2)
          return resolve();
        if (Date.now() - started > timeoutMs)
          return reject(new Error("The shared window never produced a picture."));
        setTimeout(check, 50);
      };
      check();
    });
  }
  async function startSession(origin) {
    if (session || !support.screen)
      return session !== null;
    armMediaKey();
    const s = settings();
    busy = true;
    status = { text: "Waiting for you to choose what to share…", kind: "info" };
    refresh();
    try {
      const { stream, video } = await openStream(s);
      const track = stream.getVideoTracks()[0];
      track?.addEventListener("ended", () => stopSession("ended"));
      const autoStopMs = Math.max(1, s.autoStopMinutes) * 60000;
      session = {
        stream,
        video,
        startedAt: Date.now(),
        autoStopAt: Date.now() + autoStopMs,
        autoStopTimer: setTimeout(() => stopSession("auto-stop"), autoStopMs),
        windowMs: autoStopMs
      };
      ctx.sendToBackend({ type: "session_state", live: true, stopsInMs: autoStopMs, windowMs: autoStopMs });
      previousGate = null;
      const label = describeTrack(track);
      status = { text: `Sharing ${label}. ${origin === "button" ? "Press Look when you want a reaction." : ""}`.trim(), kind: "ok" };
      syncTicker();
      return true;
    } catch (err) {
      status = { text: explainMediaError(err), kind: err instanceof DOMException && err.name === "NotAllowedError" ? "info" : "err" };
      disarmMediaKey();
      return false;
    } finally {
      busy = false;
      refresh();
    }
  }
  function extendSession() {
    if (!session)
      return;
    const autoStopMs = Math.max(1, settings().autoStopMinutes) * 60000;
    if (session.autoStopTimer)
      clearTimeout(session.autoStopTimer);
    session.autoStopAt = Date.now() + autoStopMs;
    session.autoStopTimer = setTimeout(() => stopSession("auto-stop"), autoStopMs);
    session.windowMs = autoStopMs;
    ctx.sendToBackend({ type: "session_extended", stopsInMs: autoStopMs, windowMs: autoStopMs });
    status = { text: `Extended. The session now stops itself at ${new Date(session.autoStopAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, kind: "ok" };
    refresh();
  }
  function stopEverything(reason) {
    stopSession(reason === "orphan" ? "destroy" : "button", true);
    closeWebcam();
  }
  function stopSession(reason, gone = false) {
    if (!session)
      return;
    const { stream, video, autoStopTimer } = session;
    session = null;
    if (!gone && reason !== "destroy")
      sessionEndedAt = Date.now();
    ctx.sendToBackend({ type: "session_state", live: false, reason: gone ? "destroy" : reason });
    disarmMediaKey();
    if (autoStopTimer)
      clearTimeout(autoStopTimer);
    for (const t of stream.getTracks())
      t.stop();
    video.pause();
    video.srcObject = null;
    previousGate = null;
    stopTicker();
    status = reason === "ended" ? { text: "Sharing was stopped from the browser. Session over.", kind: "info" } : reason === "auto-stop" ? { text: `Stopped by itself after ${settings().autoStopMinutes} minutes. Start again whenever you like. Change the length in Settings → Capture.`, kind: "info" } : { text: "Session stopped. Nothing is being shared.", kind: "info" };
    if (reason !== "destroy")
      refresh();
  }
  function describeStream(stream) {
    const track = stream.getVideoTracks()[0];
    if (!track)
      return "no video track";
    const st = track.getSettings();
    const size = st.width && st.height ? `${st.width}×${st.height}` : "?×?";
    const fps = typeof st.frameRate === "number" ? `${Math.round(st.frameRate * 10) / 10} fps` : "? fps";
    const label = track.label ?? "";
    return `Stream: ${size} at ${fps}.${label ? ` The browser calls it "${label}".` : ""}`;
  }
  function describeTrack(track) {
    if (!track)
      return "something";
    const settingsOf = track.getSettings();
    const kind = settingsOf.displaySurface;
    const size = settingsOf.width && settingsOf.height ? ` (${settingsOf.width}×${settingsOf.height})` : "";
    if (kind === "monitor")
      return `a whole screen${size}`;
    if (kind === "window")
      return `a window${size}`;
    if (kind === "browser")
      return `a browser tab${size}`;
    return `your screen${size}`;
  }
  function explainMediaError(err, what = "share the screen") {
    if (err instanceof DOMException) {
      switch (err.name) {
        case "NotAllowedError":
          return "Cancelled. Nothing was shared.";
        case "NotFoundError":
          return "The browser found nothing it could share.";
        case "NotReadableError":
        case "AbortError":
          return "The browser could not read the screen. On macOS, check Screen Recording permission for your browser in System Settings.";
        default:
          return `Could not ${what}: ${err.name}${err.message ? ` (${err.message})` : ""}`;
      }
    }
    return `Could not ${what}: ${err instanceof Error ? err.message : String(err)}`;
  }
  function grab(video, s) {
    if (!mainCtx || !thumbCtx || !gateCtx)
      throw new Error(CANVAS_MISSING);
    const { width, height } = fitWithin(video.videoWidth, video.videoHeight, s.maxEdge);
    if (width === 0 || height === 0)
      throw new Error("The shared window has no size yet. Try Look again.");
    mainCanvas.width = width;
    mainCanvas.height = height;
    mainCtx.drawImage(video, 0, 0, width, height);
    return encodeFromMainCanvas(s);
  }
  function encodeFromMainCanvas(s) {
    if (!mainCtx || !thumbCtx || !gateCtx)
      throw new Error(CANVAS_MISSING);
    const width = mainCanvas.width;
    const height = mainCanvas.height;
    const jpegB64 = dataUrlToBase64(mainCanvas.toDataURL("image/jpeg", s.jpegQuality));
    const thumb = fitWithin(width, height, s.thumbEdge);
    thumbCanvas.width = thumb.width;
    thumbCanvas.height = thumb.height;
    thumbCtx.drawImage(mainCanvas, 0, 0, thumb.width, thumb.height);
    const thumbDataUrl = thumbCanvas.toDataURL("image/jpeg", 0.6);
    gateCtx.drawImage(mainCanvas, 0, 0, GATE_EDGE, GATE_EDGE);
    const gate = toGrey(gateCtx.getImageData(0, 0, GATE_EDGE, GATE_EDGE).data);
    return { jpegB64, thumbB64: dataUrlToBase64(thumbDataUrl), thumbDataUrl, width, height, gate };
  }
  function isShift(diff, threshold) {
    return diff >= Math.max(threshold * 8, 48);
  }
  function send(frame, source, trigger, talk, shift = false) {
    const payload = {
      type: "capture",
      source,
      trigger,
      ...talk ? { talk } : {},
      ...shift ? { shift: true } : {},
      jpegB64: frame.jpegB64,
      thumbB64: frame.thumbB64,
      width: frame.width,
      height: frame.height,
      declaredJpegBytes: base64ByteLength(frame.jpegB64),
      declaredThumbBytes: base64ByteLength(frame.thumbB64),
      capturedAt: Date.now(),
      localTime: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
    lastSentAt = payload.capturedAt;
    lastRoundTripMs = null;
    lastThumbDataUrl = frame.thumbDataUrl;
    counters.sent += 1;
    awaitingReaction = trigger !== "test";
    if (awaitingReaction) {
      working = talk ? "Sending your line with a fresh Look…" : "Looking…";
      partialLines = [];
      lastProgressAt = Date.now();
    }
    ctx.sendToBackend(payload);
  }
  async function look(trigger, talk) {
    if (busy || !support.screen)
      return;
    if (trigger === "tick")
      counters.ticks += 1;
    if (isAwaiting()) {
      if (trigger !== "tick") {
        status = { text: `Still on the last Look: ${working ?? "waiting for the reaction…"}`, kind: "info" };
        refresh();
      }
      return;
    }
    const s = settings();
    if (trigger === "tick") {
      const hold = deps.voice?.tickHold();
      if (hold) {
        status = { text: `Holding the automatic Look: ${hold}.`, kind: "info" };
        refresh();
        return;
      }
    }
    try {
      if (s.captureMode === "paranoid") {
        busy = true;
        status = { text: "Choose what to share for this one Look…", kind: "info" };
        refresh();
        const { stream, video } = await openStream(s);
        try {
          const frame = grab(video, s);
          send(frame, "screen", trigger, talk);
          status = { text: "Sent one picture. Nothing is being shared now.", kind: "ok" };
        } finally {
          for (const t of stream.getTracks())
            t.stop();
          video.srcObject = null;
        }
        return;
      }
      if (!session) {
        const ok = await startSession("look");
        if (!ok || !session)
          return;
      }
      busy = true;
      refresh();
      const frame = grab(session.video, s);
      const verdict = frameChanged(previousGate, frame.gate, s.changeThreshold);
      const shift = previousGate !== null && isShift(verdict.diff, s.changeThreshold);
      if (trigger === "tick") {
        previousGate = frame.gate;
        if (!verdict.changed) {
          counters.skipped += 1;
          status = { text: `The screen barely changed (${verdict.diff.toFixed(1)} against a threshold of ${s.changeThreshold}). Skipped.`, kind: "info" };
          return;
        }
        status = { text: `The screen changed (${verdict.diff.toFixed(1)}). Sent.`, kind: "ok" };
      } else {
        previousGate = frame.gate;
        status = { text: `Sent a ${frame.width}×${frame.height} picture.`, kind: "ok" };
      }
      send(frame, "screen", trigger, talk, shift);
    } catch (err) {
      counters.failed += 1;
      status = { text: explainMediaError(err), kind: "err" };
    } finally {
      busy = false;
      refresh();
    }
  }
  async function sendSyntheticFrame() {
    if (busy)
      return;
    busy = true;
    refresh();
    try {
      if (!mainCtx)
        throw new Error(CANVAS_MISSING);
      const s = settings();
      const { width, height } = fitWithin(1920, 1080, s.maxEdge);
      mainCanvas.width = width;
      mainCanvas.height = height;
      const gradient = mainCtx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#2b1a4d");
      gradient.addColorStop(0.5, "#0f5a63");
      gradient.addColorStop(1, "#c0532b");
      mainCtx.fillStyle = gradient;
      mainCtx.fillRect(0, 0, width, height);
      const image = mainCtx.getImageData(0, 0, width, height);
      const d = image.data;
      for (let i = 0;i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 70;
        d[i] = Math.max(0, Math.min(255, d[i] + n));
        d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
        d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
      }
      mainCtx.putImageData(image, 0, 0);
      mainCtx.fillStyle = "rgba(255,255,255,0.92)";
      mainCtx.font = `bold ${Math.round(height / 12)}px system-ui, sans-serif`;
      mainCtx.textAlign = "center";
      mainCtx.fillText("Houselights test picture", width / 2, height / 2);
      mainCtx.font = `${Math.round(height / 28)}px system-ui, sans-serif`;
      mainCtx.fillText(new Date().toLocaleString(), width / 2, height / 2 + height / 10);
      const frame = encodeFromMainCanvas(s);
      send(frame, "synthetic", "test");
      status = { text: `Sent a ${frame.width}×${frame.height} test picture (${formatBytes(base64ByteLength(frame.jpegB64))}). Waiting for it to arrive…`, kind: "info" };
    } catch (err) {
      counters.failed += 1;
      status = { text: `Could not send the test picture: ${err instanceof Error ? err.message : String(err)}`, kind: "err" };
    } finally {
      busy = false;
      refresh();
    }
  }
  function setOtherStatus(text, kind) {
    if (kind === "err")
      otherLines.fail(text);
    else
      otherLines.status(text);
  }
  async function openWebcam() {
    if (webcam || busy)
      return;
    busy = true;
    setOtherStatus("Asking for the webcam…", "info");
    refresh();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      const video = el("video", { className: "hl-preview", muted: true, playsInline: true, autoplay: true });
      video.srcObject = stream;
      await video.play();
      await waitForFrames(video, 5000);
      stream.getVideoTracks()[0]?.addEventListener("ended", () => closeWebcam());
      webcam = { stream, video };
      webcamPreview.replaceChildren(video);
      setOtherStatus("Webcam on. Press Snap to send one photo. The camera switches off straight after.", "info");
    } catch (err) {
      setOtherStatus(explainMediaError(err, "open the webcam").replace("the screen", "the webcam"), "err");
    } finally {
      busy = false;
      refresh();
    }
  }
  function closeWebcam() {
    if (!webcam)
      return;
    for (const t of webcam.stream.getTracks())
      t.stop();
    webcam.video.pause();
    webcam.video.srcObject = null;
    webcam = null;
    webcamPreview.replaceChildren();
    refresh();
  }
  async function snapWebcam() {
    if (!webcam || busy)
      return;
    if (isAwaiting()) {
      setOtherStatus(`Still on the last Look: ${working ?? "waiting for the reaction…"} Snap again when the reaction arrives.`, "info");
      return;
    }
    busy = true;
    refresh();
    try {
      const frame = grab(webcam.video, settings());
      closeWebcam();
      send(frame, "webcam", "look");
      status = { text: `Sent a ${frame.width}×${frame.height} webcam photo.`, kind: "ok" };
      setOtherStatus("Photo sent. Webcam off.", "ok");
    } catch (err) {
      counters.failed += 1;
      setOtherStatus(`Could not send the photo: ${err instanceof Error ? err.message : String(err)}`, "err");
    } finally {
      busy = false;
      refresh();
    }
  }
  async function choosePicture() {
    if (busy)
      return;
    if (typeof ctx.uploads?.pickFile === "function") {
      try {
        const files = await ctx.uploads.pickFile({ accept: ["image/*"], maxSizeBytes: 25 * 1024 * 1024 });
        const file = files[0];
        if (!file)
          return;
        const bytes = new Uint8Array(file.bytes);
        await sendImageBlob(new Blob([bytes], { type: file.mimeType || "image/*" }), "file");
      } catch (err) {
        setOtherStatus(`Could not open the picture: ${err instanceof Error ? err.message : String(err)}`, "err");
        refresh();
      }
      return;
    }
    pictureInput.click();
  }
  async function sendImageBlob(blob, source) {
    if (busy)
      return;
    if (isAwaiting()) {
      setOtherStatus(`Still on the last Look: ${working ?? "waiting for the reaction…"} Send the picture again when the reaction arrives.`, "info");
      return;
    }
    busy = true;
    setOtherStatus("Reading the picture…", "info");
    refresh();
    try {
      if (!mainCtx)
        throw new Error(CANVAS_MISSING);
      const image = await decodeImage(blob);
      const { width, height } = fitWithin(image.width, image.height, settings().maxEdge);
      if (width === 0 || height === 0)
        throw new Error("That file is not a picture.");
      mainCanvas.width = width;
      mainCanvas.height = height;
      mainCtx.drawImage(image.source, 0, 0, width, height);
      image.release();
      const frame = encodeFromMainCanvas(settings());
      send(frame, source, "look");
      status = { text: `Sent a ${frame.width}×${frame.height} ${source === "camera" ? "photo" : "picture"}.`, kind: "ok" };
      setOtherStatus(source === "camera" ? "Photo sent." : "Picture sent.", "ok");
    } catch (err) {
      counters.failed += 1;
      setOtherStatus(`Could not use that picture: ${err instanceof Error ? err.message : String(err)}`, "err");
    } finally {
      busy = false;
      refresh();
    }
  }
  async function decodeImage(blob) {
    if (typeof createImageBitmap === "function") {
      try {
        const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
        return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
      } catch {}
    }
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image;
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("The browser could not read that picture."));
        i.src = url;
      });
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }
  function syncTicker() {
    const s = settings();
    const wanted = session !== null && s.captureMode === "continuous";
    const intervalMs = Math.max(1, s.cadenceSeconds) * 1000;
    if (!wanted) {
      stopTicker();
      return;
    }
    if (ticker && ticker.intervalMs === intervalMs)
      return;
    stopTicker();
    startTicker(intervalMs);
  }
  function startTicker(intervalMs) {
    try {
      const url = URL.createObjectURL(new Blob([TICK_WORKER_SOURCE], { type: "text/javascript" }));
      const worker = new Worker(url);
      worker.onmessage = (event) => {
        if (event.data?.type === "tick")
          look("tick");
      };
      worker.onerror = () => {
        stopTicker();
        startMainThreadTicker(intervalMs);
        refresh();
      };
      worker.postMessage({ type: "start", intervalMs });
      ticker = { kind: "worker", worker, url, intervalMs };
    } catch {
      startMainThreadTicker(intervalMs);
    }
    refresh();
  }
  function startMainThreadTicker(intervalMs) {
    ticker = { kind: "main", timer: setInterval(() => void look("tick"), intervalMs), intervalMs };
  }
  function stopTicker() {
    if (!ticker)
      return;
    if (ticker.kind === "worker") {
      ticker.worker.postMessage({ type: "stop" });
      ticker.worker.terminate();
      URL.revokeObjectURL(ticker.url);
    } else {
      clearInterval(ticker.timer);
    }
    ticker = null;
  }
  return {
    look,
    backPanel: (id) => back[id],
    isLive: () => session !== null,
    justEnded: () => session === null && sessionEndedAt > 0 && Date.now() - sessionEndedAt < CURTAIN_WINDOW_MS,
    onHush() {
      renderHushButton();
      renderQuick();
    },
    refreshVoice() {
      renderVoice();
      renderQuick();
      renderChat();
      renderPermissions();
    },
    onReceipt(receipt) {
      lastReceipt = receipt;
      if (receipt.ok)
        counters.received += 1;
      else
        counters.failed += 1;
      if (receipt.capturedAt && receipt.capturedAt === lastSentAt) {
        lastRoundTripMs = Math.max(0, Date.now() - lastSentAt);
      }
      if (receipt.ok && status.text.endsWith("Waiting for the backend…")) {
        status = { text: "The test picture arrived.", kind: "ok" };
      }
      refresh();
    },
    async talk(text, withLook) {
      const line = text.trim();
      if (!line)
        return;
      if (withLook) {
        if (companionOn()) {
          remoteLookFor(line);
          return;
        }
        await look("talk", line);
        return;
      }
      awaitingReaction = true;
      working = "Sending your line…";
      partialLines = [];
      lastProgressAt = Date.now();
      status = { text: "Sent your line. Waiting for the reaction…", kind: "info" };
      refresh();
      ctx.sendToBackend({ type: "talk", text: line });
    },
    pressLook,
    isPhone: () => phone,
    isCompanion: () => companionOn(),
    remoteLook: (talk) => remoteLookFor(talk),
    onCompanionFrame(frame) {
      if (!companionOn() || awaitingReaction)
        return;
      clearRemoteLookTimer();
      remoteAsked = false;
      lastThumbDataUrl = `data:image/jpeg;base64,${frame.thumbB64}`;
      companionSince = Date.now();
      refresh();
    },
    onCompanionReaction(result) {
      if (!companionOn())
        return;
      companionSince = 0;
      if (!awaitingReaction)
        lastReaction = result;
      refresh();
    },
    onRemoteLookRequest(request) {
      if (phone)
        return;
      const decline = (text) => ctx.sendToBackend({ type: "remote_look_answer", ok: false, text });
      if (!session)
        return;
      if (busy || isAwaiting())
        return decline("Your computer is still on the last Look. Try again when that reaction arrives.");
      look(request.talk ? "talk" : "look", request.talk);
    },
    onCompanionSession(live, stop) {
      if (!companionOn())
        return;
      remoteStop = live && stop ? { at: Date.now() + stop.stopsInMs, windowMs: stop.windowMs } : null;
      if (live && status.kind === "err") {
        status = { text: "Your computer is sharing now.", kind: "ok" };
        sessionLines.clearFailure();
      }
      refresh();
    },
    onRemoteExtendRequest() {
      if (!phone && session)
        extendSession();
    },
    onRemoteLookResult(result) {
      if (!companionOn())
        return;
      if (result.ok)
        return;
      clearRemoteLookTimer();
      remoteAsked = false;
      companionSince = 0;
      status = { text: result.text, kind: "err" };
      refresh();
    },
    takePhoto() {
      if (busy)
        return;
      if (isAwaiting()) {
        setOtherStatus(`Still on the last Look: ${working ?? "waiting for the reaction…"} Take the photo when the reaction arrives.`, "info");
        return;
      }
      cameraInput.click();
    },
    choosePicture() {
      choosePicture();
    },
    onProgress(progress) {
      if (!awaitingReaction)
        return;
      working = progressText(progress);
      if (progress.lines)
        partialLines = progress.lines;
      lastProgressAt = Date.now();
      refresh();
    },
    onReaction(result) {
      const mine = awaitingReaction;
      awaitingReaction = false;
      working = null;
      partialLines = [];
      lastReaction = result;
      if (result.ok)
        counters.reactions += 1;
      refresh();
      return mine;
    },
    onChatState(state) {
      if ((state.chat?.id ?? null) !== (chat.chat?.id ?? null)) {
        sessionLines.clearFailure();
        otherLines.clearFailure();
        reactionLines.clearFailure();
      }
      chat = state;
      renderChat();
      renderLookAction();
      refresh();
    },
    onWatching(state) {
      watchingState = { confirmed: state.confirmed ?? null, candidate: state.candidate ?? null, lastConfirmed: state.lastConfirmed ?? null, doubt: state.doubt ?? null };
      renderWatching();
      renderChat();
      refresh();
    },
    onLookupStatus(next) {
      lookupStatus = next;
      renderChat();
    },
    confirmWatching(text) {
      ctx.sendToBackend({ type: "confirm_watching", text });
    },
    setStance(stance, custom) {
      if (!chat.chat)
        return;
      ctx.sendToBackend({ type: "set_stance", chatId: chat.chat.id, stance, ...typeof custom === "string" ? { custom } : {} });
    },
    dismissWatching() {
      ctx.sendToBackend({ type: "dismiss_watching" });
    },
    onSettings() {
      renderSettings();
      renderWatching();
      syncTicker();
      refresh();
    },
    stop() {
      stopSession("button");
    },
    extend() {
      if (companionOn())
        ctx.sendToBackend({ type: "remote_extend" });
      else
        extendSession();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot,
    destroy() {
      mediaKey.destroy();
      listeners.clear();
      stopSession("destroy");
      closeWebcam();
      window.removeEventListener("pagehide", onPageHide);
      clearOrphanGuard();
      stopTicker();
      clearInterval(clock);
      unsubLookClick();
      unsubComposer();
      lookAction.destroy();
      for (const sc of [staticScope, settingsScope, chatScope, quickScope, deviceScope, webScope])
        sc.reset();
      tab.destroy();
      removeStyle();
    }
  };
}
var ORPHAN_KEY = "__houselightsStop";
function registerOrphanGuard(stop) {
  const w = window;
  w[ORPHAN_KEY] = stop;
}
function clearOrphanGuard() {
  const w = window;
  delete w[ORPHAN_KEY];
}
function stopOrphanedCapture() {
  const w = window;
  const stop = w[ORPHAN_KEY];
  if (typeof stop !== "function")
    return false;
  try {
    stop();
  } catch {}
  delete w[ORPHAN_KEY];
  return true;
}
function detectEnvironment(ctx) {
  const capabilities = ctx.host?.capabilities ?? {};
  let clientKind = "unknown";
  let platform = "unknown";
  let isMobile = null;
  if (ctx.client && (capabilities["client-info-v1"] ?? 0) >= 1) {
    try {
      const info = ctx.client.getInfo();
      clientKind = info.kind;
      platform = info.platform;
      isMobile = info.isMobile === true;
    } catch {}
  }
  if (clientKind === "unknown") {
    const w = window;
    if (w.__TAURI_INTERNALS__ || w.__TAURI__)
      clientKind = "desktop";
    else
      clientKind = "browser";
  }
  return {
    isSecureContext: window.isSecureContext,
    hasGetDisplayMedia: typeof navigator.mediaDevices?.getDisplayMedia === "function",
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    clientKind,
    platform,
    isMobile: isMobile ?? (clientKind === "mobile" || isMobileUserAgent(navigator.userAgent ?? "")),
    desktopCaptureCapability: Number(capabilities["desktop-capture-worker-v1"] ?? 0),
    hasDocumentPictureInPicture: "documentPictureInPicture" in window
  };
}

// src/beat-decorator.ts
var RECENT_WINDOW = 200;
var OURS = ".hl-beat, .hl-portrait";
var MESSAGE_ATTR = "data-message-id";
function decorOf(spindleMetadata) {
  if (!spindleMetadata || typeof spindleMetadata !== "object")
    return null;
  const hl = spindleMetadata.houselights;
  if (!hl || typeof hl !== "object")
    return null;
  const meta = hl;
  if (meta.beat)
    return typeof meta.thumbB64 === "string" && meta.thumbB64 ? { kind: "beat", beat: meta } : null;
  if (typeof meta.speakerAvatar === "string" && meta.speakerAvatar) {
    return { kind: "portrait", url: meta.speakerAvatar, name: typeof meta.speaker === "string" ? meta.speaker : "" };
  }
  return null;
}
function decorOfStoreMessage(message) {
  if (!message || typeof message !== "object")
    return null;
  const extra = message.extra;
  if (!extra || typeof extra !== "object")
    return null;
  return decorOf(extra.spindle_metadata);
}
function createBeatDecorator(ctx) {
  const decorated = new Map;
  const known = new Map;
  const inflight = new Set;
  let alive = true;
  const messagesApi = ctx.messages;
  const getRecent = typeof messagesApi?.getRecent === "function" ? messagesApi.getRecent.bind(messagesApi) : null;
  function harvest(message) {
    const id = message?.id;
    if (typeof id !== "string" || !id)
      return;
    const meta = decorOfStoreMessage(message);
    if (meta)
      known.set(id, meta);
    else if (!known.get(id))
      known.set(id, null);
  }
  function harvestStore() {
    if (!getRecent)
      return;
    try {
      for (const message of getRecent(RECENT_WINDOW))
        harvest(message);
    } catch {}
  }
  const waiting = new Map;
  let batch = [];
  let batchTimer = null;
  function askBackend(messageId) {
    return new Promise((resolve) => {
      waiting.set(messageId, resolve);
      batch.push(messageId);
      if (batchTimer === null) {
        batchTimer = setTimeout(() => {
          batchTimer = null;
          const ids = batch.splice(0);
          ctx.sendToBackend({ type: "get_beats", messageIds: ids });
        }, 100);
      }
    });
  }
  const unsubBackend = ctx.onBackendMessage((payload) => {
    const msg = payload;
    if (msg?.type !== "beats" || !msg.beats)
      return;
    for (const [id, resolve] of [...waiting]) {
      if (!(id in msg.beats))
        continue;
      waiting.delete(id);
      const raw = msg.beats[id];
      const meta = raw && typeof raw === "object" ? decorOf({ houselights: raw }) : null;
      known.set(id, meta);
      resolve(meta);
    }
  });
  async function readMeta(messageId) {
    if (known.has(messageId))
      return known.get(messageId) ?? null;
    harvestStore();
    if (known.has(messageId))
      return known.get(messageId) ?? null;
    return askBackend(messageId);
  }
  function findCard(messageId) {
    const roots = ctx.dom.listMessageElements().filter((m) => m.messageId === messageId).map((m) => m.element);
    if (roots.length === 0)
      return null;
    return roots.find((el) => !roots.some((other) => other !== el && el.contains(other))) ?? roots[0];
  }
  function inject(card) {
    const html = '<div class="hl-beat"></div>';
    const afterBody = card.querySelector('[data-spindle-mount="message_body_after"]');
    if (afterBody)
      return ctx.dom.inject(afterBody, html, "afterend");
    const footer = card.querySelector('[data-spindle-mount="message_footer"]');
    if (footer)
      return ctx.dom.inject(footer, html, "beforebegin");
    return ctx.dom.inject(card, html, "beforeend");
  }
  function injectPortrait(card, url, name) {
    const header = card.querySelector('[data-spindle-mount="message_header"]');
    if (!header)
      return null;
    const wrapper = ctx.dom.inject(header, '<span class="hl-portrait"></span>', "afterend");
    const slot = wrapper.querySelector(".hl-portrait") ?? wrapper;
    const img = document.createElement("img");
    img.className = "hl-portrait-img";
    img.alt = name ? `${name}'s portrait` : "Council member's portrait";
    img.decoding = "async";
    try {
      img.src = new URL(url, location.origin).href;
    } catch {
      return wrapper;
    }
    slot.appendChild(img);
    return wrapper;
  }
  function draw(slot, meta, card) {
    if (card.getAttribute("data-part") === "user")
      slot.classList.add("hl-beat-right");
    const img = document.createElement("img");
    img.className = "hl-beat-thumb";
    img.alt = meta.source === "webcam" ? "Webcam photo the character saw" : "What the character saw";
    img.src = `data:image/jpeg;base64,${meta.thumbB64}`;
    img.decoding = "async";
    slot.appendChild(img);
    const caption = document.createElement("div");
    caption.className = "hl-beat-caption";
    if (meta.frameB64) {
      caption.textContent = "Press to see the full-size picture.";
      let full = false;
      img.addEventListener("click", (ev) => {
        ev.stopPropagation();
        full = !full;
        img.src = `data:image/jpeg;base64,${full ? meta.frameB64 : meta.thumbB64}`;
        img.classList.toggle("hl-beat-full", full);
        caption.textContent = (meta.hushed ? "Seen while hushed. " : "") + (full ? "Press to shrink it." : "Press to see the full-size picture.");
      });
      img.style.cursor = "zoom-in";
    } else {
      caption.textContent = meta.width && meta.height ? `Thumbnail of a ${meta.width}×${meta.height} picture. Only this thumbnail was kept.` : "Thumbnail. Only this thumbnail was kept.";
    }
    if (meta.hushed)
      caption.textContent = `Seen while hushed. ${caption.textContent}`;
    slot.appendChild(caption);
  }
  async function decorate(messageId) {
    if (!alive || !messageId || decorated.has(messageId) || inflight.has(messageId))
      return;
    inflight.add(messageId);
    try {
      const meta = await readMeta(messageId);
      if (!meta || !alive || decorated.has(messageId))
        return;
      const card = findCard(messageId);
      if (!card)
        return;
      const already = card.querySelector(OURS);
      if (already) {
        decorated.set(messageId, already.parentElement ?? already);
        return;
      }
      if (meta.kind === "beat") {
        const wrapper = inject(card);
        draw(wrapper.querySelector(".hl-beat") ?? wrapper, meta.beat, card);
        decorated.set(messageId, wrapper);
      } else {
        const wrapper = injectPortrait(card, meta.url, meta.name);
        if (wrapper)
          decorated.set(messageId, wrapper);
      }
    } catch {} finally {
      inflight.delete(messageId);
    }
  }
  function sweep() {
    if (!alive)
      return;
    const ids = new Set(ctx.dom.listMessageElements().map((m) => m.messageId));
    for (const id of ids)
      decorate(id);
  }
  let scheduled = false;
  const pendingIds = new Set;
  function scheduleFlush() {
    if (scheduled)
      return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const ids = [...pendingIds];
      pendingIds.clear();
      for (const id of ids) {
        const wrapper = decorated.get(id);
        if (!wrapper) {
          decorate(id);
          continue;
        }
        later(500, () => {
          if (wrapper.isConnected)
            return;
          const card = findCard(id);
          if (!card || card.querySelector(OURS))
            return;
          decorated.delete(id);
          decorate(id);
        });
      }
    }, 0);
  }
  const observer = typeof MutationObserver === "function" ? new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element))
          continue;
        const own = node.getAttribute(MESSAGE_ATTR);
        if (own)
          pendingIds.add(own);
        for (const el of node.querySelectorAll(`[${MESSAGE_ATTR}]`)) {
          const id = el.getAttribute(MESSAGE_ATTR);
          if (id)
            pendingIds.add(id);
        }
      }
    }
    if (pendingIds.size)
      scheduleFlush();
  }) : null;
  observer?.observe(document.body, { childList: true, subtree: true });
  const unsubs = [];
  const timers = new Set;
  function later(ms, fn) {
    const t = setTimeout(() => {
      timers.delete(t);
      if (alive)
        fn();
    }, ms);
    timers.add(t);
  }
  unsubs.push(ctx.events.on("MESSAGE_SENT", (payload) => {
    const message = payload?.message;
    harvest(message);
    const id = message?.id;
    if (typeof id !== "string")
      return;
    for (const ms of [0, 300, 1200, 3000])
      later(ms, () => void decorate(id));
  }));
  unsubs.push(ctx.events.on("MESSAGE_DELETED", (payload) => {
    const id = payload?.messageId;
    if (typeof id !== "string")
      return;
    const wrapper = decorated.get(id);
    decorated.delete(id);
    known.delete(id);
    if (wrapper) {
      try {
        ctx.dom.uninject(wrapper);
      } catch {}
    }
  }));
  unsubs.push(ctx.events.on("CHAT_SWITCHED", () => {
    known.clear();
    decorated.clear();
    later(250, sweep);
    later(1500, sweep);
  }));
  sweep();
  later(1000, sweep);
  return {
    destroy() {
      alive = false;
      observer?.disconnect();
      unsubBackend();
      if (batchTimer !== null)
        clearTimeout(batchTimer);
      for (const t of timers)
        clearTimeout(t);
      for (const u of unsubs)
        u();
      for (const wrapper of decorated.values()) {
        try {
          ctx.dom.uninject(wrapper);
        } catch {}
      }
      decorated.clear();
      known.clear();
    }
  };
}
var BEAT_STYLES = `
  .hl-beat { position: relative; z-index: 1; margin: 0 24px 16px;
             display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
  .hl-beat.hl-beat-right { align-items: flex-end; text-align: right; }
  .hl-beat-thumb { display: block; max-width: min(320px, 100%); height: auto;
                   border-radius: var(--lumiverse-radius, 6px);
                   border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3)); }
  .hl-beat-thumb.hl-beat-full { max-width: 100%; }
  .hl-portrait { display: inline-flex; align-items: center; margin: 0 6px; flex: none; vertical-align: middle; }
  .hl-portrait-img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; display: block;
                     border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                     background: var(--lumiverse-fill-subtle, transparent); }
  .hl-beat-caption { font-size: calc(11.2px * var(--lumiverse-font-scale, 1)); color: var(--lumiverse-text-dim, inherit); opacity: 0.85; }
`;

// src/pane.ts
var TAIL_LIMIT = 14;
var DISC_SIZE = 56;
var DISC_MARGIN = { right: 16, bottom: 96 };
var DISC_TAP_SLOP = 8;
var BASE_FONT_PX = 12;
var GLANCE = { width: 260, height: 214 };
var EXPANDED = { width: 320, height: 420 };
var MIN_SIZE = { width: 200, height: 150 };
var THEME_VARS = [
  "--hl-surface",
  "--lumiverse-text",
  "--lumiverse-text-muted",
  "--lumiverse-text-dim",
  "--lumiverse-fill",
  "--lumiverse-fill-subtle",
  "--lumiverse-border",
  "--lumiverse-border-hover",
  "--lumiverse-accent",
  "--lumiverse-accent-fg",
  "--lumiverse-primary",
  "--lumiverse-primary-contrast",
  "--lumiverse-radius",
  "--lumiverse-transition-fast"
];
function resolveThemeCss(css, lookup) {
  const one = /var\((--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g;
  let out = css;
  for (let pass = 0;pass < 3 && out.includes("var("); pass++) {
    out = out.replace(one, (_m, name, fallback) => {
      const value = lookup(name).trim();
      return value || (fallback ?? "").trim();
    });
  }
  return out;
}
function parseColor(text) {
  const m = /^rgba?\(\s*([\d.]+)\s*,?\s*([\d.]+)\s*,?\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/i.exec(text.trim());
  if (!m)
    return null;
  let a = 1;
  if (m[4] !== undefined)
    a = m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Math.min(1, Math.max(0, a)) };
}
function over(bottom, top) {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0)
    return { r: 0, g: 0, b: 0, a: 0 };
  const ch = (t, b) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), a };
}
function cssColor(c) {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}
function isDark(c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 128;
}
function compositeStack(stack, backgroundOf) {
  let result = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = stack.length - 1;i >= 0; i--) {
    const c = parseColor(backgroundOf(stack[i]));
    if (c && c.a > 0)
      result = over(result, c);
  }
  return result;
}
function effectiveBackground(el) {
  const backgroundOf = (node) => getComputedStyle(node).backgroundColor;
  let stack = [];
  if (typeof document.elementsFromPoint === "function") {
    const r = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
    stack = document.elementsFromPoint(x, y).filter((node) => !el.contains(node) && !node.closest(".hl-pane"));
  }
  if (stack.length === 0) {
    for (let node = el.parentElement;node; node = node.parentElement)
      stack.unshift(node);
  }
  return compositeStack(stack, backgroundOf);
}
var HUSH_TITLE = "They keep watching. They just can't talk about it.";
var HUSHED_TITLE = "Press to let them talk again.";
function clock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function createPane(deps) {
  const { ctx, engine } = deps;
  const create = ctx.ui?.createFloatWidget;
  if (typeof create !== "function")
    return unavailable();
  let widget;
  try {
    widget = create.call(ctx.ui, {
      width: GLANCE.width,
      height: GLANCE.height,
      initialPosition: {
        x: Math.max(0, Math.round((window.innerWidth - GLANCE.width) / 2)),
        y: Math.max(0, Math.round((window.innerHeight - GLANCE.height) / 2))
      },
      snapToEdge: true,
      tooltip: "Houselights",
      chromeless: true
    });
  } catch {
    return unavailable();
  }
  let snapshot = engine.snapshot();
  let hush = { hushed: false, source: null, remainingMs: 0 };
  let hushEndsAt = 0;
  const hushNow = () => {
    if (!hush.hushed)
      return hush;
    const remainingMs = hushEndsAt - Date.now();
    return remainingMs > 0 ? { ...hush, remainingMs } : { hushed: false, source: null, remainingMs: 0 };
  };
  let expanded = false;
  let popout = null;
  let alive = true;
  const sizes = { glance: { ...GLANCE }, expanded: { ...EXPANDED } };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
      node.textContent = text;
    return node;
  };
  const root = el("div", "hl-pane");
  const glass = el("div", "hl-pane-glass");
  const frame = el("img", "hl-pane-frame");
  frame.alt = "The last picture the character saw";
  frame.decoding = "async";
  const phone = deps.phone === true;
  if (phone)
    root.classList.add("hl-pane-phone");
  const empty = el("div", "hl-pane-empty", phone ? "Nothing seen yet. Take a photo." : "Nothing seen yet. Press Look.");
  const avatar = el("img", "hl-pane-avatar");
  avatar.alt = "";
  const live = el("div", "hl-pane-live");
  const caption = el("div", "hl-pane-caption");
  const corner = el("div", "hl-pane-corner");
  const cornerBtn = (title, onClick) => {
    const b = el("button", "hl-pane-btn hl-pane-corner-btn");
    b.type = "button";
    b.title = title;
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    return b;
  };
  const toggleView = (key) => {
    const next = !currentView()[key];
    if (deps.setView)
      deps.setView({ [key]: next });
    else
      viewOverride = { ...viewOverride, [key]: next };
    render();
  };
  const picBtn = cornerBtn("", () => toggleView("hidePicture"));
  const linesBtn = cornerBtn("", () => toggleView("linesOnly"));
  corner.append(picBtn, linesBtn, live);
  glass.append(frame, empty, avatar, corner, caption);
  const strip = el("div", "hl-pane-strip");
  const stopWarn = el("div", "hl-pane-warn");
  const stopWarnText = el("span", "hl-pane-warn-text");
  const stopWarnBtn = el("button", "hl-pane-warn-btn", "Extend");
  stopWarnBtn.type = "button";
  stopWarnBtn.addEventListener("click", () => engine.extend());
  stopWarn.append(stopWarnText, stopWarnBtn);
  stopWarn.hidden = true;
  const controls = el("div", "hl-pane-controls");
  const btn = (label, onClick) => {
    const b = el("button", "hl-pane-btn", label);
    b.type = "button";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
    return b;
  };
  const iconBtn = (name, word, onClick) => {
    const b = btn("", onClick);
    b.classList.add("hl-pane-icon-btn");
    setIcon(b, name, word);
    return b;
  };
  const setIcon = (b, name, word) => {
    if (b.dataset.icon === name && b.getAttribute("aria-label") === word)
      return;
    b.dataset.icon = name;
    b.replaceChildren(icon(name, 14));
    b.setAttribute("aria-label", word);
    b.title = word;
  };
  const lookBtn = btn("Look", () => void engine.look());
  const buttonHushed = () => {
    const h = hushNow();
    return h.hushed && h.source === "button";
  };
  const hushBtn = btn("Hush", () => deps.onHush(!buttonHushed()));
  const stopBtn = btn("Stop", engine.stop);
  const expandBtn = iconBtn("maximize-2", "Expand", () => setExpanded(!expanded));
  const popBtn = iconBtn("picture-in-picture-2", "Pop out", () => void togglePopout());
  popBtn.hidden = !("documentPictureInPicture" in window);
  const voiceBtn = iconBtn("volume-x", "Speak aloud", () => {
    const next = !deps.voice.voiceOut();
    deps.voice.setVoiceOut(next);
    if (!next)
      deps.voice.stop();
    render();
  });
  voiceBtn.classList.add("hl-pane-voice");
  const photoBtn = iconBtn("camera", "Photo", () => engine.takePhoto?.());
  const pictureBtn = iconBtn("image", "Picture", () => engine.choosePicture?.());
  const remoteBtn = iconBtn("monitor", "Ask computer", () => engine.remoteLook?.());
  photoBtn.hidden = !phone;
  pictureBtn.hidden = !phone;
  remoteBtn.hidden = true;
  if (phone) {
    lookBtn.hidden = true;
    popBtn.hidden = true;
    hushBtn.hidden = true;
  }
  for (const b of [voiceBtn, expandBtn, popBtn])
    b.classList.add("hl-pane-btn-compact");
  controls.append(lookBtn, remoteBtn, photoBtn, pictureBtn, hushBtn, stopBtn, voiceBtn, expandBtn, popBtn);
  const chip = el("div", "hl-pane-chip");
  const chipText = el("span", "hl-pane-chip-text");
  const chipYes = iconBtn("check", "Confirm", () => engine.confirmWatching(snapshot.watching.candidate?.text ?? snapshot.watching.lastConfirmed ?? ""));
  const chipEdit = iconBtn("pencil", "Edit", () => editChip());
  const chipClear = iconBtn("x", "Clear", () => engine.confirmWatching(""));
  chipClear.classList.add("hl-pane-btn-danger");
  chip.append(chipText, chipYes, chipEdit, chipClear);
  let chipEditing = false;
  function editChip() {
    const w = snapshot.watching;
    const input = el("input", "hl-pane-chip-input");
    input.type = "text";
    input.maxLength = 80;
    input.value = w.candidate?.text ?? w.confirmed ?? w.lastConfirmed ?? "";
    input.placeholder = "e.g. Palworld";
    input.setAttribute("aria-label", "What is on screen");
    const done = (save) => {
      chipEditing = false;
      if (save)
        engine.confirmWatching(input.value);
      renderChip();
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter")
        done(true);
      if (ev.key === "Escape")
        done(false);
    });
    input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const ok = iconBtn("check", "Save", () => done(true));
    ok.addEventListener("mousedown", (ev) => ev.preventDefault());
    input.addEventListener("blur", (ev) => {
      if (chipEditing && ev.relatedTarget !== ok)
        done(false);
    });
    chipEditing = true;
    chip.replaceChildren(input, ok);
    input.focus();
  }
  function renderChip() {
    if (chipEditing)
      return;
    const w = snapshot.watching;
    chip.replaceChildren(chipText, chipYes, chipEdit, chipClear);
    chip.classList.toggle("hl-pane-chip-unset", !w.candidate && !w.confirmed && !w.lastConfirmed);
    chip.classList.toggle("hl-pane-chip-ask", !w.candidate && !w.confirmed && !!w.lastConfirmed);
    chipText.title = "";
    if (!w.candidate && !w.confirmed && w.lastConfirmed) {
      chipText.textContent = `Still ${w.lastConfirmed}?`;
      chipText.title = w.doubt === "screen" ? "The screen stopped looking like this. Nothing is sent until you confirm or change it." : "From your last session. Nothing is sent until you confirm or change it.";
      chipYes.hidden = false;
      chipClear.hidden = true;
    } else if (w.candidate) {
      chipText.textContent = `Watching: ${w.candidate.text}?`;
      chipYes.hidden = false;
      chipClear.hidden = true;
    } else if (w.confirmed) {
      chipText.textContent = `Watching: ${w.confirmed}`;
      chipYes.hidden = true;
      chipClear.hidden = false;
    } else {
      chipText.textContent = "Watching: not set";
      chipYes.hidden = true;
      chipClear.hidden = true;
    }
  }
  const more = el("div", "hl-pane-more");
  const tailList = el("div", "hl-pane-tail");
  const tailEmpty = el("div", "hl-pane-tail-empty", "Nothing in this chat yet.");
  const talkRow = el("div", "hl-pane-talk");
  const talkInput = el("input", "hl-pane-talk-input");
  talkInput.type = "text";
  talkInput.placeholder = "Say something about what they can see";
  talkInput.maxLength = 2000;
  talkInput.setAttribute("aria-label", "Say something to the character");
  let pendingLine = null;
  const chatBoxDraft = () => {
    if (talkInput.value.trim())
      return null;
    const draft = deps.composer?.current();
    const watched = snapshot.chat.chat;
    return draft && draft.text && watched && draft.chatId === watched.id ? draft : null;
  };
  const sendTalk = (withLook) => {
    const text = talkInput.value.trim();
    if (!text) {
      const draft = withLook ? chatBoxDraft() : null;
      if (!draft)
        return;
      deps.composer?.sent(draft.chatId, draft.text);
      engine.talk(draft.text, true);
      if (countdown)
        cancelCountdown();
      setTalkNote("", "info");
      return;
    }
    talkInput.value = "";
    pendingLine = text;
    engine.talk(text, withLook);
    if (countdown)
      cancelCountdown();
    setTalkNote("", "info");
  };
  talkInput.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      sendTalk(ev.ctrlKey || ev.metaKey);
    }
  });
  talkInput.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  const sendBtn = btn("Send", () => sendTalk(false));
  const lookSendBtn = iconBtn("eye", "Send + look", () => sendTalk(true));
  lookSendBtn.classList.add("hl-pane-talk-eye");
  function renderEye() {
    const fromChatBox = chatBoxDraft() !== null;
    setIcon(lookSendBtn, "eye", fromChatBox ? "Send + look: sends what's typed in the chat box" : "Send + look");
    lookSendBtn.classList.toggle("hl-pane-btn-on", fromChatBox);
  }
  talkInput.addEventListener("input", () => renderEye());
  const unsubComposer = deps.composer?.onChange(() => renderEye()) ?? (() => {});
  const micBtn = iconBtn("mic", "Talk", () => {
    if (deps.voice.listening()) {
      deps.voice.cancelListening();
      return;
    }
    cancelCountdown();
    const started = deps.voice.listen({
      onStatus: (phase) => setListenPhase(phase),
      onInterim: (text) => {
        if (text.trim())
          talkInput.value = text;
      },
      onTranscript: (text) => {
        setListenPhase(null);
        if (!text) {
          setTalkNote("Heard nothing.", "info");
          return;
        }
        talkInput.value = text;
        const auto = deps.voice.autoSend();
        if (auto.enabled)
          startCountdown(Math.max(0, auto.delaySeconds));
        else
          setTalkNote("Press Enter to send, or edit it first.", "info");
      },
      onError: (message) => {
        setListenPhase(null);
        setTalkNote(message, "err");
      },
      onEnd: () => {
        setListenPhase(null);
        render();
      }
    });
    if (started)
      setListenPhase("loading");
    render();
  });
  micBtn.classList.add("hl-pane-talk-mic");
  talkRow.append(talkInput, sendBtn, lookSendBtn, micBtn);
  const talkNote = el("div", "hl-pane-talk-note");
  talkNote.hidden = true;
  let listenPhase = null;
  let countdown = null;
  let noteIsPhase = false;
  function setTalkNote(text, kind, phase = false) {
    noteIsPhase = phase && !!text;
    talkNote.textContent = text;
    talkNote.classList.toggle("hl-pane-talk-note-err", kind === "err");
    talkNote.hidden = !text;
  }
  function setListenPhase(phase) {
    listenPhase = phase;
    if (phase === "loading")
      setTalkNote("Getting the recogniser ready…", "info", true);
    else if (phase === "listening")
      setTalkNote("Listening. Say one thing, then pause.", "info", true);
    else if (phase === "processing")
      setTalkNote("Transcribing…", "info", true);
    else if (!countdown && noteIsPhase)
      setTalkNote("", "info");
    render();
  }
  const onDocEscape = (ev) => {
    if (ev.key !== "Escape" || !countdown)
      return;
    cancelCountdown();
    setTalkNote("Kept. Press Enter when you are ready.", "info");
  };
  function cancelCountdown() {
    if (!countdown)
      return;
    clearInterval(countdown.timer);
    countdown = null;
    talkInput.ownerDocument.removeEventListener("keydown", onDocEscape, true);
    setTalkNote("", "info");
  }
  function startCountdown(seconds) {
    cancelCountdown();
    if (seconds === 0) {
      sendTalk(false);
      return;
    }
    talkInput.ownerDocument.addEventListener("keydown", onDocEscape, true);
    try {
      talkInput.focus({ preventScroll: true });
    } catch {}
    const tick = () => {
      if (!countdown)
        return;
      if (countdown.remaining <= 0) {
        cancelCountdown();
        sendTalk(false);
        return;
      }
      setTalkNote(`Sending in ${countdown.remaining} seconds. Press Escape or edit it to hold it back.`, "info");
      countdown.remaining -= 1;
    };
    countdown = { remaining: seconds, timer: setInterval(tick, 1000) };
    tick();
  }
  talkInput.addEventListener("keydown", (ev) => {
    if (!countdown)
      return;
    cancelCountdown();
    setTalkNote(ev.key === "Escape" ? "Kept. Press Enter when you are ready." : "", "info");
  });
  talkInput.addEventListener("pointerdown", () => cancelCountdown());
  const stanceRow = el("div", "hl-pane-stance");
  const stanceLabel = el("span", "hl-pane-stance-label", "Stance");
  const stanceSelect = el("select", "hl-pane-stance-select");
  stanceSelect.setAttribute("aria-label", "Stance for this chat");
  for (const s of STANCES) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    stanceSelect.appendChild(opt);
  }
  stanceSelect.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  stanceSelect.addEventListener("keydown", (ev) => ev.stopPropagation());
  stanceSelect.addEventListener("change", () => engine.setStance(stanceSelect.value));
  stanceRow.append(stanceLabel, stanceSelect);
  const moreRow = el("div", "hl-pane-more-row");
  const extendBtn = btn("Extend", engine.extend);
  const openBtn = btn("Open in Lumiverse", () => openInLumiverse());
  moreRow.append(extendBtn, openBtn);
  more.append(chip, stanceRow, tailList, tailEmpty, talkRow, talkNote, moreRow);
  more.hidden = true;
  let tail = null;
  let tailRequestedAt = 0;
  let tailRetry = null;
  let lastSeenReaction = null;
  let lastSeenChatId;
  function requestTail() {
    if (!alive || !expanded)
      return;
    const now = Date.now();
    const wait = 500 - (now - tailRequestedAt);
    if (wait > 0) {
      if (tailRetry === null)
        tailRetry = setTimeout(() => {
          tailRetry = null;
          requestTail();
        }, wait);
      return;
    }
    tailRequestedAt = now;
    ctx.sendToBackend({ type: "get_tail", limit: TAIL_LIMIT });
  }
  function hhmm(at) {
    return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function renderTail() {
    const atBottom = tailList.childElementCount === 0 || tailList.scrollHeight - tailList.scrollTop - tailList.clientHeight < 12;
    const keepTop = tailList.scrollTop;
    tailList.replaceChildren();
    const entries = tail?.entries ?? [];
    const watched = snapshot.chat.chat?.id ?? null;
    const stale = tail && tail.chatId !== watched;
    tailEmpty.hidden = entries.length > 0 && !stale;
    if (stale) {
      tailEmpty.textContent = "Loading…";
      return;
    }
    tailEmpty.textContent = tail ? "Nothing in this chat yet." : "Loading…";
    for (const e of entries)
      tailList.appendChild(tailRow(e));
    tailList.scrollTop = atBottom ? tailList.scrollHeight : keepTop;
  }
  function tailRow(e) {
    const row = el("div", `hl-pane-tail-row hl-pane-tail-${e.kind}`);
    if (e.hidden && e.kind !== "beat")
      row.classList.add("hl-pane-tail-hidden");
    if (e.kind === "beat") {
      const via = e.beat?.source === "webcam" ? "webcam" : e.beat?.source === "camera" ? "phone" : e.beat?.source === "file" ? "picture" : null;
      row.textContent = `saw${via ? ` (${via})` : ""}${e.beat?.hushed ? e.beat.quiet === "conversation" ? " (held back)" : " (hushed)" : ""}: ${e.beat?.scene ?? "(not described)"} · ${hhmm(e.at)}`;
      row.title = e.text;
      return row;
    }
    const who = el("span", "hl-pane-tail-name", e.kind === "user" ? e.name || "You" : e.name);
    const text = el("span", "hl-pane-tail-text", e.text);
    const marks = [e.lookedUp ? "had notes" : "", e.hushTold === "hush" ? "told: hush" : e.hushTold === "quiet" ? "told: held back" : ""].filter(Boolean);
    const when = el("span", "hl-pane-tail-time", [...marks, hhmm(e.at)].join(" · "));
    if (snapshot.chat.box && e.kind !== "user" && (e.avatarUrl || e.characterId)) {
      const pic = el("img", "hl-pane-tail-avatar");
      pic.alt = "";
      pic.src = e.avatarUrl ? new URL(e.avatarUrl, location.origin).href : deps.avatarUrl(e.characterId);
      row.appendChild(pic);
    }
    row.append(who, text, when);
    row.title = e.text;
    return row;
  }
  function openInLumiverse() {
    try {
      window.focus();
    } catch {}
    const chat = snapshot.chat.chat;
    if (!chat)
      return;
    if (snapshot.chat.activeChatId === chat.id)
      return;
    if (deps.openChat) {
      deps.openChat(chat.id);
      return;
    }
    try {
      const surfaces = ctx.host?.surfaces;
      const action = surfaces?.list(["entity_action"]).find((s) => s.id === "character_chat");
      if (!action)
        return;
      const keys = Object.keys(action.params ?? {});
      const params = {};
      for (const k of keys) {
        if (/chat/i.test(k))
          params[k] = chat.id;
        else if (/character/i.test(k) && chat.characterId)
          params[k] = chat.characterId;
      }
      console.info(`[Houselights] opening chat via character_chat with ${JSON.stringify(params)}`);
      surfaces.invoke({ kind: "entity_action", id: "character_chat" }, params);
    } catch (err) {
      console.warn("[Houselights] could not open the chat in Lumiverse:", err);
    }
  }
  const status = el("div", "hl-pane-status");
  status.hidden = true;
  const workingLine = el("div", "hl-pane-working");
  workingLine.hidden = true;
  const grip = el("div", "hl-pane-grip");
  grip.title = "Drag to resize";
  grip.setAttribute("data-spindle-float-resize-handle", "");
  grip.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0)
      return;
    ev.stopPropagation();
    ev.preventDefault();
    const startW = root.offsetWidth;
    const startH = root.offsetHeight;
    const rect = root.getBoundingClientRect();
    const scale = startW > 0 ? rect.width / startW : 1;
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    const id = ev.pointerId;
    let frameReq = 0;
    let next = { width: startW, height: startH };
    const paint = () => {
      frameReq = 0;
      try {
        widget.setSize(next.width, next.height);
      } catch {}
    };
    const onMove = (e) => {
      if (e.pointerId !== id)
        return;
      const width = Math.max(MIN_SIZE.width, Math.round(startW + (e.clientX - x0) / scale));
      next = {
        width,
        height: expanded ? Math.max(MIN_SIZE.height, Math.round(startH + (e.clientY - y0) / scale)) : glanceHeight(width)
      };
      if (!frameReq)
        frameReq = requestAnimationFrame(paint);
    };
    const finish = (e) => {
      if (e.pointerId !== id)
        return;
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", finish);
      grip.removeEventListener("pointercancel", finish);
      if (frameReq)
        cancelAnimationFrame(frameReq);
      paint();
      sizes[expanded ? "expanded" : "glance"] = { ...next };
      try {
        grip.releasePointerCapture(id);
      } catch {}
    };
    try {
      grip.setPointerCapture(id);
    } catch {}
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);
  });
  grip.addEventListener("click", (ev) => ev.stopPropagation());
  glass.appendChild(workingLine);
  root.append(glass, strip, stopWarn, controls, more, status, grip);
  widget.root.style.display = "block";
  widget.root.style.width = "100%";
  widget.root.style.height = "100%";
  widget.root.appendChild(root);
  const removeStyle = ctx.dom.addStyle(PANE_STYLES);
  if (!phone) {
    try {
      root.style.backgroundColor = cssColor(effectiveBackground(widget.root));
    } catch {}
  }
  function glanceHeight(width) {
    const inner = width - 18;
    const nopic = currentView().hidePicture;
    const size = portraitPreview?.sizePct ?? deps.portrait?.().sizePct ?? 25;
    let h = 18 + (nopic ? Math.max(glass.offsetHeight, portraitPx(inner, size) + 12) : Math.round(inner * 9 / 16));
    const parts = [strip, stopWarn, controls, status].filter((n) => !n.hidden && n.getClientRects().length > 0);
    for (const n of parts)
      h += n.offsetHeight || (n === controls ? 28 : 16);
    h += 6 * parts.length;
    return Math.max(MIN_SIZE.height, h);
  }
  function fitGlance() {
    if (expanded || !alive)
      return;
    const width = root.offsetWidth;
    if (!width)
      return;
    const h = glanceHeight(width);
    if (popout) {
      const chrome = popout.outerHeight - popout.innerHeight;
      if (Math.abs(popout.innerHeight - h) > 2) {
        try {
          popout.resizeTo?.(popout.outerWidth, h + chrome);
        } catch {}
      }
    } else if (Math.abs(root.offsetHeight - h) > 2) {
      try {
        widget.setSize(width, h);
      } catch {}
    }
    sizes.glance = { width, height: h };
  }
  let portraitPreview = null;
  function applyPortrait() {
    const saved = deps.portrait?.() ?? { sizePct: 25, opacityPct: 100 };
    const size = portraitPreview?.sizePct ?? saved.sizePct;
    const opacity = portraitPreview?.opacityPct ?? saved.opacityPct;
    if (currentView().hidePicture) {
      const px = portraitPx(root.clientWidth - 16, size);
      avatar.style.height = `${px}px`;
      avatar.style.width = `${px}px`;
    } else {
      avatar.style.height = `${size}%`;
      avatar.style.width = "";
    }
    avatar.style.opacity = String(Math.min(1, Math.max(0.1, opacity / 100)));
  }
  function portraitPx(innerWidth, sizePct) {
    const width = innerWidth > 0 ? innerWidth : GLANCE.width - 16;
    const glassHeight = expanded ? Math.min(360, Math.max(72, Math.round((root.clientHeight || EXPANDED.height) * 0.36))) : width * 9 / 16;
    return Math.max(18, Math.round(glassHeight * sizePct / 100));
  }
  let viewOverride = {};
  let textPreview = null;
  let viewKey = "";
  function currentView() {
    const saved = deps.view?.() ?? { textPct: 100, hidePicture: false, linesOnly: false };
    return { ...saved, ...viewOverride };
  }
  function applyView() {
    const v = currentView();
    const pct = Math.min(200, Math.max(70, textPreview ?? v.textPct));
    root.style.fontSize = `${Math.round(BASE_FONT_PX * pct) / 100}px`;
    root.classList.toggle("hl-pane-nopic", v.hidePicture);
    glass.classList.toggle("hl-pane-glass-nopic", v.hidePicture);
    root.classList.toggle("hl-pane-lines-only", v.linesOnly);
    picBtn.textContent = v.hidePicture ? "Show picture" : "Hide picture";
    picBtn.classList.toggle("hl-pane-corner-on", v.hidePicture);
    linesBtn.textContent = v.linesOnly ? "All text" : "Lines only";
    linesBtn.classList.toggle("hl-pane-corner-on", v.linesOnly);
    const key = `${pct}|${v.hidePicture}|${v.linesOnly}|${v.hidePicture ? glass.offsetHeight : 0}`;
    if (key !== viewKey) {
      viewKey = key;
      requestAnimationFrame(fitGlance);
    }
  }
  let avatarFor = null;
  let surfaceAt = 0;
  function refreshSurface() {
    if (popout || Date.now() - surfaceAt < 3000)
      return;
    surfaceAt = Date.now();
    try {
      const page = effectiveBackground(widget.root);
      const fill = parseColor(getComputedStyle(root).backgroundColor);
      root.style.setProperty("--hl-surface", cssColor(fill ? over(page, fill) : page));
    } catch {}
  }
  function render() {
    if (!alive)
      return;
    refreshSurface();
    const s = snapshot;
    const reaction = s.lastReaction;
    if (s.lastThumbDataUrl) {
      if (frame.src !== s.lastThumbDataUrl)
        frame.src = s.lastThumbDataUrl;
      frame.hidden = false;
      empty.hidden = true;
    } else {
      frame.hidden = true;
      empty.hidden = false;
    }
    const partialNow = s.awaitingReaction ? s.partialLines ?? [] : [];
    const lastLine = partialNow.length ? partialNow[partialNow.length - 1] : reaction?.ok && reaction.chatId === s.chat.chat?.id && reaction.lines?.length ? reaction.lines[reaction.lines.length - 1] : null;
    const characterId = s.chat.chat?.characterId ?? null;
    const avatarSrc = lastLine?.avatarUrl ? new URL(lastLine.avatarUrl, location.origin).href : lastLine?.characterId ? deps.avatarUrl(lastLine.characterId) : characterId ? deps.avatarUrl(characterId) : null;
    if (avatarSrc !== avatarFor) {
      avatarFor = avatarSrc;
      if (avatarSrc) {
        avatar.src = avatarSrc;
        avatar.hidden = false;
      } else {
        avatar.removeAttribute("src");
        avatar.hidden = true;
      }
    }
    if (s.live && s.autoStopAt) {
      live.textContent = `LIVE · ${clock(s.autoStopAt - Date.now())}`;
      live.hidden = false;
    } else {
      live.hidden = true;
    }
    let captionText = "";
    const partial = s.awaitingReaction ? s.partialLines ?? [] : [];
    if (partial.length)
      captionText = partial.map((l) => l.name ? `${l.name}: ${l.text}` : l.text).join(`
`);
    else if (reaction?.ok && reaction.lines?.length)
      captionText = reaction.lines.map((l) => l.name ? `${l.name}: ${l.text}` : l.text).join(`
`);
    else if (reaction?.ok && reaction.text)
      captionText = reaction.text;
    else if (reaction && !reaction.ok)
      captionText = quietReason(reaction);
    caption.textContent = captionText;
    caption.hidden = !captionText;
    caption.classList.toggle("hl-pane-caption-quiet", !partial.length && !!reaction && !reaction.ok);
    if (captionText && !partial.length && reaction?.ok && reaction.lookedUp) {
      const mark = el("span", "hl-pane-looked", " · had notes");
      caption.appendChild(mark);
    }
    const bits = [];
    const watchingBit = watchingLine(s.watching);
    if (watchingBit)
      bits.push(watchingBit);
    const chatLabel = s.chat.chat ? s.chat.chat.characterName ? `${s.chat.chat.characterName} · ${s.chat.chat.name}` : s.chat.chat.name : "";
    const pinned = s.chat.mode === "pinned";
    if (!s.chat.chat)
      bits.push("No chat open");
    else if (!s.chat.enabled)
      bits.push(`Reactions off in ${chatLabel}`);
    else
      bits.push(`${pinned ? "Pinned to" : "Reacting in"}: ${chatLabel}`);
    const waiting = s.chat.newReactions ?? 0;
    if (waiting > 0)
      bits.push(`${waiting} new`);
    strip.title = s.chat.chat ? chatLabel : "";
    if (s.live && s.mediaKeyHeld)
      bits.push("⏭ = Look");
    const h = hushNow();
    if (h.hushed && h.source === "conversation")
      bits.push(`quiet while you talk ${clock(h.remainingMs)}`);
    strip.textContent = bits.join(" · ");
    const warn = s.live ? stopWarningText(s.autoStopAt, s.stopWarnAt, Date.now()) : "";
    stopWarnText.textContent = warn ? `${warn} · ` : "";
    if (stopWarn.hidden !== !warn) {
      stopWarn.hidden = !warn;
      requestAnimationFrame(fitGlance);
    }
    lookBtn.disabled = !s.canCapture || s.busy || s.awaitingReaction || !s.chat.chat || !s.chat.enabled;
    photoBtn.disabled = pictureBtn.disabled = s.busy || s.awaitingReaction || !s.chat.chat || !s.chat.enabled;
    const companion = phone && engine.companion?.() === true;
    if (phone)
      lookSendBtn.hidden = !companion;
    remoteBtn.hidden = !companion;
    remoteBtn.disabled = s.busy || s.awaitingReaction || !s.chat.chat || !s.chat.enabled;
    lookBtn.textContent = s.busy || s.awaitingReaction ? "…" : "Look";
    const workingWas = workingLine.hidden;
    workingLine.textContent = s.awaitingReaction ? s.working ?? "Waiting for the reaction…" : "";
    workingLine.hidden = !s.awaitingReaction;
    if (workingWas !== workingLine.hidden)
      requestAnimationFrame(fitGlance);
    applyPortrait();
    applyView();
    sendBtn.disabled = s.awaitingReaction || !s.chat.chat;
    lookSendBtn.disabled = s.awaitingReaction || !s.chat.chat || !s.canCapture && !companion || s.busy;
    renderEye();
    talkInput.disabled = !s.chat.chat;
    voiceBtn.hidden = !deps.voice.canSpeak();
    const out = deps.voice.voiceOut();
    setIcon(voiceBtn, out ? "volume-2" : "volume-x", "Speak aloud");
    voiceBtn.setAttribute("aria-pressed", String(out));
    voiceBtn.classList.toggle("hl-pane-voice-on", out);
    micBtn.hidden = !deps.voice.canListen();
    const listening = deps.voice.listening() || listenPhase !== null;
    setIcon(micBtn, listening ? "square" : "mic", listening ? "Stop" : "Talk");
    micBtn.classList.toggle("hl-pane-talk-mic-on", listening);
    micBtn.disabled = !s.chat.chat;
    const pressed = buttonHushed();
    hushBtn.textContent = pressed ? `Hushed · ${clock(hushNow().remainingMs)}` : "Hush";
    hushBtn.classList.toggle("hl-pane-btn-on", pressed);
    grip.hidden = popout !== null;
    stopBtn.hidden = !s.live;
    extendBtn.hidden = !s.live;
    const elsewhere = !!s.chat.chat && s.chat.activeChatId !== undefined && s.chat.activeChatId !== s.chat.chat.id;
    openBtn.hidden = phone || popout === null && !elsewhere;
    openBtn.textContent = popout ? "Back to Lumiverse" : "Open in Lumiverse";
    setIcon(expandBtn, phone || expanded ? "minimize-2" : "maximize-2", phone ? "Fold away" : expanded ? "Shrink" : "Expand");
    setIcon(popBtn, "picture-in-picture-2", popout ? "Pop in" : "Pop out");
    if (expanded) {
      if (reaction !== lastSeenReaction || s.chat.chat?.id !== lastSeenChatId)
        requestTail();
      if (s.chat.chat?.id !== lastSeenChatId)
        renderTail();
    }
    if (reaction !== lastSeenReaction && reaction?.trigger === "talk" && pendingLine !== null) {
      if (!reaction.ok && !talkInput.value)
        talkInput.value = pendingLine;
      pendingLine = null;
    }
    lastSeenReaction = reaction;
    lastSeenChatId = s.chat.chat?.id;
    const stance = s.chat.stance ?? DEFAULT_STANCE;
    if (stanceSelect.value !== stance)
      stanceSelect.value = stance;
    stanceSelect.disabled = !s.chat.chat;
    stanceRow.hidden = !!s.chat.box;
    renderChip();
    chip.hidden = phone;
    const statusWas = status.hidden;
    if (s.status.kind === "err" && s.status.text) {
      status.textContent = s.status.text;
      status.hidden = false;
    } else {
      status.hidden = true;
    }
    if (statusWas !== status.hidden)
      requestAnimationFrame(fitGlance);
  }
  function quietReason(r) {
    if (r.error)
      return `Reaction failed: ${r.error}`;
    switch (r.reason) {
      case "no-chat":
        return "No chat to react in.";
      case "chat-off":
        return "Reactions are off for this chat.";
      case "busy":
        return "Held back: a reply was being written.";
      case "already-reacting":
        return "Still on the previous picture.";
      case "hush":
        return "Staying quiet.";
      case "cooldown":
        return "Saw it. Saving the next remark.";
      case "kind":
        return "Nothing worth saying here.";
      case "boring":
        return "Saw it. Not worth a word.";
      case "repeat":
        return "Nothing new since the last reaction.";
      default:
        return "Nothing said.";
    }
  }
  function setExpanded(next) {
    if (phone && !next) {
      foldToDisc();
      return;
    }
    expanded = next;
    root.classList.toggle("hl-pane-expanded", expanded);
    more.hidden = !expanded;
    if (expanded) {
      requestTail();
      renderTail();
    }
    const size = sizes[expanded ? "expanded" : "glance"];
    if (popout) {
      try {
        popout.resizeTo?.(size.width, size.height + (popout.outerHeight - popout.innerHeight));
      } catch {}
    } else
      widget.setSize(size.width, size.height);
    render();
    if (!expanded)
      requestAnimationFrame(fitGlance);
  }
  let disc = null;
  function mountDisc() {
    if (disc)
      return true;
    try {
      disc = create.call(ctx.ui, {
        width: DISC_SIZE,
        height: DISC_SIZE,
        initialPosition: {
          x: Math.max(0, window.innerWidth - DISC_SIZE - DISC_MARGIN.right),
          y: Math.max(0, window.innerHeight - DISC_SIZE - DISC_MARGIN.bottom)
        },
        snapToEdge: true,
        tooltip: "Houselights",
        chromeless: true
      });
    } catch (err) {
      console.warn("[Houselights] the folded eye could not be made; the widget stays open", err);
      disc = null;
      return false;
    }
    const face = disc.root;
    face.classList.add("hl-disc");
    face.setAttribute("role", "button");
    face.setAttribute("tabindex", "0");
    face.setAttribute("aria-label", "Open Houselights");
    face.innerHTML = HOUSELIGHTS_ICON;
    let pressed = null;
    face.addEventListener("pointerdown", (ev) => {
      pressed = { x: ev.clientX, y: ev.clientY };
    }, true);
    face.addEventListener("click", (ev) => {
      const from = pressed;
      pressed = null;
      if (from && (Math.abs(ev.clientX - from.x) > DISC_TAP_SLOP || Math.abs(ev.clientY - from.y) > DISC_TAP_SLOP))
        return;
      openFromDisc();
    });
    face.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ")
        return;
      ev.preventDefault();
      openFromDisc();
    });
    return true;
  }
  function foldToDisc() {
    if (!mountDisc())
      return;
    widget.setVisible(false);
    disc.setVisible(true);
  }
  function openFromDisc() {
    disc?.setVisible(false);
    widget.setVisible(true);
    setExpanded(true);
  }
  let popoutStyle = null;
  function readTheme(computed) {
    const theme = new Map;
    for (const name of THEME_VARS)
      theme.set(name, computed.getPropertyValue(name).trim());
    return { theme, canvas: effectiveBackground(widget.root) };
  }
  function paintPopout(doc, theme, canvas) {
    doc.documentElement.style.colorScheme = isDark(canvas) ? "dark" : "light";
    doc.documentElement.style.background = cssColor(canvas);
    for (const [name, value] of theme)
      if (value)
        doc.documentElement.style.setProperty(name, value);
    if (popoutStyle)
      popoutStyle.textContent = resolveThemeCss(PANE_STYLES + POPOUT_STYLES, (name) => theme.get(name) ?? "");
  }
  function syncTheme() {
    if (!alive)
      return;
    try {
      if (popout) {
        const { theme, canvas } = readTheme(getComputedStyle(document.documentElement));
        const fill = parseColor(theme.get("--lumiverse-fill") ?? "");
        theme.set("--hl-surface", cssColor(fill ? over(canvas, fill) : canvas));
        paintPopout(popout.document, theme, canvas);
        root.style.removeProperty("--hl-surface");
        if (!phone)
          root.style.backgroundColor = cssColor(canvas);
        return;
      }
      if (!phone)
        root.style.backgroundColor = cssColor(effectiveBackground(widget.root));
      surfaceAt = 0;
      refreshSurface();
    } catch {}
  }
  let themeTimer = null;
  const onThemeChange = () => {
    if (themeTimer)
      clearTimeout(themeTimer);
    themeTimer = setTimeout(() => {
      themeTimer = null;
      syncTheme();
    }, 150);
  };
  const themeObserver = typeof MutationObserver === "function" ? new MutationObserver(onThemeChange) : null;
  themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
  const schemeQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  schemeQuery?.addEventListener?.("change", onThemeChange);
  async function togglePopout() {
    if (popout) {
      popout.close();
      return;
    }
    const api = window.documentPictureInPicture;
    if (!api)
      return;
    try {
      const size = sizes[expanded ? "expanded" : "glance"];
      const { theme, canvas } = readTheme(getComputedStyle(root));
      console.info(`[Houselights] pop-out theme canvas=${cssColor(canvas)} text=${theme.get("--lumiverse-text") || "(unset)"} fill=${theme.get("--lumiverse-fill") || "(unset)"}`);
      const w = await api.requestWindow({ width: size.width, height: size.height });
      popout = w;
      const doc = w.document;
      doc.title = "Houselights";
      popoutStyle = doc.createElement("style");
      doc.head.appendChild(popoutStyle);
      paintPopout(doc, theme, canvas);
      doc.body.appendChild(root);
      widget.setVisible(false);
      requestAnimationFrame(fitGlance);
      w.addEventListener("pagehide", () => {
        popout = null;
        popoutStyle = null;
        if (!alive)
          return;
        widget.root.appendChild(root);
        widget.setVisible(true);
        syncTheme();
        render();
      });
      render();
    } catch (err) {
      snapshot = { ...snapshot, status: { text: `Could not pop out: ${err instanceof Error ? err.message : String(err)}`, kind: "err" } };
      render();
    }
  }
  const unsubscribe = engine.subscribe((s) => {
    snapshot = s;
    render();
  });
  const ticker = setInterval(() => {
    if (snapshot.live || hush.hushed || snapshot.awaitingReaction)
      render();
    if (hush.hushed && !hushNow().hushed)
      hush = hushNow();
  }, 1000);
  render();
  setExpanded(true);
  return {
    available: true,
    setHush(next) {
      hush = next;
      hushEndsAt = next.hushed ? Date.now() + Math.max(0, next.remainingMs) : 0;
      render();
    },
    refresh() {
      render();
    },
    popOut() {
      if (!popout)
        togglePopout();
    },
    previewPortrait(preview) {
      textPreview = preview?.textPct ?? null;
      portraitPreview = preview && (preview.sizePct !== undefined || preview.opacityPct !== undefined) ? preview : null;
      applyView();
      applyPortrait();
    },
    setTail(next) {
      tail = next;
      if (expanded)
        renderTail();
    },
    noteActivity() {
      requestTail();
    },
    destroy() {
      alive = false;
      clearInterval(ticker);
      if (tailRetry !== null)
        clearTimeout(tailRetry);
      themeObserver?.disconnect();
      schemeQuery?.removeEventListener?.("change", onThemeChange);
      if (themeTimer)
        clearTimeout(themeTimer);
      unsubscribe();
      unsubComposer();
      cancelCountdown();
      deps.voice.cancelListening();
      if (popout) {
        try {
          popout.close();
        } catch {}
        popout = null;
      }
      removeStyle();
      disc?.destroy();
      widget.destroy();
    }
  };
}
function unavailable() {
  return { available: false, setHush() {}, setTail() {}, refresh() {}, popOut() {}, previewPortrait() {}, noteActivity() {}, destroy() {} };
}
var PANE_STYLES = `
  .hl-pane [hidden] { display: none !important; }
  .hl-pane { display: flex; flex-direction: column; gap: 6px; padding: 8px; box-sizing: border-box;
             width: 100%; height: 100%; overflow: hidden;
             font: calc(12px * var(--lumiverse-font-scale, 1))/1.4 system-ui, sans-serif; color: var(--lumiverse-text, inherit);
             background: var(--lumiverse-fill, rgba(20,20,28,0.95));
             border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
             border-radius: var(--lumiverse-radius, 8px); user-select: none; }
  .hl-pane-glass { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden;
                   border-radius: var(--lumiverse-radius, 6px);
                   background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.12)); flex: 0 0 auto; }
  /* Expanded: the glass is sized from a share of the height and shrink-wraps the frame, so a wide
     Pane doesn't leave the picture floating in a wide empty box. */
  .hl-pane-expanded .hl-pane-glass { width: auto; height: clamp(72px, 36%, 360px); max-width: 100%;
                                     align-self: center; }
  .hl-pane-frame { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hl-pane-expanded .hl-pane-frame { object-fit: contain; }
  .hl-pane-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
                   color: var(--lumiverse-text-dim, inherit); opacity: 0.8; text-align: center; padding: 8px; }
  .hl-pane-avatar { position: absolute; top: 6px; left: 6px; height: 25%; width: auto; aspect-ratio: 1 / 1;
                    min-width: 18px; min-height: 18px; max-height: calc(100% - 12px); box-sizing: border-box;
                    border-radius: 50%; object-fit: cover; border: 2px solid var(--lumiverse-fill, rgba(0,0,0,0.6));
                    background: var(--lumiverse-fill-subtle, transparent); }
  /* D-059: the picture's top-right corner: LIVE and the two view toggles, one tap each. */
  .hl-pane-corner { position: absolute; top: 6px; right: 6px; display: flex; flex-wrap: wrap; gap: 4px;
                    align-items: center; justify-content: flex-end; max-width: 62%; }
  /* D-062: solid, so the picture under them can't drown the text (light theme over a dark frame). */
  .hl-pane-corner .hl-pane-corner-btn { flex: 0 0 auto; padding: 2px 7px; font-size: 0.78em; line-height: 1.4;
                                        border-radius: 999px; white-space: nowrap;
                                        background: var(--hl-surface, var(--lumiverse-fill, rgba(20,20,28,0.85)));
                                        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35); }
  .hl-pane-corner .hl-pane-corner-on { opacity: 1; border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  /* Hide pic: the picture and its placeholder go; the portraits and the lines stay. D-060: the
     top area shrinks to the portrait (the size it would have over the picture), with the corner
     and the newest line beside it; a long line makes it taller. */
  .hl-pane-nopic .hl-pane-frame, .hl-pane-nopic .hl-pane-empty { display: none !important; }
  .hl-pane .hl-pane-glass.hl-pane-glass-nopic { aspect-ratio: auto; height: auto; width: 100%; max-width: 100%;
                                               display: grid; grid-template-columns: auto minmax(0, 1fr);
                                               grid-template-rows: auto 1fr; column-gap: 8px; row-gap: 4px;
                                               padding: 6px; box-sizing: border-box; }
  .hl-pane-glass-nopic .hl-pane-avatar { position: static; grid-row: 1 / 3; grid-column: 1; max-height: none; }
  .hl-pane-glass-nopic .hl-pane-corner { position: static; grid-row: 1; grid-column: 2; max-width: none; justify-self: end; }
  .hl-pane-glass-nopic .hl-pane-caption { position: static; grid-row: 2; grid-column: 2; padding: 0; background: none;
                                          -webkit-line-clamp: 4; align-self: start; }
  /* Lines only: every line that isn't a character's. Controls and the talk box stay usable. */
  .hl-pane-lines-only .hl-pane-strip, .hl-pane-lines-only .hl-pane-status, .hl-pane-lines-only .hl-pane-working,
  .hl-pane-lines-only .hl-pane-chip, .hl-pane-lines-only .hl-pane-empty, .hl-pane-lines-only .hl-pane-looked,
  .hl-pane-lines-only .hl-pane-caption-quiet, .hl-pane-lines-only .hl-pane-tail-beat,
  .hl-pane-lines-only .hl-pane-tail-system,
  .hl-pane-lines-only .hl-pane-tail-time, .hl-pane-lines-only .hl-pane-tail-empty { display: none !important; }
  .hl-pane-live { padding: 2px 6px; border-radius: 999px; flex: 0 0 auto;
                  font-size: 0.78em; font-weight: 600; letter-spacing: 0.04em;
                  background: var(--lumiverse-accent, var(--lumiverse-primary, #c33)); color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); }
  .hl-pane-caption { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 8px 6px;
                     color: var(--lumiverse-text, #fff);
                     /* D-062: solid behind the text, fading out only in the top padding. */
                     background: linear-gradient(to top, var(--hl-surface, var(--lumiverse-fill, rgba(0,0,0,0.85))) calc(100% - 18px), transparent);
                     display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .hl-pane-expanded .hl-pane-caption { display: none; }
  .hl-pane-strip { font-size: 0.92em; color: var(--lumiverse-text-muted, inherit); white-space: nowrap;
                   overflow: hidden; text-overflow: ellipsis; flex: none; }
  .hl-pane-chip { display: flex; align-items: center; gap: 4px; flex: none; font-size: 0.92em; }
  .hl-pane-chip-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                       padding: 3px 6px; border-radius: 999px;
                       background: var(--lumiverse-fill-subtle, rgba(128,128,128,0.12));
                       border: 1px solid var(--lumiverse-accent, var(--lumiverse-primary, rgba(128,128,128,0.4))); }
  .hl-pane-chip .hl-pane-btn { flex: 0 0 auto; padding: 2px 6px; }
  .hl-pane-chip-unset .hl-pane-chip-text { border-style: dashed; color: var(--lumiverse-text-dim, inherit); }
  /* D-099: "Still <name>?": a question waiting for an answer. */
  .hl-pane-chip-ask .hl-pane-chip-text { border-style: dashed; border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-pane-warn { flex: none; font-size: 0.92em; color: var(--lumiverse-warning, var(--lumiverse-text, inherit)); white-space: nowrap; }
  .hl-pane-warn-btn { font: inherit; cursor: pointer; padding: 1px 8px; color: var(--lumiverse-text, inherit);
                      background: var(--lumiverse-fill-subtle, transparent); border: 1px solid var(--lumiverse-warning, var(--lumiverse-border, rgba(128,128,128,0.3)));
                      border-radius: var(--lumiverse-radius, 6px); }
  .hl-pane-chip-input { flex: 1; min-width: 0; padding: 3px 6px; font: inherit; color: var(--lumiverse-text, inherit);
                        background: var(--lumiverse-fill-subtle, transparent);
                        border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                        border-radius: var(--lumiverse-radius, 6px); user-select: text; }
  .hl-pane-controls { display: flex; gap: 4px; flex: none; }
  /* Buttons keep one size whatever the text size: the row has to fit the widget. */
  .hl-pane-btn { flex: 1; min-width: 0; padding: 5px 6px; font: inherit; font-size: 0.92em; cursor: pointer;
                 color: var(--lumiverse-text, inherit); background: var(--lumiverse-fill-subtle, transparent);
                 border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                 border-radius: var(--lumiverse-radius, 6px); transition: border-color var(--lumiverse-transition-fast, 120ms); }
  .hl-pane-btn:hover { border-color: var(--lumiverse-border-hover, var(--lumiverse-accent, var(--lumiverse-primary, currentColor))); }
  .hl-pane-btn:disabled { opacity: 0.5; cursor: default; }
  /* The icon buttons keep their size; the word buttons (Look / \uD83D\uDCF7 \uD83D\uDDBC on a phone, Hush, Stop) share the rest. */
  .hl-pane-controls .hl-pane-btn-compact { flex: 0 0 auto; }
  /* D-090 (D5): icon buttons, a 28 px square with a 14 px line icon; the word shows on a phone. */
  .hl-pane-icon-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px;
                      min-width: 28px; min-height: 28px; padding: 0 6px; flex: 0 0 auto; }
  .hl-pane-icon-btn .hl-icon { display: inline-flex; line-height: 0; }
  .hl-pane-icon-btn .hl-icon svg { display: block; }
  /* D-091 (asked for after 0.1.6): icons only on a phone too; the words made the row wrap. */
  /* D-091: on a phone or tablet the widget gets an opaque backing in the theme's own page colour.
     It is chromeless, and a light theme's fill is a 6 % black wash, so it used to show whatever was
     behind it: over a dark chat background, a light theme's dark text sat on near-black. */
  .hl-pane.hl-pane-phone { background-color: var(--lumiverse-bg, Canvas);
                           background-image: linear-gradient(var(--lumiverse-fill, transparent), var(--lumiverse-fill, transparent)); }
  .hl-pane-chip .hl-pane-btn-danger { margin-left: 6px; color: var(--lumiverse-danger, rgb(220,70,70)); }
  .hl-pane-more { display: flex; flex-direction: column; gap: 6px; min-height: 5em; flex: 1 1 auto; min-height: 0; }
  .hl-pane-tail { flex: 1 1 auto; min-height: 3em; overflow: auto; display: flex; flex-direction: column; gap: 4px;
                  padding-right: 2px; }
  .hl-pane-tail-empty { color: var(--lumiverse-text-dim, inherit); font-size: 0.92em; }
  .hl-pane-tail-row { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.35; }
  .hl-pane-tail-name { font-weight: 600; margin-right: 4px; }
  .hl-pane-tail-avatar { width: 16px; height: 16px; border-radius: 50%; object-fit: cover; vertical-align: -3px; margin-right: 4px; }
  .hl-pane-caption { white-space: pre-line; }
  .hl-pane-looked { font-size: 0.92em; opacity: 0.75; white-space: nowrap; }
  .hl-pane-tail-time { color: var(--lumiverse-text-dim, inherit); font-size: 0.84em; margin-left: 6px; white-space: nowrap; }
  .hl-pane-tail-user { color: var(--lumiverse-text-muted, inherit); }
  .hl-pane-tail-beat { font-size: 0.92em; color: var(--lumiverse-text-dim, inherit); padding-left: 8px;
                       border-left: 2px solid var(--lumiverse-border, rgba(128,128,128,0.3)); }
  .hl-pane-tail-system { font-size: 0.92em; color: var(--lumiverse-text-dim, inherit); }
  .hl-pane-tail-hidden { opacity: 0.5; }
  .hl-pane-talk { display: flex; gap: 4px; flex: none; }
  .hl-pane-talk-input { flex: 1; min-width: 0; padding: 5px 6px; font: inherit; color: var(--lumiverse-text, inherit);
                        background: var(--lumiverse-fill-subtle, transparent);
                        border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                        border-radius: var(--lumiverse-radius, 6px); user-select: text; }
  .hl-pane-talk-input:focus { outline: none; border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-pane-stance { display: flex; align-items: center; gap: 6px; flex: none; font-size: 0.92em; }
  .hl-pane-stance-label { color: var(--lumiverse-text-dim, inherit); }
  .hl-pane-stance-select { flex: 1; min-width: 0; padding: 3px 4px; font: inherit; color: var(--lumiverse-text, inherit);
                           background: var(--lumiverse-fill-subtle, transparent);
                           border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
                           border-radius: var(--lumiverse-radius, 6px); }
  /* D-062: a native list draws a translucent option over white; give its rows the solid surface. */
  .hl-pane-stance-select option { background-color: var(--hl-surface, Canvas); color: var(--lumiverse-text, CanvasText); }
  .hl-pane-stance-select:focus { outline: none; border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-pane-talk .hl-pane-btn { flex: 0 0 auto; }
  .hl-pane-talk-mic-on, .hl-pane-voice-on, .hl-pane-btn-on { border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-pane-talk-note { font-size: 0.92em; color: var(--lumiverse-text-dim, inherit); flex: none; }
  .hl-pane-talk-note-err { color: var(--lumiverse-text, inherit); border-left: 3px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); padding-left: 6px; }
  .hl-pane-more-row { display: flex; gap: 4px; flex: none; }
  .hl-pane-more-row .hl-pane-btn { flex: 1; }
  .hl-pane-more-text { white-space: pre-wrap; }
  .hl-pane-more-seen { font-size: 0.92em; color: var(--lumiverse-text-dim, inherit); }
  .hl-pane-working { position: absolute; left: 6px; bottom: 6px; max-width: calc(100% - 12px); z-index: 2;
                     padding: 2px 8px; border-radius: 999px; font-size: 0.92em;
                     color: var(--lumiverse-text, inherit); background: var(--hl-surface, var(--lumiverse-fill, rgba(0,0,0,0.85)));
                     border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.35));
                     white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-sizing: border-box; }
  /* At a glance the caption also sits at the bottom: lift it above the progress pill while it shows. */
  .hl-pane-glass:has(.hl-pane-working:not([hidden])) .hl-pane-caption { bottom: 26px; }
  /* D-056: the folded eye on a phone, a disc in the theme's accent colour. */
  .hl-disc { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
             box-sizing: border-box; border-radius: 50%; cursor: pointer; touch-action: none; user-select: none;
             -webkit-user-select: none; background: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2));
             color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); }
  .hl-disc svg { width: 58%; height: 58%; display: block; }
  .hl-disc:active { filter: brightness(1.1); }
  .hl-pane-status { font-size: 0.92em; color: var(--lumiverse-text, inherit); padding: 4px 6px;
                    border-left: 3px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); flex: none; }
  .hl-pane { position: relative; }
  .hl-pane-grip { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
                  touch-action: none; opacity: 0.55;
                  background: linear-gradient(135deg, transparent 0 50%, var(--lumiverse-text-dim, rgba(128,128,128,0.6)) 50% 60%,
                              transparent 60% 70%, var(--lumiverse-text-dim, rgba(128,128,128,0.6)) 70% 80%, transparent 80%); }
  .hl-pane-grip:hover { opacity: 1; }
  /* D-090: the phone, in one block at the end (style guide §6, Lumiverse's own test for a phone):
     every button reaches the 28 px floor. The desktop reads none of it. */
  @media (pointer: coarse), (max-width: 600px) {
    .hl-pane .hl-pane-btn, .hl-pane .hl-pane-corner .hl-pane-corner-btn { min-height: 28px; min-width: 28px; }
    .hl-pane .hl-pane-chip-input, .hl-pane .hl-pane-talk-input { min-height: 28px; }
  }
`;
var POPOUT_STYLES = `
  html, body { margin: 0; height: 100%; }
  body { background: var(--lumiverse-fill, rgba(0,0,0,0.15)); }
  .hl-pane { border: none; border-radius: 0; height: 100vh; }
`;

// src/toolbar.ts
var CLEAR_BOTTOM = 96;
var EDGE = 16;
var TAP_SLOP = 8;
var STATUS_HOLD_MS = 15000;
var EXPLAIN_IDLE_MS = 6000;
var STORE = {
  pos: "houselights.toolbar.pos",
  folded: "houselights.toolbar.folded",
  disc: "houselights.toolbar.disc",
  hintSeen: "houselights.toolbar.hintSeen"
};
var TOOLBAR_HINT = "Type in the chat box, then tap here. They'll take a fresh look and answer you.";
function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function clock2(ms) {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
function createToolbar(deps) {
  const { ctx, engine, composer } = deps;
  const create = ctx.ui?.createFloatWidget;
  const inert = {
    available: false,
    setHush() {},
    setTail() {},
    refresh() {},
    popOut() {},
    previewPortrait() {},
    noteActivity() {},
    destroy() {},
    landed() {},
    showTips() {}
  };
  if (typeof create !== "function")
    return inert;
  let widget;
  const saved = readStore(STORE.pos);
  try {
    widget = create.call(ctx.ui, {
      width: 240,
      height: 48,
      initialPosition: saved ?? { x: EDGE, y: Math.max(0, window.innerHeight - 48 - CLEAR_BOTTOM) },
      snapToEdge: true,
      tooltip: "Houselights",
      chromeless: true
    });
  } catch (err) {
    console.warn("[Houselights] the toolbar could not be made", err);
    return inert;
  }
  const removeStyle = ctx.dom.addStyle(TOOLBAR_STYLES);
  const root = widget.root;
  root.classList.add("hl-tb-host");
  const bar = document.createElement("div");
  bar.className = "hl-tb";
  const row = document.createElement("div");
  row.className = "hl-tb-row";
  const row2 = document.createElement("div");
  row2.className = "hl-tb-row hl-tb-row2";
  row2.hidden = true;
  const statusLine = document.createElement("div");
  statusLine.className = "hl-tb-status";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  const inputRow = document.createElement("div");
  inputRow.className = "hl-tb-input-row";
  const input = document.createElement("input");
  input.className = "hl-tb-input";
  input.type = "text";
  input.placeholder = "Say something, then Enter";
  input.setAttribute("aria-label", "Your line");
  input.enterKeyHint = "send";
  inputRow.appendChild(input);
  inputRow.hidden = true;
  const hint = document.createElement("button");
  hint.type = "button";
  hint.className = "hl-tb-hint";
  hint.textContent = TOOLBAR_HINT;
  hint.setAttribute("aria-label", `${TOOLBAR_HINT} Tap to dismiss.`);
  hint.hidden = true;
  const warnLine = document.createElement("div");
  warnLine.className = "hl-tb-warn";
  const warnText = document.createElement("span");
  const extendBtn = document.createElement("button");
  extendBtn.type = "button";
  extendBtn.className = "hl-tb-warn-btn";
  extendBtn.textContent = "Extend";
  extendBtn.addEventListener("click", () => engine.extend());
  warnLine.append(warnText, extendBtn);
  warnLine.hidden = true;
  bar.append(hint, row, row2, inputRow, statusLine, warnLine);
  root.appendChild(bar);
  function iconButton(name, word, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hl-tb-btn hl-tb-icon-btn";
    b.addEventListener("click", onClick);
    setIcon(b, name, word);
    return b;
  }
  function setIcon(b, name, word) {
    if (b.dataset.icon !== name) {
      b.replaceChildren(icon(name, 18));
      b.dataset.icon = name;
    }
    b.setAttribute("aria-label", word);
    b.title = word;
  }
  function wordButton(text, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hl-tb-btn hl-tb-word-btn";
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }
  const lookBtn = document.createElement("button");
  lookBtn.type = "button";
  lookBtn.className = "hl-tb-btn hl-tb-look";
  const lookLabel = document.createElement("span");
  lookLabel.className = "hl-tb-label";
  const lookWord = document.createElement("span");
  lookWord.textContent = "Look";
  const sendWord = document.createElement("span");
  sendWord.textContent = "Send + look";
  lookLabel.append(lookWord, sendWord);
  lookBtn.append(icon("eye", 18), lookLabel);
  lookBtn.addEventListener("click", () => look());
  function setLook(sends) {
    lookWord.classList.toggle("hl-tb-ghost", sends);
    sendWord.classList.toggle("hl-tb-ghost", !sends);
    lookBtn.setAttribute("aria-label", sends ? "Send + look" : "Look");
  }
  const pencilBtn = iconButton("pencil", "Type a line", () => {
    inputRow.hidden = !inputRow.hidden;
    render();
    if (!inputRow.hidden)
      input.focus();
  });
  sendWord.hidden = !composer.available;
  pencilBtn.hidden = composer.available;
  const mainGroup = document.createElement("div");
  mainGroup.className = "hl-tb-main";
  mainGroup.append(lookBtn, pencilBtn);
  const goBtn = wordButton("Go to chat", () => {
    const target = snapshot.chat.chat;
    if (target && deps.openChat)
      deps.openChat(target.id);
  });
  goBtn.classList.add("hl-tb-main");
  const photoBtn = iconButton("camera", "Photo", () => engine.takePhoto());
  const pictureBtn = iconButton("image", "Picture", () => engine.choosePicture());
  const hushBtn = wordButton("Hush", () => deps.onHush(!buttonHushed()));
  const voiceBtn = iconButton("volume-x", "Speak aloud", () => {
    deps.voice.setVoiceOut(!deps.voice.voiceOut());
    render();
  });
  const helpBtn = iconButton("circle-help", "What do these do?", () => setExplain(!explain));
  const foldBtn = iconButton("minimize-2", "Fold away", () => fold());
  row.append(mainGroup, goBtn, photoBtn, pictureBtn, hushBtn, voiceBtn, helpBtn, foldBtn);
  let snapshot = engine.snapshot();
  let hush = { hushed: false, source: null, remainingMs: 0 };
  let hushEndsAt = 0;
  const buttonHushed = () => hush.hushed && hush.source === "button" && hushEndsAt > Date.now();
  let statusSeen = null;
  let explain = false;
  let explainTimer = null;
  let explained = null;
  let pendingInput = null;
  let alive = true;
  function look() {
    dismissHint();
    const target = snapshot.chat.chat;
    if (!target)
      return;
    if (!composer.available)
      return engine.remoteLook();
    const draft = composer.current();
    if (!draft || draft.chatId !== target.id)
      return;
    if (draft.text) {
      composer.sent(draft.chatId, draft.text);
      engine.remoteLook(draft.text);
    } else
      engine.remoteLook();
  }
  function dismissHint() {
    if (hint.hidden)
      return;
    hint.hidden = true;
    writeStore(STORE.hintSeen, true);
    requestAnimationFrame(fit);
  }
  hint.addEventListener("click", () => dismissHint());
  function explanation(b) {
    if (b === lookBtn) {
      return composer.available ? "Your computer takes a fresh look. With something typed in the chat box, it sends that too." : "Your computer takes a fresh look.";
    }
    if (b === pencilBtn)
      return "Type a line here to send it with a fresh look.";
    if (b === goBtn)
      return "Opens the chat the reactions land in.";
    if (b === photoBtn)
      return "Opens your camera. They react to the photo.";
    if (b === pictureBtn)
      return "Pick a picture from your files. They react to it.";
    if (b === hushBtn)
      return buttonHushed() ? "Hushed. Tap to let them talk again." : "They keep watching. They just can't talk about it.";
    if (b === voiceBtn)
      return "Reads each reaction aloud.";
    if (b === foldBtn)
      return "Folds this away to the popcorn. Tap the popcorn to bring it back.";
    if (b === extendBtn)
      return "Gives the session on your computer more time before it stops itself.";
    return "";
  }
  function setExplain(on) {
    explain = on;
    if (explainTimer !== null)
      clearTimeout(explainTimer);
    explainTimer = on ? setTimeout(() => setExplain(false), EXPLAIN_IDLE_MS) : null;
    if (on)
      explained = null;
    render();
  }
  bar.addEventListener("click", (ev) => {
    if (!explain)
      return;
    const b = ev.target?.closest("button");
    if (!b || b === helpBtn || b === hint)
      return;
    ev.preventDefault();
    ev.stopPropagation();
    explained = { text: explanation(b), at: Date.now() };
    setExplain(false);
  }, true);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      inputRow.hidden = true;
      render();
      return;
    }
    if (ev.key !== "Enter" || ev.isComposing)
      return;
    ev.preventDefault();
    const target = snapshot.chat.chat;
    if (!target || !looksAllowed())
      return;
    const line = input.value.trim();
    if (line) {
      pendingInput = { chatId: target.id, text: line };
      engine.remoteLook(line);
    } else
      engine.remoteLook();
    inputRow.hidden = true;
    render();
  });
  function looksAllowed() {
    const s = snapshot;
    return !s.busy && !s.awaitingReaction && !!s.chat.chat && s.chat.enabled;
  }
  function statusText(s, note, idle) {
    if (explain)
      return { text: "Tap a button to see what it does.", err: false, wrap: true };
    if (explained && Date.now() - explained.at <= STATUS_HOLD_MS)
      return { text: explained.text, err: false, wrap: true };
    if (note)
      return { text: note, err: false };
    if (s.awaitingReaction || s.busy)
      return { text: s.working ?? s.status.text ?? "Waiting for the reaction…", err: false };
    if (!s.status.text)
      return { text: idle, err: false };
    if (statusSeen?.status !== s.status)
      statusSeen = { status: s.status, at: Date.now() };
    if (Date.now() - statusSeen.at > STATUS_HOLD_MS)
      return { text: idle, err: false };
    return { text: s.status.text, err: s.status.kind === "err", wrap: s.status.kind === "err" };
  }
  function render() {
    if (!alive)
      return;
    const s = snapshot;
    const companion = engine.companion();
    const target = s.chat.chat;
    const idle = looksAllowed();
    let note = null;
    const off = (b, disabled) => {
      b.disabled = explain ? false : disabled;
    };
    off(photoBtn, !idle);
    off(pictureBtn, !idle);
    mainGroup.hidden = !companion;
    goBtn.hidden = true;
    let sends = false;
    if (companion && composer.available && target) {
      const draft = composer.current();
      if (!draft || draft.chatId !== target.id) {
        mainGroup.hidden = true;
        if (deps.openChat)
          goBtn.hidden = false;
        else
          note = `Open ${target.name} to reply here.`;
      } else
        sends = !!draft.text;
    }
    setLook(sends);
    off(lookBtn, !idle);
    off(pencilBtn, !idle);
    if (inputRow.hidden === false && (!companion || composer.available))
      inputRow.hidden = true;
    const hintWanted = !mainGroup.hidden && composer.available && readStore(STORE.hintSeen) !== true;
    if (hint.hidden === hintWanted)
      hint.hidden = !hintWanted;
    const pressed = buttonHushed();
    if (!pressed)
      hushShort = false;
    hushBtn.classList.add("hl-tb-hush");
    const left = clock2(hushEndsAt - Date.now());
    hushBtn.textContent = pressed ? stacked || hushShort ? left : `Hushed · ${left}` : "Hush";
    hushBtn.setAttribute("aria-label", pressed ? `Hushed, ${left} left` : "Hush");
    hushBtn.classList.toggle("hl-tb-on", pressed);
    hushBtn.setAttribute("aria-pressed", String(pressed));
    hushBtn.title = pressed ? "Press to let them talk again." : "They keep watching. They just can't talk about it.";
    voiceBtn.hidden = !deps.voice.canSpeak();
    const out = deps.voice.voiceOut();
    setIcon(voiceBtn, out ? "volume-2" : "volume-x", "Speak aloud");
    voiceBtn.setAttribute("aria-pressed", String(out));
    voiceBtn.classList.toggle("hl-tb-on", out);
    helpBtn.classList.toggle("hl-tb-on", explain);
    helpBtn.setAttribute("aria-pressed", String(explain));
    bar.classList.toggle("hl-tb-explaining", explain);
    const st = statusText(s, note, companion ? watchingLine(s.watching) : "");
    const warn = companion ? stopWarningText(s.autoStopAt, s.stopWarnAt, Date.now()) : "";
    warnText.textContent = warn ? `${warn} · ` : "";
    warnLine.hidden = !warn;
    extendBtn.disabled = false;
    statusLine.textContent = st.text;
    statusLine.hidden = !st.text;
    statusLine.classList.toggle("hl-tb-status-err", st.err);
    statusLine.classList.toggle("hl-tb-status-wrap", st.wrap === true);
    requestAnimationFrame(fit);
  }
  let size = { width: 0, height: 0 };
  let hushShort = false;
  function rows() {
    const tops = new Set;
    for (const c of row.children)
      if (!c.hidden)
        tops.add(c.offsetTop);
    return tops.size;
  }
  let stacked = false;
  let arrangedFor = "";
  function arrange() {
    const was = stacked;
    const hasMain = !mainGroup.hidden || !goBtn.hidden;
    const shownText = hushBtn.textContent;
    bar.classList.remove("hl-tb-stacked");
    row2.hidden = true;
    row.append(mainGroup, goBtn, photoBtn, pictureBtn, hushBtn, voiceBtn, helpBtn, foldBtn);
    hushBtn.textContent = "Hush";
    stacked = hasMain && rows() > 1;
    hushBtn.textContent = shownText;
    if (stacked) {
      row.append(mainGroup, goBtn, hushBtn, helpBtn);
      row2.append(photoBtn, pictureBtn, voiceBtn, foldBtn);
      row2.hidden = false;
      bar.classList.add("hl-tb-stacked");
    }
    return stacked !== was;
  }
  function fit() {
    if (!alive)
      return;
    bar.style.maxWidth = `${Math.max(120, window.innerWidth - 2 * EDGE)}px`;
    const key = [window.innerWidth, mainGroup.hidden, goBtn.hidden, voiceBtn.hidden, sendWord.hidden, pencilBtn.hidden].join("|");
    if (key !== arrangedFor) {
      arrangedFor = key;
      if (arrange()) {
        render();
        return;
      }
    }
    if (!stacked && buttonHushed() && !hushShort && rows() > 1) {
      hushShort = true;
      render();
      return;
    }
    const r = bar.getBoundingClientRect();
    const width = Math.ceil(r.width);
    const height = Math.ceil(r.height);
    if (width > 0 && height > 0 && (width !== size.width || height !== size.height)) {
      size = { width, height };
      widget.setSize(width, height);
      keepClear();
    }
  }
  let pushedFrom = null;
  function keepClear() {
    if (!alive || !widget.isVisible())
      return;
    const vv = window.visualViewport;
    const top = vv ? vv.offsetTop : 0;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const limit = Math.max(top + 8, bottom - CLEAR_BOTTOM - size.height);
    const at = widget.getPosition();
    if (at.y > limit) {
      if (!pushedFrom)
        pushedFrom = at;
      widget.moveTo(at.x, limit);
    } else if (pushedFrom) {
      const y = Math.min(pushedFrom.y, limit);
      if (y !== at.y)
        widget.moveTo(pushedFrom.x, y);
      if (y === pushedFrom.y)
        pushedFrom = null;
    }
  }
  const vv = window.visualViewport;
  vv?.addEventListener("resize", keepClear);
  vv?.addEventListener("scroll", keepClear);
  window.addEventListener("resize", keepClear);
  function rememberDrags(el, onMoved) {
    let downAt = null;
    const down = (ev) => {
      downAt = { x: ev.clientX, y: ev.clientY };
    };
    const up = (ev) => {
      const from = downAt;
      downAt = null;
      if (!from || Math.abs(ev.clientX - from.x) <= TAP_SLOP && Math.abs(ev.clientY - from.y) <= TAP_SLOP)
        return;
      setTimeout(() => alive && onMoved(), 250);
    };
    el.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }
  const forgetToolbarDrags = rememberDrags(root, () => {
    pushedFrom = null;
    writeStore(STORE.pos, widget.getPosition());
    keepClear();
  });
  let forgetDiscDrags = null;
  let disc = null;
  function mountDisc() {
    if (disc)
      return true;
    const at = readStore(STORE.disc);
    try {
      disc = create.call(ctx.ui, {
        width: DISC_SIZE,
        height: DISC_SIZE,
        initialPosition: at ?? {
          x: Math.max(0, window.innerWidth - DISC_SIZE - EDGE),
          y: Math.max(0, window.innerHeight - DISC_SIZE - CLEAR_BOTTOM)
        },
        snapToEdge: true,
        tooltip: "Houselights",
        chromeless: true
      });
    } catch (err) {
      console.warn("[Houselights] the popcorn could not be made; the toolbar stays open", err);
      disc = null;
      return false;
    }
    const face = disc.root;
    face.classList.add("hl-disc");
    face.setAttribute("role", "button");
    face.setAttribute("tabindex", "0");
    face.setAttribute("aria-label", "Open Houselights");
    face.innerHTML = HOUSELIGHTS_ICON;
    let pressed = null;
    face.addEventListener("pointerdown", (ev) => {
      pressed = { x: ev.clientX, y: ev.clientY };
    }, true);
    face.addEventListener("click", (ev) => {
      const from = pressed;
      pressed = null;
      if (from && (Math.abs(ev.clientX - from.x) > TAP_SLOP || Math.abs(ev.clientY - from.y) > TAP_SLOP))
        return;
      unfold();
    });
    forgetDiscDrags = rememberDrags(face, () => disc && writeStore(STORE.disc, disc.getPosition()));
    face.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ")
        return;
      ev.preventDefault();
      unfold();
    });
    return true;
  }
  function fold() {
    if (!mountDisc())
      return;
    inputRow.hidden = true;
    widget.setVisible(false);
    disc.setVisible(true);
    writeStore(STORE.folded, true);
  }
  function unfold() {
    disc?.setVisible(false);
    widget.setVisible(true);
    writeStore(STORE.folded, false);
    render();
    keepClear();
  }
  const unsubscribe = engine.subscribe((s) => {
    snapshot = s;
    render();
  });
  const unsubComposer = composer.onChange(() => render());
  const ticker = setInterval(() => {
    const holding = !!statusSeen && Date.now() - statusSeen.at <= STATUS_HOLD_MS + 1000;
    const explaining = !!explained && Date.now() - explained.at <= STATUS_HOLD_MS + 1000;
    const stopping = !!snapshot.autoStopAt && !!snapshot.stopWarnAt && Date.now() >= snapshot.stopWarnAt - 1000 && Date.now() <= snapshot.autoStopAt + 2000;
    if (hush.hushed || snapshot.awaitingReaction || holding || explaining || stopping)
      render();
  }, 1000);
  render();
  if (readStore(STORE.folded) === true)
    fold();
  return {
    available: true,
    setHush(next) {
      hush = next;
      hushEndsAt = next.hushed ? Date.now() + Math.max(0, next.remainingMs) : 0;
      render();
    },
    setTail() {},
    refresh() {
      render();
    },
    popOut() {},
    previewPortrait() {},
    noteActivity() {},
    landed(chatId, text) {
      if (!pendingInput || pendingInput.chatId !== chatId || text !== pendingInput.text.slice(0, 2000))
        return;
      if (input.value.trim() === pendingInput.text)
        input.value = "";
      pendingInput = null;
    },
    showTips() {
      writeStore(STORE.hintSeen, false);
      render();
    },
    destroy() {
      alive = false;
      clearInterval(ticker);
      if (explainTimer !== null)
        clearTimeout(explainTimer);
      unsubscribe();
      unsubComposer();
      vv?.removeEventListener("resize", keepClear);
      vv?.removeEventListener("scroll", keepClear);
      window.removeEventListener("resize", keepClear);
      forgetToolbarDrags();
      forgetDiscDrags?.();
      widget.destroy();
      disc?.destroy();
      disc = null;
      removeStyle();
    }
  };
}
var TOOLBAR_STYLES = `
  .hl-tb-host [hidden] { display: none !important; }
  .hl-tb { display: inline-flex; flex-direction: column; gap: 4px; padding: 6px; box-sizing: border-box;
           width: max-content; font: calc(13px * var(--lumiverse-font-scale, 1))/1.35 system-ui, sans-serif;
           color: var(--lumiverse-text, inherit);
           background-color: var(--lumiverse-bg, Canvas);
           background-image: linear-gradient(var(--lumiverse-fill, transparent), var(--lumiverse-fill, transparent));
           border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3));
           border-radius: calc(var(--lumiverse-radius, 6px) + 4px); box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35); }
  .hl-tb-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .hl-tb-btn { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
               min-width: 36px; min-height: 36px; padding: 0 8px; font: inherit; cursor: pointer;
               color: var(--lumiverse-text, inherit); background: var(--lumiverse-fill-subtle, transparent);
               border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3)); border-radius: var(--lumiverse-radius, 6px); }
  .hl-tb-btn:disabled { opacity: 0.5; cursor: default; }
  .hl-tb-icon-btn { padding: 0; }
  /* D-096: Look, an eye and a word. Both words share one grid cell, so the button is as wide as
     the longer and never changes size; the one not showing is only invisible. */
  .hl-tb-main { display: flex; gap: 4px; flex: 0 0 auto; }
  .hl-tb-look { gap: 6px; flex: 1 1 auto; font-weight: 600; }
  .hl-tb-look .hl-icon { display: inline-flex; line-height: 0; }
  .hl-tb-label { display: inline-grid; }
  .hl-tb-label > span { grid-area: 1 / 1; white-space: nowrap; text-align: left; }
  .hl-tb-ghost { visibility: hidden; }
  /* A small box where one row won't hold them: Look, Hush and ? on top; the rest share the second row. */
  .hl-tb-stacked .hl-tb-row { flex-wrap: nowrap; }
  .hl-tb-stacked .hl-tb-main { flex: 1 0 auto; }
  .hl-tb-stacked .hl-tb-row2 > * { flex: 1 1 0; }
  /* Hush and its countdown are the same width there, so pressing it moves nothing. */
  .hl-tb-stacked .hl-tb-hush { min-width: 58px; }
  /* Explain mode: every button is askable, and looks it. */
  .hl-tb-explaining .hl-tb-btn { border-style: dashed; }
  /* The one-time hint: a bubble over the Look button, with a tail pointing down at it. */
  .hl-tb-hint { position: relative; width: 0; min-width: 100%; box-sizing: border-box; margin-bottom: 4px; padding: 6px 8px;
                font: inherit; text-align: left; cursor: pointer; color: var(--lumiverse-text, inherit);
                background-color: var(--lumiverse-bg, Canvas);
                background-image: linear-gradient(var(--lumiverse-fill, transparent), var(--lumiverse-fill, transparent));
                border: 1px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor));
                border-radius: var(--lumiverse-radius, 6px); }
  .hl-tb-hint::after { content: ''; position: absolute; left: 18px; bottom: -6px; width: 10px; height: 10px;
                       background-color: var(--lumiverse-bg, Canvas);
                       background-image: linear-gradient(var(--lumiverse-fill, transparent), var(--lumiverse-fill, transparent));
                       transform: rotate(45deg);
                       border-right: 1px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor));
                       border-bottom: 1px solid var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-tb-icon-btn .hl-icon { display: inline-flex; line-height: 0; }
  .hl-tb-icon-btn .hl-icon svg { display: block; }
  .hl-tb-on { border-color: var(--lumiverse-accent, var(--lumiverse-primary, currentColor)); }
  .hl-tb-status { width: 0; min-width: 100%; font-size: 0.92em; padding: 0 2px; overflow: hidden;
                  white-space: nowrap; text-overflow: ellipsis; color: var(--lumiverse-text-muted, var(--lumiverse-text, inherit)); }
  .hl-tb-status-err { color: var(--lumiverse-danger, rgb(220,70,70)); }
  /* A failure and an explanation are read whole: they wrap. After the rule above, and one class
     more specific, so it wins (in 0.1.12 and 0.1.13 it sat before it and never applied). */
  .hl-tb-status.hl-tb-status-wrap { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
  /* D-099: "Stops in 1:42 · Extend", with Extend a button of its own. */
  .hl-tb-warn { width: 0; min-width: 100%; font-size: 0.92em; padding: 0 2px; white-space: nowrap;
                color: var(--lumiverse-warning, var(--lumiverse-text, inherit)); }
  .hl-tb-warn-btn { font: inherit; cursor: pointer; min-height: 28px; padding: 0 10px; color: var(--lumiverse-text, inherit);
                    background: var(--lumiverse-fill-subtle, transparent);
                    border: 1px solid var(--lumiverse-warning, var(--lumiverse-border, rgba(128,128,128,0.3)));
                    border-radius: var(--lumiverse-radius, 6px); }
  .hl-tb-input-row { display: flex; width: 0; min-width: 100%; }
  /* 16 px: anything smaller makes iOS zoom the page when the input takes focus. */
  .hl-tb-input { flex: 1; min-width: 0; min-height: 36px; box-sizing: border-box; padding: 4px 8px; font: inherit; font-size: 16px;
                 color: var(--lumiverse-text, inherit); background: var(--lumiverse-fill-subtle, transparent);
                 border: 1px solid var(--lumiverse-border, rgba(128,128,128,0.3)); border-radius: var(--lumiverse-radius, 6px); }
  .hl-disc { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
             box-sizing: border-box; border-radius: 50%; cursor: pointer; touch-action: none; user-select: none;
             -webkit-user-select: none; background: var(--lumiverse-accent, var(--lumiverse-primary, #7e57c2));
             color: var(--lumiverse-accent-fg, var(--lumiverse-primary-contrast, #fff)); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45); }
  .hl-disc svg { width: 58%; height: 58%; display: block; }
  .hl-disc:active { filter: brightness(1.1); }
`;

// src/composer.ts
var TALK_MAX = 2000;
function composerFrom(ctx) {
  const caps = ctx.host?.capabilities ?? {};
  const api = ctx.composer;
  return Number(caps["composer-v1"] ?? 0) >= 1 && api ? api : null;
}
function createComposerBridge(api) {
  let pending = null;
  const listeners = new Set;
  let unsubscribe = null;
  if (api) {
    try {
      unsubscribe = api.onChange(() => {
        for (const l of listeners)
          l();
      });
    } catch (err) {
      console.warn("[Houselights] could not follow the chat box", err);
    }
  }
  function current() {
    if (!api)
      return null;
    try {
      const s = api.getState();
      if (!s.mounted || !s.chatId)
        return null;
      return { chatId: s.chatId, text: s.text.trim() };
    } catch {
      return null;
    }
  }
  return {
    available: api !== null,
    current,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sent(chatId, text) {
      const line = text.trim();
      pending = line ? { chatId, text: line } : null;
    },
    landed(chatId, text) {
      if (!pending || pending.chatId !== chatId || text !== pending.text.slice(0, TALK_MAX))
        return;
      const was = pending;
      pending = null;
      const now = current();
      if (!api || !now || now.chatId !== was.chatId || now.text !== was.text || was.text.length > TALK_MAX)
        return;
      try {
        api.setText("");
      } catch (err) {
        console.warn("[Houselights] could not clear the chat box", err);
      }
    },
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
      listeners.clear();
      pending = null;
    }
  };
}

// src/voice.ts
var STT_PROVIDER_CHOICES = [
  { id: "default", label: "Lumiverse's Voice & Speech setting" },
  { id: "whistle", label: "Whistle (runs on your own machine)" },
  { id: "webspeech", label: "Browser speech recognition" },
  { id: "connection", label: "Your STT connection" }
];
var STT_PHONE_CHOICES = [
  { id: "auto", label: "Automatic" },
  ...STT_PROVIDER_CHOICES
];
var PROVIDER_NAMES = { webspeech: "Browser speech recognition", whistle: "Whistle", connection: "Your STT connection" };
var AUTO_ORDER = ["webspeech", "connection", "whistle"];
function sttCandidates(settings, phone, providers) {
  const pick = (c) => c === "default" ? undefined : c;
  if (!phone)
    return [pick(settings.sttProvider ?? "default")];
  const choice = settings.sttProviderPhone ?? "auto";
  if (choice !== "auto")
    return [pick(choice)];
  const usable = new Set(providers.filter((p) => p.available).map((p) => p.id));
  return [undefined, ...AUTO_ORDER.filter((id) => usable.has(id))];
}
function sttReasonText(reason) {
  switch (reason) {
    case "secureContext":
      return "needs the page opened over https (or on the computer itself as localhost)";
    case "microphone":
      return "this browser gives the page no microphone (phone and tablet browsers allow it only on https pages)";
    case "audioCapture":
      return "this browser cannot record audio for it";
    case "webSpeech":
      return "this browser has no speech recognition (Firefox does not; Chrome and Safari do)";
    case "connectionRequired":
      return "no STT connection is set up in Lumiverse";
    case "worker":
    case "wasm":
    case "crypto":
      return "this browser is missing something it needs; a current Chrome or Safari has it";
    default:
      return reason ? `not available here (${reason})` : "not available here";
  }
}
function spokenText(text, name) {
  const t = text.trim();
  if (!name)
    return t;
  const prefix = new RegExp(`^\\**${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\**\\s*[:—–-]\\s*`, "i");
  return t.replace(prefix, "").trim();
}
function createVoice(deps) {
  const { ctx } = deps;
  const now = deps.now ?? (() => Date.now());
  const caps = ctx.host?.capabilities ?? {};
  const tts = ctx.tts && Number(caps["text-to-speech-v1"] ?? 0) >= 1 ? ctx.tts : null;
  const stt = ctx.stt && Number(caps["speech-to-text-v1"] ?? 0) >= 1 ? ctx.stt : null;
  let media = null;
  let speakingNow = tts?.isSpeaking() ?? false;
  let speechEndedAt = 0;
  let epoch = 0;
  let chain = Promise.resolve();
  let session = null;
  const listeners = new Set;
  const unsubscribeTts = tts ? tts.subscribe((speaking) => {
    if (speaking === speakingNow)
      return;
    speakingNow = speaking;
    if (!speaking)
      speechEndedAt = now();
    for (const l of listeners) {
      try {
        l(speaking);
      } catch {}
    }
  }) : null;
  async function readGranted() {
    try {
      const granted = await ctx.permissions.getGranted();
      media = granted.includes("media");
    } catch {
      media = false;
    }
    return media;
  }
  readGranted();
  function providers() {
    if (!stt)
      return [];
    try {
      return stt.listProviders();
    } catch {
      return [];
    }
  }
  const onPhone = () => deps.phone?.() === true;
  const canSpeak = () => !!tts && media === true && deps.settings().voiceOut;
  const canListen = () => !!stt && media === true;
  async function sayText(text, connectionId) {
    if (!tts)
      return;
    const clean = text.trim();
    if (!clean)
      return;
    await tts.speak({ text: clean }, connectionId ? { connectionId } : undefined);
  }
  async function sayLine(line, connectionId) {
    if (!tts)
      return;
    if (line.messageId) {
      try {
        await tts.speak({ messageId: line.messageId });
        return;
      } catch {}
    }
    await sayText(spokenText(line.text, line.name), connectionId);
  }
  function enqueue(job) {
    const mine = epoch;
    chain = chain.then(() => mine === epoch ? job(mine) : undefined).catch(() => {});
  }
  return {
    availability: () => ({ tts: !!tts, stt: !!stt, media, providers: providers() }),
    refreshPermissions: readGranted,
    async requestMedia() {
      try {
        const granted = await ctx.permissions.request(["media"], {
          reason: "Voice: to speak reactions aloud, and to hear you when you press the mic. Off until you turn it on. The mic opens only when you press it, for one thing you say."
        });
        media = granted.includes("media");
      } catch {
        await readGranted();
      }
      return media === true;
    },
    canSpeak,
    canListen,
    speaking: () => speakingNow,
    listening: () => session !== null,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    speakReaction(result, viewerIdOf, onlyViewerId) {
      if (!result.ok || !canSpeak())
        return;
      const settings = deps.settings();
      if (result.lines && result.lines.length > 0) {
        for (const line of result.lines) {
          const viewerId = viewerIdOf?.(line) ?? null;
          if (onlyViewerId && viewerId !== onlyViewerId)
            continue;
          const connectionId = viewerId ? settings.boxVoices[viewerId] : undefined;
          enqueue(() => sayLine(line, connectionId || undefined));
        }
        return;
      }
      if (result.text) {
        const line = { text: result.text, messageId: result.messageId };
        enqueue(() => sayLine(line));
      }
    },
    speakText(text) {
      if (!tts)
        return Promise.reject(new Error("This Lumiverse cannot speak yet."));
      if (media !== true)
        return Promise.reject(new Error("The media permission is not granted."));
      return sayText(text);
    },
    stop() {
      epoch += 1;
      chain = Promise.resolve();
      if (tts && media === true) {
        try {
          tts.stop();
        } catch {}
      }
    },
    listen(callbacks) {
      if (!stt || media !== true)
        return false;
      if (session)
        return false;
      this.stop();
      const candidates = sttCandidates(deps.settings(), onPhone(), providers());
      let s = null;
      let lastErr = null;
      for (const provider of candidates) {
        try {
          s = stt.start({
            provider,
            continuous: false,
            onStatus: (status) => callbacks.onStatus(status.phase, status.progress),
            onResult: (r) => {
              if (!r.isFinal)
                callbacks.onInterim?.(r.text);
            }
          });
          break;
        } catch (err) {
          lastErr = err;
          if (!/STT_UNAVAILABLE|STT_PROVIDER_INVALID|not available/i.test(err instanceof Error ? err.message : String(err)))
            break;
        }
      }
      if (!s) {
        console.warn("[Houselights] mic: the recogniser would not start:", lastErr);
        callbacks.onError(describeSttError(lastErr));
        return false;
      }
      session = s;
      const started = s;
      s.ready.catch(() => {});
      s.result.then((t) => callbacks.onTranscript(t.text.trim())).catch((err) => {
        if (isAbort(err))
          return;
        console.warn(`[Houselights] mic: ${started.provider} failed:`, err);
        callbacks.onError(`${PROVIDER_NAMES[started.provider] ?? started.provider}: ${describeSttError(err)}`);
      }).finally(() => {
        if (session === started)
          session = null;
        callbacks.onEnd();
      });
      return true;
    },
    cancelListening() {
      const s = session;
      if (!s)
        return;
      session = null;
      try {
        s.cancel();
      } catch {}
    },
    tickHold() {
      if (!tts || !deps.settings().voiceOut)
        return null;
      if (speakingNow)
        return "the character is still speaking";
      const cooldownMs = Math.max(0, deps.settings().cooldownSeconds) * 1000;
      if (speechEndedAt && now() < speechEndedAt + cooldownMs)
        return "letting the last line land";
      return null;
    },
    destroy() {
      this.cancelListening();
      epoch += 1;
      unsubscribeTts?.();
      listeners.clear();
    }
  };
}
function isAbort(err) {
  return err instanceof Error && err.name === "AbortError";
}
function describeSttError(err, secure = isSecurePage()) {
  const message = err instanceof Error ? err.message : String(err);
  const insecure = secure ? "" : " This page is open over plain http, and phone and tablet browsers allow the microphone only on https pages. Lumiverse's Tailscale guide sets up an https address.";
  if (/STT_BUSY/i.test(message))
    return "Another extension has the microphone right now.";
  const unavailable = /STT_UNAVAILABLE:(\w+)/.exec(message);
  if (unavailable)
    return `That recogniser ${sttReasonText(unavailable[1])}.${insecure}`;
  if (/NotAllowed|denied|permission|not-allowed/i.test(message))
    return `The browser did not allow the microphone. Check the site's microphone permission.${insecure}`;
  if (/service-not-allowed/i.test(message))
    return "This browser's speech service is off. Choose another mic recogniser on the Voice card in the full settings.";
  if (/recognition error: network/i.test(message))
    return "The browser's speech recognition could not reach its online service.";
  if (/No speech detected/i.test(message))
    return "No speech heard. Press the mic and talk.";
  if (/SPINDLE_FRONTEND_INACTIVE/i.test(message))
    return "Houselights was reloaded. Press the mic again.";
  return message || "The microphone could not start.";
}
function isSecurePage() {
  try {
    return globalThis.isSecureContext !== false;
  } catch {
    return true;
  }
}

// src/frontend.ts
var HUSH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8
  8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8
  8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  <line x1="2" y1="2" x2="22" y2="22"/></svg>`;
var SCENE_KINDS = [
  "menu",
  "loading",
  "cutscene",
  "combat",
  "exploration",
  "dialogue",
  "outcome",
  "other"
];
var KIND_LABELS = {
  outcome: "Outcome (death, game over, victory)"
};
function chatLabel(c) {
  return c.characterName ? `${c.characterName} · ${c.name}` : c.name;
}
var SETTINGS_ICONS = {
  models: "bot",
  seeing: "scan-eye",
  capture: "monitor",
  pacing: "gauge",
  voice: "mic",
  box: "armchair",
  watchingIn: "pin",
  webSearch: "globe",
  device: "smartphone",
  prompts: "file-text",
  troubleshooting: "wrench"
};
function boldTokens(text) {
  const p = el("p");
  for (const part of text.split(/(\{\{[^}]+\}\})/)) {
    if (!part)
      continue;
    p.append(/^\{\{/.test(part) ? el("strong", { textContent: part }) : document.createTextNode(part));
  }
  return p;
}
function setup(ctx) {
  const removeStyle = ctx.dom.addStyle(SHARED_STYLES + BEAT_STYLES);
  const ui = createUiKit(ctx).scope();
  const root = ctx.ui.mount("settings_extensions");
  let config = null;
  let defaults = null;
  let connections = [];
  let activeChat = null;
  let chatMode = "follow";
  let chats = [];
  let sampleScene = "";
  let scene = "";
  let status = null;
  let busy = false;
  const panel = document.createElement("div");
  panel.className = "hl-panel";
  root.appendChild(panel);
  const search = settingsSearch(panel);
  function connectionRow(label, value, emptyLabel, onChange, hint) {
    const options = [
      { value: "", label: emptyLabel },
      ...connections.map((c) => ({
        value: c.id,
        label: `${c.name} — ${c.model}${c.isDefault ? " (default)" : ""}`
      }))
    ];
    return ui.selectRow(label, value ?? "", options, (v) => onChange(v || null), hint);
  }
  const mySaves = new Set;
  let saveSeq = 0;
  function patch(changes) {
    if (!config)
      return;
    config = { ...config, ...changes };
    const saveId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${saveSeq++}`;
    mySaves.add(saveId);
    if (mySaves.size > 50)
      mySaves.delete(mySaves.values().next().value);
    ctx.sendToBackend({ type: "save_config", config: changes, saveId });
  }
  let hush = { hushed: false, source: null, remainingMs: 0, busy: false };
  let hushTicker = null;
  const hushAction = ctx.ui.registerInputBarAction({
    id: "houselights-hush",
    label: "Hush",
    subtitle: HUSH_TITLE,
    iconSvg: HUSH_ICON
  });
  const buttonHushed = () => hush.hushed && hush.source === "button";
  function hushLabel() {
    const seconds = Math.max(0, Math.ceil(hush.remainingMs / 1000));
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    if (buttonHushed())
      return { label: `Hushed · ${clock}`, subtitle: HUSHED_TITLE };
    if (hush.hushed)
      return { label: "Hush", subtitle: `Quiet for ${clock} after you spoke.` };
    return { label: "Hush", subtitle: HUSH_TITLE };
  }
  function refreshHushButton() {
    const { label, subtitle } = hushLabel();
    hushAction.setLabel(label);
    hushAction.setSubtitle(subtitle);
    if (hush.hushed && hushTicker === null) {
      hushTicker = setInterval(() => {
        hush = { ...hush, remainingMs: hush.remainingMs - 1000 };
        if (hush.remainingMs <= 0)
          hush = { ...hush, hushed: false, source: null, remainingMs: 0 };
        refreshHushButton();
        if (!hush.hushed)
          pane?.setHush(hush);
        if (!hush.hushed)
          captureTab.onHush();
        if (!hush.hushed)
          render();
      }, 1000);
    } else if (!hush.hushed && hushTicker !== null) {
      clearInterval(hushTicker);
      hushTicker = null;
    }
  }
  const unsubHushClick = hushAction.onClick(() => {
    ctx.sendToBackend({ type: "set_hush", hushed: !buttonHushed() });
  });
  function setVoiceOut(on) {
    patch({ voiceOut: on });
    if (!on)
      voice.stop();
    captureTab.refreshVoice();
    pane?.refresh();
    render();
  }
  function voiceSettings() {
    return {
      voiceOut: config?.voiceOut === true,
      sttProvider: config?.sttProvider ?? "default",
      sttProviderPhone: config?.sttProviderPhone ?? "auto",
      voiceAutoSend: config?.voiceAutoSend === true,
      voiceAutoSendDelaySeconds: config?.voiceAutoSendDelaySeconds ?? 3,
      cooldownSeconds: config?.cooldownSeconds ?? 0,
      boxVoices: config?.boxVoices ?? {}
    };
  }
  const voice = createVoice({ ctx, settings: voiceSettings, phone: () => captureTab.isPhone() });
  let lastChat = null;
  const composer = createComposerBridge(composerFrom(ctx));
  function chatOpener() {
    const surfaces = ctx.host?.surfaces;
    try {
      if (!surfaces || !surfaces.list(["route"]).some((r) => r.id === "/chat/:chatId"))
        return null;
    } catch {
      return null;
    }
    return (chatId) => {
      try {
        Promise.resolve(surfaces.invoke({ kind: "route", id: "/chat/:chatId" }, { chatId })).catch((err) => console.warn("[Houselights] could not open the chat", err));
      } catch (err) {
        console.warn("[Houselights] could not open the chat", err);
      }
    };
  }
  const openChat = chatOpener();
  const captureTab = createCaptureTab({
    ctx,
    voice,
    composer,
    openChat,
    showTips: () => toolbar?.showTips(),
    boxVoice: {
      get: (viewerId) => config?.boxVoices?.[viewerId] ?? "",
      set: (viewerId, connectionId) => {
        const next = { ...config?.boxVoices ?? {} };
        if (connectionId)
          next[viewerId] = connectionId;
        else
          delete next[viewerId];
        patch({ boxVoices: next });
      }
    },
    popOut: () => pane?.popOut(),
    previewPortrait: (preview) => pane?.previewPortrait(preview),
    hush: { state: () => hush, set: (on) => ctx.sendToBackend({ type: "set_hush", hushed: on }) },
    setVoiceOut: (on) => setVoiceOut(on),
    getSettings: () => config,
    patch: (changes) => {
      patch(changes);
      if ("connectionId" in changes || "visionConnectionId" in changes)
        render();
      if ("coachSearch" in changes)
        captureTab.refreshVoice();
      if ("showPane" in changes || "showPaneMobile" in changes)
        syncPane();
      if ("companionPhone" in changes)
        pane?.refresh();
      if (["portraitSizePct", "portraitOpacityPct", "paneTextPct", "paneHidePicture", "paneLinesOnly"].some((k) => (k in changes)))
        pane?.refresh();
    },
    getConnections: () => connections,
    getConnectionName: (id) => {
      const c = id ? connections.find((x) => x.id === id) : connections.find((x) => x.isDefault);
      return c ? `${c.name} — ${c.model}` : id ? "an unknown connection" : "your default connection";
    }
  });
  let pane = null;
  let toolbar = null;
  function syncPane() {
    const wanted = captureTab.isPhone() ? config?.showPaneMobile !== false : config?.showPane !== false;
    if (wanted && !pane && captureTab.isPhone()) {
      toolbar = createToolbar({
        ctx,
        engine: {
          subscribe: (l) => captureTab.subscribe(l),
          snapshot: () => captureTab.snapshot(),
          takePhoto: () => captureTab.takePhoto(),
          choosePicture: () => captureTab.choosePicture(),
          companion: () => captureTab.isCompanion(),
          remoteLook: (talk) => captureTab.remoteLook(talk),
          extend: () => captureTab.extend()
        },
        voice: {
          canSpeak: () => {
            const a = voice.availability();
            return a.tts && a.media === true;
          },
          voiceOut: () => config?.voiceOut === true,
          setVoiceOut: (on) => setVoiceOut(on)
        },
        composer,
        onHush: (hushed) => ctx.sendToBackend({ type: "set_hush", hushed }),
        openChat
      });
      pane = toolbar;
      pane.setHush(hush);
    } else if (wanted && !pane) {
      pane = createPane({
        ctx,
        engine: {
          subscribe: (l) => captureTab.subscribe(l),
          snapshot: () => captureTab.snapshot(),
          look: () => captureTab.pressLook(),
          takePhoto: () => captureTab.takePhoto(),
          choosePicture: () => captureTab.choosePicture(),
          companion: () => captureTab.isCompanion(),
          remoteLook: () => captureTab.remoteLook(),
          stop: () => captureTab.stop(),
          extend: () => captureTab.extend(),
          talk: (text, withLook) => captureTab.talk(text, withLook),
          confirmWatching: (text) => captureTab.confirmWatching(text),
          dismissWatching: () => captureTab.dismissWatching(),
          setStance: (stance) => captureTab.setStance(stance)
        },
        voice: {
          canSpeak: () => {
            const a = voice.availability();
            return a.tts && a.media === true;
          },
          voiceOut: () => config?.voiceOut === true,
          setVoiceOut: (on) => {
            patch({ voiceOut: on });
            render();
            captureTab.refreshVoice();
          },
          canListen: () => voice.canListen(),
          listening: () => voice.listening(),
          listen: (callbacks) => voice.listen(callbacks),
          cancelListening: () => voice.cancelListening(),
          stop: () => voice.stop(),
          autoSend: () => ({ enabled: config?.voiceAutoSend === true, delaySeconds: config?.voiceAutoSendDelaySeconds ?? 3 })
        },
        phone: captureTab.isPhone(),
        composer,
        openChat,
        onHush: (hushed) => ctx.sendToBackend({ type: "set_hush", hushed }),
        portrait: () => ({
          sizePct: clampPct(config?.portraitSizePct, 25, 10, 90),
          opacityPct: clampPct(config?.portraitOpacityPct, 100, 10, 100)
        }),
        view: () => ({
          textPct: clampPct(config?.paneTextPct, 100, 70, 200),
          hidePicture: config?.paneHidePicture === true,
          linesOnly: config?.paneLinesOnly === true
        }),
        setView: (changes) => {
          patch({
            ...changes.hidePicture !== undefined ? { paneHidePicture: changes.hidePicture } : {},
            ...changes.linesOnly !== undefined ? { paneLinesOnly: changes.linesOnly } : {}
          });
          captureTab.onSettings();
        },
        avatarUrl: (characterId) => new URL(`/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=sm`, location.origin).href
      });
      pane.setHush(hush);
      pane.noteActivity();
    } else if (!wanted && pane) {
      pane.destroy();
      pane = null;
      toolbar = null;
    }
  }
  const beatDecorator = createBeatDecorator(ctx);
  function scrollHost() {
    for (let n = panel.parentElement;n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight)
        return n;
    }
    return document.scrollingElement ?? null;
  }
  function render() {
    const host = scrollHost();
    const top = host?.scrollTop ?? 0;
    const minHeight = panel.style.minHeight;
    panel.style.minHeight = `${panel.offsetHeight}px`;
    try {
      renderPanel();
    } finally {
      panel.style.minHeight = minHeight;
      if (host)
        host.scrollTop = top;
    }
  }
  let resetNote = null;
  function renderPanel() {
    ui.reset();
    for (const child of Array.from(panel.children))
      if (child !== search.root)
        child.remove();
    panel.prepend(el("h3", { textContent: "Houselights" }));
    if (!config || !defaults) {
      search.root.remove();
      panel.appendChild(el("div", { className: "hl-status", textContent: "Loading…" }));
      return;
    }
    if (search.root.parentNode !== panel)
      panel.appendChild(search.root);
    const visionGroup = el("div", { className: "hl-group" });
    visionGroup.appendChild(ui.selectRow("How the character sees", config.visionMode, [
      { value: "describe", label: "Describe" },
      { value: "attach", label: "Attach" }
    ], (v) => {
      patch({ visionMode: v });
      render();
    }, [
      "Describe: the vision model turns the picture into a sentence or two, and only that text reaches the character.",
      "Attach: the picture itself goes to the reaction model, which must accept images.",
      "Pacing's interest settings work only in Describe."
    ]));
    const visionModelRow = config.visionMode === "describe" ? connectionRow("Vision model", config.visionConnectionId, "Same as the reaction model", (v) => {
      patch({ visionConnectionId: v });
      captureTab.onSettings();
    }) : null;
    visionGroup.appendChild(ui.checkboxRow("Keep the full-size picture on the hidden note", config.attachFullFrame, (v) => patch({ attachFullFrame: v }), "Every reaction leaves a hidden note in the chat, with a thumbnail under it. When on, the full-size picture is " + "kept too, and a press on the thumbnail shows it. Later prompts carry the note's description, never the picture."));
    const paceGroup = el("div", { className: "hl-group" });
    const attach = config.visionMode === "attach";
    const describeOnly = attach ? " (Describe only)" : "";
    if (attach) {
      paceGroup.appendChild(el("div", { className: "hl-status", textContent: "How the character sees is set to Attach, so the interest settings on this card are off. The timers still work." }));
    }
    const paceHelp = "How choosy Houselights is about speaking up by itself in Continuous. A Look you press always gets a reaction. " + "The interest settings need Describe; the timers work in both.";
    paceGroup.appendChild(ui.numberRow("Minimum gap between reactions (seconds)", config.cooldownSeconds, { min: 0, max: 600, step: 5 }, (v) => patch({ cooldownSeconds: v })));
    paceGroup.appendChild(ui.numberRow(`How interesting a moment must be (0–10)${describeOnly}`, config.salienceBar, { min: 0, max: 10, step: 1, disabled: attach }, (v) => patch({ salienceBar: v }), "The vision model rates each moment from 0 to 10. At 0 everything gets a reaction; at 7 and above only deaths, " + "boss fights and disasters do. Start around 4."));
    paceGroup.appendChild(el("span", { className: "hl-subhead hl-subhead-gap", textContent: `Never comment on${describeOnly}` }));
    const kindWrap = el("div", { className: "hl-kinds" });
    for (const kind of SCENE_KINDS) {
      kindWrap.appendChild(ui.checkboxRow(KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1), config.skipKinds.includes(kind), (on) => {
        const next = on ? [...config.skipKinds, kind] : config.skipKinds.filter((k) => k !== kind);
        patch({ skipKinds: next });
        render();
      }, undefined, attach));
    }
    paceGroup.appendChild(kindWrap);
    paceGroup.appendChild(ui.numberRow(`Big moments get through skipped kinds (interest at or above, 0–10, or 11 = never)${describeOnly}`, config.kindBreakInterest ?? 8, { min: 0, max: 11, step: 1, disabled: attach }, (v) => patch({ kindBreakInterest: v }), "A death or victory screen can look like a menu. At or above this, it's commented on anyway. " + "It still has to clear How interesting a moment must be. At 11 a skipped kind is always skipped."));
    paceGroup.appendChild(ui.numberRow("Recent reactions to remember", config.roastMemory, { min: 0, max: 20, step: 1 }, (v) => patch({ roastMemory: v }), "The model is shown this many of its recent reactions and told not to repeat their shape. " + "Raise it if the same joke keeps coming back."));
    paceGroup.appendChild(el("span", { className: "hl-subhead hl-subhead-gap", textContent: "Getting a word in" }));
    paceGroup.appendChild(ui.numberRow("Hush lasts (minutes)", config.hushMinutes, { min: 1, max: 120, step: 1 }, (v) => patch({ hushMinutes: v })));
    paceGroup.appendChild(ui.numberRow("Stay quiet after you speak (seconds)", config.conversationGraceSeconds, { min: 0, max: 600, step: 5 }, (v) => patch({ conversationGraceSeconds: v }), "After you send a message, Houselights holds its automatic reactions for this long, so you can answer back " + "without being talked over. The time starts again when the reply finishes. 0 turns it off."));
    paceGroup.appendChild(ui.numberRow(`Something big enough breaks through a hush (0–10, or 11 = never)${describeOnly}`, config.overrideInterest, { min: 0, max: 11, step: 1, disabled: attach }, (v) => patch({ overrideInterest: v }), "At 11, the default, nothing breaks through a hush. Lower it and a moment rated this high gets a reaction anyway, " + "though never sooner than the minimum gap or over a reply being written. More in the guide."));
    paceGroup.appendChild(ui.checkboxRow(`Comment when a hush ends${describeOnly}`, config.hushEndComment !== false, (v) => patch({ hushEndComment: v }), "On by default. When a hush you pressed ends, the character says one thing about the most interesting moment it saw " + "meanwhile. It needs a Continuous session in Describe, and does not happen after the quiet that follows your own message.", attach));
    paceGroup.appendChild(ui.checkboxRow("Curtain call when a session ends", config.curtainCall !== false, (v) => patch({ curtainCall: v }), "One closing line about the session when it stops. On by default. Not after a session under two minutes or one " + "with nothing worth mentioning, and not while hushed."));
    const testGroup = el("div", { className: "hl-group" });
    testGroup.appendChild(captionHelp(el("span", { className: "hl-subhead", textContent: "Test with a typed scene" }), "Test with a typed scene", "Type what a vision model might say about a screen. The character reacts to that text, and nothing is captured."));
    testGroup.appendChild(el("p", {
      className: "hl-sub",
      textContent: activeChat ? chatMode === "pinned" ? `The reaction goes into the pinned chat, "${chatLabel(activeChat)}", even if React in this chat is off.` : `The reaction goes into your open chat, "${chatLabel(activeChat)}", even if React in this chat is off.` : "No chat is open. Open a chat with a character first."
    }));
    const sceneBox = el("textarea", { value: scene, rows: 4 });
    sceneBox.className = "hl-input hl-scene";
    sceneBox.placeholder = "e.g. A menu with three save files";
    sceneBox.id = "hl-scene-box";
    sceneBox.addEventListener("input", () => {
      scene = sceneBox.value;
    });
    const sceneLabel = el("label", { className: "hl-sub", textContent: "Scene" });
    sceneLabel.htmlFor = sceneBox.id;
    testGroup.append(sceneLabel, sceneBox);
    const fire = button(busy ? "Reacting…" : "Send a test reaction", () => {
      busy = true;
      status = { text: "Asking your character…", kind: "info" };
      render();
      ctx.sendToBackend({ type: "test_roast", scene });
    }, true);
    fire.disabled = busy || !activeChat;
    const resetScene = button("Restore the sample scene", () => {
      scene = sampleScene;
      render();
    });
    testGroup.append(el("div", { className: "hl-btns" }, [fire, resetScene]));
    if (status) {
      testGroup.appendChild(el("div", { className: statusClass(status.kind), textContent: status.text }));
    }
    const genGroup = el("div", { className: "hl-group" });
    genGroup.appendChild(connectionRow("Reaction model", config.connectionId, "Your default connection", (v) => {
      patch({ connectionId: v });
      captureTab.onSettings();
    }, [
      "The model that writes the reaction. Lumiverse adds the chat's history, persona, world info and memories itself.",
      LIGHT_MODEL_ADVICE
    ]));
    if (visionModelRow)
      genGroup.appendChild(visionModelRow);
    genGroup.appendChild(ui.numberRow("Temperature", config.temperature, { min: 0, max: 2, step: 0.05 }, (v) => patch({ temperature: v })));
    genGroup.appendChild(ui.numberRow("Top P", config.topP, { min: 0, max: 1, step: 0.05 }, (v) => patch({ topP: v })));
    genGroup.appendChild(ui.numberRow("Max tokens", config.maxTokens, { min: 32, max: 2048, step: 16 }, (v) => patch({ maxTokens: v })));
    genGroup.appendChild(ui.checkboxRow("Let the models think", config.allowReasoning, (v) => patch({ allowReasoning: v }), "Off by default: Houselights asks the model not to reason before it answers. When on, raise Max tokens well " + "above its usual value and expect each reaction to take seconds longer. More in the guide."));
    genGroup.appendChild(ui.numberRow("Give up after (seconds)", config.generationTimeoutSeconds, { min: 10, max: 600, step: 10 }, (v) => patch({ generationTimeoutSeconds: v }), "How long each model call may take before Houselights stops waiting and says so."));
    const voiceGroup = el("div", { className: "hl-group" });
    const va = voice.availability();
    if (!va.tts && !va.stt) {
      voiceGroup.appendChild(note("This Lumiverse cannot speak or listen yet, so there is nothing to turn on. Updating Lumiverse may add it."));
    } else if (va.media === false) {
      voiceGroup.appendChild(note("Lumiverse has not granted Houselights the media permission, so the speaker and the mic stay hidden. " + "Press Allow voice on this card."));
    }
    const voiceHelp = !va.tts && !va.stt || va.media === false ? undefined : "Off until you turn it on. Speak reactions aloud is on the During the show card and on the widget; the widget's " + "mic takes one thing you say per press. Each character speaks in the voice on its Voice tab in Lumiverse's character editor, or your default TTS voice. " + "More in the guide.";
    const onPhone = captureTab.isPhone();
    voiceGroup.appendChild(ui.selectRow("Mic recogniser on your computer", config.sttProvider ?? "default", STT_PROVIDER_CHOICES.map((c) => ({ value: c.id, label: c.label })), (v) => patch({ sttProvider: v }), "What turns your speech into text. Whistle runs on your own machine. Browser speech recognition and an STT connection " + "send the audio elsewhere."));
    voiceGroup.appendChild(ui.selectRow("Mic recogniser on mobile", config.sttProviderPhone ?? "auto", STT_PHONE_CHOICES.map((c) => ({ value: c.id, label: c.label })), (v) => patch({ sttProviderPhone: v }), [
      "The mic is always the phone's or tablet's own. Automatic uses the first of these that works there:",
      "1. Lumiverse's Voice & Speech setting. 2. Browser speech recognition. 3. Your STT connection. 4. Whistle."
    ]));
    if (va.stt) {
      const label = { webspeech: "Browser speech recognition", whistle: "Whistle", connection: "Your STT connection" };
      const rows = va.providers.map((p) => `${label[p.id] ?? p.name}: ${p.available ? "works here" : sttReasonText(p.unavailableReason)}`);
      const secure = isSecurePage();
      voiceGroup.appendChild(note(`On this ${onPhone ? "phone or tablet" : "computer"}: ${rows.join("; ")}.` + (secure ? "" : " This page is open over plain http, so the browser gives it no microphone. Open Lumiverse at an https address " + "(Lumiverse's Tailscale guide sets one up) and the mic can work here.")));
    }
    voiceGroup.appendChild(ui.checkboxRow("Send what the mic heard by itself", config.voiceAutoSend === true, (v) => patch({ voiceAutoSend: v }), "When on, what the mic heard appears in the Talk back box and is sent after a short wait. Press Escape or edit it to hold " + "it back. When off, it waits for Enter."));
    voiceGroup.appendChild(ui.numberRow("Wait before sending (seconds)", config.voiceAutoSendDelaySeconds ?? 3, { min: 0, max: 15, step: 1 }, (v) => patch({ voiceAutoSendDelaySeconds: v })));
    const boxGroup = el("div", { className: "hl-group" });
    const boxHelp = "In a group chat, the members watch together as a Box Seat. Each Look goes viewer by viewer, one model call each, and " + "every line is its own message. Each viewer's stance is set on the Who reacts card in the Houselights tab. More in the guide.";
    boxGroup.appendChild(ui.numberRow("Lines per Look", config.boxLines ?? 2, { min: 1, max: 4, step: 1 }, (v) => patch({ boxLines: v }), "At most this many viewers speak on each Look."));
    boxGroup.appendChild(ui.checkboxRow("Let a second viewer answer the first", config.boxRebuttal !== false, (v) => patch({ boxRebuttal: v }), "When on, the next viewer answers the first one's line. When off, each Look gets exactly one line, from the viewer whose turn it is."));
    boxGroup.appendChild(ui.checkboxRow("Seat your council members too", config.boxCouncil === true, (v) => patch({ boxCouncil: v }), "When on, your Lumiverse council members can watch too. A group chat seats them all to begin with; a solo chat seats only " + "the ones you turn on, on the Who reacts card, and then runs as a Box Seat."));
    const watchGroup = el("div", { className: "hl-group" });
    const pinned = config.pinnedChatId ?? "";
    const options = [{ value: "", label: "Whichever chat is open" }];
    for (const c of chats)
      options.push({ value: c.id, label: chatLabel(c) });
    if (pinned && !chats.some((c) => c.id === pinned))
      options.push({ value: pinned, label: activeChat && activeChat.id === pinned ? chatLabel(activeChat) : "Pinned chat" });
    watchGroup.appendChild(ui.selectRow("Reactions go to", pinned, options, (v) => {
      ctx.sendToBackend({ type: "pin_chat", chatId: v || null });
    }, "Reactions go to whichever chat is open, if React in this chat is on there. Choose a chat to pin it: reactions then " + "always land in it, and the Houselights tab counts the ones you have not seen. Pinning a chat turns reactions on for it."));
    const promptGroup = el("div", { className: "hl-group" });
    promptGroup.appendChild(ui.textField("Framing", "The situation, from the character's side. Lumiverse macros such as {{char}} and {{user}} work here. " + "Lumiverse adds the character card, persona, world info and memories itself, so leave them out.", config.systemPrompt, 6, (v) => patch({ systemPrompt: v }), () => {
      patch({ systemPrompt: defaults.systemPrompt });
      render();
    }));
    promptGroup.appendChild(ui.textField("Self-recognition", "What the character does when it sees itself on screen. It applies under every stance. Leave it empty to turn it off.", config.selfRecognition ?? defaults.selfRecognition ?? "", 3, (v) => patch({ selfRecognition: v }), () => {
      patch({ selfRecognition: defaults.selfRecognition ?? "" });
      render();
    }));
    promptGroup.appendChild(captionHelp(el("span", { className: "hl-subhead hl-subhead-gap", textContent: "Stances" }), "Stances", boldTokens("A stance's instruction is sent after the chat's history. {{scene}} is replaced with what was seen. " + "{{hushed}} is empty unless a hush is part of the moment; wrap hush-only text in {{ifhushed}}…{{/ifhushed}}. More in the guide.")));
    promptGroup.appendChild(ui.textField("Heckler instruction", "The Heckler mocks what it sees, one thing at a time.", config.roastInstruction, 10, (v) => patch({ roastInstruction: v }), () => {
      patch({ roastInstruction: defaults.roastInstruction });
      render();
    }));
    promptGroup.appendChild(ui.textField("Coach instruction", "The Coach is helpful and encouraging.", config.coachInstruction ?? defaults.coachInstruction ?? "", 8, (v) => patch({ coachInstruction: v }), () => {
      patch({ coachInstruction: defaults.coachInstruction ?? "" });
      render();
    }));
    promptGroup.appendChild(ui.textField("In character instruction", "In character has no act to put on.", config.characterInstruction ?? defaults.characterInstruction ?? "", 8, (v) => patch({ characterInstruction: v }), () => {
      patch({ characterInstruction: defaults.characterInstruction ?? "" });
      render();
    }));
    promptGroup.appendChild(ui.textField("Talk back instruction", "How the character answers when you say something with Talk back. Your line is already in the chat when this is sent.", config.talkInstruction ?? defaults.talkInstruction ?? "", 6, (v) => patch({ talkInstruction: v }), () => {
      patch({ talkInstruction: defaults.talkInstruction ?? "" });
      render();
    }));
    promptGroup.appendChild(ui.textField("Box Seat framing", "Used in a Box Seat in place of Framing. {{viewers}} becomes the viewers' names. It carries its own self-recognition text.", config.boxFraming ?? defaults.boxFraming ?? "", 6, (v) => patch({ boxFraming: v }), () => {
      patch({ boxFraming: defaults.boxFraming ?? "" });
      render();
    }));
    promptGroup.appendChild(ui.textField("Box Seat focus", "Tells the model to write one viewer's line and nobody else's. {{seat}} is the viewer and {{stance}} their stance in a few words. More in the guide.", config.boxFocus ?? defaults.boxFocus ?? "", 5, (v) => patch({ boxFocus: v }), () => {
      patch({ boxFocus: defaults.boxFocus ?? "" });
      render();
    }));
    if (config.visionMode === "describe") {
      promptGroup.appendChild(ui.textField("Vision prompt", "What the vision model is asked. Its answer must be JSON with scene, interest and kind.", config.visionPrompt, 8, (v) => patch({ visionPrompt: v }), () => {
        patch({ visionPrompt: defaults.visionPrompt });
        render();
      }));
    }
    const promptFactory = button("Reset prompts to factory", () => {
      confirmDanger(ctx, "Reset Prompts", "Every prompt on this card goes back to its stock text. Your saved instructions stay.", "Reset").then((yes) => {
        if (!yes || !defaults)
          return;
        patch({
          systemPrompt: defaults.systemPrompt,
          selfRecognition: defaults.selfRecognition ?? "",
          roastInstruction: defaults.roastInstruction,
          coachInstruction: defaults.coachInstruction ?? "",
          characterInstruction: defaults.characterInstruction ?? "",
          talkInstruction: defaults.talkInstruction ?? "",
          boxFraming: defaults.boxFraming ?? "",
          boxFocus: defaults.boxFocus ?? "",
          visionPrompt: defaults.visionPrompt
        });
        render();
      });
    }, "small");
    promptFactory.classList.add("hl-reset");
    promptGroup.appendChild(el("div", { className: "hl-card-foot" }, [promptFactory]));
    const withHead = (head, body) => el("div", {}, [el("span", { className: "hl-subhead hl-subhead-gap", textContent: head }), body]);
    voiceGroup.appendChild(withHead("What works here", captureTab.backPanel("voiceCheck")));
    testGroup.appendChild(captureTab.backPanel("troubleshooting"));
    testGroup.appendChild(resetBlock());
    const sections = [
      ["models", "Models", genGroup, true],
      ["seeing", "Seeing", visionGroup, true],
      ["capture", "Capture", captureTab.backPanel("capture"), false],
      ["pacing", "Pacing", paceGroup, true],
      ["voice", "Voice", voiceGroup, false],
      ["box", "Box Seat", boxGroup, false],
      ["watchingIn", "Pinned chat", watchGroup, false],
      ["webSearch", "Web search", captureTab.backPanel("webSearch"), false],
      ...captureTab.isPhone() ? [] : [["device", "Mobile", captureTab.backPanel("device"), false]],
      ["prompts", "Prompts", promptGroup, false],
      ["troubleshooting", "Troubleshooting", testGroup, false]
    ];
    const sectionHelp = { pacing: paceHelp, voice: voiceHelp, box: boxHelp, prompts: "Most people never need to open this. Each prompt has its own Reset to stock." };
    for (const [id, title, body, open] of sections)
      panel.appendChild(settingsFold(id, title, body, open, sectionHelp[id]));
    search.apply();
  }
  function resetBlock() {
    const run = (which) => {
      ctx.sendToBackend({ type: "reset_config", scope: which });
      resetNote = { text: "Resetting…", kind: "info" };
      render();
    };
    const settingsBtn = button("Reset settings", () => {
      confirmDanger(ctx, "Reset settings", "Every setting goes back to how it came. Your prompts and saved instructions stay.", "Reset").then((yes) => {
        if (yes)
          run("settings");
      });
    }, "danger");
    const factoryBtn = button("Reset to factory", () => {
      confirmDanger(ctx, "Reset to factory", "Everything Houselights has stored is cleared: settings, prompts, saved instructions and every chat's choices. This cannot be undone.", "Clear everything").then((yes) => {
        if (yes)
          run("factory");
      });
    }, "danger");
    const settingsTip = helpTip("Reset settings", "Puts every setting back to how it came. Your prompts and saved instructions stay, and each chat keeps its switch, stance and Custom instruction.");
    const factoryTip = helpTip("Reset to factory", "Clears everything Houselights has stored for you: settings, prompts, saved instructions, each chat's switch, stance and Custom " + "instruction, the Watching name and its memory of recent reactions.");
    const box = el("div", { className: "hl-card-foot" }, [
      el("span", { className: "hl-status", textContent: "Reset to factory cannot be undone." }),
      settingsBtn,
      settingsTip.button,
      factoryBtn,
      factoryTip.button
    ]);
    box.style.flexWrap = "wrap";
    const wrap = el("div", { className: "hl-stack" }, [box, settingsTip.note, factoryTip.note]);
    if (resetNote)
      wrap.appendChild(el("div", { className: statusClass(resetNote.kind), textContent: resetNote.text }));
    return wrap;
  }
  function settingsFold(id, title, body, defaultOpen, help) {
    const key = `set.${id}`;
    const d = el("details", { className: "hl-group hl-fold" });
    d.dataset.section = id;
    const tip = help ? helpTip(title, help, () => {
      d.open = true;
    }) : null;
    d.appendChild(foldSummary(title, "hl-fold-title", tip?.button, SETTINGS_ICONS[id]));
    if (tip)
      d.appendChild(tip.note);
    if (body.classList.contains("hl-group"))
      body.className = "hl-fold-body";
    else
      body.classList.add("hl-fold-body");
    d.appendChild(body);
    const saved = config?.folds?.[key];
    d.open = typeof saved === "boolean" ? saved : defaultOpen;
    d.querySelector("summary")?.addEventListener("click", () => {
      delete d.dataset.hlBySearch;
    });
    d.addEventListener("toggle", () => {
      if (d.dataset.hlBySearch)
        return;
      const now = config?.folds?.[key];
      if ((typeof now === "boolean" ? now : defaultOpen) === d.open)
        return;
      patch({ folds: { ...config?.folds ?? {}, [key]: d.open } });
    });
    return d;
  }
  const unsubscribe = ctx.onBackendMessage((payload) => {
    const msg = payload;
    if (msg.type === "state") {
      const s = msg;
      config = s.config;
      defaults = s.defaults;
      connections = s.connections ?? [];
      activeChat = s.activeChat;
      chatMode = s.chatMode ?? "follow";
      chats = s.chats ?? [];
      sampleScene = s.sampleScene ?? "";
      if (!scene)
        scene = sampleScene;
      if (s.hush) {
        hush = s.hush;
        refreshHushButton();
      }
      captureTab.onSettings();
      if (s.watching)
        captureTab.onWatching(s.watching);
      if (s.companionSession)
        captureTab.onCompanionSession(s.companionSession.live === true, s.companionSession.stopsInMs !== undefined && s.companionSession.windowMs ? { stopsInMs: s.companionSession.stopsInMs, windowMs: s.companionSession.windowMs } : null);
      const startChat = s.chatState ?? {
        type: "chat_state",
        chat: s.activeChat,
        enabled: s.chatEnabled === true,
        mode: s.chatMode ?? "follow",
        activeChatId: s.activeChatId ?? null,
        newReactions: s.newReactions ?? 0
      };
      lastChat = startChat;
      captureTab.onChatState(startChat);
      syncPane();
      render();
      return;
    }
    const otherWindowsSave = (msg.type === "config_changed" || msg.type === "config_saved") && typeof msg.saveId === "string" && !mySaves.has(msg.saveId);
    if (msg.type === "config_changed" && !otherWindowsSave)
      return;
    if (otherWindowsSave) {
      const m = msg;
      const wasSpeaking = config?.voiceOut === true;
      config = m.config;
      if (wasSpeaking && config.voiceOut !== true)
        voice.stop();
      syncPane();
      pane?.refresh();
      captureTab.onSettings();
      captureTab.refreshVoice();
      render();
      return;
    }
    if (msg.type === "config_saved") {
      config = msg.config;
      syncPane();
      pane?.refresh();
      return;
    }
    if (msg.type === "watching_state") {
      captureTab.onWatching(msg);
      return;
    }
    if (msg.type === "reset_done") {
      const factory = msg.scope === "factory";
      resetNote = { text: factory ? "Everything Houselights stored is cleared." : "Settings are back to how they came. Your prompts stayed.", kind: "ok" };
      ctx.sendToBackend({ type: "get_state" });
      render();
      return;
    }
    if (msg.type === "chat_state") {
      const s = msg;
      lastChat = s;
      activeChat = s.chat;
      chatMode = s.mode ?? "follow";
      captureTab.onChatState(s);
      render();
      return;
    }
    if (msg.type === "chats") {
      chats = msg.chats ?? [];
      render();
      return;
    }
    if (msg.type === "capture_received") {
      captureTab.onReceipt(msg);
      return;
    }
    if (msg.type === "talk_landed") {
      const chatId = typeof msg.chatId === "string" ? msg.chatId : "";
      const text = typeof msg.text === "string" ? msg.text : "";
      composer.landed(chatId, text);
      toolbar?.landed(chatId, text);
      return;
    }
    if (msg.type === "companion_frame") {
      captureTab.onCompanionFrame(msg);
      return;
    }
    if (msg.type === "companion_reaction") {
      captureTab.onCompanionReaction(msg.result);
      return;
    }
    if (msg.type === "companion_session") {
      const stopsInMs = Number(msg.stopsInMs);
      const windowMs = Number(msg.windowMs);
      captureTab.onCompanionSession(msg.live === true, Number.isFinite(stopsInMs) && Number.isFinite(windowMs) && windowMs > 0 ? { stopsInMs, windowMs } : null);
      return;
    }
    if (msg.type === "remote_extend_request") {
      captureTab.onRemoteExtendRequest();
      return;
    }
    if (msg.type === "remote_look_request") {
      captureTab.onRemoteLookRequest(msg);
      return;
    }
    if (msg.type === "remote_look_result") {
      captureTab.onRemoteLookResult(msg);
      return;
    }
    if (msg.type === "reaction_progress") {
      captureTab.onProgress(msg);
      return;
    }
    if (msg.type === "reaction_result") {
      const result = msg;
      const mine = captureTab.onReaction(result) || result.origin === "after-hush" && result.ok && captureTab.isLive() || result.origin === "curtain-call" && result.ok && captureTab.justEnded();
      if (!mine)
        return;
      const viewers = lastChat?.box?.viewers ?? [];
      const only = result.speakOnly !== undefined ? result.speakOnly : speakerOf(config?.boxSpeakers, result.chatId ?? "", viewers.filter((x) => x.seated !== false));
      voice.speakReaction(result, (line) => {
        if (line.viewerId)
          return line.viewerId;
        const v = viewers.find((x) => line.characterId && x.id === line.characterId || x.name === line.name);
        return v?.id ?? null;
      }, only);
      return;
    }
    if (msg.type === "roast_result") {
      busy = false;
      status = msg.ok ? { text: `Sent to the chat: "${String(msg.roast)}"`, kind: "ok" } : { text: `Failed: ${String(msg.error)}`, kind: "err" };
      render();
      return;
    }
    if (msg.type === "lookup_status") {
      captureTab.onLookupStatus(msg);
      return;
    }
    if (msg.type === "tail") {
      pane?.setTail(msg);
      return;
    }
    if (msg.type === "hush_state") {
      const next = msg;
      const changed = next.hushed !== hush.hushed || next.source !== hush.source;
      const silence = next.hushed && changed;
      hush = next;
      refreshHushButton();
      pane?.setHush(hush);
      captureTab.onHush();
      if (silence)
        voice.stop();
      if (changed)
        render();
      return;
    }
  });
  const unsubMessageSent = ctx.events.on("MESSAGE_SENT", () => pane?.noteActivity());
  render();
  ctx.sendToBackend({ type: "get_state" });
  voice.refreshPermissions().then(() => {
    render();
    pane?.refresh();
    captureTab.refreshVoice();
  });
  return () => {
    unsubMessageSent();
    pane?.destroy();
    pane = null;
    toolbar = null;
    composer.destroy();
    voice.destroy();
    beatDecorator.destroy();
    captureTab.destroy();
    if (hushTicker !== null)
      clearInterval(hushTicker);
    unsubHushClick();
    hushAction.destroy();
    unsubscribe();
    removeStyle();
    ctx.dom.cleanup();
  };
}
export {
  setup
};
