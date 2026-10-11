"use client";

import * as React from "react";

import { getLocalStorageValue, setLocalStorageValue } from "@/lib/local-storage.client";

// Chat input send/newline keys are a frontend-only preference stored in localStorage,
// so changing browsers requires setting it again. Issue #39 changed the default from
// Ctrl+Enter to Enter in 0.3.2; the old behavior remains available as an option.
export type ChatSendMode = "enter" | "ctrl-enter";

export const CHAT_SEND_MODE_KEY = "artex_chat_send_mode";
export const DEFAULT_CHAT_SEND_MODE: ChatSendMode = "enter";

export const CHAT_SEND_MODE_OPTIONS: { value: ChatSendMode; label: string }[] = [
  { value: "enter", label: "Enter to send, Shift+Enter for new line" },
  { value: "ctrl-enter", label: "Ctrl+Enter to send, Enter for new line" },
];

function parseMode(raw: string | null): ChatSendMode {
  return raw === "ctrl-enter" || raw === "enter" ? raw : DEFAULT_CHAT_SEND_MODE;
}

// Subscribers in the current tab. The storage event fires only in other tabs,
// so changing the setting here must notify inputs in this tab immediately.
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

// Return a string literal so Object.is compares by value without looping in useSyncExternalStore.
function getSnapshot(): ChatSendMode {
  return parseMode(getLocalStorageValue(CHAT_SEND_MODE_KEY));
}

// The server has no localStorage, so render the default until hydration corrects it via getSnapshot.
function getServerSnapshot(): ChatSendMode {
  return DEFAULT_CHAT_SEND_MODE;
}

export function useChatSendMode(): ChatSendMode {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function setChatSendMode(mode: ChatSendMode) {
  setLocalStorageValue(CHAT_SEND_MODE_KEY, mode);
  for (const listener of listeners) listener();
}

// shouldSubmitOnKey decides whether a key press should send.
// isComposing / keyCode 229 means an IME is composing text; allow it so Enter does not submit while selecting characters.
// Enter mode excludes only Shift to preserve the 0.3.2 behavior for users who have not changed the setting.
// Ctrl+Enter mode accepts both Ctrl and Cmd (macOS).
export function shouldSubmitOnKey(e: React.KeyboardEvent, mode: ChatSendMode): boolean {
  if (e.key !== "Enter") return false;
  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return false;
  if (mode === "ctrl-enter") return e.ctrlKey || e.metaKey;
  return !e.shiftKey;
}
