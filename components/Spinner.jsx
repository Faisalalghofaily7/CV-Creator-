"use client";

// Self-contained loading indicator. Its CSS (.spinner / @keyframes
// spinner-rotate) lives in app/globals.css, loaded once by the root
// layout — never in a component-local <style> tag. A component-local
// <style> only exists in the DOM while that component's own return
// branch is the one actually rendering; several components in this app
// (AtsCvBuilder.jsx especially) have multiple mutually-exclusive
// top-level branches, so a spinner class styled that way animates on
// whichever branch happens to define it and renders as a frozen icon on
// every other one. Defining the CSS globally, once, is what actually
// guarantees the animation exists wherever this is used.
export default function Spinner({ size = 14, label = "جارٍ التوليد", style }) {
  return (
    <span
      className="spinner"
      role="status"
      aria-label={label}
      style={{ width: size, height: size, ...style }}
    />
  );
}
