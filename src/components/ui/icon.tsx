export function Icon({ name, size = 18 }: { name: "plus" | "up" | "down" | "close" | "grip" | "arrow" | "loop" | "play"; size?: number }) {
  const paths = { plus: "M12 5v14M5 12h14", up: "m6 14 6-6 6 6", down: "m6 10 6 6 6-6", close: "m6 6 12 12M6 18 18 6", grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01", arrow: "M4 12h16m-6-6 6 6-6 6", loop: "M4 9a7 7 0 0 1 12-4l3 3M19 3v5h-5M20 15a7 7 0 0 1-12 4l-3-3M5 21v-5h5", play: "m8 5 11 7-11 7Z" };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "grip" ? 3 : 1.6} strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
