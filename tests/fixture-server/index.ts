import { startFixtureServer } from "../helpers/fixture-server";

/**
 * Standalone fixture site for manual fetcher checks / Playwright support:
 *   pnpm fixture:server
 */
async function main(): Promise<void> {
  const server = await startFixtureServer();
  console.log(`Fixture server listening on ${server.url}`);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
