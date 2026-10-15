// Tier 3: the data service. Express hosts Apollo Server; Postgres sits behind it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import { ApolloServerPluginLandingPageDisabled } from "@apollo/server/plugin/disabled";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";
import { unwrapResolverError } from "@apollo/server/errors";
import { GraphQLError } from "graphql";
import { config } from "./config.ts";
import { isServiceCall, userFromAuthHeader } from "./auth.ts";
import { pool } from "./db.ts";
import { depthLimit } from "./depth-limit.ts";
import { createLoaders } from "./loaders.ts";
import { resolvers, type Context } from "./resolvers.ts";

export const typeDefs = readFileSync(fileURLToPath(new URL("./schema.graphql", import.meta.url)), "utf8");

export async function createApp() {
  const apollo = new ApolloServer<Context>({
    typeDefs,
    resolvers,
    introspection: !config.production,                       // don't publish the schema map in production
    validationRules: [depthLimit(8)],
    plugins: [config.production ? ApolloServerPluginLandingPageDisabled() : ApolloServerPluginLandingPageLocalDefault({ embed: true })],
    formatError: (formatted, error) => {
      // Expected errors (bad input, auth) pass through; anything unexpected is logged here and masked for the client.
      const original = unwrapResolverError(error);
      if (original instanceof GraphQLError || formatted.extensions?.code !== "INTERNAL_SERVER_ERROR") return formatted;
      console.error("[graphql]", original);
      return { message: "Internal server error", extensions: { code: "INTERNAL_SERVER_ERROR" } };
    },
  });
  await apollo.start();

  const app = express();
  app.disable("x-powered-by");
  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.use("/graphql", express.json({ limit: "100kb" }), expressMiddleware(apollo, {
    context: async ({ req }): Promise<Context> => ({
      user: await userFromAuthHeader(req.get("authorization")),
      service: isServiceCall(req.get("x-service-key")),
      loaders: createLoaders(),                               // fresh per request
    }),
  }));
  return { app, apollo };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = await createApp();
  const server = app.listen(config.port, config.host, () =>
    console.log(`CardioLens data API on http://${config.host}:${config.port}/graphql${config.production ? "" : "  (Apollo Sandbox at the same URL)"}`));
  const shutdown = () => server.close(async () => { await pool.end(); process.exit(0); });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
