"use client";

import { useEffect } from "react";

/**
 * Drives the landing parallax. Each `[data-scene]` element gets `--p`, its scroll progress from 0
 * (top reaches the top of the viewport) to 1 (bottom reaches the bottom); landing.css turns that
 * into motion. With reduced motion, scenes are static and `--p` is the scene's `data-still` value.
 */
export function ScrollScenes() {
  useEffect(() => {
    const scenes = Array.from(document.querySelectorAll<HTMLElement>("[data-scene]"));
    const landing = document.querySelector<HTMLElement>(".landing");
    const start = document.getElementById("start");
    const jumps = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('.landing a[href="#start"]'),
    );
    const prompt = document.getElementById("prompt");

    // "Start your search" and "Skip to search" land in the box, ready to type, not just near it.
    // A fragment jump would move focus to #start itself, so scroll there by hand instead.
    const focusPrompt = (event: MouseEvent) => {
      if (!start || !prompt) return;
      event.preventDefault();
      start.scrollIntoView();
      prompt.focus({ preventScroll: true });
    };
    for (const jump of jumps) jump.addEventListener("click", focusPrompt);

    // Hide "Skip to search" once the search section is on screen, with or without motion.
    const observer =
      landing && start
        ? new IntersectionObserver(
            ([entry]) => landing.toggleAttribute("data-at-start", !!entry?.isIntersecting),
            { rootMargin: "0px 0px -40% 0px" },
          )
        : null;
    if (start) observer?.observe(start);
    // "Skip to search" waits until the hero, with its own button, has scrolled away.
    const hero = document.querySelector(".scene-hero");
    const heroObserver =
      landing && hero
        ? new IntersectionObserver(([entry]) =>
            landing.toggleAttribute("data-past-hero", !entry?.isIntersecting),
          )
        : null;
    if (hero) heroObserver?.observe(hero);
    const cleanUp = () => {
      for (const jump of jumps) jump.removeEventListener("click", focusPrompt);
      observer?.disconnect();
      heroObserver?.disconnect();
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      for (const scene of scenes) scene.style.setProperty("--p", scene.dataset.still ?? "1");
      return cleanUp;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      for (const scene of scenes) {
        const rect = scene.getBoundingClientRect();
        const range = rect.height - vh;
        const p = range > 0 ? Math.min(1, Math.max(0, -rect.top / range)) : 0;
        scene.style.setProperty("--p", p.toFixed(4));
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cleanUp();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return null;
}
