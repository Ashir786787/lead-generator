"use client";

import { createAuthClient } from "better-auth/react";

// Deliberately no absolute baseURL: the auth client then calls
// `/api/auth/*` on the current origin, so the app keeps working when it is
// reached through localhost, a LAN address, or a deployed domain.
export const authClient = createAuthClient();
