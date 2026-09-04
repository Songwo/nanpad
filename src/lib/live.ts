import { create } from "zustand";

interface LiveState {
  cpu: Record<string, number>;
  memory: Record<string, number>;
  set: (id: string, cpu: number, memory: number) => void;
}

export const useLive = create<LiveState>((set) => ({
  cpu: {},
  memory: {},
  set: (id, cpu, memory) =>
    set((s) => ({
      cpu: { ...s.cpu, [id]: cpu },
      memory: { ...s.memory, [id]: memory },
    })),
}));
