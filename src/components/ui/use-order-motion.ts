"use client";
import { useLayoutEffect, useRef } from "react";

export function useOrderMotion() {
  const root = useRef<HTMLOListElement>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    root.current?.querySelectorAll<HTMLElement>("[data-order-id]").forEach(row => {
      const id = row.dataset.orderId!;
      const top = row.offsetTop;
      const previous = positions.current.get(id);
      if (previous !== undefined && previous !== top && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        row.animate([{ transform: `translateY(${previous - top}px)` }, { transform: "translateY(0)" }], { duration: 240, easing: "cubic-bezier(.2,.75,.2,1)" });
      }
      next.set(id, top);
    });
    positions.current = next;
  });
  return root;
}
