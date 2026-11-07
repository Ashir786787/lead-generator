import { collections, newId, now } from "@/lib/db";

export async function ensureTag(workspaceId: string, name: string): Promise<string> {
  const existing = await collections.tags.findOne({ workspaceId, name });
  if (existing) return existing._id;
  const id = newId();
  try {
    await collections.tags.insertOne({
      _id: id,
      workspaceId,
      name,
      color: "primary",
      createdAt: now(),
    });
    return id;
  } catch {
    // A concurrent request created the same tag; reuse it.
    const row = await collections.tags.findOne({ workspaceId, name });
    if (!row) throw new Error("Could not create the tag.");
    return row._id;
  }
}

export async function linkTag(
  workspaceId: string,
  businessId: string,
  tagId: string,
): Promise<void> {
  const id = `${businessId}:${tagId}`;
  await collections.businessTags.updateOne(
    { _id: id },
    { $setOnInsert: { _id: id, workspaceId, businessId, tagId } },
    { upsert: true },
  );
}
