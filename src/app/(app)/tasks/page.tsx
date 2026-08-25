import { ListChecks } from "lucide-react";
import { requireOrgContext } from "@/lib/auth";
import { ComingSoon } from "@/components/app/coming-soon";

/**
 * Task delegation.
 *
 * Placeholder for now, but the data layer behind it is already built and
 * applied -- see the Task model in prisma/schema.prisma and the policies in
 * supabase/migrations/0007_tasks.sql. What is missing is the board UI.
 */
export default async function TasksPage() {
  const { appUser } = await requireOrgContext();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-muted-foreground">
          {appUser.canDelegateTasks
            ? "Delegate work to the team and track it through to done."
            : "What the team is working on, and who has what."}
        </p>
      </div>

      <ComingSoon
        icon={ListChecks}
        title="Coming soon"
        description="Delegated tasks, with everyone able to see the whole board."
        points={[
          "Tony creates a task — name, description, priority, start and due date — and assigns it to a VA or partner.",
          "The assignee gets an email the moment it lands, with the brief and the due date.",
          "They move it through In progress → For review, and Tony gets told when something is waiting on him.",
          "Every task is visible to everyone, showing who is assigned to what — shared awareness, not four private queues.",
        ]}
        note="Only Tony can create and assign; everyone can read everything and update their own. That split is already enforced at the database, not just in the interface."
        preview={
          <div className="grid gap-2 sm:grid-cols-4">
            {[
              { col: "Not started", items: [["Reconcile July invoices", "Zia", "High"]] },
              { col: "In progress", items: [["Chase PCC network quote", "Ian", "Medium"]] },
              { col: "For review", items: [["Draft Sergent migration doc", "Zia", "Urgent"]] },
              { col: "Completed", items: [["Update client list", "Ian", "Low"]] },
            ].map(({ col, items }) => (
              <div key={col} className="rounded-md border p-2">
                <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">{col}</p>
                {items.map(([title, who, pri]) => (
                  <div key={title} className="rounded border p-2">
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-[11px] leading-tight">{title}</span>
                      <span className="shrink-0 text-[9px] uppercase text-accent">{pri}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{who}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        }
      />
    </div>
  );
}
