/* ink-policy.js -- the VERDICT policy for ink-judged chrome, in one
 * place for both worlds: menu.js applies it to live actors, card-demo
 * mirrors it pixel-for-pixel into the goldens. Keeping it here means
 * the certified render can never drift from shipped behavior by
 * copy-paste -- the Tokyo header incident was exactly that disease
 * (the demo transcribed a static white ladder while the menu judged,
 * and the golden lock froze a surface its renderer never evaluated).
 *
 * Policy only: boxes in, verdicts out. No Clutter, no Cairo, no
 * clock -- deterministic for a given bgPoint, which is what lets the
 * goldens certify the grouping itself. */

import { judgeInk } from './chart.js';

/* five samples per label box: the centre, its four flanks, and one
 * above and below -- a disc grazing any of them counts against the text */
export const SAMPLE_GRID = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5],
    [0.5, 0.25], [0.5, 0.75]];

/** px box [x, y, w, h] in card space -> sample fractions [fx, fy].
 * y clamps to the card; x stays raw (an ellipsized label may overhang
 * its allocation, and that ground still sits under the text). */
export function boxSampleFractions(box, cardWidth, cardHeight) {
    const [x0, y0, bw, bh] = box;
    const out = [];
    for (const [rx, ry] of SAMPLE_GRID) {
        const fy = Math.min(1, Math.max(0, (y0 + bh * ry) / cardHeight));
        const fx = (x0 + bw * rx) / cardWidth;
        if (Number.isFinite(fx + fy))
            out.push([fx, fy]);
    }
    return out;
}

/** Judge a group of boxes as ONE ground: whichever family survives the
 * worst sample of EVERY box wins for the whole group -- labels that
 * share a row must never split their verdict. */
export function judgeBoxes(boxes, cardWidth, cardHeight, bgPoint,
    comp = bg => bg) {
    const bgs = [];
    for (const box of boxes)
        for (const [fx, fy] of boxSampleFractions(box, cardWidth, cardHeight))
            bgs.push(comp(bgPoint(fx, fy)));
    return judgeInk(bgs);
}

/** The animated-sky card's chrome verdicts (menu._applyTextInk):
 *  - headerLeft:  temperature + description read as one left pair;
 *  - headerRight: city + clock read as one right pair -- if either
 *    touches the sun or a full moon, BOTH go to the other family;
 *  - tabActive:   judged through its dark glass (compGlass), where the
 *    glow family almost always keeps its seat; null skips the group
 *    entirely (unmapped button: keep whatever style it already wears);
 *  - tabsIdle:    the whole inactive row, one verdict for all -- a
 *    disc under the last tab sends the first tab to ink too.
 * bgPoint(fx, fy) answers "what is the ground rgb at this card
 * fraction", the caller's job alone (menu samples sky+scrim+disc, the
 * demo samples its own identical stack). */
export function chromeVerdicts(boxes, cardWidth, cardHeight, bgPoint,
    compGlass) {
    const judge = (list, comp) => judgeBoxes(list.filter(Boolean),
        cardWidth, cardHeight, bgPoint, comp);
    return {
        headerLeft: judge(boxes.headerLeft),
        headerRight: judge(boxes.headerRight),
        tabActive: boxes.tabActive
            ? judge([boxes.tabActive], compGlass) : null,
        tabsIdle: boxes.tabsIdle.length
            ? judge(boxes.tabsIdle) : null,
    };
}
