// Builds a <use> reference into the SVG sprite defined once in index.html. `el()` in
// views/cases.js uses document.createElement, which produces an inert element for SVG tags,
// so the svg/use nodes here are built with createElementNS instead.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}
