/**
 * Scroll pacing shared between the panels and the scroll controller: a stop that has just arrived holds the
 * lap until its blocks are actually on screen (after the start lights), so nobody scrolls past content they
 * never saw.
 */
export const pace = { holdUntil: 0 }
