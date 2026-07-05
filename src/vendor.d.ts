/**
 * Ambient stubs for the vendored, importmap-resolved libraries. These ship as
 * plain ESM in public/vendor and carry no type definitions; we type-check OUR
 * code, not the libraries, so they are declared loosely here. This file is
 * type-only — never imported at runtime, so it does not affect the zero-build
 * "clone and serve" property. If we ever want real types for one of these
 * (e.g. @types/three), swap its stub for the real declaration.
 */

declare module 'three';
declare module 'gsap';
declare module 'gsap/ScrollTrigger';
declare module 'lenis';
declare module 'satellite';

// Absolute-path dynamic import used for the optional Lenis smooth-scroll module.
declare module '/public/vendor/lenis/lenis.min.js';
