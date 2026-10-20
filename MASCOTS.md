# Mascot images to make

The fr5a mascot is a yellow cartoon chicken whose foot (or tail tip) is an orange fountain-pen nib. The style matches the existing images: thick warm-brown outlines, flat yellow fill with soft shading, a red comb and wattle, an orange beak, and no text.

**Format:** PNG with a transparent background (RGBA), 2048×2048 or a wider landscape canvas like `fr5a-sleep.png` (2016×1109). Leave some empty space around the figure. It is shown 96–148px tall, so the silhouette has to read at that size: one clear prop and no fine detail.

**Where:** save into `src/renderer/src/lib/assets/` with the file name given below.

## Existing poses

| File              | Pose                                       | Used for                           |
| ----------------- | ------------------------------------------ | ---------------------------------- |
| `fr5a-new.png`    | A cracked egg with a nib inside            | Welcome / no note open, empty map  |
| `fr5a-search.png` | Holding a magnifier, a question mark above | No search matches, AI pane welcome |
| `fr5a-sleep.png`  | Curled up asleep                           | Trash is empty, empty folder       |

## New images

### 1. `fr5a-clean.png`: Changes, nothing changed

- **Where:** Changes view when no note differs from the last commit (`Changes.svelte`, "No note differs from the last commit…").
- **Mood:** everything is saved and in sync, nothing to do.
- **Pose:** the chicken standing relaxed and content, wings folded or one wing giving a thumbs-up, eyes closed in a happy smile. Optionally a small tidy stack of paper or a checkmark beside it.
- **Prompt idea:** _cute yellow cartoon chicken mascot with a fountain-pen-nib foot, standing contentedly with a satisfied closed-eye smile, one wing giving a thumbs-up, a small neat stack of paper beside it, thick brown outlines, flat colors, transparent background_

### 2. `fr5a-history.png`: Changes, folder not under git

- **Where:** Changes view when the notes folder has no git repo yet ("This notes folder isn't under git… Set up sync").
- **Mood:** an invitation to start tracking history, not an error.
- **Pose:** the chicken holding a long scroll or a small notebook with a few lines and a branching line (like a git graph) on it, looking up curious and inviting.
- **Prompt idea:** _cute yellow cartoon chicken mascot with a fountain-pen-nib foot, holding an unrolled scroll with a simple branching timeline drawn on it, curious hopeful expression, thick brown outlines, flat colors, transparent background_

### 3. `fr5a-chat.png`: AI pane, no past sessions

- **Where:** AI pane → Past sessions when the list is empty ("No sessions yet…"). Shown small.
- **Mood:** ready to talk.
- **Pose:** the chicken with an empty speech bubble beside its head (no text or dots inside, or three dots at most), one wing raised as if saying hi.
- **Prompt idea:** _cute yellow cartoon chicken mascot with a fountain-pen-nib foot, waving one wing hello, an empty rounded speech bubble beside its head, friendly open expression, thick brown outlines, flat colors, transparent background_

### 4. `fr5a-coins.png`: Usage & cost, no usage yet

- **Where:** session ⋯ → Usage & cost, and Settings → AI → Usage, before any reply has been counted ("No usage yet…"). Shown compact.
- **Mood:** an empty ledger, nothing spent.
- **Pose:** the chicken peeking into an empty small coin jar or piggy-bank-style egg, or holding an empty receipt.
- **Prompt idea:** _cute yellow cartoon chicken mascot with a fountain-pen-nib foot, peering into an empty glass coin jar with mild surprise, thick brown outlines, flat colors, transparent background_

### 5. `fr5a-locked.png`: Encrypted note while the vault is locked

- **Where:** a new screen for opening an encrypted note while the key is locked (there's only an unlock prompt today). It could also go on Settings → Encryption.
- **Mood:** safe and private, not scary.
- **Pose:** the chicken hugging a closed padlock or a golden key, or sitting on top of a locked egg with a small keyhole.
- **Prompt idea:** _cute yellow cartoon chicken mascot with a fountain-pen-nib foot, hugging a large golden padlock protectively, calm reassuring expression, thick brown outlines, flat colors, transparent background_

### 6. `fr5a-offline.png`: AI pane offline / request failed

- **Where:** the AI pane when offline ("You're offline — messages will fail…") or when a run fails. It's a small banner today, so this image would be compact or appear only in an empty chat.
- **Mood:** a mild "oops", not alarming.
- **Pose:** the chicken holding an unplugged cable or looking at a broken Wi-Fi symbol, with a sheepish sweat drop.
- **Prompt idea:** _cute yellow cartoon chicken mascot with a fountain-pen-nib foot, holding an unplugged cable end with a sheepish expression and a small sweat drop, thick brown outlines, flat colors, transparent background_

### 7. `fr5a-synced.png` (optional): Sync done / connected

- **Where:** Settings → Sync after "Connected and up to date.", or a sync with no conflicts.
- **Mood:** success.
- **Pose:** the chicken cheering with both wings up, or with two circular arrows (a sync symbol) behind it.
- **Prompt idea:** _cute yellow cartoon chicken mascot with a fountain-pen-nib foot, cheering with both wings raised, two curved circular arrows behind it, joyful expression, thick brown outlines, flat colors, transparent background_

## Leave as text (no image)

- Sidebar → Tags, "No tags yet" (a narrow sidebar section)
- Move dialog, "No folders match" (inside a small dialog list)
- In-note find, "No matches" (a one-line strip)
