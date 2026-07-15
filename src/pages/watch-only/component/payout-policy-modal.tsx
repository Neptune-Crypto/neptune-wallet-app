import MonoText from "@/components/mono-text";
import {
  PayoutBasis,
  PayoutPolicy,
  PayoutPolicyDraft,
  PayoutRun,
  WatchOnlyAddressRecord,
} from "@/utils/api/types";
import { amount_to_positive_fixed } from "@/utils/math-util";
import {
  Alert,
  Button,
  Divider,
  Flex,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAlertTriangle, IconTrash } from "@tabler/icons-react";
import { format } from "date-fns";
import { useEffect, useState } from "react";

const RUN_STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  skipped_no_receipts: "No receipts",
  skipped_insufficient_funds: "Insufficient funds",
  failed: "Failed",
};

const BASIS_OPTIONS: { value: PayoutBasis; label: string }[] = [
  { value: "Liquid", label: "Liquid received" },
  { value: "TimeLocked", label: "Time-locked received" },
];

// neptune-consensus sets MINING_REWARD_TIME_LOCK_PERIOD = Timestamp::years(3),
// and Timestamp::years counts 365.24 mean days — so the lock is 1095.72 days,
// neither 3*365 nor three calendar years. A cap of 1095 whole days misses every
// mining reward by ~17 hours.
//
// The figure is exact, not nominal: a guesser UTXO's release date is its own
// block's timestamp plus this period, and its receipt time is that same block
// timestamp, so the difference is always precisely this.
const GUESSER_LOCK_DAYS = 3 * 365.24;

// Clears the guesser lock with ten days to spare — enough margin for a
// third-party time lock that was composed a while before it confirmed.
const SUGGESTED_LOCK_CAP_DAYS = 1106;

// Decimal-only, and deliberately not parsed to a number: the multiplier is a
// rate against i128 nau amounts, so it travels to the backend as text.
const DECIMAL_RE = /^\d+(\.\d+)?$/;

const EMPTY_DRAFT: PayoutPolicyDraft = {
  recipient: "",
  basis: "Liquid",
  multiplier: "",
  min_lock_days: "",
  max_lock_days: String(SUGGESTED_LOCK_CAP_DAYS),
  max_daily_payout: "",
  min_confirmations: "10",
  run_time: "09:00",
  armed: false,
};

function isPositiveDecimal(value: string): boolean {
  return DECIMAL_RE.test(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) > 0;
}

function isValidTime(value: string): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

// Backend stores run_time as minutes-of-day; render it back as "HH:MM".
function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Load a saved policy into the form's string-only working shape.
function policyToDraft(policy: PayoutPolicy): PayoutPolicyDraft {
  return {
    recipient: policy.recipient,
    basis: policy.basis,
    multiplier: policy.multiplier,
    min_lock_days: policy.min_lock_days != null ? String(policy.min_lock_days) : "",
    max_lock_days: String(policy.max_lock_days),
    max_daily_payout: policy.max_daily_payout ?? "",
    min_confirmations: String(policy.min_confirmations),
    run_time: minutesToHHMM(policy.run_time),
    armed: policy.armed,
  };
}

/** Field-level errors, keyed by field. A field is absent when it is valid. */
function validate(draft: PayoutPolicyDraft): Partial<Record<keyof PayoutPolicyDraft, string>> {
  const errors: Partial<Record<keyof PayoutPolicyDraft, string>> = {};

  if (!draft.recipient.trim()) {
    errors.recipient = "A recipient address is required";
  }
  if (!isPositiveDecimal(draft.multiplier)) {
    errors.multiplier = "Enter a decimal greater than zero, e.g. 0.5";
  }
  // Required rather than optional: an uncapped policy would pay out against a
  // receipt locked for a million years, i.e. against burnt coins.
  if (draft.basis === "TimeLocked" && !isPositiveInteger(draft.max_lock_days)) {
    errors.max_lock_days = "Enter a whole number of days greater than zero";
  }
  // Optional lower bound; only meaningful for TimeLocked. Must not exceed the max.
  if (draft.basis === "TimeLocked" && draft.min_lock_days) {
    if (!isPositiveInteger(draft.min_lock_days)) {
      errors.min_lock_days = "Enter a whole number of days greater than zero, or leave empty";
    } else if (
      isPositiveInteger(draft.max_lock_days) &&
      Number(draft.min_lock_days) > Number(draft.max_lock_days)
    ) {
      errors.min_lock_days = "Minimum cannot exceed the maximum";
    }
  }
  // Optional; empty means "no ceiling" rather than zero.
  if (draft.max_daily_payout && !isPositiveDecimal(draft.max_daily_payout)) {
    errors.max_daily_payout = "Enter an amount greater than zero, or leave empty for no ceiling";
  }
  if (!isNonNegativeInteger(draft.min_confirmations)) {
    errors.min_confirmations = "Enter a whole number of blocks";
  }
  if (!isValidTime(draft.run_time)) {
    errors.run_time = "Enter a time as HH:MM";
  }
  return errors;
}

interface PayoutPolicyModalProps {
  /** The address the policy meters. `null` keeps the modal closed. */
  address: WatchOnlyAddressRecord | null;
  /** The address's existing policy, if any — loaded into the form for editing. */
  existing: PayoutPolicy | null;
  /** Recorded runs for this policy, newest first (audit history). */
  runs: PayoutRun[];
  onClose: () => void;
  onSave: (draft: PayoutPolicyDraft) => Promise<void>;
  onDelete: () => Promise<void>;
}

export default function PayoutPolicyModal({
  address,
  existing,
  runs,
  onClose,
  onSave,
  onDelete,
}: PayoutPolicyModalProps) {
  const [draft, setDraft] = useState<PayoutPolicyDraft>(EMPTY_DRAFT);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  // Load the existing policy (or a blank form) whenever a different address is
  // opened, so a half-typed policy for one address never bleeds into the next.
  useEffect(() => {
    if (address) {
      setDraft(existing ? policyToDraft(existing) : EMPTY_DRAFT);
      setShowErrors(false);
    }
  }, [address?.id, existing]);

  const set = <K extends keyof PayoutPolicyDraft>(key: K, value: PayoutPolicyDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const errors = validate(draft);
  const errorFor = (key: keyof PayoutPolicyDraft) => (showErrors ? errors[key] : undefined);

  const handleSave = async () => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    setIsSaving(true);
    try {
      await onSave(draft);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  };

  const isTimeLocked = draft.basis === "TimeLocked";
  // A cap shorter than the guesser lock silently zeroes the policy, so say so
  // rather than letting it look configured but never pay.
  const capExcludesRewards =
    isTimeLocked &&
    isPositiveInteger(draft.max_lock_days) &&
    Number(draft.max_lock_days) < GUESSER_LOCK_DAYS;

  return (
    <Modal
      opened={address !== null}
      onClose={onClose}
      title="Daily payout policy"
      centered
      size="lg"
      overlayProps={{ backgroundOpacity: 0.5, blur: 4 }}
    >
      <Flex direction="column" gap="md">
        {address && (
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" c="dimmed">
              Metering
            </Text>
            <Text size="sm">{address.name || "this address"}</Text>
            <MonoText value={address.address_short_form} copy={false} full={false} />
          </Group>
        )}

        <Alert color="blue" variant="light">
          <Text size="xs">
            Watch-only funds can never be spent. Each payout is sent from{" "}
            <b>this account&apos;s own balance</b> — the watched address only decides how much.
          </Text>
        </Alert>

        <TextInput
          label="Recipient"
          data-autofocus
          required
          value={draft.recipient}
          error={errorFor("recipient")}
          onChange={(event) => set("recipient", event.currentTarget.value)}
          placeholder="The address every payout is sent to"
        />

        <Flex direction="column" gap={4}>
          <Text size="sm" fw={500}>
            Pay against
          </Text>
          <SegmentedControl
            fullWidth
            data={BASIS_OPTIONS}
            value={draft.basis}
            onChange={(value) => set("basis", value as PayoutBasis)}
          />
          <Text c="dimmed" size="xs">
            {isTimeLocked
              ? "Counts receipts that arrived carrying a time lock."
              : "Counts receipts that arrived spendable, with no time lock."}
          </Text>
        </Flex>

        <TextInput
          label="Multiplier"
          required
          value={draft.multiplier}
          error={errorFor("multiplier")}
          onChange={(event) => set("multiplier", event.currentTarget.value)}
          placeholder="0.5"
          description={
            isPositiveDecimal(draft.multiplier)
              ? `Each day, pay ${draft.multiplier} × the ${
                  isTimeLocked ? "time-locked" : "liquid"
                } amount received since the last payout.`
              : "Each day, pay this multiple of the amount received since the last payout."
          }
        />

        <TextInput
          label="Run time"
          type="time"
          required
          value={draft.run_time}
          error={errorFor("run_time")}
          onChange={(event) => set("run_time", event.currentTarget.value)}
          description="Local time of day the payout runs, once daily. A run missed while the app was closed is caught up on next launch."
        />

        {isTimeLocked && (
          <>
            <TextInput
              label="Ignore locks shorter than"
              value={draft.min_lock_days}
              error={errorFor("min_lock_days")}
              onChange={(event) => set("min_lock_days", event.currentTarget.value)}
              placeholder="Leave empty for no lower bound"
              rightSection={
                <Text size="xs" c="dimmed" pr="xs">
                  days
                </Text>
              }
              rightSectionWidth={44}
              description="Optional. Receipts locked for fewer days than this are excluded — e.g. to pay only against long-locked mining rewards."
            />

            <TextInput
              label="Ignore locks longer than"
              required
              value={draft.max_lock_days}
              error={errorFor("max_lock_days")}
              onChange={(event) => set("max_lock_days", event.currentTarget.value)}
              placeholder={String(SUGGESTED_LOCK_CAP_DAYS)}
              rightSection={
                <Text size="xs" c="dimmed" pr="xs">
                  days
                </Text>
              }
              rightSectionWidth={44}
              description={`Measured from when each UTXO was received. Receipts locked for longer are excluded entirely — a lock far enough out is a burn, and paying against it is a pure loss. Mining rewards sit at ${GUESSER_LOCK_DAYS} days, so a cap must clear that to include them.`}
            />
          </>
        )}

        {capExcludesRewards && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Text size="xs">
              Mining rewards are locked for exactly {GUESSER_LOCK_DAYS} days, so a cap of{" "}
              {draft.max_lock_days} days excludes every one of them and this policy would never pay.
              Use {SUGGESTED_LOCK_CAP_DAYS} for ten days of margin.
            </Text>
          </Alert>
        )}

        <Divider label="Limits" labelPosition="left" />

        <TextInput
          label="Maximum per payout"
          value={draft.max_daily_payout}
          error={errorFor("max_daily_payout")}
          onChange={(event) => set("max_daily_payout", event.currentTarget.value)}
          placeholder="Leave empty for no ceiling"
          rightSection={
            <Text size="xs" c="dimmed" pr="xs">
              NPT
            </Text>
          }
          rightSectionWidth={44}
          description="A single run never sends more than this. Anything the multiplier works out to above the ceiling is dropped, not carried into the next run — settle the difference by hand if it matters."
        />

        <TextInput
          label="Required confirmations"
          value={draft.min_confirmations}
          error={errorFor("min_confirmations")}
          onChange={(event) => set("min_confirmations", event.currentTarget.value)}
          description="A receipt counts only once buried this many blocks deep, so a reorg cannot undo a receipt you have already paid against."
        />

        <Divider />

        <Switch
          checked={draft.armed}
          onChange={(event) => set("armed", event.currentTarget.checked)}
          label="Armed"
          description="A policy sends nothing while disarmed."
        />

        {draft.armed && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
            <Text size="xs">
              While armed, this wallet sends real funds every day without asking. Payments cannot be
              undone.
            </Text>
          </Alert>
        )}

        {existing && runs.length > 0 && (
          <>
            <Divider label="Recent runs" labelPosition="left" />
            <ScrollArea.Autosize mah={180} type="auto">
              <Table verticalSpacing={4} fz="xs" striped>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>When</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Paid</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {runs.map((run) => (
                    <Table.Tr key={run.id}>
                      <Table.Td>{format(run.run_at, "yyyy-MM-dd HH:mm")}</Table.Td>
                      <Table.Td>{RUN_STATUS_LABELS[run.status] ?? run.status}</Table.Td>
                      <Table.Td ta="right">
                        {run.status === "paid" ? amount_to_positive_fixed(run.payout_amount) : "—"}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
          </>
        )}

        <Group justify={existing ? "space-between" : "flex-end"} mt="xs">
          {existing && (
            <Button
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={14} />}
              loading={isDeleting}
              onClick={handleDelete}
            >
              Delete policy
            </Button>
          )}
          <Button variant="light" loading={isSaving} onClick={handleSave}>
            Save policy
          </Button>
        </Group>
      </Flex>
    </Modal>
  );
}
