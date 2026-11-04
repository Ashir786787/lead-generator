import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  activities,
  businesses,
  businessTags,
  contactPoints,
  notes,
  tags,
} from "@/lib/db/schema";
import type { WorkspaceContext } from "@/lib/auth/session";
import { notFound } from "@/lib/api/errors";
import { publishEvent } from "@/lib/events/bus";
import type { PipelineStatus } from "@/lib/constants";
import { PIPELINE_STATUS_LABELS } from "@/lib/constants";

async function logActivity(
  ctx: WorkspaceContext,
  businessId: string | null,
  type: typeof activities.$inferInsert.type,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.insert(activities).values({
    workspaceId: ctx.workspaceId,
    businessId,
    type,
    message,
    metadata,
    actorId: ctx.user.id,
  });
}

async function assertLead(ctx: WorkspaceContext, id: string) {
  const [row] = await db
    .select({ id: businesses.id, status: businesses.status, followUpAt: businesses.followUpAt, notes: businesses.notes })
    .from(businesses)
    .where(and(eq(businesses.workspaceId, ctx.workspaceId), eq(businesses.id, id)))
    .limit(1);
  if (!row) throw notFound("Lead not found");
  return row;
}

export interface UpdateLeadPatch {
  status?: PipelineStatus;
  notes?: string | null;
  followUpAt?: string | null;
  doNotContact?: boolean;
  ownerId?: string | null;
  tags?: string[];
}

export async function updateLead(ctx: WorkspaceContext, id: string, patch: UpdateLeadPatch): Promise<void> {
  const existing = await assertLead(ctx, id);
  const updates: Partial<typeof businesses.$inferInsert> = { updatedAt: new Date() };

  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (patch.status === "do_not_contact") updates.doNotContact = true;
  }
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.followUpAt !== undefined) {
    updates.followUpAt = patch.followUpAt ? new Date(patch.followUpAt) : null;
  }
  if (patch.doNotContact !== undefined) {
    updates.doNotContact = patch.doNotContact;
    if (patch.doNotContact) updates.status = "do_not_contact";
  }
  if (patch.ownerId !== undefined) updates.ownerId = patch.ownerId;

  await db
    .update(businesses)
    .set(updates)
    .where(and(eq(businesses.workspaceId, ctx.workspaceId), eq(businesses.id, id)));

  if (patch.status !== undefined && patch.status !== existing.status) {
    await logActivity(
      ctx,
      id,
      "status_changed",
      `Status changed to ${PIPELINE_STATUS_LABELS[patch.status]}`,
      { from: existing.status, to: patch.status },
    );
  }
  if (patch.notes !== undefined && patch.notes !== existing.notes) {
    await logActivity(ctx, id, "note_added", "Notes updated");
    await db.insert(notes).values({
      workspaceId: ctx.workspaceId,
      businessId: id,
      body: patch.notes ?? "",
      authorId: ctx.user.id,
    });
  }
  if (patch.followUpAt !== undefined) {
    await logActivity(
      ctx,
      id,
      "follow_up_changed",
      patch.followUpAt ? `Follow-up set to ${patch.followUpAt.slice(0, 10)}` : "Follow-up cleared",
    );
  }
  if (patch.ownerId !== undefined) {
    await logActivity(ctx, id, "owner_changed", "Owner updated");
  }
  if (patch.doNotContact !== undefined) {
    await logActivity(
      ctx,
      id,
      "updated",
      patch.doNotContact ? "Marked as do not contact" : "Do-not-contact removed",
    );
  }
  if (patch.tags !== undefined) {
    await setTags(ctx, id, patch.tags);
  }

  await publishEvent(ctx.workspaceId, "lead.updated", { businessId: id });
}

export async function setTags(ctx: WorkspaceContext, businessId: string, names: string[]): Promise<void> {
  const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, 20);
  const ids: string[] = [];
  for (const name of clean) {
    await db
      .insert(tags)
      .values({ workspaceId: ctx.workspaceId, name })
      .onConflictDoNothing({ target: [tags.workspaceId, tags.name] });
    const [tag] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.workspaceId, ctx.workspaceId), eq(tags.name, name)))
      .limit(1);
    if (tag) ids.push(tag.id);
  }
  await db
    .delete(businessTags)
    .where(and(eq(businessTags.workspaceId, ctx.workspaceId), eq(businessTags.businessId, businessId)));
  if (ids.length) {
    await db
      .insert(businessTags)
      .values(ids.map((tagId) => ({ workspaceId: ctx.workspaceId, businessId, tagId })))
      .onConflictDoNothing();
  }
  await logActivity(ctx, businessId, "tag_added", clean.length ? `Tags: ${clean.join(", ")}` : "Tags cleared");
}

export async function setContactVerified(
  ctx: WorkspaceContext,
  contactId: string,
  verified: boolean,
): Promise<void> {
  const [contact] = await db
    .select({ id: contactPoints.id, businessId: contactPoints.businessId })
    .from(contactPoints)
    .where(and(eq(contactPoints.workspaceId, ctx.workspaceId), eq(contactPoints.id, contactId)))
    .limit(1);
  if (!contact) throw notFound("Contact not found");
  await db
    .update(contactPoints)
    .set({ verifiedByUser: verified })
    .where(and(eq(contactPoints.workspaceId, ctx.workspaceId), eq(contactPoints.id, contactId)));
  await logActivity(
    ctx,
    contact.businessId,
    "contact_verified",
    verified ? "Contact marked verified by you" : "Contact verification removed",
  );
  await publishEvent(ctx.workspaceId, "lead.updated", { businessId: contact.businessId });
}

export async function bulkSetStatus(
  ctx: WorkspaceContext,
  ids: string[],
  status: PipelineStatus,
): Promise<number> {
  const scoped = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.workspaceId, ctx.workspaceId),
        inArray(businesses.id, ids),
        isNull(businesses.mergedIntoId),
      ),
    );
  const scopedIds = scoped.map((row) => row.id);
  if (!scopedIds.length) return 0;
  await db
    .update(businesses)
    .set({
      status,
      ...(status === "do_not_contact" ? { doNotContact: true } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(businesses.workspaceId, ctx.workspaceId), inArray(businesses.id, scopedIds)));
  await db.insert(activities).values(
    scopedIds.map((id) => ({
      workspaceId: ctx.workspaceId,
      businessId: id,
      type: "status_changed" as const,
      message: `Status changed to ${PIPELINE_STATUS_LABELS[status]} (bulk)`,
      actorId: ctx.user.id,
    })),
  );
  await publishEvent(ctx.workspaceId, "lead.updated", { count: scopedIds.length });
  return scopedIds.length;
}

export async function bulkArchive(ctx: WorkspaceContext, ids: string[]): Promise<number> {
  const scoped = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.workspaceId, ctx.workspaceId),
        inArray(businesses.id, ids),
        isNull(businesses.mergedIntoId),
      ),
    );
  const scopedIds = scoped.map((row) => row.id);
  if (!scopedIds.length) return 0;
  await db
    .update(businesses)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(businesses.workspaceId, ctx.workspaceId), inArray(businesses.id, scopedIds)));
  await publishEvent(ctx.workspaceId, "lead.updated", { count: scopedIds.length, archived: true });
  return scopedIds.length;
}

export async function bulkAddTag(ctx: WorkspaceContext, ids: string[], tagName: string): Promise<number> {
  const name = tagName.trim();
  if (!name) return 0;
  const scoped = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.workspaceId, ctx.workspaceId),
        inArray(businesses.id, ids),
        isNull(businesses.mergedIntoId),
      ),
    );
  const scopedIds = scoped.map((row) => row.id);
  if (!scopedIds.length) return 0;
  await db
    .insert(tags)
    .values({ workspaceId: ctx.workspaceId, name })
    .onConflictDoNothing({ target: [tags.workspaceId, tags.name] });
  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.workspaceId, ctx.workspaceId), eq(tags.name, name)))
    .limit(1);
  if (!tag) return 0;
  await db
    .insert(businessTags)
    .values(scopedIds.map((businessId) => ({ workspaceId: ctx.workspaceId, businessId, tagId: tag.id })))
    .onConflictDoNothing();
  await db.insert(activities).values(
    scopedIds.map((businessId) => ({
      workspaceId: ctx.workspaceId,
      businessId,
      type: "tag_added" as const,
      message: `Tag added: ${name} (bulk)`,
      actorId: ctx.user.id,
    })),
  );
  await publishEvent(ctx.workspaceId, "lead.updated", { count: scopedIds.length });
  return scopedIds.length;
}
