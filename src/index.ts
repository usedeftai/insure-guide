import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleQuery } from "./routes/query";
import { handleVapiWebhook } from "./routes/vapi-webhook";
import { formRoutes } from "./routes/forms";

const app = new Hono();

const welcomeStrings = [
  `Hello Hono from Bun ${process.versions.bun}!`,
  "To learn more about Hono + Bun on Vercel, visit https://vercel.com/docs/frameworks/backend/hono",
];

app.get("/", (c) => {
  return c.text(welcomeStrings.join("\n\n"));
});


app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "*"],
    allowMethods: ["GET", "POST", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

app.get("/", (c) =>
  c.json({
    status: "ok",
    service: "backend",
    message: "BitCamp backend API",
  })
);

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "backend",
    timestamp: new Date().toISOString(),
  })
);

app.post("/query", handleQuery);
app.post("/webhook/vapi", handleVapiWebhook);
app.route("/api/forms", formRoutes);

export default app;
