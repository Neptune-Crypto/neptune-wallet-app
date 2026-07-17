import { OutputInfo } from "@/utils/api/types";

// Transaction records written before outputs carried change/amount metadata
// stored each output as a bare commitment string. Accept both shapes so the
// UI can render old and new records uniformly; legacy entries have no
// amount/is_change, so callers show them without a change/recipient label.
export function normalizeOutput(output: OutputInfo | string): OutputInfo {
  return typeof output === "string" ? { commitment: output } : output;
}

export interface OutputGroup {
  key: string;
  // Recipient address (bech32m); undefined for the change group and for
  // recipient outputs whose address couldn't be resolved.
  address?: string;
  isChange: boolean;
  items: { commitment: string; amount?: string }[];
}

// Groups a record's outputs for display: one group per recipient address, plus
// a single change group. Returns null for legacy records that carry no
// per-output metadata (no address and no is_change), so callers can fall back
// to the flat commitment display. Change is always listed last.
export function buildOutputGroups(raw: (OutputInfo | string)[]): OutputGroup[] | null {
  const outputs = (raw ?? []).map(normalizeOutput);
  const structured = outputs.some((o) => o.address !== undefined || o.is_change !== undefined);
  if (!structured) return null;

  const byKey = new Map<string, OutputGroup>();
  const order: OutputGroup[] = [];
  for (const o of outputs) {
    const key = o.is_change ? "__change__" : (o.address ?? "__recipient__");
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        address: o.is_change ? undefined : o.address,
        isChange: !!o.is_change,
        items: [],
      };
      byKey.set(key, group);
      order.push(group);
    }
    group.items.push({ commitment: o.commitment, amount: o.amount });
  }
  return order.sort((a, b) => Number(a.isChange) - Number(b.isChange));
}
