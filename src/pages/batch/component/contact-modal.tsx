import { queryAllContacts } from "@/store/contact/contact-slice";
import { useAppDispatch } from "@/store/hooks";
import { Modal } from "@mantine/core";
import { useEffect } from "react";
import ContactTable from "./contact-table";

interface Props {
  opened: boolean;
  close: () => void;
}
export default function ContactModal({ opened, close }: Props) {
  const dispatch = useAppDispatch();
  useEffect(() => {
    dispatch(queryAllContacts());
  }, [dispatch]);
  return (
    <Modal size={"lg"} opened={opened} onClose={close} title="Address Book">
      <ContactTable />
    </Modal>
  );
}
