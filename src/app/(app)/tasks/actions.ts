"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth";
import { withRLS } from "@/lib/db/rls";
import { notifyTaskAssigned, notifyTaskForReview } from "@/lib/email/notify";
import {
  taskFormSchema,
  taskStatusSchema,
  type TaskFormValues,
  type TaskStatusValue,
} from "@/lib/validations/task";

export type ActionResult = { ok: true; warning?: string } | { ok: false; error: string };

/**
 * yyyy-mm-dd -> the Date a @db.Date column stores.
 *
 * Constructed with Date.UTC from the parts rather than `new Date(str)`. Both
 * happen to give UTC midnight for this format, but the explicit form can't be
 * broken later by someone "helpfully" accepting another date format, and it
 * documents that the value is a calendar date with no time in it.
 */
function toDateOnly(value: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Creates and assigns a task.
 *
 * Permission is checked here AND enforced by RLS. The check here exists to
 * give a readable error instead of a policy violation; the policy exists
 * because a check in application code is not a security boundary.
 */
export async function createTask(input: TaskFormValues): Promise<ActionResult> {
  const parsed = taskFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const { authUserId, appUser } = await requireOrgContext();
  if (!appUser.canDelegateTasks) {
    return { ok: false, error: "You don't have permission to assign tasks." };
  }

  let taskId: string;
  try {
    taskId = await withRLS(authUserId, async (tx) => {
      // The assignee must be a real colleague in this org. RLS scopes the
      // lookup, so an id from another organisation simply isn't found.
      const assignee = await tx.user.findUnique({
        where: { id: data.assignedToUserId },
        select: { id: true },
      });
      if (!assignee) throw new Error("That person isn't in your organisation.");

      const created = await tx.task.create({
        data: {
          organizationId: appUser.organizationId,
          title: data.title,
          description: data.description || null,
          priority: data.priority,
          startDate: toDateOnly(data.startDate),
          dueDate: toDateOnly(data.dueDate),
          assignedToUserId: data.assignedToUserId,
          createdByUserId: appUser.id,
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't create the task." };
  }

  // After the transaction commits, never inside it: the task existing is the
  // real work, and a mail failure must not roll it back.
  const sent = await notifyTaskAssigned(taskId);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");

  if (!sent.ok && !sent.skipped) {
    return { ok: true, warning: `Task created, but the email didn't send: ${sent.error}` };
  }
  return { ok: true };
}

export async function updateTask(taskId: string, input: TaskFormValues): Promise<ActionResult> {
  const parsed = taskFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const { authUserId, appUser } = await requireOrgContext();
  if (!appUser.canDelegateTasks) {
    return { ok: false, error: "You don't have permission to edit tasks." };
  }

  let reassignedTo: string | null = null;
  try {
    reassignedTo = await withRLS(authUserId, async (tx) => {
      const before = await tx.task.findUnique({
        where: { id: taskId },
        select: { assignedToUserId: true },
      });
      if (!before) throw new Error("Task not found.");

      await tx.task.update({
        where: { id: taskId },
        data: {
          title: data.title,
          description: data.description || null,
          priority: data.priority,
          startDate: toDateOnly(data.startDate),
          dueDate: toDateOnly(data.dueDate),
          assignedToUserId: data.assignedToUserId,
        },
      });
      // Only a CHANGE of assignee warrants another email -- re-notifying on
      // every edit would train people to ignore the notifications.
      return before.assignedToUserId !== data.assignedToUserId ? data.assignedToUserId : null;
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't update the task." };
  }

  if (reassignedTo) await notifyTaskAssigned(taskId);
  revalidatePath("/tasks");
  return { ok: true };
}

/**
 * Moves a task between statuses.
 *
 * Separate from updateTask on purpose: this is the one write an assignee is
 * allowed to make, so keeping it its own action means the editable fields
 * never travel through a path they can call. RLS lets an assignee update
 * their own row; it cannot restrict WHICH columns, so that restriction lives
 * here -- and this action writes nothing but status.
 */
export async function updateTaskStatus(
  taskId: string,
  status: TaskStatusValue,
): Promise<ActionResult> {
  const parsed = taskStatusSchema.safeParse({ taskId, status });
  if (!parsed.success) return { ok: false, error: "Invalid status." };

  const { authUserId, appUser } = await requireOrgContext();

  let becameForReview = false;
  try {
    becameForReview = await withRLS(authUserId, async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: { assignedToUserId: true, status: true, completedAt: true },
      });
      if (!task) throw new Error("Task not found.");
      if (!appUser.canDelegateTasks && task.assignedToUserId !== appUser.id) {
        throw new Error("You can only update tasks assigned to you.");
      }

      await tx.task.update({
        where: { id: taskId },
        data: {
          status,
          // Stamped the first time it completes and never overwritten, so
          // "finished on" survives a re-open and a second completion.
          completedAt:
            status === "Completed" ? (task.completedAt ?? new Date()) : task.completedAt,
        },
      });
      return status === "ForReview" && task.status !== "ForReview";
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't update the status." };
  }

  if (becameForReview) await notifyTaskForReview(taskId);
  revalidatePath("/tasks");
  return { ok: true };
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const { authUserId, appUser } = await requireOrgContext();
  if (!appUser.canDelegateTasks) {
    return { ok: false, error: "You don't have permission to delete tasks." };
  }

  try {
    await withRLS(authUserId, (tx) => tx.task.delete({ where: { id: taskId } }));
  } catch {
    return { ok: false, error: "Couldn't delete the task." };
  }
  revalidatePath("/tasks");
  return { ok: true };
}
