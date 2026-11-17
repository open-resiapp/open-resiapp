// Owned by the accounting module — BYT-20261117-002 Phase 5.
// Section navigation for every /accounting/* page. Each page keeps its own
// module guard (isModuleEnabled → notFound); the nav renders nothing for
// users who cannot read the books as board.
import AccountingSectionNav from "@modules/accounting/src/components/AccountingSectionNav";

export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AccountingSectionNav />
      {children}
    </>
  );
}
