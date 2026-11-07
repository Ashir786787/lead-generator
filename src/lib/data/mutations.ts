import { collections, newId, now } from "@/lib/db";
import type { ActivityType, BusinessDoc } from "@/lib/db/types";
import type { WorkspaceContext } from "@/lib/auth/session";
import { notFound } from "@/lib/api/errors";
import { publishEvent } from "@/lib/events/bus";
import { ensureTag, linkTag } from "@/lib/data/tags";
import type { PipelineStatus } from "@/lib/constants";
import { PIPELINE_STATUS_LABELS } from "@/lib/constants";

async function logActivity(
  ctx: WorkspaceContext,
  businessId: string | null,
  type: ActivityType,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await collections.activities.insertOne({
    _id: newId(),
    workspaceId: ctx.workspaceId,
    businessId,
    type,
    message,
    metadata: metadata ?? null,
    actorId: ctx.user.id,
    createdAt: now(),
  });
}

async function assertLead(ctx: WorkspaceContext, id: string) {
  const row = await collections.businesses.findOne(
    { workspaceId: ctx.workspaceId, _id: id },
    { projection: { _id: 1, status: 1, followUpAt: 1, notes: 1 } },
  );
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
  const updates: Partial<BusinessDoc> = { updatedAt: now() };

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

  await collections.businesses.updateOne(
    { workspaceId: ctx.workspaceId, _id: id },
    { $set: updates },
  );

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
    const timestamp = now();
    await collections.notes.insertOne({
      _id: newId(),
      workspaceId: ctx.workspaceId,
      businessId: id,
      body: patch.notes ?? "",
      authorId: ctx.user.id,
      createdAt: timestamp,
      updatedAt: timestamp,
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
  for (const name of clean) ids.push(await ensureTag(ctx.workspaceId, name));

  await collections.businessTags.deleteMany({
    workspaceId: ctx.workspaceId,
    businessId,
  });
  for (const tagId of ids) await linkTag(ctx.workspaceId, businessId, tagId);

  await logActivity(ctx, businessId, "tag_added", clean.length ? `Tags: ${clean.join(", ")}` : "Tags cleared");
}

export async function setContactVerified(
  ctx: WorkspaceContext,
  contactId: string,
  verified: boolean,
): Promise<void> {
  const contact = await collections.contactPoints.findOne(
    { workspaceId: ctx.workspaceId, _id: contactId },
    { projection: { _id: 1, businessId: 1 } },
  );
  if (!contact) throw notFound("Contact not found");
  await collections.contactPoints.updateOne(
    { workspaceId: ctx.workspaceId, _id: contactId },
    { $set: { verifiedByUser: verified } },
  );
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
  const scoped = await collections.businesses
    .find(
      { workspaceId: ctx.workspaceId, _id: { $in: ids }, mergedIntoId: null },
      { projection: { _id: 1 } },
    )
    .toArray();
  const scopedIds = scoped.map((row) => row._id);
  if (!scopedIds.length) return 0;
  await collections.businesses.updateMany(
    { workspaceId: ctx.workspaceId, _id: { $in: scopedIds } },
    {
      $set: {
        status,
        ...(status === "do_not_contact" ? { doNotContact: true } : {}),
        updatedAt: now(),
      },
    },
  );
  const timestamp = now();
  await collections.activities.insertMany(
    scopedIds.map((id) => ({
      _id: newId(),
      workspaceId: ctx.workspaceId,
      businessId: id,
      type: "status_changed" as const,
      message: `Status changed to ${PIPELINE_STATUS_LABELS[status]} (bulk)`,
      metadata: null,
      actorId: ctx.user.id,
      createdAt: timestamp,
    })),
  );
  await publishEvent(ctx.workspaceId, "lead.updated", { count: scopedIds.length });
  return scopedIds.length;
}

export async function bulkArchive(ctx: WorkspaceContext, ids: string[]): Promise<number> {
  const scoped = await collections.businesses
    .find(
      { workspaceId: ctx.workspaceId, _id: { $in: ids }, mergedIntoId: null },
      { projection: { _id: 1 } },
    )
    .toArray();
  const scopedIds = scoped.map((row) => row._id);
  if (!scopedIds.length) return 0;
  const timestamp = now();
  await collections.businesses.updateMany(
    { workspaceId: ctx.workspaceId, _id: { $in: scopedIds } },
    { $set: { archivedAt: timestamp, updatedAt: timestamp } },
  );
  await publishEvent(ctx.workspaceId, "lead.updated", { count: scopedIds.length, archived: true });
  return scopedIds.length;
}

export async function bulkAddTag(ctx: WorkspaceContext, ids: string[], tagName: string): Promise<number> {
  const name = tagName.trim();
  if (!name) return 0;
  const scoped = await collections.businesses
    .find(
      { workspaceId: ctx.workspaceId, _id: { $in: ids }, mergedIntoId: null },
      { projection: { _id: 1 } },
    )
    .toArray();
  const scopedIds = scoped.map((row) => row._id);
  if (!scopedIds.length) return 0;
  const tagId = await ensureTag(ctx.workspaceId, name);
  for (const businessId of scopedIds) {
    await linkTag(ctx.workspaceId, businessId, tagId);
  }
  const timestamp = now();
  await collections.activities.insertMany(
    scopedIds.map((businessId) => ({
      _id: newId(),
      workspaceId: ctx.workspaceId,
      businessId,
      type: "tag_added" as const,
      message: `Tag added: ${name} (bulk)`,
      metadata: null,
      actorId: ctx.user.id,
      createdAt: timestamp,
    })),
  );
  await publishEvent(ctx.workspaceId, "lead.updated", { count: scopedIds.length });
  return scopedIds.length;
}
