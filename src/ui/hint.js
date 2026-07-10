// @ts-check
/**
 * hint.js — a small, styled, accessible tooltip primitive.
 *
 * Replaces raw `title=""` attributes (ugly, unstyled, not clickable) with a
 * proper popover: on hover OR keyboard focus it shows a short explanation and an
 * optional "Learn how →" link that routes to the relevant docs article, so a
 * visitor can go straight from a CONNECT-FOR-LIVE label to the instructions.
 *
 * Pure markup helper — no per-instance JS. Behaviour is CSS (`:hover` /
 * `:focus-within`), styled globally in styles/components.css (.hint*). The link
 * carries `data-route` so the SPA router intercepts it.
 *
 * @module ui/hint
 */

'use strict';

import { esc } from '../utils.js';

/**
 * Wrap a label in a hoverable hint with a styled tooltip.
 *
 * @param {string} labelHtml  the visible label markup (e.g. an amber chip span).
 * @param {string} text       one/two-sentence explanation shown in the tooltip.
 * @param {object} [opts]
 * @param {string} [opts.docRoute]  a SPA route (e.g. '/docs/going-live') the
 *   "Learn how →" link navigates to. Omit for an explanation-only tooltip.
 * @param {string} [opts.linkText='Learn how →']  the link label.
 * @param {'up'|'down'} [opts.place='up']  which side the tooltip opens on.
 * @param {'start'|'center'|'end'} [opts.align='center']  horizontal anchor —
 *   use 'end' for a right-aligned label so the popover doesn't overflow the edge.
 * @param {string} [opts.className='']  extra classes on the wrapper.
 * @returns {string} HTML string.
 */
export function hint(labelHtml, text, opts = {}) {
  const { docRoute = '', linkText = 'Learn how →', place = 'up', align = 'center', className = '' } = opts;
  const link = docRoute
    ? `<a class="hint__link" href="${esc(docRoute)}" data-route="${esc(docRoute)}">${esc(linkText)}</a>`
    : '';
  return (
    `<span class="hint hint--${place} hint--${align} ${className}" tabindex="0" aria-label="${esc(text)}">` +
    labelHtml +
    `<span class="hint__pop" role="tooltip">` +
    `<span class="hint__text">${esc(text)}</span>` +
    link +
    `</span>` +
    `</span>`
  );
}
