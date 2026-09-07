import { useAppSelector } from "@/store/hooks";

export const useLoadingContacts = () => {
  return useAppSelector((state) => state.contact.loadingContacts);
};
export const useAllContacts = () => {
  return useAppSelector((state) => state.contact.contacts);
};
// True once a contact fetch has settled, successfully or not.
export const useContactsLoaded = () => {
  return useAppSelector((state) => state.contact.contactsLoaded);
};
