import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { HealthStatus } from "@/common/enums";

const health = new Hono();

// Response schemas
const HealthResponseSchema = z.object({
  status: z.enum(HealthStatus),
  timestamp: z.string(),
});

const HealthChecksSchema = z.object({
  server: z.enum(HealthStatus),
  database: z.enum(HealthStatus),
});

const DetailedHealthResponseSchema = z.object({
  status: z.enum(HealthStatus),
  checks: HealthChecksSchema,
  timestamp: z.string(),
});

// Basic health check
health.get(
  "/",
  describeRoute({
    operationId: "healthCheck",
    tags: ["Health"],
    summary: "Health check",
    description: "Basic health check endpoint",
    responses: {
      200: {
        description: "Service is healthy",
        content: {
          "application/json": {
            schema: resolver(HealthResponseSchema),
          },
        },
      },
    },
  }),
  (c) => {
    return c.json(
      {
        status: HealthStatus.HEALTHY,
        timestamp: new Date().toISOString(),
      },
      200
    );
  }
);

// Detailed health check
health.get(
  "/detailed",
  describeRoute({
    operationId: "detailedHealthCheck",
    tags: ["Health"],
    summary: "Detailed health check",
    description: "Detailed health check with integrations status",
    responses: {
      200: {
        description: "All systems healthy",
        content: {
          "application/json": {
            schema: resolver(DetailedHealthResponseSchema),
          },
        },
      },
      503: {
        description: "Service unhealthy",
        content: {
          "application/json": {
            schema: resolver(DetailedHealthResponseSchema),
          },
        },
      },
    },
  }),
  async (c) => {
    const checks = {
      server: HealthStatus.HEALTHY,
    };

    const isHealthy = Object.values(checks).every(
      (status) => status === HealthStatus.HEALTHY
    );

    return c.json(
      {
        status: isHealthy ? HealthStatus.HEALTHY : HealthStatus.UNHEALTHY,
        checks,
        timestamp: new Date().toISOString(),
      },
      isHealthy ? 200 : 503
    );
  }
);

export { health };
