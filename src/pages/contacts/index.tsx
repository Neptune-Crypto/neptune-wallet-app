import WithTitlePageHeader from "@/components/header/withTitlePageHeader";
import ContactTable from "@/pages/batch/component/contact-table";

export default function ContactsPage() {
  return (
    <WithTitlePageHeader title="Contacts">
      <ContactTable height={"calc(100vh - 160px)"} />
    </WithTitlePageHeader>
  );
}
