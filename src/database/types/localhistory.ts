import { OutputInfo, SendInputItem } from "@/utils/api/types.ts";

export interface ExecutionHistory {
  txid: string;
  timestamp: number;
  height: number;
  addressId: number;
  address: string;
  fee: string;
  priorityFee: string;
  status?: string;
  // New records store OutputInfo objects; records predating that stored bare
  // commitment strings — normalizeOutput() reconciles the two at render time.
  outputs: (OutputInfo | string)[];
  batchOutput: SendInputItem[];
}

export interface ExecutionDbHistory {
  txid: string;
  timestamp: number;
  height: number;
  addressId: number;
  address: string;
  fee: string;
  priorityFee: string;
  status?: string;
  batchOutput: string;
}
