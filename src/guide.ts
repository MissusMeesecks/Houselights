/**
 * D-087 (D2): the guide, shown by Lumiverse's own help button on the Houselights tab's
 * header (`registerDrawerTab({ guide })`). Help behind a `[?]` stays at about three
 * sentences; what does not fit ends "More in the guide." and continues here.
 * D-088 adds the full settings' sections.
 */
import { LIGHT_MODEL_GUIDE } from './reasoning.ts'

export const GUIDE_TITLE = 'Houselights'

/**
 * D-104: Lumiverse's guide viewer renders with line breaks kept (its `marked` is set to
 * `breaks: true` for chat messages, and the setting is global), so a paragraph wrapped in the
 * source showed a break at every wrap. This joins each paragraph, and each list item with its
 * indented continuation, into one line. Headings, list items and blank lines start a new line.
 */
export function unwrapMarkdown(markdown: string): string {
  const out: string[] = []
  for (const line of markdown.split('\n')) {
    const blank = line.trim() === ''
    const starts = /^(#{1,6} |[-*+] |\d+\. |```|\||>)/.test(line)
    const prev = out.length ? out[out.length - 1]! : ''
    if (!blank && !starts && out.length && prev.trim() !== '' && !/^(#{1,6} |```)/.test(prev)) {
      out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`
    } else {
      out.push(blank ? '' : line)
    }
  }
  return out.join('\n')
}

/** The guide as written, wrapped for reading here. Lumiverse gets `GUIDE_MARKDOWN`. */
export const GUIDE_SOURCE = `# Houselights

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
`

export const GUIDE_MARKDOWN = unwrapMarkdown(GUIDE_SOURCE)
