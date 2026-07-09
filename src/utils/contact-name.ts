import { Contact } from "@/database/types/contact";

// Resolve an address to its human name: a saved contact's alias, or — for the
// wallet's own addresses (type "owner") — the account name marked as such.
// Purely a lookup against the user's local contact list, so it can't be spoofed
// by the sender of an address. Returns undefined for unknown addresses.
export function contactDisplayName(contacts: Contact[], address?: string): string | undefined {
  if (!address) return undefined;
  const trimmed = address.trim();
  if (!trimmed) return undefined;
  const contact = contacts.find((c) => c.address === trimmed);
  if (!contact) return undefined;
  return contact.type === "owner" ? `${contact.aliasName} (my account)` : contact.aliasName;
}
