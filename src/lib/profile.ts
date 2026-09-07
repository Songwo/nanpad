import { create } from "zustand";
import { desktop } from "./desktop";

export interface Profile {
  name: string;
  ready: boolean;
  vaultExists: boolean;
}
export const useProfile = create<{
  profile: Profile | null;
  error: string;
  refresh: () => Promise<void>;
}>((set) => ({
  profile: null,
  error: "",
  refresh: async () => {
    try {
      set({
        error: "",
        profile: (await desktop()?.profile.get()) ?? {
          name: "Nanpad",
          ready: true,
          vaultExists: false,
        },
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
