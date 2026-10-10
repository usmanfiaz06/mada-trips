import { create } from 'zustand';

/** One toast at a time, 3.2 seconds, like the prototype. */
type ToastState = { text: string | null; id: number; show: (text: string) => void; hide: () => void };
let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  text: null,
  id: 0,
  show(text) {
    clearTimeout(timer);
    set({ text, id: Date.now() });
    timer = setTimeout(() => set({ text: null }), 3200);
  },
  hide() { clearTimeout(timer); set({ text: null }); },
}));

export const toast = (text: string) => useToast.getState().show(text);
