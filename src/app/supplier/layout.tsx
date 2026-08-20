// NextMav Procure — the supplier portal shell.
//
// A separate application surface, not a mode of the buyer's one. The two realms
// share no session, no navigation and no data-loading path: a supplier reaches
// this tree with their own cookie, and every page under it resolves its own
// principal server-side before rendering anything.
//
// Deliberately plainer than the buyer's shell. A supplier visits to answer a
// tender and leave; a sidebar of modules they have no access to would be noise.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Supplier Portal — NextMav Procure",
};

export default function SupplierLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
