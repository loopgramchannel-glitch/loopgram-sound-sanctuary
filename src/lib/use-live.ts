import { useQuery } from "@tanstack/react-query";
import { DEFAULT_LIVE } from "./live-settings";
import { getLiveSettings } from "./social.functions";

/** Owner's Loop Party switches (defaults until loaded, so nothing flickers off). */
export function useLive() {
  const q = useQuery({ queryKey: ["live-settings"], queryFn: () => getLiveSettings(), staleTime: 30_000, placeholderData: DEFAULT_LIVE });
  return q.data ?? DEFAULT_LIVE;
}
