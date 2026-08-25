import { AddressValidation, validateAddress } from "@/commands/wallet";
import { useDebouncedValue } from "@mantine/hooks";
import { useEffect, useState } from "react";

// Inline verdict for a single address field, from the backend parser.
// A verdict is only reported while it still matches the current input, so
// a slow response can never flag a value the user already corrected; a
// failed invoke leaves it unknown, which never blocks the caller.
export function useAddressValidation(address: string) {
  const trimmed = address.trim();
  const [checked, setChecked] = useState<{
    address: string;
    verdict: AddressValidation;
  } | null>(null);
  const [debounced] = useDebouncedValue(trimmed, 350);

  useEffect(() => {
    if (!debounced) return;
    let cancelled = false;
    validateAddress(debounced)
      .then((verdict) => {
        if (!cancelled) setChecked({ address: debounced, verdict });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const verdict = checked && checked.address === trimmed ? checked.verdict : null;
  return {
    invalid: trimmed !== "" && verdict !== null && !verdict.valid,
    keyType: verdict?.valid ? verdict.keyType : undefined,
  };
}
