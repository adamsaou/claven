import {
  StateEffect,
  StateField,
  MapMode,
  RangeSet,
  RangeSetBuilder,
  type Extension
} from '@codemirror/state'
import type { EditorState } from '@codemirror/state'
import { gutter, GutterMarker, EditorView } from '@codemirror/view'
import type { LineChange } from '../../../shared/linediff'

/**
 * The change bars, part of THE ADAPTER.
 *
 * App code hands over plain `LineChange` data and this turns it into a gutter.
 * That is the seam: nothing outside `editor/` knows CodeMirror exists.
 *
 * The marks arrive through a StateEffect into a StateField rather than by
 * rebuilding EditorState. Rebuilding on every keystroke would throw away the
 * undo history, which is the one thing the editor must never do quietly.
 */

/** Replace every mark. Diffs are computed whole, so there is no incremental form. */
export const setChangedLines = StateEffect.define<readonly LineChange[]>()

class ChangeMarker extends GutterMarker {
  // Assigned in the constructor body from the parameter, not from `this.kind`.
  // A field initialiser runs before parameter properties are assigned, so
  // reading `this.kind` there is a compile error rather than a subtle bug.
  override elementClass: string

  constructor(private readonly kind: LineChange['kind']) {
    super()
    this.elementClass = `cm-changeBar cm-changeBar-${kind}`
  }

  /**
   * `Simple`, not the inherited default.
   *
   * `GutterMarker` overrides `RangeValue`'s defaults with
   * `mapMode = MapMode.TrackBefore`, which deletes a marker when the character
   * before it is deleted. Measured by running this repo's own CodeMirror in
   * node: with marks on lines 2, 3 and 4 of a five line document, deleting line
   * 1 left marks on 2 and 3, having silently dropped one. Every deletion would
   * make bars vanish until the next diff arrived, which is exactly the flicker
   * the debounce exists to avoid.
   *
   * The cost of `Simple` is that a deletion can collapse two markers onto one
   * position. That is only visible for the fraction of a second before the next
   * diff replaces the whole set, and a duplicate bar is a far smaller lie than
   * a missing one.
   */
  override mapMode = MapMode.Simple

  override eq(other: ChangeMarker): boolean {
    return other.kind === this.kind
  }
}

/**
 * Reserves the gutter's width and nothing else.
 *
 * `initialSpacer` renders a real element into the DOM, so a spacer sharing the
 * change bars' class means an untouched file appears to carry one. It has its
 * own class for that reason: the bars are countable, which is what a test needs
 * in order to say "this file has no changes" and mean it.
 */
class SpacerMarker extends GutterMarker {
  override elementClass = 'cm-changeSpacer'
}

const SPACER = new SpacerMarker()

const MARKERS = {
  added: new ChangeMarker('added'),
  modified: new ChangeMarker('modified'),
  removed: new ChangeMarker('removed')
} as const

function build(
  state: EditorState,
  changes: readonly LineChange[]
): RangeSet<ChangeMarker> {
  const builder = new RangeSetBuilder<ChangeMarker>()
  // Sorted and clamped before building: RangeSetBuilder requires ascending
  // positions and throws otherwise, and a mark past the end of a shorter
  // document would be a crash rather than a wrong pixel.
  const usable = changes
    .filter((change) => change.line >= 1 && change.line <= state.doc.lines)
    .slice()
    .sort((a, b) => a.line - b.line)

  let previous = -1
  for (const change of usable) {
    const from = state.doc.line(change.line).from
    // One marker per line. A line that is both the end of a replacement and the
    // site of a deletion would otherwise be added twice, out of order.
    if (from === previous) continue
    previous = from
    builder.add(from, from, MARKERS[change.kind])
  }
  return builder.finish()
}

const changedLinesField = StateField.define<RangeSet<ChangeMarker>>({
  create() {
    return RangeSet.empty
  },
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setChangedLines)) return build(transaction.state, effect.value)
    }
    // Mapped through edits so the bars follow the text between diffs, which is
    // what makes the debounce invisible while you are typing.
    return transaction.docChanged ? marks.map(transaction.changes) : marks
  }
})

/**
 * Colours are deliberately not ember.
 *
 * BRAND.md spends the accent on "what is focused", and a file with forty
 * changed lines would drown that. These are the semantic colours already in the
 * token set: success for added, info for modified, error for removed.
 */
const theme = EditorView.baseTheme({
  '.cm-changeGutter': { width: '2px', paddingLeft: '2px' },
  '.cm-changeBar': { width: '2px', marginLeft: '0' },
  '.cm-changeSpacer': { width: '2px' },
  '.cm-changeBar-added': { backgroundColor: '#5FBF7A' },
  '.cm-changeBar-modified': { backgroundColor: '#5AD1E6' },
  // A deletion has no line of its own, so it is drawn short and sits at the
  // bottom edge of the line the text used to follow.
  '.cm-changeBar-removed': {
    backgroundColor: '#E5484D',
    height: '35%',
    marginTop: 'auto',
    alignSelf: 'flex-end'
  }
})

export function gitGutter(): Extension {
  return [
    changedLinesField,
    gutter({
      class: 'cm-changeGutter',
      markers: (view) => view.state.field(changedLinesField),
      // Nothing to draw on a line with no mark, but the gutter still has to
      // reserve its width or line numbers shift the first time a bar appears.
      initialSpacer: () => SPACER
    }),
    theme
  ]
}
