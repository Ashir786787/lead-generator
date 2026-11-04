/** Minimal actor passed to data mutations. WorkspaceContext satisfies this shape. */
export interface ActorContext {
  workspaceId: string;
  user: { id: string };
}
