# Installing Houselights

**Time needed:** about two minutes, plus however long you spend arguing with your character.

---

## 1. Install the extension

1. In Lumiverse, open the **Extensions** panel.
2. Choose **install from URL** and paste:

   ```
   https://github.com/MissusMeesecks/Houselights
   ```

3. Lumiverse asks you to approve seven permissions:

   | Permission | Why Houselights needs it |
   |---|---|
   | `generation` | To ask your connections for a description and a reaction |
   | `chats` | To know which chat you're looking at |
   | `chat_mutation` | To put the reaction and the hidden note into the chat |
   | `characters` | To read the character's name |
   | `ui_panels` | To draw the widget, a small floating window over the page |
   | `media` | Voice: speak replies aloud and push-to-talk, only when you turn them on |
   | `web_search` | Look things up: notes about the game you confirmed, only in chats where you turn it on |

   That is the complete list. If it asks for anything beyond those seven, stop. (`web_search` is privileged: Lumiverse may ask for it separately, or leave it ungranted until you press **Allow web search** in the tab. Everything else works without it.)

After an update, the top of the Houselights tab shows your Houselights and Lumiverse versions and
whether every permission is granted. Lumiverse doesn't always ask for a newly added one; if a permission
is missing, the line names it and what stops working without it.

## 2. Open a chat and turn it on there

Houselights reacts in whichever chat you are **looking at**, and only in chats you've switched it on
for. Open a chat with the character you want doing the watching, open the drawer, find the
**Houselights** tab (the popcorn icon), and tick **React in this chat**.

**Pick a stance (optional).** Under the switch, **Stance** says how this chat's character takes what it
sees: **In character** (the default — no act to put on; the character is told what's on screen and
reacts as themselves, the best fit for most cards), **Heckler** (picks one thing on screen and mocks it),
**Coach** (notices what you're doing and offers one useful pointer, encouraging rather than
condescending), or **Custom** (the box
starts with a default — In character, plus a part for after a hush — to use as is or edit; **Reset to
default** puts it back. Write your own instruction there; `{{scene}}` marks where what was seen goes, and if you
leave it out the scene is put in front of your text; `{{hushed}}` is empty unless a hush is part of the
moment, and then says so — *"{{user}} hushed you for 4 minutes. That is over now, and this is the first
thing you have said since."* — so your instruction can react to being silenced. Put hush-only guidance
between `{{ifhushed}}` and `{{/ifhushed}}` and it's left out of the prompt entirely when there was no
hush, so the character isn't reminded of hushes on every Look. A reaction whose prompt mentioned a hush
shows *told: hush* next to its time in the widget's chat strip; *told: held back* means it was told it
kept quiet while you were talking). Give a Custom instruction a name and **Save as**
to keep it; **Saved instructions** then lists it in every chat, and picking one makes it that chat's
instruction. In a Box Seat, each Custom viewer can have a saved instruction of their own (see 5¾).
The stance is per chat and takes effect on the
next Look. The expanded widget has the same selector. Whatever the stance, the character is also told
it's looking out at your real screen, and that if they appear on it themselves — their own face, their
name, a character who is them — they recognise it.

**Pin a chat (optional).** Under the switch there's **Pin this chat**. Pinned, reactions keep landing
in that chat even while you're reading or playing somewhere else, and the Houselights tab shows a
*N new* badge until you go back. Beside **Unpin**, a badge says where you are: **You're here** in the
pinned chat, **You're elsewhere** anywhere else, with a **Go to chat** button that takes you there. Pinning switches the chat on for you. **Unpin** goes back to following
whichever chat is open. The same choice lives in the settings as **Pinned chat**.

## 3. First Look

1. Pick the models once, in the full settings (**Open the full settings** at the bottom of the tab →
   **Models**): the reaction model is the character's voice, the vision model is the eyes. "Use my
   default connection" is fine to start. Every section of the tab and of the settings page folds,
   and remembers whether you left it open.
2. Press **Start + Look**, in the **Session** section at the top of the tab. It stays greyed out until **React in
   this chat** is ticked. Your browser's share dialog opens; pick a window or a screen.
3. Within a few seconds the character says something about it, as a normal message in the chat, and a
   hidden note with a thumbnail appears above it.

If the tab says the browser can't share the screen, you're on a plain `http://` address that isn't
`localhost`; browsers only allow screen capture on `https://` or `localhost`. The webcam, phone camera
and picture buttons under **Other eyes** work either way.

## 4. Sessions

**Start** opens a session so that each Look needs no picker. In **continuous** mode (the **Mode**
picker under the Session buttons) a session also looks on its own every few seconds, skips frames where
nothing changed, rates whether the moment is worth a comment, and waits out a cooldown between
reactions. **Stop** ends the session; **Extend** pushes back the 30-minute auto-stop. A **LIVE** badge
sits on the tab while a session runs, and your browser shows its own sharing indicator too.

**Paranoid** mode asks the browser's share dialog on every single Look and never holds a session open.

## 5. The other buttons

- **Look** also lives in the chat's input bar, so you can fire it without opening the drawer. While
  something is typed in Lumiverse's chat box it becomes **Send + look**: a fresh Look, with what you
  typed going in as your message. The chat box empties only once your line is in the chat; if the
  Look fails, what you typed stays. (It never presses Lumiverse's own Send, which would answer in the
  card's ordinary voice.)
- **Hush** (input bar, widget, phone toolbar, and in the tab beside **Stop**): they keep watching, they just can't talk about it. The button
  counts down (*Hushed · 4:32*); click it again to let them talk. While hushed, nothing breaks through
  by default, and anything already being read aloud stops. Interesting moments still go into the chat
  as hidden notes (at most one per minimum gap), and the first thing they say afterwards is
  handed a short list of what they saw, so they can bring one up. When a hush you pressed ends
  (lifted or run out), they say one thing about the most interesting moment from it (Pacing has the
  switch; on by default). A Look or a line you send yourself still gets an answer, and the hush keeps running. Starting a new session clears anything left over from an earlier hush. Only your own messages count as you talking — a new chat's greeting doesn't. A stance instruction can use `{{hushed}}` to be told about the hush itself (see "Pick a stance" in 2).
  It also goes quiet by itself for a moment after you speak in the chat; the widget's strip shows that
  one, not the button.
- **Other eyes:** **Webcam** opens a preview and **Snap** takes one photo (the camera is released
  immediately). **Phone camera** opens the camera app when you're using Lumiverse from a phone.
  **Choose a picture** sends any image from disk.
- **Send a test picture** sends a made-up picture so you can check the path without sharing anything.

## 5½. The widget

*On a phone or tablet:* the widget is a small **toolbar** over the chat, not a window. Reactions
are read in the chat itself, where they land like any message, so it has no picture and no chat of
its own. It's on by default; **Hide widget**, at the top of the Houselights tab, turns it off (your
computer keeps its own switch, so one doesn't change the other). The tab on a phone starts with
**Camera and pictures** and hides the screen-sharing buttons, the Mode picker and Pop out on start,
since phones can't share their screen.

A short walk through it on a phone:
1. Open the chat you want reactions in. The toolbar sits near the bottom: **Photo** (the camera
   app), **Picture** (one from your files), **Hush**, the speaker, **?** and **Fold away**. Not sure
   what one does? Tap **?**, then the button: the toolbar says what it does without doing it.
2. Take a photo or pick a picture; the line under the buttons says what's happening (*Reading the
   picture…*, *Marlo is answering…*), and the reaction lands in the chat.
3. Drag the toolbar wherever it's out of your way; it remembers. When the keyboard comes up it
   moves above it, clear of the chat box, and goes back when the keyboard goes down.
4. **Fold away** folds it to a small **popcorn** on a disc in your theme's accent colour. Tap the
   popcorn to bring the toolbar back.

*Desktop companion (a phone beside your computer):* tick **Follow my computer**, off by
default, in the phone's Houselights tab under **During the show** (it's also under **This
device** in the full settings). Then, while you play on the computer:
- open the same chat on the phone. Reactions land there as they happen;
- the toolbar's first button follows Lumiverse's chat box. Empty, it reads **Look**: your computer
  takes a fresh Look. Type something and it reads **Send + look**: your line goes with the Look, as
  your message. A one-time tip points this out the first time; **Show tips again**, under Follow my
  computer in the tab, brings it back. The chat box empties once your line is in the chat; if the Look fails (the
  computer isn't sharing, say), what you typed stays;
- the same **Look** / **Send + look** is in the chat box's own menu on the phone while Follow my
  computer is on, and **Photo** and **Picture** stay on the toolbar for the phone's own camera;
- if the chat open on the phone isn't the one Houselights is reacting in, the button says **Go to
  chat** and takes you there, so the reply lands where you can see it;
- on an older Lumiverse that doesn't let extensions use its chat box, the button stays **Look**, and
  a pencil beside it opens a one-line box on the toolbar: type, press Enter, and it closes;
- if a Look fails (your computer isn't sharing yet, say), the toolbar says so for a few seconds and
  then clears; it also clears the moment your computer starts sharing.

Things to know:
- The computer must already be sharing: start a session there. The phone can't start one, because
  browsers only open the share picker for a click on the computer itself. If nothing is being shared,
  or the computer is busy with the last reply, the phone says so; if it hears nothing back within 10
  seconds, it says that too.
- A Look your computer takes is read aloud on the computer, even when the phone asked for it.
- When a session ends, the character says one closing line about it, the curtain call (**Curtain call when a session ends**, in the full settings under Pacing, on by default).
- Sessions stop themselves after 30 minutes unless extended (the length is in the full settings under Capture). Extend is on
  the computer, and for the last two minutes the phone's toolbar shows *Stops in m:ss · Extend* too: tapping it
  there gives the computer's session more time.
- Anyone holding your unlocked phone, signed in to your Lumiverse, can ask for a Look while a session
  runs. It's still only what you chose to share, and your browser's sharing indicator stays on the
  whole time.
- On a plain `http://` address the small picture travels to the phone unencrypted over your home
  network, like the rest of Lumiverse on that address.

A small window that floats over the page, so you can see Houselights without opening the drawer:
the last frame the character saw, their avatar, the newest reaction as a caption, and Look / Hush /
Stop. Drag it anywhere; pull the bottom-right corner to resize it. **Expand** expands it: the picture
stays whole and the chat's last few messages appear under it, with each of the character's "saw:"
notes as a small marker. **Pop out** pops it out into its own window that stays on top of a fullscreen
game (Chrome, Edge and Firefox); tick **Pop out on start**, in the tab's **During the show** section, and it opens that
way whenever a Look button starts a session — the tab's, the widget's own, or the input bar's. **Open in Lumiverse** (on the pop-out, **Back to Lumiverse**) takes you to the chat reactions land in when you're in another one.
**Next-track key = Look**, in the tab's **During the show** section and off by default, turns your keyboard's next-track
media key into Look while a session runs, game in front or not. Browsers only send media keys to a
page that is playing something, so Houselights plays silence for as long as the session runs; until
you stop the session, Spotify and other players won't skip on that key. The widget shows *⏭ = Look*
while it's held. A key press can't open the share picker, so start the session with a click first.
If another player is open and the key still goes to it, press the key and pick Houselights in the
media pop-up your system shows (on Windows, the arrow at its edge switches between players): which
player gets the key is your system's choice, not the page's. If the key stops answering
mid-session, untick **Next-track key = Look** and tick it again.
In a group chat the widget has no stance switch: each viewer's stance is set in the tab's Box Seat
section, so one slip can't change the whole box.

**Watching: … ?** When a session starts, Houselights tries to work out what you're in, from the window
title (Firefox gives one; Chrome and Edge don't) or from what the vision model can read off the screen,
and shows it as a chip on the widget and in the tab: **Watching: Palworld? ✓ ✎ ✕**. Nothing is sent until
you say yes or edit it; ✕ dismisses it. Once confirmed, the character is told that's what you're in,
which makes the heckling sharper. It asks again only after a big change on screen (alt-tab sized),
never per frame.

The name lasts for the session. When the session ends (Stop, or stopping by itself), the name stops
being used; at the next Start the chip asks **Still Palworld? ✓ ✎**, and nothing is sent until you
tap ✓ or change it. A Look outside a session works the same way. In *describe* mode the name is also
checked against the screen: each Look, the vision model is asked whether the screen still looks like
it, and after two "no"s in a row the chip asks **Still Palworld?** again and stops sending the name
(menus and loading screens never count against it). If you answer "yes, still that", it takes more
"no"s to ask again. What is being watched also shows on the widget's status line and, on a phone
following your computer, on its toolbar: **Watching: Palworld**, or **Watching: ?** while a question
is waiting.

**Talking back.** Expanded, there's a line at the bottom: *Say something about what they can see*.
**Send** (or Enter) posts your line into the chat and the character answers it with the last thing it
saw. **Send + look** (or Ctrl+Enter) takes a fresh look first and sends your line with it. With that
line empty, Send + look takes what's typed in Lumiverse's own chat box instead (the button lights up
and says so); the chat box empties once your line is in the chat. Your line
lands in the chat as a normal message from you; the reply comes through Houselights, in the same
voice as a Look, never through the chat's own reply button.
It is on by default; press **Hide widget**, at the top of the Houselights tab, to turn it
off. **Pop out on start** needs it, so it greys out while the widget is off.

**The portrait.** The tab's **During the show** section (under *Widget appearance*) sets the speaker's portrait on the widget's picture:
**Portrait size** (a share of the picture's height, so it grows when you resize the widget) and
**Portrait opacity** (lower lets the picture show through). Dragging either slider shows the change
on the widget straight away; it's saved when you let go. **Text size** (70–200%) works the same way
for the widget's and the pop-out's text; the buttons keep their size so the row still fits.

**Hide picture and Lines only.** Two buttons in the top-right corner of the widget's picture, each one tap,
each label saying what the tap does:
- **Hide picture** hides the last picture the character saw. The portraits and the lines stay, and the top
  of the widget shrinks to the portrait (at the size it would have over the picture), with the newest
  line beside it; **Portrait size** sets how tall that is, and a long line makes it taller.
- **Lines only** hides every line of text that isn't a character's or yours: the "Reacting in" strip,
  the progress line, error notes, reasons for staying quiet, and in the expanded view the "saw:" rows
  and the times. Your own lines stay. The buttons and the Talk box stay usable.
Both are remembered, and both are also tickboxes in the tab's **During the show** section, under *Widget appearance*. The LIVE badge stays
either way: it's your sign that the screen is being shared.

**While it's working.** Between Look and the reply, a line under the buttons says what's happening:
*Looking…*, *Reading the picture…* (describe mode), *Looking things up…* (a Coach with search on), then
*Marlo is writing…* — or in the Box Seat, *Wren is writing (1 of 4)…*, *Marlo is answering
(2 of 4)…*. Each Box Seat line appears on the widget as it lands, so a four-seat Look isn't a long
silence. Look is greyed until the reaction is done: one reaction at a time, so a second press can't
collide with the first. If nothing comes back for two and a half minutes (say, the extension was
reloaded mid-reaction), Look works again.

## 5¾. The Box Seat

Several characters can watch at once. In Lumiverse, make a **group chat** with the characters you want
in the Box Seat. Open that chat (or pin it) and Houselights treats it as a **Box Seat**. Each Look goes seat by
seat: the opener writes a line (the viewers take turns opening), then the next viewer is asked, with that
line already in the chat, to answer it. Each line lands as its own message. On a Lumiverse build that
allows it, the line carries that character's own name and avatar, exactly as if they had spoken; on older
builds it carries a *"Name:"* prefix instead, which the widget reads for the avatar. The Houselights tab's
Box Seat section says which of the two your host does. The widget's avatar is whoever spoke last, and the
expanded tail shows a small avatar by each line.

In the Houselights tab, under the chat's stance, the **Box Seat** section lists the viewers, each as
their own indented block — the name, then that viewer's **Stance** (one heckles, one coaches) and, for a
Custom viewer, their **Instruction**. Whatever the group's card mode,
Houselights puts each seat's own card — description, personality, scenario — in that seat's call, so
a viewer sounds like themself rather than like the group's first member. In the settings, **The Box Seat** sets how many lines a Look may produce (default two) and
whether a second viewer answers at all. One model call per line. Talk back with **@Name** to make that
viewer open. With more viewers than lines, the seats after the opener go to whoever has waited longest
since they last spoke, so everyone gets a turn.

**A Custom instruction per viewer.** When a viewer's stance is **Custom**, a line under it —
**Marlo's instruction** — picks which saved instruction they use: *This chat's Custom text* (the box
above, shared by every Custom viewer who has nothing picked), or any instruction you've saved with
**Save as**. So Marlo can sigh while Ottilie gushes. Picking one copies its text for that viewer, so
editing or deleting the saved one later doesn't change them.

**Council members:** with **Seat your council members too** on in the settings, the members of your
Lumiverse council can watch too, their definition, personality and behaviour standing in for a card.
- **In a group chat** they all join the box by default; the tab's Box Seat section has a **sits in
  this box** tickbox for each, and every chat keeps its own choice.
- **In a solo chat** nobody joins unless you ask: the tab shows **Council members** with a **joins this
  chat** tickbox each. Tick one and the chat runs as a Box Seat — the character plus whoever you
  ticked, seat by seat, a stance each. Untick them all and it's an ordinary solo chat again.

In Lumiverse's chat view the big round picture on a council member's line is the chat's main
character's: Lumiverse draws that circle only for characters, and Houselights can't change it. So
Houselights adds the member's own small portrait right after the name in that message's header,
and the widget shows their portrait as usual. Nothing is written into the chat for it; it's drawn
for the last 200 messages of the chat you have open (and fetched for older ones as you scroll).

One caveat. Swiping a box line in Lumiverse uses Lumiverse's own generation, not Houselights, so a swiped
line can lose the watcher voice.

## 5⅞. Voice

Off until you turn it on, and only on a Lumiverse build with the speech APIs (the full settings'
**Voice** section says whether yours has them, under *On this device*). If you installed Houselights before the `media`
permission was added, that section has an **Allow voice** button that asks Lumiverse for it. **Speak
reactions aloud** is also in the tab's **During the show** section, next to Hush.

- **Speaker** (on the widget's buttons): reads each reaction aloud, one line after another. It's an on/off switch, the same one as **Speak reactions aloud** in the
  extension settings, and it's one setting for all your devices: turning it off on one turns it off on
  every open Lumiverse. A reaction is only ever spoken by the window that asked for it, so a phone left
  open doesn't read out your computer's Looks. Each character speaks in the voice set on its **Voice**
  tab in Lumiverse's character editor, or your default Lumiverse TTS voice if it has none, so in a Box
  Seat every viewer can sound different. That needs the chat to be the one open on screen: with a
  pinned chat while you're in another, the reactions are still read aloud, but every line is in your
  default voice (Lumiverse finds a character's voice only for the chat you're looking at). While the speaker is on, the tab's Box Seat section has
  **Speaks aloud**: *Everyone, one after another*, or *Only Marlo* (any one viewer). With one chosen, the others' lines still appear in
  the chat and on the widget; they just aren't read out. The per-viewer **Voice** pickers (for council
  members, and on hosts that can't stamp lines) only show while the speaker is on, and only for
  viewers who are read aloud.
  Hush and the mic button both stop it. While the character is speaking, and for one cooldown
  after, a continuous session holds its automatic Looks.
- **Mic** (beside Talk back on the expanded widget): push-to-talk. Press once, say one thing, stop
  talking; the words appear in the Talk box for you to send. With **Send what the mic heard after a
  moment** ticked (Voice settings; off by default) they're sent a few seconds later unless you press
  Escape or start editing. There is no open mic: nothing listens between presses. Which recogniser it uses
  (Whistle on your own machine, the browser's, or your STT connection) is a setting; the default is
  whatever Lumiverse's Voice & Speech settings say. A phone keeps its own choice (**Mic recogniser on
  this phone**, *Automatic* to start with: Lumiverse's setting, then whichever works there), so changing
  it on the phone leaves your computer's alone. The mic is always the device's own. Under the choice,
  the settings list each recogniser as *works here* or why not.
  *On a phone, nothing works?* Check the address bar. Phone browsers give a plain `http://` page no
  microphone at all, so on an address like `http://192.168.x.x:7860` every recogniser fails; the
  settings say so when that's the case. Lumiverse's own Tailscale guide sets up an `https://` address
  for your phone. Firefox on Android has no browser speech recognition; Chrome and Safari do.
  *Untested:* the phone mic over an `https://` (Tailscale) address. Houselights has only been tried
  on a phone over plain `http://`, where it correctly says why the mic can't work. If you run Lumiverse
  over https on your phone, please report whether the mic works for you.

## 5⅞½. Look things up (any stance)

Every chat has a **Look things up** switch, on the Watching card in the Houselights tab, whatever its
stance. It is off by default, set for each chat separately, and needs three things: the `web_search` permission (the section has an
**Allow web search** button if Lumiverse hasn't granted it), Lumiverse's own **Settings → Web Search**
set up, and a name confirmed under **Watching**. Vision must be on *describe*, since the vision model
is what reads the search words off the screen.

When on, the character gets up to three short notes about what's on screen. A **Coach** uses them
to help. Every other stance (Heckler, In character, Custom) is told to use them only where they fit
who the character is and what they would naturally notice, and never to recite them: a Heckler who
knows the boss's weak spot is funnier, not more helpful. In the Box Seat there is one search per
Look and every seated viewer gets the notes. Houselights searches with the
name you confirmed plus text printed on screen — the current objective or quest line, the mission or
chapter name, the place, the boss — never the screenshot, never a window title, never how the scene
looks. If the screen shows no such text there is no search. A new search happens only when that text
changes, not on every Look. The tab shows the last search and how many notes came back.

**A Custom instruction needs no special wording.** The notes arrive in their own block, with their own
rules: use them as your own knowledge, never quote them, ignore them if they don't fit. Your
instruction can still steer them: *"If you have notes about the game, slip in one thing you happen to
know"*, or *"Never give hints, even if you know them."*

**Potential spoilers.** The character uses whatever the notes say about where you are (unless a Custom instruction says otherwise), and a guide may
mention what comes next: a later area, a twist, an ending. There is no spoiler-free setting; an
earlier one kept the Coach so vague it stopped helping. Leave Look things up off if you'd rather find
things out yourself.

**Recommended usage:** Coach works best in solo chats with Look things up on, the *On demand* mode
selected (under the Session buttons; the default), and **Next-track key = Look** enabled (the tab's
**During the show** section): start a session, play, and press the key when you want a pointer. The
same line sits under the Coach's description when you pick it.

A reaction that had notes in front of
it says *had notes* on the widget. Under the toggle, **Last search** shows the query, and **What the Coach
was given** shows the notes word for word. Houselights reads the pages the search found, not just their
one-line summaries, so a search takes a few seconds; it only happens when the on-screen text changes.

## 6. Where things are

**The rule:** what you touch per session or per chat is in the **Houselights tab** in the sidebar;
what you set once is in the **full settings** (**Open the full settings** at the bottom of the tab, or
**Settings → Extensions → Houselights**).

**The tab, top to bottom:**

- **The top** — the version line (Houselights and Lumiverse, and whether every permission is
  granted), then a small **Hide widget / Show widget** button (this device's widget switch: the
  computer's on a computer, the phone's on a phone) and the Idle / LIVE badge. Lumiverse's own help
  button on the tab's header opens the guide.
- **Session** — Start / Look / Stop / Extend, **Mode** (a two-part bar: *On demand* or *Continuous*),
  and a closed **Other eyes** fold with two labelled parts: **Webcam**, and **Camera and
  pictures**. (On a phone this section is **Camera and pictures**, with Other eyes open.)
- **Who reacts** — this chat on or off, Pin, the stance (with Custom and your saved instructions),
  Box Seat viewers and their stances, who speaks aloud.
- **Watching** — what you're in, and **Look things up** when the stance is Coach or Custom.
- **During the show** — things you might change mid-chat: **Hush** (*Hushed · 4:32* while it runs),
  **Speak reactions aloud**, **Pop out on start** (on by default), **Next-track key =
  Look** (here on purpose: it takes over your keyboard's next-track key), and a closed **Widget
  appearance** fold: portrait size and see-through, text size, Hide picture, Lines only.
- **Last sent** — at the bottom, always shown, never folded: exactly what left the browser.

**The full settings, top to bottom** (Models, Seeing and Pacing open; the rest folded until you open
them):

- **Models** — the reaction model (the character's voice) and the vision model (the eyes), temperature,
  top P, max tokens, whether to let models think (leave it off; see the README's "Which model"), and
  how long to wait before giving up.
- **Seeing** — *describe* (a vision model writes a plain description; the character gets text) or
  *attach* (the picture goes straight to the character's model, which must accept images); whether to
  keep the full-size frame on the hidden note.
- **Capture** — the continuous interval, the change threshold, the auto-stop, the picture sizes, the
  two share-dialog hints, and **Paranoid mode** (the share picker every single Look).
- **Pacing** — cooldown, the interest bar a moment has to clear, kinds of screen to ignore (menus,
  loading screens), how big a moment gets through an ignored kind anyway (8 by default: a death
  screen can look like a menu), how many past reactions to remember, hush length, staying quiet after you speak,
  whether something big enough breaks through a hush (11, the default, means never), and whether the
  character comments once when a hush you pressed ends (on by default). In
  *describe* mode the vision model keeps running during a hush — that's what keeping watching costs.
- **Voice** — the mic recogniser on your computer and on mobile, sending what the mic heard by
  itself, and what works here (with **Allow voice** and **Say a test line**).
- **Box Seat** — lines per Look, whether a second viewer answers, and the council experiment.
- **Pinned chat** — whichever chat is open, or one chat you pin.
- **Web search** — whether Lumiverse lets Houselights search, with **Allow web search**.
- **Mobile** (shown on a computer only) — the phone's or tablet's widget switch and **Follow my computer**.
- **Prompts** — most people never need to open this. The framing, the self-recognition lines, the
  Heckler / Coach / In character instructions, the Talk back instruction, the Box Seat framing and
  focus, and the vision prompt, each with its own **Reset to stock**, and **Reset to factory** at the
  foot of the card for all of them. Each asks first.
- **Troubleshooting** — **Test with a typed scene** (a reaction with no capture at all; *Restore the
  sample scene* refills the box with the built-in example), **Test the connection** (a made-up picture
  through the whole path), **Session details** (what a report needs: the stream, the timer and the
  counters), and two resets, each asking before it acts: **Reset settings** (every setting back to how
  it came; your prompts, saved instructions and each chat's own settings stay) and **Reset to factory**
  (everything Houselights has stored for you is cleared, prompts and chats included; it can't be
  undone).

---

## On a Mac or an iPhone (beta)

Houselights was built and tested in Chrome on Windows, plus a phone. **Macs, Safari and iPhones
haven't been tested yet**, so treat them as a beta, and please report what happens: it's the
quickest way this gets fixed.

**On a Mac, Chrome, Edge or Firefox is the safer choice for now.** They should behave as they do on
Windows, with one extra step: the first time you share, macOS asks you to allow your browser in
**System Settings → Privacy & Security → Screen & System Audio Recording**. Allow it, then quit and
reopen the browser. Newer macOS versions ask again every so often; that's macOS, not Houselights.

**What's known to differ in Safari** (on a Mac, in the Lumiverse desktop app on a Mac, and in *every*
browser on an iPhone or iPad, since Apple makes them all use Safari's engine):

- You can share a window or a whole screen, not a tab.
- Safari doesn't tell Houselights the window's title, so the *watching* guess has to come from the
  picture instead.
- No pop-out widget: that is a Chrome and Edge feature. The widget still floats in the page.
- Browser speech recognition may need **Siri** or **Dictation** turned on in System Settings.
- On an iPhone, the silent switch can mute the character's voice.
- **The one we're most unsure of:** Safari is reported to stop updating a shared screen once its tab
  is in the background. If so, the character would just go quiet during play, with no error.

**If you try it, what helps most.** Your device, macOS or iOS version, and browser, plus:

1. Did **Look** work at all? If not, the exact words in the status line.
2. **Safari, background test:** set **Mode** to *Continuous*, start a session, put a game or video in
   front of Safari, and play for **five minutes**. Did the character keep reacting to new things, or
   go quiet after the first minute or so?
3. **Next-track key = Look:** does the key reach Safari or Chrome while a game is in front?
4. **Voice:** did replies speak aloud? Did the mic hear you?

## If something goes wrong

The status line in the tab reports the actual error, in words. The three most common:

- **"No active chat to react in"** — open a chat first.
- **"Reactions are off for this chat"** — tick **React in this chat**.
- **"The model returned an empty response … reasoning"** — the connection is thinking even though
  Houselights asked it not to. Pick a light chat model such as Gemma 4.

Lumiverse logs under the name **Houselights**.
