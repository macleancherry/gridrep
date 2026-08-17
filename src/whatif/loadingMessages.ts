import { useEffect, useRef, useState } from "react";

export const LOADING_MESSAGES = [
  "Reticulating splines…",
  "Waiting for the green flag…",
  "Asking the stewards very nicely…",
  "Untangling the wiring loom…",
  "Checking tire pressures…",
  "Radioing the safety car…",
  "Scrolling #paddock-chat on Discord…",
  "Muting someone's push-to-talk mic…",
  "Downloading replay.rpy (4.2 GB)…",
  "Recalculating who actually had the racing line…",
  "Politely asking iRacing's servers for lap times…",
  "Buffering the incident replay…",
  "Counting incident points…",
  "Negotiating with the netcode…",
  "Bribing race control…",
  "Simulating tire degradation…",
  "Debating optimal pit strategy…",
  "Warming up the brakes…",
  "Cross-checking the BoP tables…",
  "Waking up the spotter…",
  "Reconnecting after a rage quit…",
  "Converting bar chat into telemetry…",
];

/** Cycles through LOADING_MESSAGES at random while `active`, starting from a random offset each time it turns on. */
export function useLoadingMessage(active: boolean, intervalMs = 1800): string {
  const [message, setMessage] = useState(() => LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
  const lastIndex = useRef(-1);

  useEffect(() => {
    if (!active) return;

    function pickNext() {
      let next = Math.floor(Math.random() * LOADING_MESSAGES.length);
      if (next === lastIndex.current) next = (next + 1) % LOADING_MESSAGES.length;
      lastIndex.current = next;
      setMessage(LOADING_MESSAGES[next]);
    }

    pickNext();
    const id = setInterval(pickNext, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return message;
}
