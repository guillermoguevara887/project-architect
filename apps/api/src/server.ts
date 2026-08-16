import "dotenv/config";
import { createServer } from "./create-server.js";

const server = createServer({
  logger: true,
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);
const host = process.env.API_HOST ?? "0.0.0.0";

try {
  await server.listen({ host, port });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
