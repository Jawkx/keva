import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getDeviceLanguage() {
  return navigator.language.split("-")[0] ?? navigator.language;
}

export function noop() {}

export function off<TEvent extends Event>(
  element: EventTarget,
  events: string | string[],
  callback: (event: TEvent) => void,
) {
  for (const event of Array.isArray(events) ? events : [events]) {
    element.removeEventListener(event, callback as EventListener);
  }

  return element;
}

export function on<TEvent extends Event>(
  element: EventTarget,
  events: string | string[],
  callback: (event: TEvent) => void,
) {
  for (const event of Array.isArray(events) ? events : [events]) {
    element.addEventListener(event, callback as EventListener);
  }

  return element;
}

export function toFixedNumber(number: number, digits: number, base = 10) {
  const power = Math.pow(base, digits);
  return Math.round(number * power) / power;
}
