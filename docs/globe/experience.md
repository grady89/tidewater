# The World — experience architecture

Every state, what it says, and what each interaction is for.

## States

- **First launch, no saves.** The globe rises out of the fog: twelve misted seas, no towns. Title "Tiny Tides",
  line under it "A world of tidal towns. Pick a sea." One temperate face is pre-lit and its card is open in the
  new-sector state, so the first click can be "Begin". Message: *this is empty and it is yours.*
- **Returning launch.** The same rise, then the built islands surface one by one, last played last; the camera
  settles on the last-played face with its card open. Enter or a click on it dives. Message: *here is what you
  have; the sea you left is waiting.*
- **Idle.** Nothing hovered: the globe drifts slowly; the card stays on the last-played face (or the pre-lit
  empty one). Hint: "Drag to spin · Click a sea · Enter to dive".
- **Hover.** The face under the pointer lifts and brightens; its card replaces the idle card after 120 ms so a
  fast sweep does not flicker. Keyboard focus behaves as hover (arrows move it face to face).
- **Sector card (built).** Miniature is the face itself, so the card shows text only: name (Instrument Serif),
  biome · band, population, cycles played, last played ("2 hours ago"), and the actions Enter, Rename, Delete,
  Export. Escape closes nothing here (there is nothing modal).
- **Sector card (empty).** "Uncharted sea · Temperate" and the new-sector flow inline: seed field with Random,
  the biome list for the band (only Tidewater selectable; the rest shown greyed with "uncharted"), a name field
  pre-filled ("Third Sea", "Tidewater IV"…), and Begin. Message: *choosing is three fields.*
- **Dive.** Card and title fade, the camera falls into the face, cut, the island eases to its default view; the
  island's HUD fades in. From click to control: 1.6 s (0 with reduced motion).
- **Return** (Town menu → "World", or Escape from the island's top level when nothing is open): the island's
  state is saved into its sector, the camera rises out of the island into the World at the same framing, the
  card for that face is open. Message: *your town is kept; the world is where it lives.*
- **Rename.** In-page prompt over the card (input pre-filled, Enter confirms, Escape cancels).
- **Delete.** In-page confirm: "Clear this sea? The town on it is gone for good." Confirm empties the face
  (the water settles back to uncharted); Cancel returns to the card.
- **Export.** Downloads `tinytides-<name>.json` (the sector record: metadata + SimState).
- **Import.** "Import a sea…" at the bottom of the World: a file picker; the record is validated by the sim's
  deserialize and lands on the hovered empty face, or the first empty face (a confirm asks before replacing a
  built face). Bad files: an in-page notice, nothing changes.
- **Migration** (first run with an old autosave or slots and no sectors): the autosave becomes face 1, the
  slots faces 2–4, each keeping its island seed and slot name ("Town 1" when unnamed). A one-line notice on the
  World says so once. The old keys are left where they were.
- **Reduced motion** (`prefers-reduced-motion: reduce`): no idle drift, no rise, hover lifts without easing,
  dives and returns are cuts with a 200 ms crossfade of the DOM. Every state is reachable.

## Keyboard

Arrows move the hovered face along the polyhedron (left/right around the ring, up/down between bands), Enter
dives, Escape returns from the island (when no panel is open) and cancels dialogs, Tab reaches every button.

## Dialogs

`ui/dialog.ts` provides `confirm(message, {ok, cancel})` and `prompt(message, initial)` as in-page glass
dialogs, promise-based, Escape cancels, Enter confirms, focus trapped. They replace `window.confirm` in the
Town menu's "New town" and `window.prompt` in the slot naming (the slots themselves go away with the World).

## The Town menu on the island

Keeps: save-to-sector is automatic now, so the menu shows the sector name, "World" (return), the island seed
of this town (read-only), the playtest log switch, notes and export, and Quality. The three save slots are
replaced by the World.
